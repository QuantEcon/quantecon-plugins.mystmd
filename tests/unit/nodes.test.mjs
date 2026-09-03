/**
 * Unit tests for the contract node builders in src/lib/nodes.mjs.
 *
 * The builders exist to make the contract's rules hard to break by accident, so most of
 * these tests are about what the builders REFUSE: an empty fallback, a ragged table, a
 * header cell outside row 0, a root-level label. Each refusal corresponds to a verified
 * engine behaviour documented in CONTRACT.md.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONTRACT_VERSION,
  FAMILY_TOKEN,
  NULL_DISPLAY,
  TONES,
  cell,
  checkTone,
  code,
  display,
  div,
  fraction,
  link,
  list,
  normaliseClass,
  paragraph,
  root,
  span,
  strong,
  table,
  text,
} from '../../src/lib/nodes.mjs';

test('normaliseClass puts the family and primitive tokens first', () => {
  assert.equal(normaliseClass('stats'), 'qe-dv qe-dv-stats');
  assert.equal(normaliseClass('bar-list'), 'qe-dv qe-dv-bar-list');
});

test('normaliseClass collapses whitespace and drops empty tokens', () => {
  // mystmd assigns the raw option value straight onto the node, so without this the emitted
  // class for an empty :class: would be 'qe-dv qe-dv-stats ' with a trailing space.
  assert.equal(normaliseClass('stats', ''), 'qe-dv qe-dv-stats');
  assert.equal(normaliseClass('stats', '   '), 'qe-dv qe-dv-stats');
  assert.equal(normaliseClass('stats', ' wide  compact '), 'qe-dv qe-dv-stats wide compact');
  assert.equal(normaliseClass('stats', 'a\tb\nc'), 'qe-dv qe-dv-stats a b c');
  assert.equal(normaliseClass('stats', undefined), 'qe-dv qe-dv-stats');
  assert.equal(normaliseClass('stats', null), 'qe-dv qe-dv-stats');
});

test('normaliseClass never repeats a token', () => {
  assert.equal(normaliseClass('stats', 'qe-dv'), 'qe-dv qe-dv-stats');
  assert.equal(normaliseClass('stats', 'qe-dv-stats extra'), 'qe-dv qe-dv-stats extra');
  assert.equal(normaliseClass('stats', 'extra extra'), 'qe-dv qe-dv-stats extra');
});

test('checkTone accepts the closed set and defaults to neutral', () => {
  for (const tone of TONES) assert.equal(checkTone(tone), tone);
  assert.equal(checkTone(undefined), 'neutral');
  assert.equal(checkTone(null), 'neutral');
  assert.throws(() => checkTone('danger'), RangeError);
  assert.throws(() => checkTone('red', 'items[0].tone'), /items\[0\]\.tone/);
});

test('root stamps the contract, the primitive and both class tokens', () => {
  const node = root('stats', {
    props: { stats: [{ label: 'Lectures', value: 68 }] },
    children: [paragraph('fallback')],
  });
  assert.equal(node.type, 'div');
  assert.equal(node.class, `${FAMILY_TOKEN} ${FAMILY_TOKEN}-stats`);
  assert.equal(node.contract, CONTRACT_VERSION);
  assert.equal(node.primitive, 'stats');
  assert.deepEqual(node.stats, [{ label: 'Lectures', value: 68 }]);
  // children last, so the JSON reads properties-then-fallback.
  assert.equal(Object.keys(node).at(-1), 'children');
});

test('root refuses an empty fallback, which is the whole point of the contract', () => {
  assert.throws(() => root('stats', { children: [] }), /non-empty fallback/);
  assert.throws(() => root('stats', {}), /non-empty fallback/);
  assert.throws(() => root('stats', { children: 'nope' }), TypeError);
});

test('root refuses label, identifier and html_id, which {embed} would delete', () => {
  for (const key of ['label', 'identifier', 'html_id']) {
    assert.throws(
      () => root('stats', { props: { [key]: 'x' }, children: [paragraph('f')] }),
      new RegExp(key),
    );
  }
});

test('root passes the author class option through normalisation', () => {
  const node = root('chips', { class: '  compact ', children: [paragraph('f')] });
  assert.equal(node.class, 'qe-dv qe-dv-chips compact');
});

test('inner node builders carry a class and nothing else', () => {
  assert.deepEqual(div('qe-dv-group', []), { type: 'div', class: 'qe-dv-group', children: [] });
  assert.deepEqual(span('qe-dv-chip', []), { type: 'span', class: 'qe-dv-chip', children: [] });
  // No contract stamp, no primitive, no copy of the item: the data lives exactly twice.
  for (const node of [div('a', []), span('b', [])]) {
    assert.equal(node.contract, undefined);
    assert.equal(node.primitive, undefined);
  }
});

test('inline builders coerce strings and numbers', () => {
  assert.deepEqual(text('x'), { type: 'text', value: 'x' });
  assert.deepEqual(text(42), { type: 'text', value: '42' });
  assert.deepEqual(code('w-01'), { type: 'inlineCode', value: 'w-01' });
  assert.deepEqual(strong('41'), { type: 'strong', children: [text('41')] });
  assert.deepEqual(paragraph('hi'), { type: 'paragraph', children: [text('hi')] });
  assert.deepEqual(link('https://example.org', 'see'), {
    type: 'link',
    url: 'https://example.org',
    children: [text('see')],
  });
  assert.deepEqual(paragraph([text('a'), code('b')]).children.length, 2);
});

test('table builds one header row and body rows, in that order', () => {
  const t = table(['Rule', 'Reach'], [[code('w-01'), '12']]);
  assert.equal(t.type, 'table');
  assert.equal(t.children.length, 2);
  const [header, body] = t.children;
  assert.ok(header.children.every((c) => c.header === true));
  assert.ok(body.children.every((c) => c.header === undefined));
});

test('table applies per-column alignment to every row', () => {
  const t = table(['Rule', 'Reach'], [[code('w-01'), '12']], { align: ['left', 'right'] });
  for (const row of t.children) {
    assert.equal(row.children[0].align, 'left');
    assert.equal(row.children[1].align, 'right');
  }
});

test('table refuses a ragged row, which shifts every following cell in a typst export', () => {
  assert.throws(() => table(['a', 'b'], [['1']]), /ragged/);
  assert.throws(() => table(['a', 'b'], [['1', '2', '3']]), /3 cells but the header has 2/);
  assert.throws(() => table([], []), /at least one column/);
});

test('table strips a header flag from a body cell, which would rule the LaTeX table', () => {
  // myst-to-tex writes \hline after every row whose first cell is a header, and its
  // long-table path drops every body row when they are all headers.
  const t = table(['a'], [[cell('1', { header: true })]]);
  assert.equal(t.children[1].children[0].header, undefined);
});

test('table accepts prebuilt cells and keeps their content', () => {
  const t = table([cell('Rule')], [[cell([strong('41'), text(' / 49')])]]);
  assert.equal(t.children[0].children[0].header, true);
  assert.equal(t.children[1].children[0].children.length, 2);
});

test('list builds a plain bullet list', () => {
  const l = list(['one', [code('w-01'), text(' two')]]);
  assert.equal(l.type, 'list');
  assert.equal(l.ordered, false);
  assert.equal(l.children.length, 2);
  assert.equal(l.children[0].type, 'listItem');
  assert.equal(l.children[0].children[0].type, 'paragraph');
  assert.equal(l.children[1].children[0].children.length, 2);
});

test('display prints the em dash for an absent value', () => {
  assert.equal(display(7.4), '7.4');
  assert.equal(display(7, '7.0'), '7.0');
  assert.equal(display(null), NULL_DISPLAY);
  assert.equal(display(undefined), NULL_DISPLAY);
  assert.equal(display(0), '0', 'zero is a value, not an absence');
});

test('fraction renders a value over its denominator, or alone', () => {
  assert.deepEqual(fraction(41, 49), [strong('41'), text(' / 49')]);
  assert.deepEqual(fraction(8), [strong('8')]);
  assert.deepEqual(fraction(null, 49), [strong(NULL_DISPLAY), text(' / 49')]);
});
