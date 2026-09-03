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
| `schema/` | JSON Schema for each contract primitive |
| `tests/unit/` | Module tests, no engine required |
| `tests/plugin/` | End-to-end tests that drive the real `myst` CLI |
| `tests/fixtures/` | The probe plugin and the do-nothing site template the plugin tests build against |
| `dist/` | Build output. Generated, gitignored, attached to releases |

## Working on it

```bash
nvm use              # Node 24, per .nvmrc
npm ci
npm run bundle       # writes dist/datavis.mjs
npm test             # unit tests, then the myst-driven plugin tests
```

The plugin tests need the `myst` CLI on `PATH`. They skip themselves with a message when it
is missing, so `npm test` still passes without it — check the skip count before believing a
green run. CI installs `mystmd@1.10.1`, the engine the QuantEcon themes build against.

## Engine constraints

These are not style preferences. Each has been verified against mystmd 1.10.1 (qe-v10), and
each is pinned by a test so a future change cannot quietly break it.

**A bundle may import nothing but Node built-ins.** A plugin registered by URL is downloaded
into the consuming project's `_build` cache and imported from there, so it can resolve
neither a sibling file nor an npm package. That is why the repository has its own RFC 4180
reader rather than `csv-parse`, and why `myst-common`'s `fileError` is reimplemented in
`src/lib/report.mjs` on top of the VFile the engine already passes in. `tests/plugin/bundle.test.mjs`
fails the build if any bare specifier survives bundling.

**A directive's `fileError` does not fail `--strict`.** It is logged, and then dropped:
`loadFile` clears a file's stored warnings each time it loads it and serves the cached mdast
without re-running directives. Only a document-stage transform's messages survive to the
strict check. So a directive never reports a fatal problem directly — it calls `defer()` to
attach the diagnostic to the node it emits, and `diagnosticsTransform` re-raises it on every
pass. Every family bundle must register that transform. The engine behaviour is
QuantEcon/mystmd#95. A plugin also cannot declare a data file as a dependency of a page,
so a `myst start` session shows stale data until the page is touched: QuantEcon/mystmd#96.

**Emit portable nodes only.** `myst-to-tex` has no handler for `grid`, `card` or their
children, and silently drops the whole subtree from a LaTeX export while still exiting 0.
Directives therefore emit `div`, `span`, `table`, `list` and their standard children, with
the structured data as node properties. `CONTRACT.md` is the full statement of this.

**First registration wins, and core registers first.** Two plugins claiming one directive
name produce a warning and the first one listed; a plugin claiming a name mystmd core
already owns is ignored with no error at all. A family is therefore loaded exactly once per
project, and its names are checked against core's before being documented.
`tests/plugin/registration.test.mjs` pins all three behaviours and re-checks the contract's
eight names against the engine on every run.

**Directive `run()` is synchronous** and receives only `vfile.path`, so a `:file:` source is
resolved by walking up to `myst.yml` and read with `readFileSync`. Transform plugins receive
no options, so configuration is a directive option or an environment variable.

## Tests

Unit tests cover the toolchain modules directly. The plugin tests are the ones that matter
most: each builds a throwaway MyST project, runs the real `myst` CLI over it and asserts
against the page JSON the engine writes to `_build/site/content/`. They stay offline by
pointing `site.template` at `tests/fixtures/template`, a directory holding nothing but a
`template.yml` — enough for `myst build --site` to resolve a template without reaching the
template registry over the network.

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
