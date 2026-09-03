/** Unit tests for project-root discovery and `:file:` resolution in src/lib/project.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { findProjectRoot, PROJECT_MARKER, ResolutionError, resolveFile } from '../../src/lib/project.mjs';

/**
 * A throwaway project:
 *   <root>/myst.yml
 *   <root>/data/scores.csv
 *   <root>/data/out            -> symlink to <outside>            (escapes the root)
 *   <root>/..dots/x.csv                                           (a legitimate name)
 *   <root>/lectures/intro/page.md
 *   <root>/lectures/intro/local.csv
 *   <root>/lectures/intro/link.csv -> symlink to <outside>/secret.csv
 *   <root>/sub/myst.yml                                           (a nested project)
 *   <root>/sub/page.md
 *   <outside>/secret.csv        (a sibling of the root, not inside it)
 */
let base;
let root;
let outside;
let page;

before(() => {
  // `realpathSync` because macOS puts the temp directory behind a /var -> /private/var symlink,
  // which would otherwise make every path comparison in these tests spuriously fail.
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qe-project-')));
  root = path.join(base, 'project');
  outside = path.join(base, 'outside');
  page = path.join(root, 'lectures', 'intro', 'page.md');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, '..dots'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lectures', 'intro'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, PROJECT_MARKER), 'version: 1\n');
  fs.writeFileSync(path.join(root, 'sub', PROJECT_MARKER), 'version: 1\n');
  fs.writeFileSync(path.join(root, 'sub', 'page.md'), '# Sub\n');
  fs.writeFileSync(path.join(root, 'data', 'scores.csv'), 'a\n1\n');
  fs.writeFileSync(path.join(root, '..dots', 'x.csv'), 'a\n1\n');
  fs.writeFileSync(page, '# Intro\n');
  fs.writeFileSync(path.join(root, 'lectures', 'intro', 'local.csv'), 'a\n1\n');
  fs.writeFileSync(path.join(outside, 'secret.csv'), 'a\n1\n');
  fs.symlinkSync(outside, path.join(root, 'data', 'out'));
  fs.symlinkSync(path.join(outside, 'secret.csv'), path.join(root, 'lectures', 'intro', 'link.csv'));
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('expected the call to throw');
}

test('finds the project root by walking up from a page', () => {
  assert.equal(findProjectRoot(page), root);
});

test('finds the project root from a directory, and from a path that does not exist yet', () => {
  assert.equal(findProjectRoot(path.join(root, 'lectures')), root);
  assert.equal(findProjectRoot(path.join(root, 'lectures', 'intro', 'absent.md')), root);
});

test('the nearer of two nested projects wins', () => {
  assert.equal(findProjectRoot(path.join(root, 'sub', 'page.md')), path.join(root, 'sub'));
});

test('returns null when there is no myst.yml above the page', () => {
  assert.equal(findProjectRoot(path.join(base, 'secret.csv')), null);
  assert.equal(findProjectRoot(''), null);
  assert.equal(findProjectRoot(undefined), null);
});

test('resolves a bare path against the project root, not the page', () => {
  const resolved = resolveFile('data/scores.csv', page);
  assert.equal(resolved.path, path.join(root, 'data', 'scores.csv'));
  assert.equal(resolved.root, root);
  assert.equal(resolved.relative, 'data/scores.csv');
});

test('relative always uses forward slashes, whatever the platform separator', () => {
  const { relative } = resolveFile('data/scores.csv', page);
  assert.equal(relative.includes('\\'), false);
  assert.equal(relative, 'data/scores.csv');
});

test('resolves a ./ or ../ path against the page', () => {
  assert.equal(
    resolveFile('./local.csv', page).path,
    path.join(root, 'lectures', 'intro', 'local.csv'),
  );
  assert.equal(
    resolveFile('../../data/scores.csv', page).path,
    path.join(root, 'data', 'scores.csv'),
  );
});

test('accepts an entry whose name merely begins with two dots', () => {
  assert.equal(resolveFile('..dots/x.csv', page).path, path.join(root, '..dots', 'x.csv'));
});

test('refuses an absolute path', () => {
  const error = caught(() => resolveFile('/etc/passwd', page));
  assert.ok(error instanceof ResolutionError);
  assert.match(error.message, /absolute path/);
});

test('refuses a path that escapes the project root lexically', () => {
  const error = caught(() => resolveFile('../../../outside/secret.csv', page));
  assert.ok(error instanceof ResolutionError);
  assert.match(error.message, /outside the project root/);
});

test('refuses a symlink inside the project that points outside it', () => {
  // A lexical check would pass both of these; the physical check is what catches them.
  for (const file of ['data/out/secret.csv', './link.csv']) {
    const error = caught(() => resolveFile(file, page));
    assert.ok(error instanceof ResolutionError, file);
    assert.match(error.message, /outside the project root/);
  }
});

test('a symlink target that does not exist yet is still judged by where it would land', () => {
  const error = caught(() => resolveFile('data/out/not-yet-written.csv', page));
  assert.match(error.message, /outside the project root/);
});

test('allows escaping the root only when the caller opts in', () => {
  const resolved = resolveFile('../../../outside/secret.csv', page, { allowOutsideRoot: true });
  assert.equal(resolved.path, path.join(outside, 'secret.csv'));
});

test('accepts an absolute root override and refuses a relative or empty one', () => {
  const resolved = resolveFile('scores.csv', page, { root: path.join(root, 'data') });
  assert.equal(resolved.path, path.join(root, 'data', 'scores.csv'));
  assert.throws(() => resolveFile('scores.csv', page, { root: 'data' }), ResolutionError);
  // An empty override means "not supplied", and discovery still applies.
  assert.equal(resolveFile('data/scores.csv', page, { root: '' }).root, root);
});

test('reports a missing project for a bare path and for a page-relative path alike', () => {
  const orphan = path.join(base, 'orphan.md');
  for (const file of ['data/scores.csv', './scores.csv', '../etc/hosts']) {
    const error = caught(() => resolveFile(file, orphan));
    assert.ok(error instanceof ResolutionError, file);
    assert.match(error.message, new RegExp(PROJECT_MARKER));
  }
});

test('refuses an empty or non-string file option', () => {
  for (const value of ['', '   ', undefined, null, 42]) {
    assert.ok(caught(() => resolveFile(value, page)) instanceof ResolutionError, String(value));
  }
});

test('refuses a page-relative path when the page has no path on disk', () => {
  const error = caught(() => resolveFile('./local.csv', undefined, { root }));
  assert.ok(error instanceof ResolutionError);
  assert.match(error.message, /no path on disk/);
});
