/** Unit tests for the bundle-safe diagnostics in src/lib/report.mjs. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DIAGNOSTICS_KEY,
  collectDiagnostics,
  defer,
  diagnosticsTransform,
  errorNode,
  fileError,
  fileWarn,
} from '../../src/lib/report.mjs';

/** The slice of the VFile API these helpers use, so the tests need no vfile dependency. */
function stubVFile(path = 'page.md') {
  return {
    path,
    messages: [],
    message(reason, node, source) {
      const message = { reason, message: reason, node, source, fatal: false };
      this.messages.push(message);
      return message;
    },
  };
}

test('fileError marks the message fatal, which is what --strict counts', () => {
  const vfile = stubVFile();
  const message = fileError(vfile, 'missing CSV', { ruleId: 'qe-datavis-stats', note: 'check data/' });
  assert.equal(vfile.messages.length, 1);
  assert.equal(message.fatal, true);
  assert.equal(message.ruleId, 'qe-datavis-stats');
  assert.equal(message.note, 'check data/');
});

test('fileWarn leaves the message non-fatal', () => {
  const vfile = stubVFile();
  const message = fileWarn(vfile, 'proposed rule cited without its tag');
  assert.equal(message.fatal, false);
  assert.equal(message.ruleId, undefined);
});

test('defer attaches a diagnostic to the node and returns it', () => {
  const node = { type: 'div' };
  assert.equal(defer(node, 'error', 'boom'), node);
  assert.deepEqual(node.data[DIAGNOSTICS_KEY], [{ level: 'error', message: 'boom' }]);
});

test('defer accumulates rather than overwriting, and preserves other node data', () => {
  const node = { type: 'div', data: { other: 1 } };
  defer(node, 'warn', 'first');
  defer(node, 'error', 'second', { ruleId: 'qe-datavis-stats' });
  assert.equal(node.data.other, 1);
  assert.deepEqual(node.data[DIAGNOSTICS_KEY], [
    { level: 'warn', message: 'first' },
    { level: 'error', message: 'second', ruleId: 'qe-datavis-stats' },
  ]);
});

test('defer rejects a level outside the vocabulary', () => {
  assert.throws(() => defer({ type: 'div' }, 'fatal', 'boom'), TypeError);
});

test('errorNode is a readable admonition carrying its own diagnostic', () => {
  const node = errorNode('stats', 'cannot read data/scores.csv');
  assert.equal(node.type, 'admonition');
  assert.equal(node.kind, 'error');
  assert.match(node.class, /qe-dv-stats/);
  // The fallback must say something on the page, not just in the log.
  const text = JSON.stringify(node.children);
  assert.match(text, /cannot read data\/scores\.csv/);
  assert.deepEqual(node.data[DIAGNOSTICS_KEY], [
    { level: 'error', message: 'cannot read data/scores.csv', ruleId: 'qe-datavis-stats' },
  ]);
});

test('collectDiagnostics finds diagnostics at any depth, in document order', () => {
  const tree = {
    type: 'root',
    children: [
      defer({ type: 'div' }, 'warn', 'one'),
      { type: 'block', children: [defer({ type: 'div' }, 'error', 'two')] },
      { type: 'paragraph', children: [{ type: 'text', value: 'x' }] },
    ],
  };
  assert.deepEqual(
    collectDiagnostics(tree).map(({ diagnostic }) => diagnostic.message),
    ['one', 'two'],
  );
});

test('collectDiagnostics tolerates a tree with no diagnostics or no children', () => {
  assert.deepEqual(collectDiagnostics({ type: 'root' }), []);
  assert.deepEqual(collectDiagnostics(null), []);
  assert.deepEqual(collectDiagnostics({ type: 'root', children: [{ type: 'text', value: 'x' }] }), []);
});

test('the transform re-raises every deferred diagnostic at the right level', () => {
  const vfile = stubVFile();
  const tree = {
    type: 'root',
    children: [
      defer({ type: 'div', position: { start: { line: 3, column: 1 } } }, 'error', 'fatal one', {
        ruleId: 'qe-datavis-stats',
      }),
      defer({ type: 'div' }, 'warn', 'soft one'),
    ],
  };
  const result = diagnosticsTransform.plugin()(tree, vfile);
  assert.equal(result, tree, 'the transform returns the tree it was given');
  assert.equal(vfile.messages.length, 2);
  const [error, warning] = vfile.messages;
  assert.equal(error.fatal, true);
  assert.equal(error.ruleId, 'qe-datavis-stats');
  assert.deepEqual(error.node, { start: { line: 3, column: 1 } }, 'position is forwarded');
  assert.equal(warning.fatal, false);
});

test('the transform is a document-stage transform, which is the stage --strict observes', () => {
  assert.equal(diagnosticsTransform.stage, 'document');
  assert.equal(typeof diagnosticsTransform.plugin, 'function');
});
