# QuantEcon plugins for MyST Markdown

Plugin families for the **mystmd** engine (the JavaScript `myst` CLI that Jupyter Book ≥ 2
is built on), published as single-file `.mjs` bundles attached to GitHub Releases and
registered by URL from a project's `myst.yml`. The `.mystmd` suffix marks the repository
as engine tooling, in the same family as
[`quantecon-theme.mystmd`](https://github.com/QuantEcon/quantecon-theme.mystmd) and
[`quantecon-theme-report.mystmd`](https://github.com/QuantEcon/quantecon-theme-report.mystmd).

## Status

**Planning complete (2026-09-02); build not started.** Work hangs off this repository's
`Project`-typed tracker issue (see Issues). The plan that created this repository is
[`PLAN.md` in the report theme's design handover](https://github.com/QuantEcon/quantecon-theme-report.mystmd/tree/main/docs/design-handoff-2026-09).

## Families

| Family | Bundle | Contents | Status |
| --- | --- | --- | --- |
| Data presentation | `datavis.mjs` | `stats`, `bar-list`, `stacked-bar`, `heatmap`, `data-table`, `chips`, `badges`, `delta-list` — data-presentation directives reading inline data or CSV files | planned first |
| Repository metadata | `git-metadata.mjs` | per-page git history (last modified + changelog) | lives in the lecture theme today; the move is tracked in [quantecon-theme.mystmd#156](https://github.com/QuantEcon/quantecon-theme.mystmd/issues/156) |

Domain-specific wrappers that apply a rubric to a particular dataset (for example the
compliance ledger's `qe-*` directives) do **not** live here; they ship beside the theme
that renders them and emit the same node shapes these families define.

## Principles

- **Portable AST.** Every directive emits standard MyST nodes — classed `div`/`span`,
  tables, lists, the core `grid`/`card` — with structured data as node properties and a
  small set of tone hints. Content renders in any theme and in PDF export; a theme may
  upgrade the nodes by implementing the documented contract (`CONTRACT.md` and
  `schema/`, forthcoming).
- **Self-contained bundles.** A remotely loaded plugin cannot import npm packages or
  other bundles, so each family is bundled to one file using Node built-ins only.
- **One registration per family.** mystmd keeps the first directive registered under a
  name and warns on duplicates, so a family is loaded once; names stay plain nouns with a
  documented alias fallback.
- **Share the contract, not the code.** Consumers emitting the same nodes duplicate a few
  helpers rather than depending on this repository at build time.

## Using a family

Pin a release asset in `project.plugins`:

```yaml
project:
  plugins:
    - https://github.com/QuantEcon/quantecon-plugins.mystmd/releases/download/vX.Y.Z/datavis.mjs
```

## License

MIT — see [LICENSE](./LICENSE).
