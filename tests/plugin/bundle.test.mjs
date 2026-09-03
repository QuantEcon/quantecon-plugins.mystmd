/**
 * The release artefact itself: `dist/datavis.mjs` must be a single self-contained ESM file
 * that mystmd can load and that carries nothing but this repository's own source.
 *
 * Two properties, checked separately because they fail separately. A plugin registered by
 * URL is cached on its own in the consuming project's `_build` directory, so an import of
 * anything but a Node built-in resolves against the wrong place — that is the first check.
 * But esbuild inlines everything it is not told is external, so a devDependency that crept
 * into `src/` would not show up as an import at all: it would show up as a few hundred
 * kilobytes of someone else's code inside the bundle. The second check is what catches that,
 * and it works because with `minify: false` esbuild prefixes every inlined file with a
 * comment naming its path, and a dependency's path contains `node_modules/`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { bundleAll, externals, FAMILIES, repoRoot } from '../../scripts/bundle.mjs';
import { mystBuild, readPage, skipWithoutMyst, tempDir, writeProject } from './helpers.mjs';

let dist;

before(async () => {
  dist = tempDir('qe-bundle-');
  await bundleAll({ outdir: dist });
});

after(() => fs.rmSync(dist, { recursive: true, force: true }));

/**
 * Every module specifier a file imports, statically or dynamically, one statement per line.
 *
 * Matched line by line on purpose: a lazy multi-line match lets one `import` statement swallow
 * the next and report only the second one's specifier, which is how a side-effect import went
 * unseen in an earlier version of this test.
 */
export function importedSpecifiers(source) {
  const specifiers = [];
  const statement = /^\s*(?:import|export)\b[^'"\n]*?['"]([^'"]+)['"]/;
  const dynamic = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const line of source.split('\n')) {
    const match = line.match(statement);
    if (match) specifiers.push(match[1]);
    for (const call of line.matchAll(dynamic)) specifiers.push(call[1]);
  }
  return specifiers;
}

test('every declared family produces a bundle', () => {
  for (const family of FAMILIES) {
    const outfile = path.join(dist, `${family.name}.mjs`);
    assert.ok(fs.existsSync(outfile), `${family.name} should have been bundled`);
    assert.ok(fs.statSync(outfile).size > 0);
  }
});

test('the specifier scanner sees every form of import and is not fooled by a neighbour', () => {
  const source = [
    'import "left-pad";',
    'import fs from "node:fs";',
    'import { a } from \'node:path\';',
    'export * from "re-exported";',
    'export { b } from "also-re-exported";',
    'const m = await import("dynamic");',
    'const r = require("cjs");',
    '// import "commented-out";',
    'const s = `import x from "in-a-template"`;',
  ].join('\n');
  assert.deepEqual(importedSpecifiers(source), [
    'left-pad',
    'node:fs',
    'node:path',
    're-exported',
    'also-re-exported',
    'dynamic',
    'cjs',
  ]);
});

test('a bundle imports nothing but Node built-ins', () => {
  for (const family of FAMILIES) {
    const source = fs.readFileSync(path.join(dist, `${family.name}.mjs`), 'utf8');
    for (const specifier of importedSpecifiers(source)) {
      assert.ok(
        externals.includes(specifier),
        `${family.name}.mjs imports "${specifier}", which will not resolve from a plugin cache directory`,
      );
    }
  }
});

test('a bundle inlines nothing from node_modules', () => {
  for (const family of FAMILIES) {
    const source = fs.readFileSync(path.join(dist, `${family.name}.mjs`), 'utf8');
    const inlined = [...source.matchAll(/^\/\/ (.*node_modules\/.*)$/gm)].map((m) => m[1]);
    assert.deepEqual(
      inlined,
      [],
      `${family.name}.mjs carries inlined dependency code — the family is Node built-ins only`,
    );
    // Belt and braces: the marker above depends on minify being off, so also check that the
    // string never appears at all.
    assert.equal(source.includes('node_modules/'), false);
  }
});

test('the datavis bundle exposes the plugin shape mystmd expects', async () => {
  const module = await import(path.join(dist, 'datavis.mjs'));
  const plugin = module.default;
  assert.equal(typeof plugin, 'object');
  assert.equal(plugin.name, 'QuantEcon datavis');
  assert.ok(Array.isArray(plugin.directives));
  assert.ok(Array.isArray(plugin.transforms));
  for (const directive of plugin.directives) {
    assert.equal(typeof directive.name, 'string');
    assert.equal(typeof directive.run, 'function');
  }
  for (const transform of plugin.transforms) {
    assert.equal(typeof transform.name, 'string');
    assert.equal(typeof transform.plugin, 'function');
    assert.ok(['document', 'project'].includes(transform.stage));
  }
});

test('the diagnostics transform is registered, because --strict depends on it', async () => {
  const { default: plugin } = await import(path.join(dist, 'datavis.mjs'));
  assert.ok(
    plugin.transforms.some((transform) => transform.name === 'qe-datavis-diagnostics'),
    'a directive-stage fileError never reaches --strict; the transform is what does',
  );
});

test('the bundle carries a provenance banner pointing at the source', () => {
  const source = fs.readFileSync(path.join(dist, 'datavis.mjs'), 'utf8');
  assert.match(source, /generated by scripts\/bundle\.mjs/);
  assert.match(source, /quantecon-plugins\.mystmd/);
});

test('the bundle is byte-identical whichever directory it is built from', async () => {
  const elsewhere = tempDir('qe-bundle-cwd-');
  const previous = process.cwd();
  try {
    process.chdir(elsewhere);
    await bundleAll({ outdir: elsewhere });
  } finally {
    process.chdir(previous);
  }
  try {
    for (const family of FAMILIES) {
      const here = fs.readFileSync(path.join(dist, `${family.name}.mjs`), 'utf8');
      const there = fs.readFileSync(path.join(elsewhere, `${family.name}.mjs`), 'utf8');
      assert.equal(there, here, `${family.name}.mjs differs when built from another directory`);
    }
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('mystmd loads the bundle and reports what it registered', { skip: skipWithoutMyst }, async () => {
  const project = tempDir('qe-bundle-load-');
  try {
    writeProject(project, {
      plugins: [path.join(dist, 'datavis.mjs')],
      files: { 'page.md': '# Loads\n\nNothing to see yet.\n' },
    });
    const { code, stdout, stderr } = await mystBuild(project);
    const output = `${stdout}\n${stderr}`;
    assert.equal(code, 0, output);
    assert.match(output, /QuantEcon datavis/, 'the engine should name the loaded plugin');
    // 0 directives today; #5 and #6 change this number, and this assertion with it.
    assert.match(output, /0 directives, 0 roles, 1 transform/);
    const page = readPage(project);
    assert.equal(page.mdast.type, 'root');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('the families list is what the release workflow will attach', () => {
  assert.ok(fs.existsSync(path.join(repoRoot, 'package.json')));
  assert.deepEqual(
    FAMILIES.map((family) => family.name),
    ['datavis'],
  );
});
