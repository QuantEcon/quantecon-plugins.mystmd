/**
 * The toolchain, proved through the real `myst` CLI rather than in isolation.
 *
 * The probe plugin under `tests/fixtures/probe` is built from the same modules the eight
 * directives will use — `:file:` resolution, the CSV reader, the file cache and deferred
 * diagnostics — and is bundled exactly the way a release asset is bundled. What these tests
 * assert is therefore the behaviour a consuming project actually gets.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  bundleTo,
  mystBuild,
  readPage,
  selectAll,
  skipWithoutMyst,
  tempDir,
  textOf,
  writeProject,
} from './helpers.mjs';

const REACH_CSV = 'rule,reach\nw-01,12\nw-04,7\n';

let dist;
let probe;

before(async () => {
  dist = tempDir('qe-toolchain-dist-');
  probe = await bundleTo('tests/fixtures/probe/index.mjs', 'probe', dist);
});

after(() => fs.rmSync(dist, { recursive: true, force: true }));

/**
 * A project whose page sits two directories deep, so root resolution is actually exercised.
 *
 * The single TOC entry becomes the project index, so the built page is `index.json`. The
 * directive sits on line 3 of the page, which the line-number assertions below rely on.
 */
function project(files) {
  const dir = tempDir('qe-toolchain-');
  writeProject(dir, {
    plugins: [probe],
    toc: ['lectures/intro/page.md'],
    files: {
      'lectures/intro/page.md':
        '# Probe\n\n```{probe-table}\n:file: data/rule_reach.csv\n:label: Rule reach\n```\n',
      'data/rule_reach.csv': REACH_CSV,
      ...files,
    },
  });
  return dir;
}

const probeNode = (dir) =>
  selectAll(readPage(dir).mdast, 'div').find((div) => (div.class ?? '').includes('qe-dv-probe'));

describe('reading a CSV through the toolchain', { skip: skipWithoutMyst }, () => {
  test('resolves :file: against the project root, not the page, and emits both data and a table', async () => {
    const dir = project();
    try {
      const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
      assert.equal(code, 0, `${stdout}\n${stderr}`);

      const node = probeNode(dir);
      assert.ok(node, 'the probe directive should have emitted a classed div');

      // The structured data rides on the node...
      assert.equal(node.contract, '1.0');
      assert.equal(node.primitive, 'probe');
      assert.equal(node.label, 'Rule reach');
      assert.equal(node.source, 'data/rule_reach.csv', 'forward slashes on every platform');
      assert.deepEqual(node.rows, [
        { rule: 'w-01', reach: 12 },
        { rule: 'w-04', reach: 7 },
      ]);
      // ...and numbers survive as numbers, not as strings.
      assert.equal(typeof node.rows[0].reach, 'number');
      // ...and the diagnostics payload does not ship, because the transform strips it.
      assert.equal(node.data, undefined);

      // ...while the children are a genuine table, which is what a plain theme renders.
      const [table] = selectAll(node, 'table');
      assert.ok(table, 'the fallback must be a real table');
      const rows = table.children.filter((child) => child.type === 'tableRow');
      assert.equal(rows.length, 3, 'one header row and two body rows');
      assert.ok(rows[0].children.every((cell) => cell.header === true));
      assert.equal(textOf(rows[1]), 'w-0112');
      assert.equal(textOf(rows[2]), 'w-047');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a page-relative ./ path resolves against the page', async () => {
    const dir = tempDir('qe-toolchain-rel-');
    try {
      writeProject(dir, {
        plugins: [probe],
        toc: ['lectures/intro/page.md'],
        files: {
          'lectures/intro/page.md': '# Probe\n\n```{probe-table}\n:file: ./local.csv\n```\n',
          'lectures/intro/local.csv': 'rule,reach\nlocal-01,3\n',
        },
      });
      const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
      assert.equal(code, 0, `${stdout}\n${stderr}`);
      assert.deepEqual(probeNode(dir).rows, [{ rule: 'local-01', reach: 3 }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * What this proves, and what it does not. Each `myst build` is a fresh process with an
   * empty mdast cache, so every directive runs again and reads the current data whether or
   * not the page changed. That is the property a deploy needs, and it is what is asserted.
   * It says nothing about the file cache, whose proof is `tests/unit/cache.test.mjs`, and
   * nothing about `myst start`, where a CSV edit alone does NOT refresh the page: the engine
   * rebuilds from its own cache without re-running directives, and a plugin cannot declare
   * the CSV a dependency (QuantEcon/mystmd#96).
   */
  test('a fresh build reflects the current data, with no change to the page', async () => {
    const dir = project();
    try {
      assert.equal((await mystBuild(dir)).code, 0);
      assert.equal(probeNode(dir).rows[0].reach, 12);
      fs.writeFileSync(path.join(dir, 'data', 'rule_reach.csv'), 'rule,reach\nw-01,20\nw-04,7\nw-09,1\n');
      assert.equal((await mystBuild(dir)).code, 0);
      const after = probeNode(dir);
      assert.equal(after.rows.length, 3, 'the new row should be present');
      assert.equal(after.rows[0].reach, 20, 'the changed value should be read');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('failing loudly', { skip: skipWithoutMyst }, () => {
  test('a missing CSV fails --strict, names the line, and leaves a visible admonition', async () => {
    const dir = project();
    try {
      fs.rmSync(path.join(dir, 'data', 'rule_reach.csv'));
      const strict = await mystBuild(dir, { strict: true });
      const output = `${strict.stdout}${strict.stderr}`;
      assert.equal(strict.code, 1, 'a missing data file must fail the build');
      // The directive starts on line 3 of the page; the diagnostic must say so.
      assert.match(output, /page\.md:3 cannot read data\/rule_reach\.csv/);

      // Even on a non-strict build the page says what went wrong rather than silently
      // dropping the region.
      const [admonition] = selectAll(readPage(dir).mdast, 'admonition').filter((node) =>
        (node.class ?? '').includes('qe-dv-error'),
      );
      assert.ok(admonition, 'a failed directive should leave a visible error on the page');
      assert.match(textOf(admonition), /cannot read data\/rule_reach\.csv/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a CSV missing a required column fails --strict and names the column', async () => {
    const dir = project({ 'data/rule_reach.csv': 'rule,occurrences\nw-01,12\n' });
    try {
      const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
      assert.equal(code, 1);
      assert.match(`${stdout}${stderr}`, /missing required column "reach"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a path escaping the project root is refused, lexically and through a symlink', async () => {
    const dir = project();
    try {
      const page = path.join(dir, 'lectures', 'intro', 'page.md');
      fs.writeFileSync(page, '# Probe\n\n```{probe-table}\n:file: ../../../../etc/passwd\n```\n');
      let result = await mystBuild(dir, { strict: true });
      assert.equal(result.code, 1);
      assert.match(`${result.stdout}${result.stderr}`, /outside the project root/);

      const outside = tempDir('qe-outside-');
      fs.writeFileSync(path.join(outside, 'secret.csv'), 'rule,reach\nSECRET,1\n');
      fs.symlinkSync(outside, path.join(dir, 'data', 'out'));
      fs.writeFileSync(page, '# Probe\n\n```{probe-table}\n:file: data/out/secret.csv\n```\n');
      result = await mystBuild(dir, { strict: true });
      assert.equal(result.code, 1, 'a symlink out of the project must be refused too');
      assert.match(`${result.stdout}${result.stderr}`, /outside the project root/);
      fs.rmSync(outside, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a warning diagnostic is reported, once, and does not fail the build', async () => {
    const dir = project({ 'data/rule_reach.csv': 'rule,reach\nw-01,12\nw-04,\n' });
    try {
      const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
      const output = `${stdout}${stderr}`;
      assert.equal(code, 0, output);
      assert.match(output, /page\.md:3 no reach recorded for w-04/);
      assert.equal(probeNode(dir).rows[1].reach, null, 'an empty cell is null, not zero');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The engine premise the whole deferral mechanism rests on, pinned so that a green suite
 * would go red the day it changes (QuantEcon/mystmd#95): a fatal message raised from a
 * directive's own `run()` is logged but NOT counted by `--strict`, while the same message
 * raised from a document-stage transform is. If the first of these ever starts failing the
 * build, the deferral is redundant and this test says so.
 */
describe('the --strict premise', { skip: skipWithoutMyst }, () => {
  const plugin = (raiseFrom) => `
    function fatal(vfile, message) { const m = vfile.message(message); m.fatal = true; return m; }
    const directive = { name: 'boom', body: { type: String },
      run(data, vfile) { ${raiseFrom === 'directive' ? "fatal(vfile, 'raised from the directive');" : ''} return []; } };
    const transform = { name: 'boom-transform', stage: 'document',
      plugin: () => (tree, vfile) => { ${raiseFrom === 'transform' ? "fatal(vfile, 'raised from the transform');" : ''} return tree; } };
    export default { name: 'Boom', directives: [directive], transforms: [transform] };
  `;

  for (const [raiseFrom, expectedExit] of [
    ['directive', 0],
    ['transform', 1],
  ]) {
    test(`a fatal message raised from a ${raiseFrom} exits ${expectedExit} under --strict`, async () => {
      const dir = tempDir(`qe-strict-${raiseFrom}-`);
      try {
        const file = path.join(dir, 'boom.mjs');
        fs.writeFileSync(file, plugin(raiseFrom));
        writeProject(dir, { plugins: [file], files: { 'page.md': '# S\n\n```{boom}\nx\n```\n' } });
        const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
        const output = `${stdout}${stderr}`;
        assert.match(output, new RegExp(`raised from the ${raiseFrom}`), 'the message is logged either way');
        assert.equal(code, expectedExit, output);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
