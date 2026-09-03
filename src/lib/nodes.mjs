/**
 * Builders for the node shapes CONTRACT.md defines.
 *
 * These are the hundred and fifty lines the contract expects a second producer to duplicate
 * rather than import. The compliance wrappers that ship beside the report theme emit the
 * same shapes and copy this file; that is the deal the contract makes, and it is cheaper
 * than a cross-repository build dependency between two bundles that cannot import anything
 * anyway.
 *
 * Everything here exists to make the contract's rules hard to break by accident:
 *
 *   - `root()` is the only way to build a primitive's root node, so the class tokens, the
 *     `contract` stamp and the `primitive` name are never spelled by hand.
 *   - `table()` refuses a ragged table and refuses a header cell outside row 0, because both
 *     corrupt an export rather than merely looking wrong (see CONTRACT.md, "Fallback
 *     tables").
 *   - `normaliseClass()` implements the `:class:` rule, because mystmd's own
 *     `addClassOptions` is literally `node.class = data.options.class` and does no
 *     normalisation at all.
 *
 * Nothing here knows what a score is, what a band is, or when a number is bad. Tones arrive
 * as words from whoever owns the rubric.
 */

/** The contract version every node built here is stamped with. */
export const CONTRACT_VERSION = '1.0';

/** The family class token, carried by every root node. */
export const FAMILY_TOKEN = 'qe-dv';

/** The closed tone vocabulary. A tone is a hint: never a colour, never a threshold. */
export const TONES = Object.freeze(['neutral', 'accent', 'good', 'warn', 'bad']);

/** What the fallback prints where a value is absent. */
export const NULL_DISPLAY = '—';

/**
 * Build the `class` string for a primitive's root node.
 *
 * The family and primitive tokens come first, in that order, followed by the author's own
 * tokens from `:class:` with whitespace collapsed, empties dropped and anything already
 * present removed. mystmd assigns the raw option string straight onto the node, so a
 * directive that does not do this emits `"qe-dv qe-dv-stats "` for an empty `:class:` and a
 * duplicate token for `:class: qe-dv`.
 *
 * @param {string} primitive
 * @param {string} [authorClasses] the raw `:class:` option value
 * @returns {string}
 */
export function normaliseClass(primitive, authorClasses) {
  const own = [FAMILY_TOKEN, `${FAMILY_TOKEN}-${primitive}`];
  const extra = String(authorClasses ?? '')
    .split(/\s+/)
    .filter((token) => token !== '' && !own.includes(token));
  // Preserve author order but drop a token repeated within the option itself.
  return [...own, ...new Set(extra)].join(' ');
}

/** Assert a tone is in the closed set, returning it. Used at the edge, not everywhere. */
export function checkTone(tone, where = 'tone') {
  if (tone === undefined || tone === null) return 'neutral';
  if (!TONES.includes(tone)) {
    throw new RangeError(`${where} must be one of ${TONES.join(', ')}, got ${JSON.stringify(tone)}`);
  }
  return tone;
}

/**
 * Build a primitive's root node.
 *
 * @param {string} primitive one of the eight primitive names
 * @param {object} options
 * @param {object} [options.props] the structured data, attached as root properties
 * @param {object[]} options.children the fallback rendering — never empty
 * @param {string} [options.class] the raw `:class:` option value
 * @returns {object}
 */
export function root(primitive, { props = {}, children, class: authorClasses } = {}) {
  if (!Array.isArray(children) || children.length === 0) {
    throw new TypeError(
      `${primitive}: children must be a non-empty fallback rendering — a primitive that renders nothing in a plain theme does not implement the contract`,
    );
  }
  for (const forbidden of ['label', 'identifier', 'html_id']) {
    if (forbidden in props) {
      throw new TypeError(
        `${primitive}: a root node must not carry "${forbidden}" — {embed} deletes it from the embedded subtree`,
      );
    }
  }
  return {
    type: 'div',
    class: normaliseClass(primitive, authorClasses),
    contract: CONTRACT_VERSION,
    primitive,
    ...props,
    children,
  };
}

/** A `div` with a class and nothing else. Inner nodes are dumb: no stamp, no data copy. */
export function div(className, children) {
  return { type: 'div', class: className, children };
}

/** A `span` with a class and nothing else. */
export function span(className, children) {
  return { type: 'span', class: className, children };
}

/** A text node. */
export function text(value) {
  return { type: 'text', value: String(value) };
}

/** Inline code, for a rule id or a file path. */
export function code(value) {
  return { type: 'inlineCode', value: String(value) };
}

/** Bold inline content — the figure in a stat row, the count in a fraction. */
export function strong(children) {
  return { type: 'strong', children: toInline(children) };
}

/** A link. `link` is one of the few node types `{embed}` leaves its identifier alone on. */
export function link(url, children) {
  return { type: 'link', url, children: toInline(children) };
}

/** A paragraph wrapping inline content. */
export function paragraph(children) {
  return { type: 'paragraph', children: toInline(children) };
}

/** Coerce a string, node or array into an inline children array. */
function toInline(children) {
  if (Array.isArray(children)) return children;
  if (typeof children === 'string' || typeof children === 'number') return [text(children)];
  return [children];
}

/**
 * A table cell.
 *
 * @param {any} children string, node, or array of nodes
 * @param {{header?: boolean, align?: 'left'|'center'|'right'}} [options]
 */
export function cell(children, options = {}) {
  const node = { type: 'tableCell', children: toInline(children) };
  if (options.header) node.header = true;
  if (options.align) node.align = options.align;
  return node;
}

/** A table row. Prefer `table()`, which enforces the rules a bare row cannot. */
export function row(cells) {
  return { type: 'tableRow', children: cells };
}

/**
 * Build a fallback table, enforcing the two rules that make a table survive export.
 *
 * `myst-to-tex` writes a rule after every row whose first cell is a header, and its
 * long-table path counts leading header rows to find the body — so a header cell outside row
 * 0 either over-rules the table or empties it. `myst-to-typst` writes cells as one flat
 * positional sequence after taking the column count from the first row, so one short row
 * shifts every cell after it. Both are silent in the source and obvious only in the output,
 * which is exactly the kind of thing a builder should refuse to produce.
 *
 * @param {any[]} headerCells the header row's cells, as content or cell nodes
 * @param {any[][]} bodyRows each row's cells
 * @param {{align?: ('left'|'center'|'right')[]}} [options] per-column alignment
 */
export function table(headerCells, bodyRows, options = {}) {
  const align = options.align ?? [];
  const width = headerCells.length;
  if (width === 0) throw new TypeError('a table needs at least one column');

  const build = (cells, header) =>
    row(
      cells.map((content, index) => {
        // Pass a cell node through, but keep the alignment and header rules ours.
        const node = isCell(content) ? content : cell(content);
        if (header) node.header = true;
        else delete node.header;
        if (align[index]) node.align = align[index];
        return node;
      }),
    );

  const rows = [build(headerCells, true)];
  bodyRows.forEach((cells, index) => {
    if (cells.length !== width) {
      throw new TypeError(
        `row ${index + 1} has ${cells.length} cells but the header has ${width}; a ragged table shifts every following cell in a typst export`,
      );
    }
    rows.push(build(cells, false));
  });
  return { type: 'table', children: rows };
}

function isCell(value) {
  return value !== null && typeof value === 'object' && value.type === 'tableCell';
}

/** A bullet list whose items are each a paragraph of inline content. */
export function list(items) {
  return {
    type: 'list',
    ordered: false,
    spread: false,
    children: items.map((item) => ({
      type: 'listItem',
      spread: true,
      children: [paragraph(item)],
    })),
  };
}

/** What the fallback prints for a value: the display string, or an em dash when absent. */
export function display(value, formatted) {
  if (value === null || value === undefined) return NULL_DISPLAY;
  return formatted ?? String(value);
}

/**
 * A value over a denominator, as the fallback renders it: **41** / 49.
 *
 * @param {number|null} value
 * @param {number|null} [denominator]
 * @returns {object[]} inline nodes
 */
export function fraction(value, denominator) {
  const figure = strong(display(value));
  if (denominator === null || denominator === undefined) return [figure];
  return [figure, text(` / ${denominator}`)];
}
