/**
 * A dependency-free RFC 4180 CSV reader.
 *
 * A remotely loaded MyST plugin is cached as a single file and resolves imports from the
 * cache directory, so it cannot use `csv-parse` or any other npm package (see CONTRACT.md,
 * "Packaging constraints"). This module is that constraint's answer: enough of RFC 4180 to
 * read the CSVs QuantEcon's report pipelines emit, in Node built-ins only.
 *
 * What it implements, from RFC 4180 and the extensions real-world CSV needs:
 *
 *   - Fields separated by a delimiter (`,` by default), records by `LF`, `CRLF` or `CR`.
 *   - Double-quoted fields, which may contain the delimiter, quotes escaped as `""`, and
 *     literal line breaks.
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
 * Parse CSV text into an array of records, each an array of string fields.
 *
 * Every field is returned verbatim: no trimming, no type coercion, no null substitution.
 *
 * @param {string} text
 * @param {{delimiter?: string}} [options]
 * @returns {string[][]}
 */
export function parseCsv(text, options = {}) {
  const delimiter = options.delimiter ?? ',';
  if (typeof text !== 'string') throw new CsvError('CSV input must be a string');
  if (delimiter.length !== 1) throw new CsvError('delimiter must be a single character');
  if (delimiter === '"' || delimiter === '\r' || delimiter === '\n') {
    throw new CsvError('delimiter must not be a quote or a line break');
  }

  // Strip a UTF-8 BOM so the first header does not silently become '﻿series'.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldWasQuoted = false;
  let sawAnyChar = false;
  let line = 1;

  const endField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
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
      line += 1;
      endRow();
      sawAnyChar = false;
      continue;
    }

    field += char;
    sawAnyChar = true;
  }

  if (quoted) throw new CsvError('unterminated quoted field', line);
  // A trailing line break ends the last record; anything else leaves one open.
  if (sawAnyChar || field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Parse CSV text whose first record is a header row into an array of objects.
 *
 * Short records are padded with `''` and long ones are an error, so a malformed row fails
 * the build rather than silently losing a column.
 *
 * @param {string} text
 * @param {{delimiter?: string, trim?: boolean}} [options]
 *   `trim` (default true) trims surrounding whitespace from headers and from unquoted-looking
 *   values; it never alters the interior of a field.
 * @returns {{columns: string[], rows: Record<string, string>[]}}
 */
export function readCsv(text, options = {}) {
  const trim = options.trim ?? true;
  const records = parseCsv(text, options).filter(
    (record) => !(record.length === 1 && record[0].trim() === ''),
  );
  if (records.length === 0) throw new CsvError('CSV has no header row');

  const columns = records[0].map((name) => (trim ? name.trim() : name));
  const seen = new Set();
  for (const name of columns) {
    if (name === '') throw new CsvError('CSV header has an empty column name');
    if (seen.has(name)) throw new CsvError(`CSV header repeats the column "${name}"`);
    seen.add(name);
  }

  const rows = records.slice(1).map((record, index) => {
    if (record.length > columns.length) {
      throw new CsvError(
        `row has ${record.length} fields but the header has ${columns.length}`,
        index + 2,
      );
    }
    const row = {};
    columns.forEach((name, columnIndex) => {
      const value = record[columnIndex] ?? '';
      row[name] = trim ? value.trim() : value;
    });
    return row;
  });

  return { columns, rows };
}

/** The cell values that mean "no value here", matched case-insensitively after trimming. */
export const DEFAULT_NULL_TOKENS = ['', 'n/a', 'na', '-', '—', 'null'];

/**
 * Read one cell as a number, or `null` when it is one of the null tokens.
 *
 * Throws on a non-empty cell that is not a number, because a typed column that silently
 * becomes `NaN` is how a report starts lying.
 *
 * @param {string|number|null|undefined} value
 * @param {{column?: string, nullTokens?: string[]}} [options]
 * @returns {number|null}
 */
export function toNumber(value, options = {}) {
  const nullTokens = options.nullTokens ?? DEFAULT_NULL_TOKENS;
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (nullTokens.some((token) => token.toLowerCase() === raw.toLowerCase())) return null;
  const where = () => (options.column ? ` in column "${options.column}"` : '');
  // Number('') and Number('  ') are both 0. A blank cell that the caller has not declared a
  // null token is a hole in the data, not a zero, so it fails rather than reading as one.
  if (raw === '') {
    throw new CsvError(`empty cell is not a number${where()}`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new CsvError(`"${raw}" is not a number${where()}`);
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
