/**
 * `datavis` — QuantEcon's data-presentation plugin family for mystmd.
 *
 * This module is the bundle entry point. `npm run bundle` compiles it and everything it
 * imports into a single ESM file, `dist/datavis.mjs`, which is what a project registers:
 *
 *   project:
 *     plugins:
 *       - https://github.com/QuantEcon/quantecon-plugins.mystmd/releases/download/vX.Y.Z/datavis.mjs
 *
 * One file, because a plugin fetched from a URL is cached on its own in the project's
 * `_build` cache and cannot resolve an import of a sibling file or an npm package from
 * there. Everything the directives need is therefore either a Node built-in or lives in
 * `src/lib/` and is inlined at bundle time.
 *
 * The directives themselves are not here yet. The node contract they emit is
 * QuantEcon/quantecon-plugins.mystmd#3; the two directive groups that implement it are #5
 * (`stats`, `bar-list`, `stacked-bar`, `heatmap`) and #6 (`data-table`, `chips`, `badges`,
 * `delta-list`). This file and the toolchain beneath it are #4, and the empty registry below
 * is what those two issues fill in.
 */
import { diagnosticsTransform } from './lib/report.mjs';

/**
 * The family's directives, in the order they are registered.
 *
 * mystmd keeps the FIRST directive registered under a name and warns once per page about
 * every duplicate, so a family must be loaded exactly once per project and must not take a
 * name that mystmd core already registers. Both facts are tested in
 * `tests/plugin/registration.test.mjs`.
 */
export const directives = [];

/**
 * The family's transforms.
 *
 * `diagnosticsTransform` is not optional. A directive's own `fileError` is logged but does
 * not fail `myst build --strict`, so every fatal problem a directive finds is deferred onto
 * the node it emits and re-raised here; `src/lib/report.mjs` explains why. `git-metadata`
 * joins this list under #11.
 */
export const transforms = [diagnosticsTransform];

/** The plugin object mystmd loads. Only the default export is read by the engine. */
const plugin = {
  name: 'QuantEcon datavis',
  author: 'QuantEcon',
  license: 'MIT',
  directives,
  transforms,
};

export default plugin;
