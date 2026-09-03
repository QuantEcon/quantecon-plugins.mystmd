/**
 * A dependency-free RFC 4180 CSV reader.
 *
 * A remotely loaded MyST plugin is cached as a single file and resolves imports from the
 * cache directory, so it cannot use `csv-parse` or any other npm package (see CONTRIBUTING.md,
 * "Engine constraints"). This module is that constraint's answer: enough of RFC 4180 to read
 * the CSVs QuantEcon's report pipelines emit, in Node built-ins only.
 *
 * What it implements, from RFC 4180 and the extensions real-world CSV needs:
 *
 *   - Fields separated by a delimiter (`,` by default), records by `LF`, `CRLF` or `CR`.
 *   - Double-quoted fields, which may contain the delimiter, quotes escaped as `""`, and
 *     literal line breaks in any of the three spellings.
 *   - A final record with no trailing line break.
 *   - A UTF-8 byte-order mark, stripped from the first field.
 *
 * What it deliberately does not implement: comment lines, delimiter sniffing, streaming and
 * type inference. Typing is explicit through `typed()`, because a build that guesses at
 * types is a build that drifts.
 */

/** Thrown when the input is not well-formed CSV. Carries a 1-based line number. */
export class CsvError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'CsvError';
    this.line = line;
  }
}

/**
 * The parser core. Yields one record per row as `{ fields, quoted, line }`, where `quoted[i]`
 * says whether field `i` was written inside double quotes and `line` is the 1-based line on
 * which the record started. Both are what the readers above need and what a bare array of
 * strings cannot carry: whether an empty field was an absence or a deliberate `""`, and
 * where to point an error raised after several multi-line fields have gone by.
 *
 * @param {string} text
 * @param {{delimiter?: string, skipBlankLines?: boolean, trim?: boolean}} [options]
 *   `skipBlankLines` drops a record that came from a line with nothing on it at all, or —
 *   when `trim` is also set — only unquoted whitespace. A quoted field, even `""`, is never
 *   blank: the author wrote it, and it stays.
 * @returns {{fields: string[], quoted: boolean[], line: number}[]}
 */
export function parseRecords(text, options = {}) {
  const delimiter = options.delimiter ?? ',';
  if (typeof text !== 'string') throw new CsvError('CSV input must be a string');
  if (delimiter.length !== 1) throw new CsvError('delimiter must be a single character');
  if (delimiter === '"' || delimiter === '\r' || delimiter === '\n') {
    throw new CsvError('delimiter must not be a quote or a line break');
  }

  // Strip a UTF-8 BOM so the first header does not silently become '﻿series'.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records = [];
  let fields = [];
  let quotedFlags = [];
  let field = '';
  let quoted = false;
  let fieldWasQuoted = false;
  let sawAnyChar = false;
  let line = 1;
  let recordLine = 1;
  let openLine = 0;

  const endField = () => {
    fields.push(field);
    quotedFlags.push(fieldWasQuoted);
    field = '';
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    const blank =
      fields.length === 1 &&
      !quotedFlags[0] &&
      (fields[0] === '' || (options.trim && fields[0].trim() === ''));
    if (!(options.skipBlankLines && blank)) {
      records.push({ fields, quoted: quotedFlags, line: recordLine });
    }
    fields = [];
    quotedFlags = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        // A quoted field may contain literal breaks in any of the three spellings, and the
        // line counter has to agree with the unquoted branch below or an error after such a
        // field names the wrong line. CRLF counts once, not twice.
        if (char === '\n' || (char === '\r' && input[i + 1] !== '\n')) line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field !== '' || fieldWasQuoted) {
        throw new CsvError('quote in an unquoted field', line);
      }
      quoted = true;
      fieldWasQuoted = true;
      openLine = line;
      sawAnyChar = true;
      continue;
    }

    // Anything other than a delimiter or a record break after a quoted field has closed
    // means the quoting is malformed: `"one"two` is not a field, it is a mistake.
    if (fieldWasQuoted && char !== delimiter && char !== '\r' && char !== '\n') {
      throw new CsvError('text after a closing quote', line);
    }

    if (char === delimiter) {
      endField();
      sawAnyChar = true;
      continue;
    }

    if (char === '\r' || char === '\n') {
      // CRLF is one break; a lone CR and a lone LF are each one break.
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
      sawAnyChar = false;
      continue;
    }

    field += char;
    sawAnyChar = true;
  }

  // Name the line where the quote opened: in a long generated file, the line where the
  // input ran out is the least useful line to be sent to.
  if (quoted) throw new CsvError('unterminated quoted field', openLine);
  // A trailing line break ends the last record; anything else leaves one open.
  if (sawAnyChar || field !== '' || fields.length > 0) endRecord();

  return records;
}

/**
 * Parse CSV text into an array of records, each an array of string fields.
 *
 * Every field is returned verbatim: no trimming, no type coercion, no null substitution, no
 * blank-line skipping.
 *
 * @param {string} text
 * @param {{delimiter?: string}} [options]
 * @returns {string[][]}
 */
export function parseCsv(text, options = {}) {
  return parseRecords(text, { delimiter: options.delimiter }).map((record) => record.fields);
}

/** The header name JavaScript would treat as a prototype setter rather than a key. */
const FORBIDDEN_HEADER = '__proto__';

/**
 * Parse CSV text whose first record is a header row into an array of objects.
 *
 * Lines with nothing on them are skipped. Short records are padded with `''` and long ones
 * are an error naming the offending line, so a malformed row fails the build rather than
 * silently losing a column.
 *
 * @param {string} text
 * @param {{delimiter?: string, trim?: boolean}} [options]
 *   `trim` (default true) trims surrounding whitespace from unquoted headers and unquoted
 *   values, and skips lines that hold only whitespace. A quoted value is never trimmed:
 *   quoting is how an author asks for a leading or trailing space to be kept.
 * @returns {{columns: string[], rows: Record<string, string>[]}}
 */
export function readCsv(text, options = {}) {
  const trim = options.trim ?? true;
  const records = parseRecords(text, { delimiter: options.delimiter, skipBlankLines: true, trim });
  if (records.length === 0) throw new CsvError('CSV has no header row');

  const clean = (value, wasQuoted) => (trim && !wasQuoted ? value.trim() : value);

  const header = records[0];
  const columns = header.fields.map((name, index) => clean(name, header.quoted[index]));
  const seen = new Set();
  for (const name of columns) {
    if (name === '') throw new CsvError('CSV header has an empty column name', header.line);
    if (name === FORBIDDEN_HEADER) {
      throw new CsvError(`CSV header must not name a column "${FORBIDDEN_HEADER}"`, header.line);
    }
    if (seen.has(name)) throw new CsvError(`CSV header repeats the column "${name}"`, header.line);
    seen.add(name);
  }

  const rows = records.slice(1).map((record) => {
    if (record.fields.length > columns.length) {
      throw new CsvError(
        `row has ${record.fields.length} fields but the header has ${columns.length}`,
        record.line,
      );
    }
    const row = {};
    columns.forEach((name, columnIndex) => {
      row[name] = clean(record.fields[columnIndex] ?? '', record.quoted[columnIndex] ?? false);
    });
    return row;
  });

  return { columns, rows };
}

/** The cell values that mean "no value here", matched case-insensitively after trimming. */
export const DEFAULT_NULL_TOKENS = ['', 'n/a', 'na', '-', '—', 'null'];

/**
 * The number grammar a CSV cell may use: optional sign, decimal digits with an optional
 * fraction, optional exponent. Deliberately narrower than `Number()`, which also accepts
 * `0x1A`, `0b11` and `0o17` — spellings a report pipeline never writes on purpose and an id
 * column can produce by accident.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Read one cell as a number, or `null` when it is one of the null tokens.
 *
 * Throws on a non-empty cell that is not a decimal number, because a typed column that
 * silently becomes `NaN` — or silently becomes 26 from `0x1A` — is how a report starts lying.
 *
 * @param {string|number|null|undefined} value
 * @param {{column?: string, nullTokens?: string[]}} [options]
 * @returns {number|null}
 */
export function toNumber(value, options = {}) {
  const nullTokens = options.nullTokens ?? DEFAULT_NULL_TOKENS;
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CsvError(`${value} is not a finite number`);
    return value;
  }
  const raw = String(value).trim();
  if (nullTokens.some((token) => token.toLowerCase() === raw.toLowerCase())) return null;
  const where = () => (options.column ? ` in column "${options.column}"` : '');
  // A blank cell that the caller has not declared a null token is a hole in the data, not a
  // zero, so it fails rather than reading as one.
  if (raw === '') {
    throw new CsvError(`empty cell is not a number${where()}`);
  }
  if (!DECIMAL.test(raw)) {
    throw new CsvError(`"${raw}" is not a number${where()}`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new CsvError(`"${raw}" is not a finite number${where()}`);
  }
  return parsed;
}

/**
 * Coerce the named columns of each row to `number | null`, leaving the rest as strings.
 *
 * @param {Record<string, string>[]} rows
 * @param {string[]} numericColumns
 * @param {{nullTokens?: string[]}} [options]
 * @returns {Record<string, string|number|null>[]}
 */
export function typed(rows, numericColumns, options = {}) {
  const numeric = new Set(numericColumns);
  return rows.map((row) => {
    const out = {};
    for (const [name, value] of Object.entries(row)) {
      out[name] = numeric.has(name) ? toNumber(value, { ...options, column: name }) : value;
    }
    return out;
  });
}

/**
 * Assert that every named column exists, and return the ones that do in the given order.
 *
 * @param {{columns: string[]}} table
 * @param {string[]} required
 * @param {string} [source] a path or label used in the error message
 */
export function requireColumns(table, required, source) {
  const present = new Set(table.columns);
  const missing = required.filter((name) => !present.has(name));
  if (missing.length > 0) {
    const where = source ? ` in ${source}` : '';
    throw new CsvError(
      `missing required column${missing.length > 1 ? 's' : ''} ${missing
        .map((name) => `"${name}"`)
        .join(', ')}${where}; found ${table.columns.map((name) => `"${name}"`).join(', ')}`,
    );
  }
  return required;
}
