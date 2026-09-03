/**
 * Directive registration, which decides two things the family has to get right up front:
 * what a project must not do (load a family twice), and what the family must not do (take a
 * name mystmd core already registers).
 *
 * mystmd keeps the FIRST directive registered under a name and warns about every duplicate,
 * once per page. Core directives are registered before any plugin's, so a plugin that takes
 * a core name is silently ignored — the worst failure mode available, because the page still
 * builds and the content is simply wrong. These tests pin the behaviour so the eight
 * directive names in CONTRACT.md can be checked against it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { bundleTo, mystBuild, readPage, selectAll, skipWithoutMyst, tempDir, textOf, writeProject } from './helpers.mjs';

/** The eight names the contract claims, checked against the engine's own registrations. */
const CONTRACT_NAMES = [
  'stats',
  'bar-list',
  'stacked-bar',
  'heatmap',
  'data-table',
  'chips',
  'badges',
  'delta-list',
];

let dist;
let probe;

before(async () => {
  dist = tempDir('qe-registration-');
  probe = await bundleTo('tests/fixtures/probe/index.mjs', 'probe', dist);
});

after(() => fs.rmSync(dist, { recursive: true, force: true }));

/** A single-file plugin registering one directive under `name`, emitting a marked div. */
function stubPlugin(dir, file, name, marker) {
  const source = `const d = {
  name: ${JSON.stringify(name)},
  body: { type: String },
  run() {
    return [{ type: 'div', class: 'stub', marker: ${JSON.stringify(marker)},
      children: [{ type: 'paragraph', children: [{ type: 'text', value: ${JSON.stringify(marker)} }] }] }];
  },
};
export default { name: ${JSON.stringify(`Stub ${marker}`)}, directives: [d] };
`;
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
  return target;
}

describe('duplicate registration', { skip: skipWithoutMyst }, () => {
  test('loading the same family twice warns and registers it once', async () => {
    const dir = tempDir('qe-dup-');
    try {
      // Two paths to the same bundle: what happens when a project pins the family and a
      // second family, or a template, pulls it in as well.
      const copy = path.join(dir, 'probe-copy.mjs');
      fs.copyFileSync(probe, copy);
      writeProject(dir, {
        plugins: [probe, copy],
        files: {
          'page.md': '# Dup\n\n```{probe-table}\n:file: data/r.csv\n```\n',
          'data/r.csv': 'rule,reach\nw-01,12\n',
        },
      });
      const { code, stdout, stderr } = await mystBuild(dir);
      const output = `${stdout}${stderr}`;
      assert.equal(code, 0, output);
      assert.match(output, /duplicate directive/i, 'the engine should warn about the duplicate');
      // One directive invocation, one node: the duplicate registration does not double it.
      const nodes = selectAll(readPage(dir).mdast, 'div').filter((node) =>
        (node.class ?? '').includes('qe-dv-probe'),
      );
      assert.equal(nodes.length, 1);
      assert.deepEqual(nodes[0].rows, [{ rule: 'w-01', reach: 12 }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('when two plugins claim a name, the first registered wins', async () => {
    const dir = tempDir('qe-first-wins-');
    try {
      const first = stubPlugin(dir, 'plugins/first.mjs', 'probe-table', 'FIRST');
      const second = stubPlugin(dir, 'plugins/second.mjs', 'probe-table', 'SECOND');
      writeProject(dir, {
        plugins: [first, second],
        files: { 'page.md': '# Order\n\n```{probe-table}\nx\n```\n' },
      });
      const { code, stdout, stderr } = await mystBuild(dir);
      assert.equal(code, 0, `${stdout}${stderr}`);
      const [node] = selectAll(readPage(dir).mdast, 'div').filter((n) => n.class === 'stub');
      assert.equal(node.marker, 'FIRST', 'the first plugin listed should win the name');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('mystmd core wins a name collision, and the plugin is silently ignored', async () => {
    const dir = tempDir('qe-core-wins-');
    try {
      // `div` is a core directive. A plugin claiming it does not replace it and does not
      // fail the build: the page renders core's div, and the only signal is a warning.
      const collider = stubPlugin(dir, 'plugins/collide.mjs', 'div', 'PLUGIN');
      writeProject(dir, {
        plugins: [collider],
        files: { 'page.md': '# Collide\n\n:::{div}\n:class: from-core\ncore body\n:::\n' },
      });
      const { code, stdout, stderr } = await mystBuild(dir);
      assert.equal(code, 0, `${stdout}${stderr}`);
      const divs = selectAll(readPage(dir).mdast, 'div');
      const fromCore = divs.find((node) => (node.class ?? '').includes('from-core'));
      assert.ok(fromCore, 'core div should still be the one that ran');
      assert.match(textOf(fromCore), /core body/);
      assert.equal(
        divs.some((node) => node.marker === 'PLUGIN'),
        false,
        'the plugin directive should never have run',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the contract names', { skip: skipWithoutMyst }, () => {
  test('none of the eight is taken by mystmd core in the version we target', async () => {
    const dir = tempDir('qe-names-');
    try {
      // Register each contract name from a plugin and check that OUR directive is the one
      // that runs. A name core already owns would leave no marked node behind.
      const plugins = CONTRACT_NAMES.map((name, index) =>
        stubPlugin(dir, `plugins/${index}.mjs`, name, name),
      );
      const body = CONTRACT_NAMES.map((name) => `\`\`\`{${name}}\nx\n\`\`\``).join('\n\n');
      writeProject(dir, { plugins, files: { 'page.md': `# Names\n\n${body}\n` } });
      const { code, stdout, stderr } = await mystBuild(dir);
      const output = `${stdout}${stderr}`;
      assert.equal(code, 0, output);
      assert.doesNotMatch(output, /duplicate directive/i, output);
      const markers = selectAll(readPage(dir).mdast, 'div')
        .filter((node) => node.class === 'stub')
        .map((node) => node.marker);
      assert.deepEqual(
        markers.sort(),
        [...CONTRACT_NAMES].sort(),
        'every contract name should still be free for the family to claim',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the documented dv- alias fallback is itself free', async () => {
    const dir = tempDir('qe-alias-');
    try {
      const aliases = CONTRACT_NAMES.map((name) => `dv-${name}`);
      const plugins = aliases.map((name, index) => stubPlugin(dir, `plugins/${index}.mjs`, name, name));
      const body = aliases.map((name) => `\`\`\`{${name}}\nx\n\`\`\``).join('\n\n');
      writeProject(dir, { plugins, files: { 'page.md': `# Aliases\n\n${body}\n` } });
      const { code, stdout, stderr } = await mystBuild(dir);
      assert.equal(code, 0, `${stdout}${stderr}`);
      const markers = selectAll(readPage(dir).mdast, 'div')
        .filter((node) => node.class === 'stub')
        .map((node) => node.marker);
      assert.deepEqual(markers.sort(), [...aliases].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
