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
 *
 * Two further engine facts make the transform safe to write the way it is written. The
 * engine gives each pass a fresh VFile, so a set of already-raised diagnostics stashed on
 * `vfile.data` cannot leak into the next pass. And it `structuredClone`s the cached tree
 * before transforms run, so deleting the payload from a node after raising it does not
 * starve the next cached rebuild — that rebuild starts from the untouched clone.
 */

/** Where a deferred diagnostic rides on the node that produced it. */
export const DIAGNOSTICS_KEY = 'qeDiagnostics';

/** Where the transform records, per pass, which diagnostics it has already raised. */
const RAISED_KEY = 'qeDiagnosticsRaised';

/**
 * The stem of every rule id this family emits.
 *
 * mystmd's `error_rules` matches a rule id EXACTLY: `- id: qe-datavis` suppresses nothing,
 * `- id: qe-datavis-stats` suppresses that primitive's diagnostics. Build ids with
 * `ruleId()` so the stem is never spelled by hand.
 */
export const RULE_ID_BASE = 'qe-datavis';

/** The rule id for a primitive's diagnostics, the exact string `error_rules` needs. */
export function ruleId(primitive) {
  return `${RULE_ID_BASE}-${primitive}`;
}

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
 * Copy the authoring directive's source position onto an emitted node.
 *
 * A node a directive builds has no position of its own, so a diagnostic deferred onto it
 * would be reported with a file name and no line. The directive does receive the parsed
 * directive node, with its position, as `data.node`; forwarding it is what turns
 * `page.md cannot read data/x.csv` into `page.md:14 cannot read data/x.csv`.
 *
 * @param {object} node the node being emitted
 * @param {{node?: {position?: object}}} data the `DirectiveData` the engine passed to `run()`
 * @returns {object} the same node
 */
export function locate(node, data) {
  const position = data?.node?.position;
  if (position) node.position = position;
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
 * @param {{ruleId?: string, data?: object}} [opts] pass the directive's `data` to give the
 *   diagnostic a line number
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
  locate(node, opts.data);
  return defer(node, 'error', message, { ruleId: opts.ruleId ?? ruleId(primitive) });
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
 * engine's `--strict` accounting can see it, then removes the payload from the node so it
 * does not ship in the site JSON.
 *
 * A project that loads a family twice — by two paths, or through a template that pulls it in
 * as well — gets two copies of this transform, in two module scopes, on the same pass. Each
 * pass's VFile is the one thing both copies share, so the set of diagnostics already raised
 * lives there: the second copy finds nothing left to raise.
 */
export const diagnosticsTransform = {
  name: 'qe-datavis-diagnostics',
  doc: 'Re-raise diagnostics deferred by QuantEcon datavis directives so that --strict sees them.',
  stage: 'document',
  plugin: () => (tree, vfile) => {
    vfile.data = vfile.data ?? {};
    const raised = (vfile.data[RAISED_KEY] ??= new WeakSet());
    for (const { node, diagnostic } of collectDiagnostics(tree)) {
      if (raised.has(diagnostic)) continue;
      raised.add(diagnostic);
      const { level, message, ...opts } = diagnostic;
      const info = { ...opts, node: node.position ?? undefined };
      if (level === 'error') fileError(vfile, message, info);
      else fileWarn(vfile, message, info);
    }
    for (const { node } of collectDiagnostics(tree)) {
      delete node.data[DIAGNOSTICS_KEY];
      if (Object.keys(node.data).length === 0) delete node.data;
    }
    return tree;
  },
};
