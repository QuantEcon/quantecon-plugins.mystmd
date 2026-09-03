/**
 * Build diagnostics: how a bundled plugin reports a problem so that `--strict` sees it.
 *
 * Two engine facts shape this module, both verified against mystmd 1.10.1 (qe-v10):
 *
 * 1. A bundle cannot import `myst-common`, so `fileError` and `fileWarn` are not available.
 *    They are, however, four lines each on top of the VFile the engine already hands to a
 *    directive: `vfile.message()` plus `fatal`. `fileError` and `fileWarn` below are exactly
 *    that, and produce log output indistinguishable from core's.
 *
 * 2. A `fileError` raised inside a DIRECTIVE is logged but does not fail `myst build --strict`.
 *    `loadFile` clears the store's warnings for a file each time it loads it, and on the
 *    second pass it serves the cached mdast without re-running directives, so a
 *    directive-stage message is wiped before the strict check harvests it. A message raised
 *    in a document-stage TRANSFORM is counted, because transforms run on every pass.
 *
 *    Consequence: a directive must not report a fatal problem directly. It attaches the
 *    diagnostic to the node it emits with `defer()`, and the family's
 *    `diagnosticsTransform` re-raises it on every pass. That is what makes "delete the CSV
 *    and the build fails loudly" true rather than aspirational — and it keeps working on
 *    incremental `myst start` rebuilds, where the directive never runs again.
 *
 *    The engine behaviour is filed as QuantEcon/mystmd#95; when that is fixed the deferral
 *    becomes redundant but stays harmless.
 */

/** Where a deferred diagnostic rides on the node that produced it. */
export const DIAGNOSTICS_KEY = 'qeDiagnostics';

/** The `ruleId` prefix consumers use to suppress a family's messages via `error_rules`. */
export const RULE_PREFIX = 'qe-datavis';

/**
 * Raise a fatal message on a VFile — the bundle-safe equivalent of `myst-common`'s
 * `fileError`. Fatal messages are reported with ⛔️ and, from a transform, stop `--strict`.
 *
 * @param {import('vfile').VFile} vfile
 * @param {string} message
 * @param {{node?: object, source?: string, note?: string, url?: string, ruleId?: string, key?: string}} [opts]
 */
export function fileError(vfile, message, opts = {}) {
  return addInfo(vfile.message(message, opts.node, opts.source), { ...opts, fatal: true });
}

/** Raise a non-fatal message on a VFile — the equivalent of `myst-common`'s `fileWarn`. */
export function fileWarn(vfile, message, opts = {}) {
  return addInfo(vfile.message(message, opts.node, opts.source), { ...opts, fatal: false });
}

function addInfo(message, opts) {
  if (opts.note) message.note = opts.note;
  if (opts.url) message.url = opts.url;
  if (opts.ruleId) message.ruleId = opts.ruleId;
  if (opts.key) message.key = opts.key;
  message.fatal = opts.fatal;
  return message;
}

/**
 * Attach a diagnostic to a node for `diagnosticsTransform` to raise later.
 *
 * This is what a directive calls instead of `fileError`. The node is returned so a directive
 * can write `return [defer(node, 'error', '...')]`.
 *
 * @param {object} node the node the directive is emitting
 * @param {'error'|'warn'} level
 * @param {string} message
 * @param {{note?: string, url?: string, ruleId?: string, key?: string}} [opts]
 * @returns {object} the same node
 */
export function defer(node, level, message, opts = {}) {
  if (level !== 'error' && level !== 'warn') {
    throw new TypeError(`diagnostic level must be 'error' or 'warn', got ${JSON.stringify(level)}`);
  }
  node.data = node.data ?? {};
  const existing = Array.isArray(node.data[DIAGNOSTICS_KEY]) ? node.data[DIAGNOSTICS_KEY] : [];
  node.data[DIAGNOSTICS_KEY] = [...existing, { level, message, ...opts }];
  return node;
}

/**
 * Build a node that stands in for a directive that could not produce its real output.
 *
 * The fallback matters: a failed directive that emits nothing leaves a hole in the page, and
 * on a non-strict build nobody notices. This emits a visible admonition instead, so the
 * problem is legible in the rendered page as well as in the build log.
 *
 * @param {string} primitive the primitive that failed, e.g. 'stats'
 * @param {string} message
 * @param {{ruleId?: string}} [opts]
 */
export function errorNode(primitive, message, opts = {}) {
  const node = {
    type: 'admonition',
    kind: 'error',
    class: `qe-dv qe-dv-error qe-dv-${primitive}`,
    children: [
      { type: 'admonitionTitle', children: [{ type: 'text', value: `${primitive} directive` }] },
      { type: 'paragraph', children: [{ type: 'text', value: message }] },
    ],
  };
  return defer(node, 'error', message, { ruleId: opts.ruleId ?? `${RULE_PREFIX}-${primitive}` });
}

/** Collect every deferred diagnostic in a tree, depth first, in document order. */
export function collectDiagnostics(tree) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const diagnostics = node.data?.[DIAGNOSTICS_KEY];
    if (Array.isArray(diagnostics)) {
      for (const diagnostic of diagnostics) found.push({ node, diagnostic });
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(tree);
  return found;
}

/**
 * The document-stage transform every family bundle must register.
 *
 * It re-raises each deferred diagnostic on the page's VFile, which is the only place the
 * engine's `--strict` accounting can see it. Register it once per bundle.
 */
export const diagnosticsTransform = {
  name: 'qe-datavis-diagnostics',
  doc: 'Re-raise diagnostics deferred by QuantEcon datavis directives so that --strict sees them.',
  stage: 'document',
  plugin: () => (tree, vfile) => {
    for (const { node, diagnostic } of collectDiagnostics(tree)) {
      const { level, message, ...opts } = diagnostic;
      const info = { ...opts, node: node.position ?? undefined };
      if (level === 'error') fileError(vfile, message, info);
      else fileWarn(vfile, message, info);
    }
    return tree;
  },
};
