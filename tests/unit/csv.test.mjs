/** Unit tests for the dependency-free RFC 4180 reader in src/lib/csv.mjs. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CsvError,
  DEFAULT_NULL_TOKENS,
  parseCsv,
  parseRecords,
  readCsv,
  requireColumns,
  toNumber,
  typed,
} from '../../src/lib/csv.mjs';

/** `assert.throws` returns nothing, so this is how a test inspects the thrown error. */
function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('expected the call to throw');
}

test('parses plain records', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('accepts a final record with no trailing newline, quoted or not', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv('a\n"last"'), [['a'], ['last']]);
  assert.deepEqual(parseCsv('a,b\n1,"two"'), [
    ['a', 'b'],
    ['1', 'two'],
  ]);
});

test('treats CRLF, LF and a lone CR as one record break each', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv('a,b\r1,2\r'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('keeps a delimiter inside a quoted field', () => {
  assert.deepEqual(parseCsv('a,b\n"one, two",3\n'), [
    ['a', 'b'],
    ['one, two', '3'],
  ]);
});

test('unescapes a doubled quote inside a quoted field', () => {
  assert.deepEqual(parseCsv('a\n"she said ""no"""\n'), [['a'], ['she said "no"']]);
});

test('keeps a line break inside a quoted field and counts the line, in all three spellings', () => {
  assert.deepEqual(parseCsv('a,b\n"line one\nline two",3\n'), [
    ['a', 'b'],
    ['line one\nline two', '3'],
  ]);
  assert.deepEqual(parseCsv('a\n"one\rtwo"\n'), [['a'], ['one\rtwo']]);
  // A quote opened on line 2 and never closed is reported at line 2, not at the end of the
  // input: in a long generated file the EOF line is the least useful place to be sent.
  for (const input of ['a\n"open\nstill open', 'a\n"open\rstill open', 'a\n"open\r\nstill open\n\n']) {
    const error = caught(() => parseCsv(input));
    assert.ok(error instanceof CsvError);
    assert.equal(error.line, 2, JSON.stringify(input));
  }
});

test('preserves empty fields, including a trailing one', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3\n,,\n'), [
    ['a', 'b', 'c'],
    ['1', '', '3'],
    ['', '', ''],
  ]);
});

test('parseCsv never skips a line, blank or otherwise', () => {
  assert.deepEqual(parseCsv('a\n\n1\n'), [['a'], [''], ['1']]);
});

test('strips a UTF-8 byte-order mark from the first field only', () => {
  const [header] = parseCsv('﻿series,score\n');
  assert.deepEqual(header, ['series', 'score']);
});

test('rejects a bare quote inside an unquoted field', () => {
  assert.throws(() => parseCsv('a,b\nun"quoted,2\n'), CsvError);
});

test('rejects a quote that reopens after a quoted field closed', () => {
  assert.throws(() => parseCsv('a\n"one"two\n'), CsvError);
});

test('honours a custom delimiter and rejects an impossible one', () => {
  assert.deepEqual(parseCsv('a;b\n1;2\n', { delimiter: ';' }), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.throws(() => parseCsv('a\n', { delimiter: ';;' }), CsvError);
  assert.throws(() => parseCsv('a\n', { delimiter: '"' }), CsvError);
  assert.throws(() => parseCsv('a\n', { delimiter: '\n' }), CsvError);
  assert.throws(() => parseCsv(Buffer.from('a')), CsvError);
});

test('parseRecords reports which fields were quoted and where each record started', () => {
  const records = parseRecords('a,b\n"x\ny",2\n\n3,4\n');
  assert.deepEqual(
    records.map(({ fields, quoted, line }) => ({ fields, quoted, line })),
    [
      { fields: ['a', 'b'], quoted: [false, false], line: 1 },
      { fields: ['x\ny', '2'], quoted: [true, false], line: 2 },
      { fields: [''], quoted: [false], line: 4 },
      { fields: ['3', '4'], quoted: [false, false], line: 5 },
    ],
  );
});

test('readCsv maps a header row onto objects and trims unquoted values by default', () => {
  const { columns, rows } = readCsv(' series , overall \n intro , 7.4 \n');
  assert.deepEqual(columns, ['series', 'overall']);
  assert.deepEqual(rows, [{ series: 'intro', overall: '7.4' }]);
});

test('readCsv never trims a quoted value, because quoting is how padding is asked for', () => {
  assert.deepEqual(readCsv('a,b\n"  x  ",1\n').rows, [{ a: '  x  ', b: '1' }]);
  assert.deepEqual(readCsv('a,b\n" ",1\n').rows, [{ a: ' ', b: '1' }]);
  assert.deepEqual(readCsv('" a ",b\nx,1\n').columns, [' a ', 'b']);
});

test('readCsv can be told not to trim at all', () => {
  assert.deepEqual(readCsv('a\n  padded  \n', { trim: false }).rows, [{ a: '  padded  ' }]);
  assert.deepEqual(readCsv(' a \n1\n', { trim: false }).columns, [' a ']);
});

test('readCsv pads a short row and rejects a long one, naming the real line', () => {
  assert.deepEqual(readCsv('a,b,c\n1,2\n').rows, [{ a: '1', b: '2', c: '' }]);
  // Blank lines and a multi-line quoted field before the bad row must not shift the number.
  const error = caught(() => readCsv('a,b\n\n"x\ny\nz",1\n1,2,3\n'));
  assert.ok(error instanceof CsvError);
  assert.equal(error.line, 6);
});

test('readCsv skips lines with nothing on them, but keeps a record the author wrote', () => {
  assert.deepEqual(readCsv('a,b\n\n1,2\n\n').rows, [{ a: '1', b: '2' }]);
  assert.deepEqual(readCsv('a,b\n,\n').rows, [{ a: '', b: '' }]);
  // A quoted empty field is a value, not a blank line.
  assert.deepEqual(readCsv('a\n""\n1\n').rows, [{ a: '' }, { a: '1' }]);
  assert.deepEqual(readCsv('a\n"   "\n1\n').rows, [{ a: '   ' }, { a: '1' }]);
  // Unquoted whitespace is blank when trimming, and a value when not.
  assert.deepEqual(readCsv('a\n   \n1\n').rows, [{ a: '1' }]);
  assert.deepEqual(readCsv('a\n   \n1\n', { trim: false }).rows, [{ a: '   ' }, { a: '1' }]);
});

test('readCsv rejects a missing, empty, repeated or __proto__ header', () => {
  assert.throws(() => readCsv(''), CsvError);
  assert.throws(() => readCsv('\n\n'), CsvError);
  assert.throws(() => readCsv('a,,c\n'), CsvError);
  assert.throws(() => readCsv('a,b,a\n'), CsvError);
  const error = caught(() => readCsv('__proto__,b\n1,2\n'));
  assert.ok(error instanceof CsvError);
  assert.match(error.message, /__proto__/);
});

test('toNumber parses decimal numbers and maps the null tokens to null', () => {
  assert.equal(toNumber('7.4'), 7.4);
  assert.equal(toNumber('-3'), -3);
  assert.equal(toNumber('+5'), 5);
  assert.equal(toNumber('.5'), 0.5);
  assert.equal(toNumber('5.'), 5);
  assert.equal(toNumber(' 12 '), 12);
  assert.equal(toNumber('1e3'), 1000);
  assert.equal(toNumber('-0'), -0);
  assert.equal(toNumber(42), 42, 'a number passes through');
  for (const token of DEFAULT_NULL_TOKENS) assert.equal(toNumber(token), null, token);
  assert.equal(toNumber('N/A'), null, 'null tokens are case-insensitive');
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
});

test('toNumber refuses anything outside the decimal grammar rather than yielding NaN', () => {
  const error = caught(() => toNumber('seven', { column: 'overall' }));
  assert.match(error.message, /column "overall"/);
  assert.throws(() => toNumber('Infinity'), CsvError);
  assert.throws(() => toNumber(Infinity), CsvError);
  assert.throws(() => toNumber('1,2'), CsvError);
  assert.throws(() => toNumber('1_000'), CsvError);
  assert.throws(() => toNumber('1e'), CsvError);
  // `Number()` would read these as 16, 3 and 15; an id column must not become arithmetic.
  assert.throws(() => toNumber('0x10'), CsvError);
  assert.throws(() => toNumber('0b11'), CsvError);
  assert.throws(() => toNumber('0o17'), CsvError);
});

test('toNumber honours a caller-supplied null vocabulary', () => {
  assert.equal(toNumber('out-of-scope', { nullTokens: ['out-of-scope'] }), null);
  assert.throws(() => toNumber('', { nullTokens: ['out-of-scope'] }), CsvError);
});

test('typed coerces only the named columns and forwards its options', () => {
  const rows = [{ series: 'intro', overall: '7.4', writing: '' }];
  assert.deepEqual(typed(rows, ['overall', 'writing']), [
    { series: 'intro', overall: 7.4, writing: null },
  ]);
  // The null vocabulary reaches toNumber: with '' no longer a null token, '' is an error.
  assert.throws(() => typed(rows, ['writing'], { nullTokens: ['n/a'] }), CsvError);
  assert.deepEqual(typed([{ x: 'n/a' }], ['x'], { nullTokens: ['n/a'] }), [{ x: null }]);
  // And the column name reaches the error message.
  const error = caught(() => typed([{ score: 'nope' }], ['score']));
  assert.match(error.message, /column "score"/);
});

test('requireColumns names every missing column', () => {
  const table = { columns: ['series', 'overall'] };
  assert.deepEqual(requireColumns(table, ['series']), ['series']);
  const error = caught(() =>
    requireColumns(table, ['series', 'lectures', 'HIGH'], 'data/series_summary.csv'),
  );
  assert.ok(error instanceof CsvError);
  assert.match(error.message, /"lectures", "HIGH"/);
  assert.match(error.message, /data\/series_summary\.csv/);
});
