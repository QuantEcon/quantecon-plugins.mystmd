/**
 * Builders for the node shapes the datavis contract defines.
 *
 * The contract itself is `CONTRACT.md`, delivered under QuantEcon/quantecon-plugins.mystmd#3
 * and stacked on this toolchain. These are the hundred and fifty lines it expects a second
 * producer to duplicate rather than import: the compliance wrappers that ship beside the
 * report theme emit the same shapes and copy this file. That is the deal the contract makes,
 * and it is cheaper than a build dependency between two bundles that cannot import anything
 * anyway.
 *
 * Everything here exists to make the contract's rules hard to break by accident:
 *
 *   - `root()` is the only way to build a primitive's root node, so the class tokens, the
 *     `contract` stamp and the `primitive` name are never spelled by hand and can never be
 *     overwritten by a stray property.
 *   - `table()` refuses a ragged table and refuses a header cell outside row 0, because both
 *     corrupt an export rather than merely looking wrong; and it puts an `align` on every
 *     cell, because the schemas require one.
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

/** The alignments a table cell may carry. */
export const ALIGNMENTS = Object.freeze(['left', 'center', 'right']);

/** What the fallback prints where a value is absent. */
export const NULL_DISPLAY = '—';

/** The keys `root()` owns. A props object may not carry them, so they can never be overwritten. */
const STAMPED_KEYS = Object.freeze(['type', 'class', 'contract', 'primitive', 'children']);

/** The keys `{embed}` deletes from any node in an embedded subtree. */
const EMBED_STRIPPED_KEYS = Object.freeze(['label', 'identifier', 'html_id']);

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

/** Assert a tone is in the closed set, returning it. Absent means `neutral`. */
export function checkTone(tone, where = 'tone') {
  if (tone === undefined || tone === null) return 'neutral';
  if (!TONES.includes(tone)) {
    throw new RangeError(`${where} must be one of ${TONES.join(', ')}, got ${JSON.stringify(tone)}`);
  }
  return tone;
}

/**
 * The class token that carries a tone onto an inner node, so a CSS-only theme can colour it.
 *
 * Built on `checkTone` so an unknown tone fails here, at the producer, rather than producing
 * a token the schemas reject.
 */
export function toneClass(tone, where = 'tone') {
  return `${FAMILY_TOKEN}-tone-${checkTone(tone, where)}`;
}

/**
 * Build a primitive's root node.
 *
 * @param {string} primitive one of the eight primitive names
 * @param {object} options
 * @param {object} [options.props] the structured data, attached as root properties
 * @param {object[]} options.children the fallback rendering — never empty
 * @param {string} [options.class] the raw `:class:` option value
 * @param {object} [options.position] the source position of the authoring directive, so a
 *   diagnostic deferred onto this node can name a line
 * @returns {object}
 */
export function root(primitive, { props = {}, children, class: authorClasses, position } = {}) {
  if (!Array.isArray(children) || children.length === 0) {
    throw new TypeError(
      `${primitive}: children must be a non-empty fallback rendering — a primitive that renders nothing in a plain theme does not implement the contract`,
    );
  }
  for (const key of STAMPED_KEYS) {
    if (key in props) {
      throw new TypeError(`${primitive}: props must not carry "${key}"; root() sets it and nothing may overwrite it`);
    }
  }
  for (const key of EMBED_STRIPPED_KEYS) {
    if (key in props) {
      throw new TypeError(
        `${primitive}: a root node must not carry "${key}" — {embed} deletes it from the embedded subtree`,
      );
    }
  }
  const node = {
    type: 'div',
    class: normaliseClass(primitive, authorClasses),
    contract: CONTRACT_VERSION,
    primitive,
    ...props,
    children,
  };
  if (position) node.position = position;
  return node;
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

/** Emphasised inline content. */
export function emphasis(children) {
  return { type: 'emphasis', children: toInline(children) };
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
  if (options.align) node.align = checkAlign(options.align);
  return node;
}

function checkAlign(align, where = 'align') {
  if (!ALIGNMENTS.includes(align)) {
    throw new RangeError(`${where} must be one of ${ALIGNMENTS.join(', ')}, got ${JSON.stringify(align)}`);
  }
  return align;
}

/** A table row. Prefer `table()`, which enforces the rules a bare row cannot. */
export function row(cells) {
  return { type: 'tableRow', children: cells };
}

/**
 * Build a fallback table, enforcing the rules that make a table survive export and validate.
 *
 * `myst-to-tex` writes a rule after every row whose first cell is a header, and its
 * long-table path counts leading header rows to find the body — so a header cell outside row
 * 0 either over-rules the table or empties it. `myst-to-typst` writes cells as one flat
 * positional sequence after taking the column count from the first row, so one short row
 * shifts every cell after it. Both are silent in the source and obvious only in the output,
 * which is exactly the kind of thing a builder should refuse to produce.
 *
 * Every cell gets an `align`, because the contract's schemas require one on every cell:
 * the caller's per-column list when given, `left` otherwise. A cell passed in ready-made is
 * copied before it is touched, so one cell object can be reused across rows.
 *
 * @param {any[]} headerCells the header row's cells, as content or cell nodes
 * @param {any[][]} bodyRows each row's cells
 * @param {{align?: ('left'|'center'|'right')[]}} [options] per-column alignment
 */
export function table(headerCells, bodyRows, options = {}) {
  const width = headerCells.length;
  if (width === 0) throw new TypeError('a table needs at least one column');
  const align = options.align ?? Array.from({ length: width }, () => 'left');
  if (align.length !== width) {
    throw new TypeError(`align lists ${align.length} columns but the table has ${width}`);
  }
  align.forEach((value, index) => checkAlign(value, `align[${index}]`));

  const build = (cells, header) =>
    row(
      cells.map((content, index) => {
        // Copy a ready-made cell rather than editing the caller's object, and keep the
        // alignment and header rules ours.
        const node = isCell(content) ? { ...content } : cell(content);
        if (header) node.header = true;
        else delete node.header;
        node.align = align[index];
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
 * An absent value is a bare em dash with no denominator and no emphasis — the contract's
 * samples render it that way, and a bold dash over a total reads as a claim.
 *
 * @param {number|null} value
 * @param {number|null} [denominator]
 * @param {string} [formatted] the display string for the value, when precision matters
 *   (`9.0` rather than `9`)
 * @returns {object[]} inline nodes
 */
export function fraction(value, denominator, formatted) {
  if (value === null || value === undefined) return [text(NULL_DISPLAY)];
  const figure = strong(display(value, formatted));
  if (denominator === null || denominator === undefined) return [figure];
  return [figure, text(` / ${denominator}`)];
}
