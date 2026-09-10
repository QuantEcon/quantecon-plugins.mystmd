# Changelog

All notable changes to the QuantEcon mystmd plugin families are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Release flow.** Each release is a `vX.Y.Z` git tag. Pushing the tag triggers
> `release.yml`, which bundles every family and publishes a GitHub Release with one `.mjs`
> asset per family, using that version's section of this file as the release notes. Consumers
> pin the asset by its tagged URL in `myst.yml`; see [`CONTRIBUTING.md`](./CONTRIBUTING.md)
> "Releases".
>
> **The version here is the bundle's, not the contract's.** `CONTRACT.md` carries its own
> `contract` version, stamped onto every emitted node, and the two move independently: a
> release that changes only a renderer hint leaves the contract at `1.0`. The rule for which
> is which is in `CONTRACT.md`, "The plugin's release version and the contract version".

## [Unreleased]

## [0.0.1] — unreleased

The distribution plumbing, with no directives in it yet.

### Added

- `release.yml`: a tag-triggered pipeline that bundles every family declared in
  `scripts/bundle.mjs` and attaches one `.mjs` per family to a GitHub Release, with this
  file's matching section as the release notes. Four guards fail the release rather than
  publishing something wrong — the tag must match `package.json`, this file must have a
  section for that version, the full suite must pass including the tests that drive the real
  `myst` CLI, and the bundle must be byte-identical when built twice. Split out of
  [#7](https://github.com/QuantEcon/quantecon-plugins.mystmd/issues/7) and landed ahead of the
  directive groups per QuantEcon/workspace-themes#12, so that downstream repositories have a
  real URL to pin before there is anything worth pinning.
- Each bundle now carries its `package.json` version in its banner, and the release checks the
  stamp before publishing. A pinned asset URL already names its version; the banner is what
  keeps a vendored copy identifiable once the URL is gone.

### Fixed

- The bundle banner named `datavis` whichever family was being built. It now names the family
  it actually built, which matters as soon as there is a second one.

### Known gaps

- `src/index.mjs` registers **no directives**. This release exists to prove the pipeline end
  to end and to give consumers a URL shape; the eight primitives are
  [#5](https://github.com/QuantEcon/quantecon-plugins.mystmd/issues/5) and
  [#6](https://github.com/QuantEcon/quantecon-plugins.mystmd/issues/6), and `v0.1.0` is the
  release that carries them.
- The one transform registered, `qe-datavis-diagnostics`, is load-bearing and is included:
  without it a directive's fatal diagnostic never reaches `myst build --strict`. See
  QuantEcon/mystmd#95.

[Unreleased]: https://github.com/QuantEcon/quantecon-plugins.mystmd/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/QuantEcon/quantecon-plugins.mystmd/releases/tag/v0.0.1
