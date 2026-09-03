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
 * The single TOC entry becomes the project index, so the built page is `index.json`.
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

describe('reading a CSV through the toolchain', { skip: skipWithoutMyst }, () => {
  test('resolves :file: against the project root, not the page, and emits both data and a table', async () => {
    const dir = project();
    try {
      const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
      assert.equal(code, 0, `${stdout}\n${stderr}`);

      const page = readPage(dir);
      const [node] = selectAll(page.mdast, 'div').filter((div) =>
        (div.class ?? '').includes('qe-dv-probe'),
      );
      assert.ok(node, 'the probe directive should have emitted a classed div');

      // The structured data rides on the node...
      assert.equal(node.contract, '1.0');
      assert.equal(node.primitive, 'probe');
      assert.equal(node.label, 'Rule reach');
      assert.equal(node.source, path.join('data', 'rule_reach.csv'));
      assert.deepEqual(node.rows, [
        { rule: 'w-01', reach: 12 },
        { rule: 'w-04', reach: 7 },
      ]);
      // ...and numbers survive as numbers, not as strings.
      assert.equal(typeof node.rows[0].reach, 'number');

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
      const [node] = selectAll(readPage(dir).mdast, 'div').filter((div) =>
        (div.class ?? '').includes('qe-dv-probe'),
      );
      assert.deepEqual(node.rows, [{ rule: 'local-01', reach: 3 }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The scope of this test is deliberate. A fresh `myst build` always reflects the current
   * data, which is what a deploy does. Under `myst start` a CSV edit alone does NOT change
   * the output — the engine rebuilds the page from its own mdast cache without re-running
   * directives, and a plugin has no way to declare the CSV a dependency of the page
   * (QuantEcon/mystmd#96). Touching the page is what picks the new data up, which is why
   * this test touches it.
   */
  test('a regenerated CSV changes the output on the next build, with no restart', async () => {
    const dir = project();
    try {
      assert.equal((await mystBuild(dir)).code, 0);
      const before = selectAll(readPage(dir).mdast, 'div').find((div) =>
        (div.class ?? '').includes('qe-dv-probe'),
      );
      assert.equal(before.rows[0].reach, 12);

      // Rewrite the data the way a report pipeline would, and stamp an unambiguously later
      // mtime so the assertion does not depend on filesystem timestamp granularity.
      const csv = path.join(dir, 'data', 'rule_reach.csv');
      fs.writeFileSync(csv, 'rule,reach\nw-01,20\nw-04,7\nw-09,1\n');
      const later = new Date(Date.now() + 2000);
      fs.utimesSync(csv, later, later);
      // Touch the page too: the engine re-parses a page only when the page's own content
      // hash changes, so without this the directive would not run again and the stale rows
      // would survive. See QuantEcon/mystmd#96.
      fs.appendFileSync(path.join(dir, 'lectures', 'intro', 'page.md'), '\nRebuilt.\n');

      assert.equal((await mystBuild(dir)).code, 0);
      const after = selectAll(readPage(dir).mdast, 'div').find((div) =>
        (div.class ?? '').includes('qe-dv-probe'),
      );
      assert.equal(after.rows.length, 3, 'the new row should be present');
      assert.equal(after.rows[0].reach, 20, 'the changed value should be re-read, not cached');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('failing loudly', { skip: skipWithoutMyst }, () => {
  test('a missing CSV fails --strict and leaves a visible admonition on the page', async () => {
    const dir = project();
    try {
      fs.rmSync(path.join(dir, 'data', 'rule_reach.csv'));
      const strict = await mystBuild(dir, { strict: true });
      assert.equal(strict.code, 1, 'a missing data file must fail the build');
      assert.match(`${strict.stdout}${strict.stderr}`, /cannot read data\/rule_reach\.csv/);

      // Even on a non-strict build the page says what went wrong rather than silently
      // dropping the region.
      const page = readPage(dir);
      const [admonition] = selectAll(page.mdast, 'admonition').filter((node) =>
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

  test('a path escaping the project root is refused', async () => {
    const dir = project();
    try {
      fs.writeFileSync(
        path.join(dir, 'lectures', 'intro', 'page.md'),
        '# Probe\n\n```{probe-table}\n:file: ../../../../etc/passwd\n```\n',
      );
      const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
      assert.equal(code, 1);
      assert.match(`${stdout}${stderr}`, /outside the project root/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a warning diagnostic is reported but does not fail the build', async () => {
    const dir = project({ 'data/rule_reach.csv': 'rule,reach\nw-01,12\nw-04,\n' });
    try {
      const { code, stdout, stderr } = await mystBuild(dir, { strict: true });
      const output = `${stdout}${stderr}`;
      assert.equal(code, 0, output);
      assert.match(output, /no reach recorded for w-04/);
      const [node] = selectAll(readPage(dir).mdast, 'div').filter((div) =>
        (div.class ?? '').includes('qe-dv-probe'),
      );
      assert.equal(node.rows[1].reach, null, 'an empty cell is null, not zero');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
