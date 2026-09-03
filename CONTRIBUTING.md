# Contributing

*How this repository is built, tested and released, and the engine constraints that shape
every plugin in it.*

Last updated: 2026-09-03

## Layout

| Path | What lives there |
| --- | --- |
| `src/index.mjs` | The `datavis` bundle entry: the directive and transform registry |
| `src/lib/` | The shared toolchain — CSV reading, project-root resolution, the file cache, diagnostics |
| `scripts/bundle.mjs` | The esbuild step that turns `src/` into a single-file release asset |
| `CONTRACT.md` | The node contract: what the directives emit and what a theme implements |
| `schema/` | JSON Schema for each contract primitive, the machine-readable half of `CONTRACT.md` |
| `samples/` | Fixtures per primitive: `valid` nodes, and `invalid` ones that must be rejected |
| `tests/unit/` | Module tests, no engine required |
| `tests/plugin/` | End-to-end tests that drive the real `myst` CLI |
| `tests/fixtures/` | The probe plugin and the do-nothing site template the plugin tests build against |
| `dist/` | Build output. Generated, gitignored, attached to releases |

## Working on it

```bash
nvm use              # Node 24, per .nvmrc
npm ci
npm run bundle       # writes dist/datavis.mjs
npm test             # the contract check, then unit tests, then the myst-driven plugin tests
```

The plugin tests need the `myst` CLI on `PATH`. Locally they skip themselves with a message
when it is missing, so `npm test` still passes without it — check the skip count before
believing a green run. On CI the same absence is an error rather than a skip, so a runner
that has quietly lost the CLI cannot report a green suite.

CI installs upstream `mystmd@1.10.1` from the npm registry. The themes are developed against
QuantEcon's fork of that version (qe-v10), which is what `myst --version` prints on a
maintainer's machine; the fork has no published package to install from, so CI and local
runs test the same version from two builds. A fork-only change to plugin loading would show
up in one and not the other.

## Engine constraints

These are not style preferences. Each has been verified against mystmd 1.10.1 (qe-v10). The
ones a test can pin are pinned, and the section on each says which test; the two that are
export behaviours of `myst-to-tex` are verified by hand and recorded in the node contract.

**A bundle may import nothing but Node built-ins.** A plugin registered by URL is downloaded
into the consuming project's `_build` cache and imported from there, so it can resolve
neither a sibling file nor an npm package. That is why the repository has its own RFC 4180
reader rather than `csv-parse`, and why `myst-common`'s `fileError` is reimplemented in
`src/lib/report.mjs` on top of the VFile the engine already passes in. `tests/plugin/bundle.test.mjs`
fails the build if any bare specifier survives bundling, and — the case that check alone
cannot see, because esbuild inlines whatever it is not told is external — if any file from
`node_modules` was inlined.

**A directive's `fileError` does not fail `--strict`.** It is logged, and then dropped:
`loadFile` clears a file's stored warnings each time it loads it and serves the cached mdast
without re-running directives. Only a document-stage transform's messages survive to the
strict check. So a directive never reports a fatal problem directly — it calls `defer()` to
attach the diagnostic to the node it emits, and `diagnosticsTransform` re-raises it on every
pass, with the directive's own line number if the directive passed its `data` to `locate()`
or `errorNode()`. Every family bundle must register that transform. The engine behaviour is
QuantEcon/mystmd#95, and `tests/plugin/toolchain.test.mjs` pins both halves of it: a fatal
message from a directive exits 0, the same message from a transform exits 1. A plugin also
cannot declare a data file as a dependency of a page, so a `myst start` session shows stale
data until the page is touched: QuantEcon/mystmd#96.

**Emit portable nodes only.** `myst-to-tex` has no handler for `grid`, `card` or their
children. It logs `Unhandled LaTeX conversion` for the node, drops the whole subtree from
the export, and exits 0 — even under `--strict`, whose accounting lives only in the site
build path. Directives therefore emit `div`, `span`, `table`, `list` and their standard
children, with the structured data as node properties. The node contract
(QuantEcon/quantecon-plugins.mystmd#3) is the full statement of this.

**First registration wins, and core registers first.** Two plugins claiming one directive
name produce a warning and the first one listed. A plugin claiming a name mystmd core
already owns never runs: the page builds, core's directive renders, and the only signal is
the same `duplicate directives registered` warning, once per page — a line to look for in a
log, not an error a build stops on. A family is therefore loaded exactly once per project,
and its names are checked against core's before being documented.
`tests/plugin/registration.test.mjs` pins all three behaviours and re-checks the contract's
eight names against the engine on every run.

**Directive `run()` is synchronous** and receives only `vfile.path`, so a `:file:` source is
resolved by walking up to `myst.yml` and read with `readFileSync`. Transform plugins receive
no options, so configuration is a directive option or an environment variable.

## Tests

`npm run test:contract` checks the contract on its own and needs no engine: every schema in
`schema/` compiles under ajv in strict mode, every sample in `samples/` marked valid
validates, every sample marked invalid is rejected, every valid sample satisfies the
invariants `CONTRACT.md` states in prose, and every valid sample still validates once every
node under it carries the `key` and `position` the engine stamps on an emitted tree. `ajv` is a devDependency, which the bundle
constraint permits — nothing in `scripts/` or `tests/` is bundled — and hand-rolling a
partial JSON Schema checker would mean the schemas were checked by an implementation that
does not implement the spec they are written in.

Unit tests cover the toolchain modules directly. The plugin tests are the ones that matter
most: each builds a throwaway MyST project, runs the real `myst` CLI over it and asserts
against the page JSON the engine writes to `_build/site/content/`. They do not depend on the
network: `site.template` points at `tests/fixtures/template`, a directory holding nothing
but a `template.yml`, which is enough for `myst build --site` to resolve a template without
reaching the template registry. The CLI still makes one outbound call per run — an update
check against the npm registry — and tolerates its failure, so the suite passes with the
network denied but is not silent on it.

Two asymmetries are worth remembering when adding a test:

- `--strict` accounting lives in the site build path, so a test asserting that a build fails
  must use `myst build --site --strict`. The `--md` and `--tex` paths exit 0 regardless.
- A single-page table of contents makes that page the project index, so it is written as
  `index.json` rather than under its own slug.

## Releases

Each family is bundled to one `.mjs` file and attached to a GitHub Release; projects pin a
tagged asset URL in `myst.yml`. Release tooling arrives with the first release,
QuantEcon/quantecon-plugins.mystmd#7.

## Conventions

- Australian English in prose (colour, behaviour, organise, prioritise).
- Dates as `YYYY-MM-DD`.
- No closing keyword (`fixes`, `closes`, `resolves`) immediately before an `owner/repo#N`
  reference in a commit message or pull-request body — GitHub auto-closes the referenced
  item on merge. Write "See QuantEcon/foo#12" or "Part of QuantEcon/foo#12".
