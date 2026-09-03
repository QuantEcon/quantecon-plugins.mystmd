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
 *   <root>/lectures/intro/page.md
 *   <root>/lectures/intro/local.csv
 *   <outside>/secret.csv        (a sibling of the root, not inside it)
 */
let base;
let root;
let page;

before(() => {
  // `realpathSync` because macOS puts the temp directory behind a /var -> /private/var symlink,
  // which would otherwise make every path comparison in these tests spuriously fail.
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qe-project-')));
  root = path.join(base, 'project');
  page = path.join(root, 'lectures', 'intro', 'page.md');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lectures', 'intro'), { recursive: true });
  fs.writeFileSync(path.join(root, PROJECT_MARKER), 'version: 1\n');
  fs.writeFileSync(path.join(root, 'data', 'scores.csv'), 'a\n1\n');
  fs.writeFileSync(page, '# Intro\n');
  fs.writeFileSync(path.join(root, 'lectures', 'intro', 'local.csv'), 'a\n1\n');
  fs.writeFileSync(path.join(base, 'secret.csv'), 'a\n1\n');
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

test('finds the project root by walking up from a page', () => {
  assert.equal(findProjectRoot(page), root);
});

test('finds the project root from a directory, and from a path that does not exist yet', () => {
  assert.equal(findProjectRoot(path.join(root, 'lectures')), root);
  assert.equal(findProjectRoot(path.join(root, 'lectures', 'intro', 'absent.md')), root);
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
  assert.equal(resolved.relative, path.join('data', 'scores.csv'));
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

test('refuses an absolute path', () => {
  const error = caught(() => resolveFile('/etc/passwd', page));
  assert.ok(error instanceof ResolutionError);
  assert.match(error.message, /absolute path/);
});

test('refuses a path that escapes the project root', () => {
  const error = caught(() => resolveFile('../../../secret.csv', page));
  assert.ok(error instanceof ResolutionError);
  assert.match(error.message, /outside the project root/);
});

test('allows escaping the root only when the caller opts in', () => {
  const resolved = resolveFile('../../../secret.csv', page, { allowOutsideRoot: true });
  assert.equal(resolved.path, path.join(base, 'secret.csv'));
});

test('accepts an explicit root override', () => {
  const resolved = resolveFile('scores.csv', page, { root: path.join(root, 'data') });
  assert.equal(resolved.path, path.join(root, 'data', 'scores.csv'));
});

test('reports a missing project rather than resolving against the wrong base', () => {
  const orphan = path.join(base, 'orphan.md');
  const error = caught(() => resolveFile('data/scores.csv', orphan));
  assert.ok(error instanceof ResolutionError);
  assert.match(error.message, new RegExp(PROJECT_MARKER));
});

test('refuses an empty or non-string file option', () => {
  for (const value of ['', '   ', undefined, null, 42]) {
    assert.ok(caught(() => resolveFile(value, page)) instanceof ResolutionError, String(value));
  }
});

test('refuses a page-relative path when the page has no path on disk', () => {
  const error = caught(() => resolveFile('./local.csv', undefined));
  assert.ok(error instanceof ResolutionError);
  assert.match(error.message, /no path on disk/);
});

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('expected the call to throw');
}
