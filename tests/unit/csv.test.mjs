/** Unit tests for the dependency-free RFC 4180 reader in src/lib/csv.mjs. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CsvError,
  DEFAULT_NULL_TOKENS,
  parseCsv,
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

test('accepts a final record with no trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
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

test('keeps a line break inside a quoted field, and counts the line', () => {
  assert.deepEqual(parseCsv('a,b\n"line one\nline two",3\n'), [
    ['a', 'b'],
    ['line one\nline two', '3'],
  ]);
  const error = caught(() => parseCsv('a\n"open\nstill open'));
  assert.ok(error instanceof CsvError);
  assert.equal(error.line, 3, 'the line counter should advance inside a quoted field');
});

test('counts a lone CR inside a quoted field, matching the unquoted branch', () => {
  // The parser accepts a lone CR as a record separator, so it has to count one inside a
  // quoted field too, or an error after such a field names the wrong line.
  const lone = caught(() => parseCsv('a\n"open\rstill open'));
  assert.ok(lone instanceof CsvError);
  assert.equal(lone.line, 3);
  // CRLF is one break, not two.
  const crlf = caught(() => parseCsv('a\n"open\r\nstill open'));
  assert.equal(crlf.line, 3);
  // And the field itself keeps the break verbatim, whichever spelling it used.
  assert.deepEqual(parseCsv('a\n"one\rtwo"\n'), [['a'], ['one\rtwo']]);
});

test('preserves empty fields, including a trailing one', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3\n,,\n'), [
    ['a', 'b', 'c'],
    ['1', '', '3'],
    ['', '', ''],
  ]);
});

test('strips a UTF-8 byte-order mark from the first field only', () => {
  const [header] = parseCsv('﻿series,score\n');
  assert.deepEqual(header, ['series', 'score']);
});

test('rejects an unterminated quoted field', () => {
  assert.throws(() => parseCsv('a,b\n"unterminated,2\n'), CsvError);
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

test('readCsv maps a header row onto objects and trims by default', () => {
  const { columns, rows } = readCsv(' series , overall \n intro , 7.4 \n');
  assert.deepEqual(columns, ['series', 'overall']);
  assert.deepEqual(rows, [{ series: 'intro', overall: '7.4' }]);
});

test('readCsv preserves interior whitespace and can be told not to trim', () => {
  const { rows } = readCsv('a\n"  padded  "\n', { trim: false });
  assert.deepEqual(rows, [{ a: '  padded  ' }]);
});

test('readCsv pads a short row and rejects a long one', () => {
  assert.deepEqual(readCsv('a,b,c\n1,2\n').rows, [{ a: '1', b: '2', c: '' }]);
  const error = caught(() => readCsv('a,b\n1,2,3\n'));
  assert.ok(error instanceof CsvError);
  assert.equal(error.line, 2, 'the error should name the offending record');
});

test('readCsv skips blank lines but keeps a record of empty fields', () => {
  assert.deepEqual(readCsv('a,b\n\n1,2\n\n').rows, [{ a: '1', b: '2' }]);
  assert.deepEqual(readCsv('a,b\n,\n').rows, [{ a: '', b: '' }]);
});

test('readCsv rejects a missing, empty or repeated header', () => {
  assert.throws(() => readCsv(''), CsvError);
  assert.throws(() => readCsv('a,,c\n'), CsvError);
  assert.throws(() => readCsv('a,b,a\n'), CsvError);
});

test('toNumber parses numbers and maps the null tokens to null', () => {
  assert.equal(toNumber('7.4'), 7.4);
  assert.equal(toNumber('-3'), -3);
  assert.equal(toNumber(' 12 '), 12);
  assert.equal(toNumber('1e3'), 1000);
  for (const token of DEFAULT_NULL_TOKENS) assert.equal(toNumber(token), null, token);
  assert.equal(toNumber('N/A'), null, 'null tokens are case-insensitive');
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
});

test('toNumber refuses a non-numeric cell rather than yielding NaN', () => {
  const error = caught(() => toNumber('seven', { column: 'overall' }));
  assert.ok(error instanceof CsvError);
  assert.match(error.message, /column "overall"/);
  assert.throws(() => toNumber('Infinity'), CsvError);
  assert.throws(() => toNumber('1,2'), CsvError);
});

test('toNumber honours a caller-supplied null vocabulary', () => {
  assert.equal(toNumber('out-of-scope', { nullTokens: ['out-of-scope'] }), null);
  assert.throws(() => toNumber('', { nullTokens: ['out-of-scope'] }), CsvError);
});

test('typed coerces only the named columns', () => {
  const rows = [{ series: 'intro', overall: '7.4', writing: '' }];
  assert.deepEqual(typed(rows, ['overall', 'writing']), [
    { series: 'intro', overall: 7.4, writing: null },
  ]);
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
