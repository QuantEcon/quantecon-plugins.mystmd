# The datavis node contract

*What the `datavis` directives put into the document tree, so that a theme can render it and
a second producer can emit the same shapes without sharing any code.*

Contract version **1.0** · Last updated: 2026-09-03

## Why there is a contract at all

Two producers and at least one consumer have to agree without a build-time dependency
between them. The producers are this plugin family and the compliance wrappers that ship
beside the QuantEcon report theme; the consumer is that theme's renderers, and in principle
any other MyST theme. A shared library would be the obvious answer and is the wrong one: a
plugin bundle cannot import anything at all (see [Packaging
constraints](#packaging-constraints)), so the dependency would have to be vendored anyway.
What is shared instead is this document and the JSON Schemas beside it. Duplicating a hundred
and fifty lines of node building is the price, and it is lower than the price of a
cross-repository build dependency.

This is decision D3 of the report theme's
[design review](https://github.com/QuantEcon/quantecon-theme-report.mystmd/blob/15f6672b9bbce57f83666dbb6ff20ac2e3e8a2da/docs/design-handoff-2026-09/REVIEW.md),
restated here as an implementable specification, and amended on one point: D3's phrase "plus
the core `grid` and `card` nodes" is withdrawn, for the reason given under
[Portability](#portability-what-the-node-types-may-be).

## The one rule

**Every primitive emits standard MyST nodes whose children are a genuine, readable rendering
of the data, with the structured data attached as properties of the root node.**

Everything else in this document follows from that sentence. A theme that implements nothing
still shows a real table or a real list. A theme that implements the contract reads the
properties and draws a chart. Neither is a degraded version of the other, and no content is
ever locked inside a node type only one theme understands.

The failure mode this rule exists to prevent is the empty container: a node carrying a
beautiful `items` array and no children, which renders as nothing at all in every theme but
one. A primitive whose fallback is empty is not implementing this contract.

## Portability: what the node types may be

The allowed node types are `div`, `span`, `table`, `tableRow`, `tableCell`, `list`,
`listItem`, `paragraph`, `text`, `strong`, `emphasis`, `inlineCode`, `link`, `admonition`
and `code`. Nothing else.

Three engine behaviours make this list what it is, all verified against mystmd 1.10.1
(qe-v10):

| Behaviour | Consequence |
| --- | --- |
| `myst-to-react` renders an unregistered node type with `DefaultComponent`: a `div` wrapping its children, or an empty `span` when it has none | A childless custom node renders as **nothing** in the default book theme and in QuantEcon's lecture theme |
| `myst-to-tex` raises `Unhandled LaTeX conversion for node of "<type>"` for a type it does not know, and does not recurse | The whole subtree is dropped from a LaTeX or PDF export |
| `myst-to-tex` has no handler for `grid`, `card`, `cardTitle`, `header`, `footer` or `grid-item` | Even the **core** grid and card nodes are dropped |

That third row is the one that surprises people, because `grid` and `card` are core nodes
that every MyST theme renders. They are still not portable in the sense this contract means.
A page built from `{grid}` and `{card}` exports to LaTeX with the grid simply missing — and
the build **still exits 0**, because `--strict` accounting lives only in the site build path,
so `myst build --tex --strict` logs the message and reports success. None of the eight
primitives uses them, and neither do the compliance wrappers.

`myst-to-typst` handles `card`, `cardTitle` and `footer`, but not `grid`; its `footer`
handler returns without writing anything, which loses the content while reporting success.

## Packaging constraints

A plugin registered by URL is fetched into the consuming project's `_build` cache and
imported from there, so it can resolve neither a sibling source file nor an npm package.
Every family therefore ships as a single bundled `.mjs` file whose only imports are Node
built-ins. In practice this means a family carries its own CSV reader rather than
`csv-parse`, and its own copies of `fileError` and `fileWarn` rather than importing
`myst-common`.

A directive's `run()` is synchronous and is handed only `vfile.path`, so a `:file:` source is
resolved by walking up to `myst.yml` and read with `readFileSync`. Transform plugins receive
no options at all, so anything configurable is a directive option or an environment variable.

## Reporting problems

A `fileError` raised inside a directive is logged but is **not** counted by
`myst build --site --strict`, so a broken directive exits 0
([QuantEcon/mystmd#95](https://github.com/QuantEcon/mystmd/issues/95)). `loadFile` clears a
file's stored warnings each time it loads it and then serves the cached mdast without
re-running directives, so a directive-stage message is wiped before the strict check harvests
it; a document-stage transform's messages survive, because transforms run on every pass.

A directive therefore does not report a fatal problem directly. It attaches the diagnostic to
the node it emits, under `data.qeDiagnostics`, and the family's document-stage transform
re-raises it on every pass — which is also what keeps it working across incremental rebuilds —
then removes the payload, so it never ships in the site JSON. Each pass raises a diagnostic
once, even when a project has loaded the family twice.
Every family bundle implementing this contract must register that transform. A directive that
cannot produce its real output emits a visible error admonition rather than nothing, so a
non-strict build still shows the reader what went wrong.

Two further behaviours worth knowing when implementing:

- `--strict` accounting lives in the site build path only. `myst build --md --strict` and
  `myst build --tex --strict` exit 0 whatever happens.
- A plugin cannot declare a data file a dependency of a page, so under `myst start` a CSV
  edit rebuilds the page from the engine's cache and shows stale data until the page itself
  is touched ([QuantEcon/mystmd#96](https://github.com/QuantEcon/mystmd/issues/96)). A fresh
  `myst build` is always current.

## Shape of every primitive

Every primitive's root node carries the same four properties, whatever else it adds:

| Property | Type | Value |
| --- | --- | --- |
| `type` | string | `div` for all eight primitives |
| `class` | string | `qe-dv` and `qe-dv-<primitive>`, space separated, plus any author-supplied tokens |
| `contract` | string | the contract version this node was built to, `"1.0"` today |
| `primitive` | string | the primitive's name, for example `"stats"` |

`class` carries two tokens rather than one so that a theme can style the family as a whole
and each primitive individually, and so a selector can key on either. Renderers should match
on the primitive token: `myst-to-react`'s `selectRenderer` accepts `unist-util-select`
selectors, so `div[class~=qe-dv-stats]` is a legal renderer key and is the recommended one.
Matching on the `primitive` property works equally well for a consumer that is not
`myst-to-react`.

The author's own `:class:` tokens are normalised before they are appended: the value is split
on whitespace, empty tokens are dropped, tokens already present are dropped, and the
survivors are joined with single spaces. This is not something mystmd does — core's
`addClassOptions` is literally `node.class = data.options.class` — so a directive that skips
it emits a trailing space for an empty `:class:` and a duplicate token for `:class: qe-dv`.

## Rules every primitive follows

These are family-wide. Each one exists because an engine behaviour makes the alternative
break something, and each is stated once here rather than eight times below. Where a
primitive's own section appears to say otherwise, this section wins.

### Authoring: one body form, no item directives

A primitive's data is authored either in the directive body or in a CSV named by `:file:`.
The body is ordinary MyST content, and each primitive accepts exactly one form of it: a
bullet list for the list-shaped primitives, and a pipe table for the matrix-shaped ones.
There are **no item directives** — no `{stat}` inside `{stats}`, no `{delta}` inside
`{delta-list}`.

That is not a style preference. Verified behaviour: `myst-parser` collects every unprocessed
directive in the document with one `selectAll` in document order and runs them in a single
pass, so a container's `run()` executes **before** the directives nested in its body and sees
them as raw `mystDirective` nodes, never as their output. Worse, the nested items' `run()`
still fires afterwards, against nodes the container has already replaced, so their output is
computed and then discarded — and any diagnostic they raise is raised from a node that is no
longer in the tree.

A container could parse the raw `mystDirective` nodes itself, and `myst-ext-grid` gets away
with re-parenting its body untouched. Neither is worth it here: item directives would double
the number of registered names, each one a fresh chance of a silent collision with a future
core directive, in exchange for syntax a bullet list already expresses. A bullet list also
gives inline markdown — code spans, links, emphasis — in labels and descriptions, which is
what the YAML bodies in the original design brief were reaching for.

### Fallback tables: one header row, equal row lengths

Only row 0 of a fallback table carries `header: true`, and no cell in any other row does.
`myst-to-tex` writes a `\hline` after every row whose first cell is a header, so row-header
cells produce a table ruled after every line; and its long-table path counts leading header
rows to find where the body starts, so a table with a header cell in every row is emitted
with a repeating running header and **no body rows at all**.

Every row in a fallback table has the same number of cells, including the header row. There
is no ragged table, and a column that is empty for one row gets an empty cell rather than
being omitted. `myst-to-typst` writes the cells of a table as one flat positional sequence
after declaring the column count from the first row, with no row delimiter, so a single short
row shifts every cell after it one column to the left for the rest of the table.

### The data lives exactly twice

Once as properties of the root node, and once rendered in the children. Never three times.
Inner nodes — the `span` inside a chip, the `tableCell` inside a row — carry a `class` and
nothing else: no `contract`, no `primitive`, no duplicate copy of the item they render. A
third copy is a third thing to keep in step, and the first one to drift is the one nobody
renders.

### No `label`, `identifier` or `html_id` on any node a primitive emits

`{embed}` strips all three from every node in the embedded subtree except cross-references,
citations, footnotes and links. A primitive that put a label on its root would lose it, and
only when the page was embedded somewhere else — the kind of defect that survives every test
and appears once the content is reused. Text that needs to travel goes in a property or in
the children.

### One vocabulary for a missing value

A value that is absent is `null` in the properties and renders as an em dash in the fallback.
There is no per-primitive label option and no magic string: `"N/A"`, `"n/a"`, `"na"`, `"-"`,
`"—"` and `"null"` are the tokens a CSV may use to mean absent, they all become `null`, and
the fallback shows `—` for all of them. A primitive that wants to distinguish *absent* from
*out of scope* does it with a second property, not a second spelling of nothing.

### Tone is a hint, never a colour and never a threshold

The closed set is `neutral`, `accent`, `good`, `warn` and `bad`. A primitive never decides
that 4.2 is bad; the producer that knows the rubric decides that and passes the word. A
consumer that meets a tone it does not know renders the value as though the tone were
`neutral` rather than failing.

## Tone

*Tone is the one channel through which a datavis primitive says how a number should read. It is a
hint, never a colour and never a rule. This section fixes the vocabulary, says where it may attach,
tells a consumer what to do with a word it does not recognise, and draws the line the plugin may
never cross.*

### The closed set

Contract 1.0 defines exactly five tones. The set is closed: a producer at this contract version
emits nothing else, and a directive handed anything else defers an error diagnostic onto the
node it emits, which the family's document-stage transform re-raises.

| Tone | Means | Does **not** mean |
| --- | --- | --- |
| `neutral` | No claim is being made about this value. It is shown, not judged. The default everywhere. | "Average", "middling", "zero". A neutral value may be the best or the worst in the set. |
| `accent` | Notable as *data* — the house measurement colour that separates a measured quantity from the chrome around it. | Approval. `accent` carries no valence at all; a reader must never infer that an accented value is good. |
| `good` | Reads well against whatever standard the producer applies. | "Large". A low count can be `good`; a high one can be `bad`. Magnitude and valence are independent. |
| `warn` | Worth a second look; not yet a failure. The middle step of a three-band judgement, or a caution with no band beneath it. | A build warning. Diagnostics are `fileWarn`; tone is presentation. |
| `bad` | Reads badly against whatever standard the producer applies. | "Invalid", "error", "missing". Bad data fails the build; a `bad` tone is perfectly valid data that happens to read poorly. |

The five split into two sub-vocabularies, and the split matters more than the individual words.
`good`, `warn` and `bad` are **valence claims**: the producer is asserting how the value reads.
`neutral` and `accent` are the **absence of a valence claim**, differing only in visual prominence.
They are therefore not points on one scale, which is why tones are unordered — see below.

### What a tone is not

- **Not a colour.** No node property in this family ever holds a hex value, an `oklch()`
  expression, a CSS variable name or a palette token. The word is the whole payload; the
  consumer owns the mapping.
- **Not a threshold, and never derived from one.** See *The hard rule*.
- **Not a severity level.** Tones have no order, no rank and no numeric mapping. A consumer must
  not sort, compare, aggregate or count by tone, and must not assume `bad < warn < good`.
- **Not a category.** Where a domain vocabulary must reach the page, it travels as data — a
  `label`, a `badge` label, a `chips` item. `stacked-bar` shows the pattern exactly: `HIGH` is a
  `categories[].label` and `bad` is that category's tone, and two categories may legitimately
  share one tone while remaining distinct.
- **Not weight, fill or emphasis.** Those are separate, orthogonal axes: `badges` carries
  `emphasis` (`outline` | `solid`), `data-table` carries `strong` on a cell. Neither may be
  inferred from a tone, and neither may be smuggled into one. Where a design difference is not a
  valence claim, the right answer is a second axis, never a sixth tone.
- **Not a direction.** In `delta-list` the arithmetic sign of `to − from` and the tone are
  independent: a share falling from 78% to 68% is an improvement, and the fall is arithmetic
  while the improvement is judgement. A consumer draws its ▲/▼ from the **tone** — as an
  improvement marker, not an up-or-down marker — and never from the numbers.
- **Not an applicability state.** See *Null wins* below.

### Where a tone may attach

Three attachment levels are permitted, and no others.

**Item level (the normal case).** Tone attaches to the datum a reader would point at: a
`stats[].tone`, a `bar-list` `items[].tone`, a `data-table` cell's `tone`, a `chips` chip, a
`badges` badge, a `delta-list` item. This is where tone belongs unless there is a specific reason
otherwise.

**Set level (a default, which must be resolved).** A primitive may accept a tone for a whole set —
`chips`' `tone`, a `delta-group`'s `tone`, `stacked-bar`'s `categories[].tone` — as an authoring
convenience. The emitted node must then carry the **resolved** value on every leaf. A consumer
must never have to walk up a tree to find a tone, and no leaf may say "absent, so inherit".

**Scale level (continuous-ramp primitives only).** Where colour comes from a continuous ramp
rather than a discrete hint, a single tone attaches to the ramp and names **the tone of a value at
`scale.max`**. `heatmap` is the only such primitive in contract 1.0. The tone names the endpoint
and nothing more: how the ramp behaves between `scale.min` and `scale.max` — diverging, monochrome,
lightness-only — is entirely the consumer's decision and is not contract.

Two prohibitions follow. **A root-level tone that exists only as a fallback for absent item tones
is forbidden.** And **a tone-bearing leaf must always carry a resolved value** — present, from the
closed set, never `undefined` and never `null`. Where a leaf has no tone field of its own it must
be tied unambiguously to exactly one tone-bearing entity by position, as a `stacked-bar` segment is
tied to `categories[i]`; that is normalisation, not inheritance, and it is permitted.

### Defaults, repeats and precedence

**The contract default is `neutral`.** A directive may choose a different authoring default where
the design warrants it — `bar-list` defaults to `accent`, on the reasoning that an unopinionated
bar should still read as data — provided the default is documented in that primitive's section and
the resolved value is always emitted. Because tone is never absent from a node, a default only ever
governs authoring, never rendering.

**Repeated tones are legal and meaningful.** Where a primitive carries an ordered set of
tone-bearing entities, two entities may share a tone; their **position in that set** is the only
tie-break, earlier being the stronger step. A consumer that cannot shade within a tone family must
render them identically without error, and must never re-order the set to make tones contiguous.

**Null wins over tone.** Where a primitive has a not-applicable state — `stats` with a null
`value`, `heatmap` with a null cell, `data-table` with a null number — that state determines the
rendering and the tone is ignored. A renderer branches on applicability first, then on tone. A
non-`neutral` tone on a not-applicable value is legal but meaningless.

**Tone never changes the emitted text.** The fallback children are tone-independent: no glyph, no
bracketed word, no emphasis, no re-ordering and no omission may be driven by a tone. Anything a
reader must be able to recover without colour belongs in the data — the asterisk that marks a
proposed rule in `bar-list` lives in `label`, precisely so it survives print, LaTeX export,
monochrome and colour-blind viewing. This rule is what makes the forward-compatibility guarantee
below cheap: degrading an unrecognised tone loses colour and nothing else.

**Class tokens are derived, never authoritative.** Where a tone-bearing datum has a dedicated node
in `children`, that node carries `qe-dv-tone-<tone>` so a theme can style it in CSS alone with no
React renderer. The token is generated from the property; a consumer that can read properties reads
properties. A tone-bearing datum with no node of its own — a `stats` tile, a `bar-list` row, each
of which is a table row in the fallback — emits no token, and a consumer that needs one upgrades
the node instead.

### What a consumer must do

A consumer's whole licence is to map a tone to colour. Specifically:

1. **Map tone to colour and to nothing else.** Not to layout, not to order, not to presence, not to
   content, not to a number.
2. **Accept any string.** A tone slot holding a word from a later contract revision must not throw,
   must not fail a build and must not drop the node or its children.
3. **Degrade an unrecognised or absent tone to `neutral`,** and render everything else normally. An
   unrecognised tone loses the colour claim; it loses nothing else, because tone claims nothing
   else.
4. **Match exactly.** No prefix matching, no fuzzy mapping, no inventing `bad-severe` → `bad`. A
   word is in the set or it is `neutral`.
5. **Never re-derive.** A consumer must not inspect a value to second-guess a tone, and must not
   reconstruct thresholds from the tones it observes.
6. **Report at most once.** A consumer that logs unrecognised tones logs one message per distinct
   unknown value per build, not one per node — a heatmap has hundreds of cells.

A tone-blind rendering — every tone treated as `neutral` — must be complete and correct. If it is
not, something other than colour has been encoded in the tone, and that is a contract violation.

### The hard rule: the plugin never encodes a domain threshold

**A datavis primitive never inspects a value in order to choose a tone. It only ever receives the
word.** The band edges, the rubric, the severity policy and the decision about what counts as good
live in the wrapper that owns the domain — for QuantEcon, `compliance.mjs` — and nowhere else. The
rubric is not a constant in this repository, not a default, not a fallback, not a test fixture and
not a comment.

The rule has a mechanical form that is worth stating because it is testable:

> Tone resolution is a pure function of a single argument — the input tone — plus a constant
> default. If an implementation's tone-resolution function takes a value, a scale, a maximum, a
> denominator or a row, it is wrong.

And a falsifiable check that follows from it:

> Replace every numeric value in a node's input with `NaN` and rebuild. Every emitted tone must be
> byte-identical. If any tone changes, a threshold has leaked.

Four conformance checks belong in the plugin's test suite:

| Check | Passes when |
| --- | --- |
| Palette grep | `datavis.mjs` contains no `#rrggbb`, no `oklch(`, no `rgb(`, no colour-token string. |
| Arity | Every tone-resolution path takes the tone and nothing else. |
| NaN invariance | The rebuild-with-`NaN` test above leaves all tones unchanged. |
| Vocabulary | No generic option name or node property name is a domain word (`HIGH`, `MEDIUM`, `LOW`, `NONE`, `TOTAL`, `rule`, `lecture`, `series`, `score`, `priority`, `severity`, `compliance`). Such words appear only inside author-supplied data. |

### Worked example: the compliance score bands

The published compliance rubric bands a 0–10 category score as **red ≤ 5.0 < amber < 8.6 ≤ green**,
and an empty cell means the category is not in scope. Here is the series-report score strip for
`lecture-python-programming`, and which side of the line each concern lives on.

| Concern | `compliance.mjs` (wrapper) | `datavis.mjs` (primitive) | The theme (consumer) |
| --- | --- | --- | --- |
| Reading `scores.csv` | ✅ owns it | — | — |
| The numbers 4.1, 7.3, 8.4, 9.0, 9.8, 9.9 | reads them | **carries them** | prints them |
| The band edges **5.0** and **8.6** | ✅ **owns them, exclusively** | never sees them | never sees them |
| "4.1 is below 5.0, therefore `bad`" | ✅ decides it | — | — |
| The word `bad` | writes it | **carries it** | reads it |
| The scale `max: 10` | passes it | **carries it** | draws the bar against it |
| The empty `references` cell → `value: null` | decides it | **carries it** | renders the N/A state |
| Red `#a63a2e` | never sees it | never sees it | ✅ **owns it, exclusively** |

What the primitive receives is eight objects of this shape, and nothing more:

```json
{ "label": "Writing", "value": 4.1, "display": "4.1", "tone": "bad" }
{ "label": "Figures", "value": 7.3, "display": "7.3", "tone": "warn" }
{ "label": "Code",    "value": 8.4, "display": "8.4", "tone": "warn" }
{ "label": "Math",    "value": 9.0, "display": "9.0", "tone": "good" }
{ "label": "References", "value": null, "display": "N/A", "tone": "neutral" }
```

Two change tests make the boundary falsifiable:

- **Move a band.** Redefine amber as `5.5 < x < 8.0`. Only `compliance.mjs` changes. No primitive
  changes, no schema changes, no renderer changes, no page is re-authored, and every published
  contract test still passes.
- **Restyle a colour.** Take `bad` from `#a63a2e` to something warmer. Only the theme changes. No
  wrapper changes and no primitive changes.

If either change touches `datavis.mjs`, a threshold or a colour has leaked.

**The case that proves it.** The same series report renders the same measure against **two
different thresholds on the same page**. The score strip colours Writing 4.1 red at the rubric's
`≤ 5.0`, while the ranked table below it bolds and reddens a Writing cell at `≤ 4`. Both are
deliberate, both are in the design brief, and a primitive that knew the rubric would necessarily
render one of them wrongly. It knows neither: it receives `tone: "bad"` in one place and
`tone: "bad", strong: true` in the other, and draws what it is told.

**The boundary case.** Occasionally a threshold must be *drawn* — the charts page's
category-averages chart carries dashed lines at 8.6 and 5.0, labelled "NONE ≥ 8.6" and
"HIGH ≤ 5.0". That is not a counter-example: at the moment a threshold becomes something the reader
sees, it has become **data with a label**, and it travels as an annotation with its own value, its
own label text and its own tone, exactly like any other datum. What is forbidden is not carrying a
number that happens to be a boundary; it is a primitive applying one. The distinguishing test is
simple:

> A number the **reader** needs in order to read the picture — a scale, a total, a denominator, a
> labelled reference line — may live in the node. A number used only to **choose a tone** never
> may.

That test admits `stats`' `max: 10`, `bar-list`'s `total: 27`, `heatmap`'s `scale: {min: 4, max:
10}` and a future annotation line, and excludes the rubric edges in every case.

## Versioning and compatibility

*How the node contract is numbered, what a change to it costs, and what a consumer does when it meets a version it was not written for.*

Two numbers govern this family and they are not the same number. The **contract version** describes the *nodes* — what a theme's renderers read. The **plugin's release version** describes the *bundle* — what a project pins in `myst.yml`. A release can move without the contract moving, and one contract version is implemented by several releases of `datavis.mjs` and by `compliance.mjs` in a different repository entirely. Keeping them apart is what lets the report theme upgrade its plugin without re-writing a renderer, and what lets a wrapper ship a new directive option without asking every consumer to look at it.

### The `contract` property

Every root node the family emits carries `contract`, whose value is the string `"1.0"`.

- **Two components, `MAJOR.MINOR`.** There is no patch component: a change that alters no node is not a contract change at all, and a change that alters a node is either additive or breaking. Nothing else exists.
- **Always a string, never a number.** `1.10` as a JSON number is `1.1`, and the family will reach a tenth minor.
- **Compare by parsing, never by string comparison.** Split on `.`, compare the two integers. `"1.10"` sorts before `"1.9"` as text, and a consumer that gets this wrong will silently mis-handle exactly the version it was warned about.
- **It sits on the root and nowhere else**, beside `primitive`. A `tableRow`, a `listItem`, a `span` or a group `div` inside the fallback never carries a stamp; it is covered by the stamp above it. This is the same rule as *The data lives exactly twice*: inner nodes carry a class and nothing more.
- **It is a property of the node, not of the plugin.** `compliance.mjs` emits these shapes without importing this repository's code, so one page can legitimately carry nodes from two emitters at two contract versions. A renderer branches on the stamp it finds on the node in front of it, never on the plugin version it believes is installed.
- **It survives everything.** It is an ordinary node property, so it reaches `_build/site/content/*.json` intact, survives the parse cache, and — unlike `label`, `identifier` and `html_id`, which `myst-cli`'s embed transform deletes from any non-reference node it copies — survives `{embed}`.
- **A node with no stamp, or a stamp that will not parse as `MAJOR.MINOR`, is not a family node.** Render its children and do not dispatch on its class.

### What the contract version covers

The contract surface is deliberately narrow. Everything in the left column moves the contract number when it changes; everything in the right column is the plugin's business and moves only the plugin's release number.

| In the contract | Outside the contract |
| --- | --- |
| The root node type (`div` or `span`) | Directive names, arguments, options and their defaults |
| Every class token the family emits — on the root and inside the fallback | Body syntax, CSV column names, path resolution, caching |
| Property names, types, required-ness, defaults, and the members of every closed vocabulary | Which problems are errors and which are warnings, and their wording |
| Structural invariants a JSON Schema cannot state (array-length equality, index correspondence, denormalised sums) | `data.qeDiagnostics` — build output attached to a node, not content |
| The shape of the fallback children: node types, nesting, order, class tokens | Everything a consumer does with a tone: palette, ramps, geometry, markers, thresholds |
| The exact text the family derives into the fallback (`"78% to 68%"`, `" / 49"`, `"N/A"`) | The prose of this document |

Two consequences are worth stating plainly, because they are the whole reason for the split. Renaming a directive — including the alias fallback below — changes no node and therefore does not move the contract. Repainting `warn` from amber to orange changes no node either. Neither is a contract event, however visible.

### Additive or breaking

> A change is **additive** when every node a `1.x` emitter produced before the change is still produced unchanged, **and** every consumer written against any earlier `1.x` renders every node produced after it correctly, without being modified.

Both halves must hold. The first is the usual backwards direction; the second is *forwards* compatibility, and it is the one that costs discipline, because it constrains what a new minor may do rather than what an old one did.

| Additive — bump the minor | Breaking — bump the major |
| --- | --- |
| A new optional property, on the root or on an item | Removing or renaming any property |
| A new member of a closed vocabulary (a sixth tone, a third `variant`) | Changing a property's type, or its default |
| A new class token appended **after** the tokens the contract already fixes | Removing a property from the required set, or adding one to it |
| A new node appended **after** the pinned head of `children` | Changing, removing or re-ordering an existing class token |
| A reserved enum member becoming emitted | Changing the node type of the root or of any pinned child |
| Documenting an invariant the family already upheld | Changing the structure, order or derived text of the pinned fallback |
| A new primitive, with its own name and schema | Changing an index correspondence between properties and children |

Worked examples from the primitives' own open questions: `bar-list`'s `items[].href` and `heatmap`'s `rows[].href` are **additive**; a `suffix` on a `stats` item is **additive**; mirroring `variant` as a class token is **breaking** and must therefore be settled before the freeze, not after; changing `bar-list`'s default item tone from `accent` to `neutral` is **breaking** for the same reason; a sixth tone for a fifth priority bucket is **additive**, because of the consumer rules that follow.

Four rules make the additive column additive. A consumer implements them **from 1.0**, and a consumer that does not is not conformant:

1. **Ignore unknown properties.** Never enumerate a node's keys and reject the unfamiliar.
2. **Fall back on an unknown vocabulary member.** An unrecognised `tone` renders as `neutral`; an unrecognised `variant`, `layout`, `labels` or `emphasis` renders as that property's documented default. Never refuse to draw.
3. **Ignore children beyond the pinned head.** Each primitive names how many leading children the contract fixes; anything after them is a later minor's business.
4. **Never validate at render time.** Schemas are an emitter-side tool (below). A consumer that validates will reject perfectly good newer nodes.

A property added in a minor is **always emitted**, carrying `null` when it has no value, consistent with the family's rule that optional values are present as `null` rather than absent so no consumer ever needs a presence check.

### Meeting a version you were not written for

| A consumer implementing 1.0 meets… | What it does |
| --- | --- |
| `1.0` | Renders from the properties. |
| `1.1`, `1.7` — same major, higher minor | Renders from the properties, exactly as for `1.0`. The four rules above make this safe; that is the promise a minor bump makes. |
| `0.9` or any lower minor of the same major | Renders from the properties. Properties it expects may be absent; it applies the documented defaults. |
| `2.0` or any higher major | **Stops reading the properties.** Renders `children` and nothing else. It does not guess, does not partially upgrade, and does not fail the page. In a development build it may log once. |
| No stamp, or an unparseable one | Renders `children`. |

Degrading to the children is always correct because of a floor that no major version may move:

- the root is a `div` or a `span`;
- its `class` carries `qe-dv` and `qe-dv-<primitive>` as whole tokens;
- it carries `contract` as a parseable `MAJOR.MINOR` string;
- its children are a **genuine, complete, plain rendering of the same data**, built only from `div`, `span`, `table`, `tableRow`, `tableCell`, `list`, `listItem`, `paragraph`, `text`, `strong`, `emphasis`, `inlineCode`, `link` and `admonition`.

That floor is the single most load-bearing rule in this document. It is what lets `compliance-lecture-style` build against the default book theme before any renderer exists; it is what keeps LaTeX and Typst export working; and it is what makes a major version bump survivable rather than a flag day, because a `2.0` node in a `1.0` theme is not broken — it is merely plain.

### Schema files

- **One file per primitive**, at `schema/<name>.json`, with `$id` the same path beneath `https://quantecon.github.io/quantecon-plugins.mystmd/`. The `$id` is an identifier and stays stable and citable whether or not the Pages site is published. The files describe the current contract version; when a major version supersedes another, the outgoing set moves to `schema/<major>.x/` and the current one stays where consumers already point.
- **`contract` is `const` in every schema.** A new minor is therefore a new directory of new files, never an edit in place. `schema/1.0/` is frozen at the freeze and is never touched again — not for a typo, not for a clarification. Prose corrections go in this document.
- **Validate a node against the version the node declares.** A `1.1` node is validated with the `1.1` schema. Nothing else is meaningful.
- **Roots keep `additionalProperties: true`; nested objects keep `additionalProperties: false`.** The root must stay open because MyST adds `key`, `html_id`, `position` and `data` of its own. So must every fallback node under `children`, which the engine stamps with `key` and `position` in the same pass: a closed fallback node admits those keys explicitly, `key`, `position` and `data` as properties beside `type` (the form `stats`, `bar-list` and `stacked-bar` use), or it stays open with the embed keys forbidden (the `heatmap` form). The validator proves it: every valid sample is validated a second time with every node decorated the way the engine would decorate it, so a schema that accepts only hand-written fixtures fails in CI. "Nested objects" in the rule means the plain data objects — an item, a column, a cell record — where a typo must be caught and no engine key ever appears. The nested strictness is safe — and valuable, because it catches an emitter's typo — precisely because schemas are an emitter-side conformance tool run in CI by this repository and by every wrapper that emits these shapes, and never a run-time gate in a theme. Strict nested objects would otherwise make the additive path impossible, since a `1.0` schema must reject a `1.1` item.
- **Conformance fixtures ship beside the schemas**, in the same versioned directory: valid nodes, invalid nodes, and a checker for the invariants JSON Schema cannot express — array-length equality, index correspondence, denormalised totals, deep-equality of a duplicated object. A third-party emitter validating only against the schema would otherwise pass a ragged node.
- **Reserved vocabulary members are permitted and encouraged** where a second value is genuinely foreseen. Declare the member in the schema and document it as *not emitted at 1.0*; a consumer written to the four rules handles it the day it appears. `data-table`'s `nulls: "first"` is the pattern.

### Directive names and the alias fallback

Four facts, all verified against the QuantEcon `mystmd` fork at v1.10.1 (qe-v10) and pinned by `tests/plugin/registration.test.mjs`:

1. **The first registration under a name wins**, and core directives are registered before any plugin's.
2. **A plugin that claims a core name is silently ignored.** The page still builds and the content is simply wrong — the worst failure mode available. The only signal is a per-page `duplicate directives registered` warning, and when core is the winner there is not even an error.
3. **As of 1.10.1 the registered names are** `admonition`, `anywidget`, `aside`, `bibliography`, `blockquote`, `code`, `code-cell`, `csv-table`, `div`, `dropdown`, `embed`, `figure`, `glossary`, `iframe`, `image`, `include`, `index`, `list-table`, `math`, `mdast`, `mermaid`, `myst`, `raw`, `show-index`, `table`, `toc`, plus the `myst-ext-*` set `button`, `card`, `exercise`, `exercise-end`, `grid`, `grid-item`, `proof`, `solution`, `solution-end`, `tab-item`, `tab-set`. **None of the family's eleven names appears.**
4. **The eleven `dv-` aliases are likewise free.**

The family claims eleven names, not eight — three of them are item directives, and they carry exactly the same collision risk:

| Primitive | Container | Items |
| --- | --- | --- |
| `stats` | `stats` / `dv-stats` | `stat` / `dv-stat` |
| `bar-list` | `bar-list` / `dv-bar-list` | — |
| `stacked-bar` | `stacked-bar` / `dv-stacked-bar` | — |
| `heatmap` | `heatmap` / `dv-heatmap` | — |
| `data-table` | `data-table` / `dv-data-table` | — |
| `chips` | `chips` / `dv-chips` | — (deliberately none) |
| `badges` | `badges` / `dv-badges` | — (deliberately none) |
| `delta-list` | `delta-list` / `dv-delta-list` | `delta-group` / `dv-delta-group`, `delta` / `dv-delta` |

**The rule: register the plain name and its `dv-` alias together, from the first release**, as a `DirectiveSpec.alias` on one spec. This settles the disagreement between the primitives — one argued that a second registered name is a second chance at a silent collision, another asked whether the alias is registered or merely documented.

The reasoning is that an alias is not a defence. A collision cannot be defended against: core wins in the engine version people have already pinned, and content written as `{stats}` breaks silently whatever we do. The alias's only job is to give that content somewhere to go *without a plugin upgrade* — and that works only if the alias is already live in the release they have pinned. Registering it later is exactly one release too late. The cost is nil: a `dv-`prefixed name is ours by convention and core will never take it, and a duplicate warning is emitted per name, not per plugin.

Detection and response:

- `tests/plugin/registration.test.mjs` re-checks all twenty-two names against the pinned engine on every run, so a collision surfaces when **we** bump the engine, not when a reader's build goes quiet.
- On a collision: record it in the changelog, tell content to move to `dv-<name>`, and drop the dead plain name in the plugin's next major. **The contract version does not move**, because no node changes — the clearest illustration of why there are two numbers.
- `stat` and `delta` are the shortest, most generic singular nouns in the family and carry the highest residual risk. Both must be in the test's name list; today only the eight container names are.

### The plugin's release version and the contract version

`datavis.mjs` is tagged `vX.Y.Z` per this repository's release convention and attached to the release as an asset; a project pins that URL. The contract is `MAJOR.MINOR` and is read off the node.

| Change | Plugin | Contract |
| --- | --- | --- |
| A new optional directive option; a better error message; a CSV-reader fix | minor or patch | unchanged |
| A directive renamed after a core collision | major | unchanged |
| A new optional node property; a new tone; a new appended child | minor at least | minor |
| A renamed property; a changed default; a changed class token; a restructured fallback | major | major |
| A new primitive | minor | minor |

Rules that follow:

- **A release emits exactly one contract version.** Its `CHANGELOG.md` entry names it and the README states the current one. A bundle never emits two.
- **A contract major forces a plugin major; a contract minor forces at least a plugin minor.** The plugin moves on its own for everything on the "outside" side of the surface table.
- **Before `v1.0.0` the contract number is provisional.** Nodes read `"1.0"` because that is the shape being drafted, but the compatibility promise starts at `v1.0.0` — the freeze at the Phase 3 exit. Every node-shape change in a `0.x` release is flagged as breaking in the changelog regardless of what the numbers say, and consumers pinning a `0.x` asset are told, in the README, that they are pinning a draft.
- **Wrappers state both numbers.** `compliance.mjs` names the contract version it emits; it does not name a `datavis` version, because it does not depend on one.
- **The report theme pins the plugins release it renders and states the contract major its renderers implement**, and still branches on each node's own stamp, because nodes from `compliance.mjs` arrive from a different repository on a different release cadence.

## The eight primitives

Each section below specifies one primitive: the node it emits, the properties that carry
its data, the directive that authors it, and what a theme with no renderer shows. They are
in reading order rather than alphabetical order, because the earlier ones establish shapes
the later ones reuse.

## `stats`

A short row of big-number tiles: a headline figure with a caption, optionally over a
denominator, and optionally scored against a shared scale with a mini bar and a one-line note.
Reach for it when a page opens with a handful of measured quantities a reader should take in
before any table or chart. It is not a chart — no axis, no ordering semantics, and no baseline
beyond the single optional `max`.

Three places in the compliance design resolve to this one primitive: the methodology tiles
(`qe-method-stats`), the per-category score strip in the series report header
(`qe-score-strip`), and the per-category score breakdown on a lecture page
(`qe-score-breakdown`).

Directive: `{stats}`, and only `{stats}` — the data is a bullet list in its body, not a nested
item directive. Alias fallback, should a future core directive take the name: `{dv-stats}`.
Renderer key: `div[class~=qe-dv-stats]`. Schema: [`schema/stats.json`](../../schema/stats.json);
fixtures: [`samples/stats.json`](../../samples/stats.json).

### Node tree

The root is a `div` carrying both family class tokens, the contract stamp, the data, and
exactly one child: the fallback table. Below is the methodology block from the compliance
landing page, complete and unabridged — it is `valid[0]` in the fixtures, byte for byte, and
every row is printed because the whole point of the fallback is that it holds all of the data,
not a sample of it.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-stats",
  "contract": "1.0",
  "primitive": "stats",
  "variant": "headline",
  "max": null,
  "stats": [
    {
      "label": "rules checked by program over a pinned corpus snapshot",
      "value": 41,
      "display": "41",
      "denominator": 49,
      "fraction": null,
      "tone": "neutral",
      "note": null
    },
    {
      "label": "judgment-only rules reviewed by reading — all 348 lectures covered",
      "value": 8,
      "display": "8",
      "denominator": null,
      "fraction": null,
      "tone": "neutral",
      "note": null
    },
    {
      "label": "lectures through the judgment layer — cross-series comparison stands on its own",
      "value": 348,
      "display": "348",
      "denominator": 348,
      "fraction": null,
      "tone": "neutral",
      "note": null
    }
  ],
  "children": [
    {
      "type": "table",
      "children": [
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "header": true,
              "children": [{ "type": "text", "value": "Measure" }]
            },
            {
              "type": "tableCell",
              "align": "right",
              "header": true,
              "children": [{ "type": "text", "value": "Value" }]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "text",
                  "value": "rules checked by program over a pinned corpus snapshot"
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                { "type": "strong", "children": [{ "type": "text", "value": "41" }] },
                { "type": "text", "value": " / 49" }
              ]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "text",
                  "value": "judgment-only rules reviewed by reading — all 348 lectures covered"
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [{ "type": "strong", "children": [{ "type": "text", "value": "8" }] }]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "text",
                  "value": "lectures through the judgment layer — cross-series comparison stands on its own"
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                { "type": "strong", "children": [{ "type": "text", "value": "348" }] },
                { "type": "text", "value": " / 348" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**The agreement rule.** The properties and the children are two renderings of the same data and
they agree exactly, index for index. Row 0 of the table is the header row, which is column
vocabulary rather than data; `stats[i]` is row *i* + 1. The label, the figure, the denominator
and the note in that row are the same strings as `label`, `display`, `denominator ?? max` and
`note` on item *i*, with the two places a null resolves to the em dash `—`: an item whose `value`
is `null` prints no denominator at all, so its figure cell holds the bare em dash even where
`denominator ?? max` is a number, and an item whose `note` is `null` holds the em dash in cell 3.
And the lengths agree:
`children[0].children.length === stats.length + 1`. The schema enforces the length equality
structurally for blocks of one to twelve tiles, and the header-row and column rules at any size;
the cell-text equality, and the length equality above twelve tiles, are asserted by the Phase 1a
AST test, which validates a real built page rather than a fixture.

**Only the root describes itself.** `contract` and `primitive` sit on the root node and nowhere
else. The table, its rows and its cells carry `type`, `align`, `children` and — on row 0 only —
`header`, and nothing else: no contract stamp, no primitive name, and no second copy of the item
the row renders. The data lives exactly twice, once in `stats` and once in the children, and a
consumer that wants the item behind a row reads `stats[i]`. No node this primitive emits carries
a top-level `label`, `identifier` or `html_id` either: `myst-cli`'s embed transform runs
`selectAll('[identifier],[label],[html_id]')` over an embedded subtree and deletes all three from
every node that is not a `crossReference`, `cite`, footnote node, `captionNumber` or `link`, so a
`div` or a `table` carrying one loses it — silently, and only when the page is embedded
elsewhere. `stats[i].label` is a different thing: a property inside an array, not an identity on
a node, and safe.

### Root properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Portable container. The family emits no custom node types, because `myst-to-tex` logs an error for a type it has no handler for, drops the whole subtree, and exits 0. |
| `class` | string | yes | `qe-dv qe-dv-stats`, in that order, then any surviving tokens from `:class:`, single-spaced. See the normalisation rule below. |
| `contract` | `"1.0"` | yes | Contract version, always the string, never a number. |
| `primitive` | `"stats"` | yes | Lets a consumer dispatch without parsing the class string. The root carries it; no inner node does. |
| `variant` | `"headline"` \| `"metric"` | yes | Tile anatomy hint; always emitted, never omitted, so a renderer never guesses. |
| `max` | number > 0 \| null | yes | The shared scale. Non-null means the tiles are comparable, bars are wanted, and the fallback uses it as the denominator for items carrying none. Null means independent figures and no bar. |
| `stats` | array of items | yes | The tiles, in display order. `minItems` 1 is the constraint; two to eight is editorial guidance, not a rule. |
| `children` | array, exactly 1 | yes | The fallback `table`: one header row, then one row per item. |

**Class normalisation.** mystmd core does no normalising of its own — `addClassOptions` is
literally `node.class = data.options.class` — so the directive does all of it. Split the
`:class:` value on `/\s+/`, drop empty tokens, drop tokens already present, append the
survivors in order, and join with single spaces. What comes out is `qe-dv qe-dv-stats`, then
the author's tokens: no duplicates, no double spaces, no leading or trailing space. The
schema's `class` pattern is that string exactly, so a directive that forgets the deduplication
fails its own fixtures.

**`variant`, and the two anatomies the canvases show.** `headline` puts the figure first with
the label reading as a caption beneath it — the methodology tiles. `metric` puts a short label
first and the value after it; the canvas sets that label in uppercase, which is a renderer's
typography and never the data — `label` and cell 1 hold the author's text verbatim, as the
fixtures show (`Writing`, not `WRITING`). The compliance design has three tile layouts, not
two, and the third is derived rather than named: a `metric` block where **no** item carries a
note renders as the compact stacked strip, label above value, in a narrow `minmax(120px, 1fr)`
track (the series score strip); a `metric` block where **any** item carries a note renders as
the wider `minmax(200px, 1fr)` card with the label and value on one baseline-aligned row and
the note beneath the bar (the lecture score breakdown). So the three canvas instances resolve
to two `variant` values, with strip-versus-breakdown derived from note presence. A renderer
needs no third enum value and must not invent one.

### Item properties

Every item carries all seven keys; optional ones are present as `null`, never absent, so a
consumer never needs a presence check and a misspelt key is caught by the schema rather than
read as missing data.

| Property | Type | Meaning |
| --- | --- | --- |
| `label` | string | Plain-text caption. Its rich inline form is cell 1 of the matching row. |
| `value` | number \| null | The figure. `null` is the family's one spelling of an absent value: the measure does not apply to this item. |
| `display` | string \| null | Exactly what to print, carrying the intended precision (`"9"` and `"9.0"` are both legal and differ typographically). A renderer prints this and never re-formats `value`. `null` exactly when `value` is null — an absent value has no figure to print, and the fallback renders it as `—`. |
| `denominator` | number > 0 \| null | This item's own total, printed after the value as `/ n`. |
| `fraction` | number in [0, 1] \| null | Pre-computed `value / max`, clamped and rounded to four decimals, so a consumer never divides. Null when `max` or `value` is null. |
| `tone` | `neutral` \| `accent` \| `good` \| `warn` \| `bad` | Colour hint. Never derived from the number by this plugin. |
| `note` | string \| null | Plain-text one-line note. Its rich inline form is cell 3 of the matching row; `null` renders there as the em dash `—`. |

`max` and `denominator` are not the same thing and neither replaces the other: `max` is one
scale for the whole block (10, for a rubric out of ten), `denominator` is this item's own total
(49 rules, 348 lectures). A block may have both, one, or neither.

**Rich text in `label` and `note`.** Both are authored as MyST, so both can carry inline
markup, and the fallback cells hold the parsed inline nodes while the properties hold the
flattened plain text. The permitted subset is `text`, `strong`, `emphasis`, `inlineCode` and
`link` — the types `myst-to-tex` and `myst-to-typst` both handle. Anything else an author
reaches for (a `{button}`, a cross-reference, an image, a footnote reference) is reduced to its
plain text with a deferred warning naming the node type, because a node type the LaTeX
serialiser has no handler for is dropped from the export silently, with the build still exiting
0.

### Directive options

Capped at what the three compliance pages actually need.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `:max:` | number > 0 | unset → `null` | The shared scale — 10 for the score strip and the breakdown. Turns the mini bars on and supplies the fallback denominator for items without one. |
| `:variant:` | `headline` \| `metric` | `headline` | Which way round the figure and its label read. |
| `:file:` | path | unset | A CSV supplying the items instead of a body. Mutually exclusive with a body. |
| `:class:` | string | unset | Extra class tokens, appended after the two family tokens. |
| *body* | one MyST bullet list | — | The tiles, one per list item, in display order. The grammar is below. There is no item directive and no second body form. |

Deliberately refused, so the family does not drift into a charting DSL: `columns` in either sense
(the tile grid is `auto-fit`, and the fallback's column names are fixed), `precision` and
`format` (the token as typed in the value field becomes `display`), a unit or `%` suffix (put the
unit in the label), a null-value label or `naLabel` (the family has one spelling of an absent
value and it is not per-block), `sort`, `total`, and any colour option — that is what `tone` is
for. PLAN.md's risk table sets the bar for reopening any of them: *"Option surface capped at what
the compliance pages use; new options need a second consumer."*

### Authoring

The body is **one MyST bullet list and nothing else**, one list item per tile, in display order.
There is no item directive — the section below records why the engine cannot have one — so a
`stats` block needs only one fence depth.

The methodology tiles, the default `headline` variant with per-item denominators, no scale and
therefore no bars — the block printed in full above:

```markdown
:::{stats}

- rules checked by program over a pinned corpus snapshot: 41 / 49
- judgment-only rules reviewed by reading — all 348 lectures covered: 8
- lectures through the judgment layer — cross-series comparison stands on its own: 348 / 348
:::
```

**The grammar of a list item.** Four rules, and the fourth is what happens to everything else.

1. **The datum line is the item's first paragraph**, and every item has one. It reads
   `label: value`. The split is made on the paragraph's *inline children*, not on the raw
   source: the **last** colon appearing in a top-level `text` node ends the label. Everything
   before it is the label — code spans, links and emphasis included — with the trailing text
   node trimmed of the colon and the space before it; `stats[i].label` is that subtree
   flattened to plain text and cell 1 of the row is the subtree itself. Splitting at the last
   colon rather than the first is what lets a label carry one of its own (`Ratio a:b: 3`).
2. **The value field is everything after that colon**, and it must be plain text: a code span
   or a link there is an error, because the field is machine-read. It reads
   `<value>[ / <denominator>][ (<tone>)]`, and everything after `<value>` is optional.
   - `<value>` is a decimal number, or one of the family's null tokens — an empty field, `n/a`,
     `na`, `-`, `—` or `null`, matched case-insensitively after trimming. A number's token as
     typed becomes `display`, so `9.0` prints `9.0` and `9` prints `9`. A null token means the
     measure does not apply here: `value`, `display` and `fraction` are all `null` and the
     fallback prints `—`.
   - `/ <denominator>` is this item's own total, a number above zero, printed after the value.
   - `(<tone>)` is one word of the closed tone vocabulary, in brackets, at the very end of the
     field. Absent means `neutral`. Nothing else in brackets is accepted there: a stray `(sic)`
     is an error rather than a silent `neutral`.
3. **The note is the item's second paragraph**, ordinary inline MyST, so rule ids set as code
   spans stay code spans in the fallback cell. A note therefore needs a blank line before it,
   which makes the list loose — that is the only shape the grammar accepts. Without the blank
   line markdown folds the note into the datum line's paragraph, the value field stops parsing,
   and the item fails with an error naming it rather than being silently misread.
4. **Anything else in the item is dropped with a warning** naming what it was: a third
   paragraph, a code block, an admonition, or a nested sublist. A nested sublist in particular
   is *not* a nested block of tiles — `stats` has exactly one level.

The lecture score breakdown is the fullest shape the primitive supports: the `metric` variant
with a scale, tones and notes. All eight categories are shown, because this is exactly the
source that produces `valid[1]` in the fixtures:

```markdown
:::{stats}
:variant: metric
:max: 10
:class: qe-score-breakdown

- Writing: 3 (bad)

  `qe-writing-006` ×10; `qe-writing-005` ×3; `qe-writing-002` ×2, +3 more.

- Math: 9 (good)

  `qe-math-012` (proposed) ×1.

- Code: 7.5 (warn)

  `qe-code-001` ×5.

- Figures: 6.5 (warn)

  `qe-fig-005` ×11; `qe-fig-008` ×10.

- References: —

  No citations in this lecture.

- Links: 10 (good)

  No mechanical violations detected.

- Admonitions: 7.5 (warn)

  `qe-admon-003` ×2.

- JAX: —

  Out of scope — JAX rules target `lecture-jax`.
:::
```

Two things that example is worth reading twice for. `References` and `JAX` carry an em dash as
their value, which is a null token: both come out with `value`, `display` and `fraction` null and
both print `—` in the fallback, and the difference between "there were no citations to score" and
"this rule set does not apply here" lives in the note, where the design already put it. And
`(proposed)` in the Math note is not a tone: the tone bracket is only read at the end of the
value field, on the datum line, so prose in the note is never inspected.

### One directive, one body form

The family registers exactly one directive name for this primitive, `stats`, and documents
`dv-stats` as the alias fallback. The plain name is free in mystmd 1.10.1 and is covered by the
registration test that fails when a future `myst` ships a directive of that name — core registers
first and wins silently, so the test is the only warning we get.

An earlier draft of this section specified a `{stat}` item directive that emitted a carrier node
for `{stats}` to read. That design is deleted, because the engine cannot support it.
`myst-parser` collects every unprocessed directive with a single `selectAll` in document order
and runs them in one pass, so a container's `run()` executes **before** the directives nested in
its body and receives them as raw `mystDirective` nodes, never as their output. Worse, the nested
items' `run()` still fires afterwards, against nodes the container has already replaced: their
output is computed and silently discarded, and any diagnostic they defer is attached to a node
that is no longer in the tree. A probe plugin built with the real `myst` CLI showed exactly that
— the container saw `["mystDirective:itm", "mystDirective:itm"]`, and of three item runs only the
one outside the container survived into the built page. The claim this section used to make,
that nested directives are already expanded when the container's `run()` sees its body, was
simply wrong, and the orphan-carrier transform that design needed has gone with it.

A bullet list gives up nothing in exchange. It carries inline markdown in labels and notes, which
is what a YAML-in-body form was reaching for; it is what the fallback cells are built from
anyway; and a reader whose tool has never heard of the directive still meets a legible list of
labels and figures.

### `:file:` CSV sources

PLAN.md's Phase 1a requires `:file:` CSV sourcing and a dependency-free RFC 4180 reader for all
eight primitives, because the family's audience is any mystmd project publishing a report and
such a project has no wrapper plugin reading data on its behalf. The reader is the family's own
(`src/lib/csv.mjs`); paths resolve against the project root, found by walking up from
`vfile.path` to the directory holding `myst.yml`, with a leading `./` or `../` opting into
resolution relative to the page instead. Reads go through the toolchain's mtime-plus-size
`FileCache`, so a fresh `myst build` always reflects the current file; `myst start` does not
notice a CSV edit on its own, because the engine serves the page from its own mdast cache and the
directive never re-runs until the page itself is touched (QuantEcon/mystmd#96).

The file takes a header row and one row per tile, in file order. Column names are matched
case-insensitively and trimmed; unknown columns are ignored; an absent optional column behaves
as if every cell were empty.

| Column | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `label` | yes | `label`, and cell 1 | Read as plain text, never parsed as markdown, so a file-sourced label carries no code spans or links. |
| `value` | yes | `value` and `display` | The cell's literal text becomes `display`; its numeric parse becomes `value`. A null token makes both `null`. |
| `denominator` | no | `denominator` | Empty means null. |
| `note` | no | `note`, and cell 3 | Plain text, like `label`. |
| `tone` | no | `tone` | Validated against the closed vocabulary; empty means `neutral`. |

`fraction` is computed from `max` exactly as for the body form. A CSV missing a `label` or a
`value` column is an error.

**Null tokens.** The family has one spelling of an absent value and a CSV uses the same one as
the body: an empty cell, or `n/a`, `na`, `-`, `—` or `null`, matched case-insensitively after
trimming — the toolchain's `DEFAULT_NULL_TOKENS`. Such a cell gives `value: null`,
`display: null` and `fraction: null`, and the fallback prints `—`.

REVIEW §6 records that `scores.csv` uses `out-of-scope` in its `jax` column and asks for a third
state. Contract 1.0 has no third state: `out-of-scope` is **not** a null token, and a `value`
cell holding it is an error naming the row and the column — the same answer `data-table` gives.
"Not applicable" and "out of scope" are different claims about the world, and the family rule is
that a primitive needing both carries a **second property**, never a second spelling of nothing.
`stats` carries no such property because the Lecture Report design already makes the distinction
in words: "Out of scope — JAX rules target `lecture-jax`" is the item's note. A producer writing
that CSV therefore leaves the `value` cell empty and puts the sentence in the `note` column. An
earlier draft of this section read `out-of-scope` as a sixth null token with a warning; that
collapse is gone.

### Tone

Tone attaches per item, at `stats[i].tone`, and nowhere else: there is no block-level tone and
none on the root node. The closed family vocabulary is
`neutral | accent | good | warn | bad`,
defaulting to `neutral`, and the plugin never inspects a number to choose one. A domain
wrapper that owns the thresholds writes it. For compliance that wrapper applies the published
rubric — red ≤ 5.0 < amber < 8.6 ≤ green — so `qe-score-strip` emits Writing 4.1 as `bad`, Code
8.4 and Figures 7.3 as `warn`, and Math 9.0, Links 9.8 and Admon 9.9 as `good`. Move the bands
and only the wrapper changes; the contract and every renderer stay put.

A consumer maps tone to one colour role and applies it to both the figure and its bar fill —
the canvas colours the serif number and the 4px bar identically. The reference palette is `bad`
→ red `#a63a2e`, `warn` → amber `#c07a1d`, `good` → green `#3e7d4f`, `accent` → the theme's
brand accent (blue `#2c72b8` here; unused by any current page but part of the family
vocabulary), and `neutral` → default ink `#14243c`.

One rendering rule is not derivable from tone and must be stated: `value === null` is the
absent-value state and it wins over tone. The canvas renders it as ghost-grey `#b0a996` text with
the bar **track drawn empty** rather than omitted, so a renderer branches on `value === null`
first and only then on tone. What it prints there is the em dash `—`: the canvas drew "N/A", and
contract 1.0 has exactly one spelling of an absent value, so the renderer follows the contract
and the canvas loses that word. A tone other than `neutral` on a null-valued item is legal but
meaningless.

Tone has no expression in the fallback children. Colour is precisely the part of the design a
plain theme cannot carry, and encoding it in the markup — a `strong`, an emoji, a bracketed
word — would put a claim in the text that the data does not make.

### Errors and warnings

A `fileError` raised inside a **directive** is logged but is not counted by
`myst build --site --strict`,
so a broken directive still exits 0. `loadFile` clears a file's stored warnings on
each load and then serves the cached mdast without re-running the directive, so the message is
wiped before the strict check harvests it (filed as QuantEcon/mystmd#95). Every diagnostic
below therefore goes through the family's toolchain instead. The directive calls
`defer(node, 'error' | 'warn', message, { ruleId })`
to attach the diagnostic to the node it emits, or
returns `errorNode('stats', message)` — a visible error admonition carrying its own diagnostic
— where it cannot produce a block at all; the document-stage `diagnosticsTransform` re-raises
them on every pass, which is what `--strict` counts and what keeps working across incremental
`myst start` rebuilds. The default rule id is `qe-datavis-stats`, so a project can suppress the
family through `error_rules`.

Deferred as **errors**: an empty container, with neither a bullet list nor `:file:` rows; body
content that is not a single bullet list, or a bullet list with no items; a list item whose
datum line has no colon, and so no value field; a value field that is neither a decimal nor a
null token, `out-of-scope` included; markup other than plain text inside a value field; a
bracketed word at the end of a value field that is not one of the five tones; a `variant` outside
its vocabulary; `max` or a `denominator` at or below zero; `:file:` given together with a
non-empty body; and a missing, unreadable or malformed CSV, or one lacking a `label` or `value`
column.

Deferred as **warnings**: a numeric value exceeding `max`, where `fraction` clamps to 1 and the
real problem is usually the wrong `max`; any block in a list item after the note paragraph — a
third paragraph, a nested sublist, a code block, an admonition — which is dropped so that `note`
and the table cell keep agreeing; and an inline node outside the permitted subset in a label or
note, reduced to its plain text.

### Fallback

With no custom renderer, a plain theme renders the root as `<div class="qe-dv qe-dv-stats">`
containing its one child, and that child is a real `<table>` — so the reader gets a small,
complete metrics table rather than an empty box.

**Row 0 is the header row**, reading `Measure | Value`, plus `Note` when the block has a note
column. The three words are fixed and are not an option. This primitive invents its columns
rather than taking them from the author — an author writes captions and figures, never column
names — so without a header row the plain rendering is two or three unlabelled columns and a
breakdown row reads "Writing | **3** / 10 | `qe-writing-006` ×10" with nothing naming the third
one. An earlier draft argued that inventing a vocabulary the author never wrote was the greater
sin. A table with no `<th>` and no column names is worse, for a screen reader most of all, and
one header row is now the family rule.

`header: true` goes on **every** cell of row 0 and on no cell of any other row. `myst-to-tex`
writes an `\hline` after every row whose *first* cell is a header, so per-row header cells rule
the table after every line; and its long-table path counts leading header rows to find where the
body starts, so a header cell in every row makes that count the row count, the body loop skips
every row, and the table exports as a repeating running header with no body at all.

Then one row per item, in `stats` order. Cell 1 is the label's inline content, left aligned.
Cell 2 is the figure in `strong` followed by plain text `" / n"` — the item's own `denominator`
if it has one, otherwise the block's `max`, so the score strip still reads "**4.1** / 10" and the
scale is never lost — right aligned; an item whose value is absent reads `—`, unemphasised and
with no denominator. Cell 3 is the note's inline content, left aligned; an item whose `note` is
null renders the em dash `—` there, the family's single spelling of an absent value, so no cell
of the table is ever blank.

The note column is a property of the **block**, not of a row: it exists exactly when at least
one item carries a note, and then every row has three cells — the header row included, and an
item without a note getting an em dash in its third cell rather than a blank one. Ragged rows are
not merely untidy, they corrupt
the export. `myst-to-typst` declares the column count from the first row and then emits every
cell as one flat positional sequence with no row delimiter, so a single short row shifts every
cell after it one column left for the rest of the table. `myst-to-tex` fails differently:
`getColumnWidths()` seeds its widths on the first row and reassigns them on every row whose
non-null width count is at least as high — which, with no explicit cell widths, is every row — so
the tabular is sized from the **last** row while `renderTableCell` still writes an `&` between
the cells each row actually has, and a block whose last item has no note aborts the LaTeX run
with "Extra alignment tab has been changed to \cr". The schema encodes the rule: a note anywhere
in `stats` requires three cells in every row, and no note anywhere requires two.

So the methodology tiles fall back to a header row and three rows reading "rules checked by
program over a pinned corpus snapshot | **41** / 49", and the lecture score breakdown to a header
row and eight rows reading "Writing | **3** / 10 | `qe-writing-006` ×10; `qe-writing-005` ×3;
…". That is genuinely the same information minus colour and bar length, which is what a reader
wants from a stat strip in a plain theme.

Export survives too. Both serialisers handle every node type this primitive can emit — `div`,
`table`, `tableRow`, `tableCell`, `text`, `strong`, `emphasis`, `inlineCode` and `link` — so a
report page carrying `stats` blocks exports to PDF as ordinary tabulars. Two deliberate
constraints protect that path. The table is emitted bare, with no wrapping `container`, no
`caption`, and no `label`, `identifier` or `html_id`, so it is never enumerated as "Table N",
never registered as a cross-reference target, and never silently stripped by the embed transform.
And only row 0 sets `header: true`, for the reasons above. `align` is set on every cell for the
HTML path; it is ignored by the LaTeX serialiser, which sizes columns with `p{}` widths, and
passed through by `myst-to-typst` into `cellx(align: …)`, which is harmless for the `left` and
`right` values this primitive emits.

## `bar-list`

Directive `{bar-list}` (alias `{dv-bar-list}`) — the only two names the primitive registers ·
node `div.qe-dv.qe-dv-bar-list` · contract `1.0` · schema
[`schema/bar-list.json`](../../schema/bar-list.json) · samples
[`samples/bar-list.json`](../../samples/bar-list.json)

A ranked list of labelled quantities, each drawn as a horizontal bar against a common scale,
with the number printed at the right of the row. Reach for it whenever the story is "which of
these is biggest, and by how much" over a single measure — rule reach across a corpus,
occurrences per category, lectures affected per rule. One measure, one bar per row: no axes, no
grouping, no stacking; a row that is itself a composition of parts belongs to `stacked-bar`.

Two compliance regions use it, and they are the whole justification for its option surface: the
series report's **Top systemic issues** list (`Series Report.dc.html:85-90`, the `labelled`
layout) and the charts page's **Most frequently violated rules** list (`Charts.dc.html:70-75`,
the `compact` layout).

### Node tree

The node below is `valid[0]` in `samples/bar-list.json`, reproduced whole — three items, one
header row and three data rows. It is a three-row list because the author wrote three items; a
ten-row list has ten rows. The fallback is never sampled, summarised or truncated.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-bar-list qe-systemic",
  "contract": "1.0",
  "primitive": "bar-list",
  "layout": "labelled",
  "max": 27,
  "total": 27,
  "columns": ["Rule", "Title", "Lectures reached (of 27)"],
  "items": [
    {
      "label": "qe-writing-006",
      "value": 23,
      "note": "Capitalize lecture titles properly",
      "secondary": "178×",
      "tone": "accent"
    },
    {
      "label": "qe-fig-005",
      "value": 21,
      "note": "Descriptive figure names for cross-referencing",
      "secondary": "128×",
      "tone": "accent"
    },
    {
      "label": "qe-writing-008",
      "value": 16,
      "note": "Remove excessive whitespace between words",
      "secondary": "43×",
      "tone": "accent"
    }
  ],
  "children": [
    {
      "type": "table",
      "children": [
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "header": true,
              "align": "left",
              "children": [{ "type": "text", "value": "Rule" }]
            },
            {
              "type": "tableCell",
              "header": true,
              "align": "left",
              "children": [{ "type": "text", "value": "Title" }]
            },
            {
              "type": "tableCell",
              "header": true,
              "align": "right",
              "children": [{ "type": "text", "value": "Lectures reached (of 27)" }]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__label",
                  "children": [{ "type": "text", "value": "qe-writing-006" }]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__note",
                  "children": [
                    { "type": "text", "value": "Capitalize lecture titles properly" }
                  ]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__value",
                  "children": [
                    { "type": "strong", "children": [{ "type": "text", "value": "23" }] },
                    { "type": "text", "value": "/27 · 178×" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__label",
                  "children": [{ "type": "text", "value": "qe-fig-005" }]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__note",
                  "children": [
                    {
                      "type": "text",
                      "value": "Descriptive figure names for cross-referencing"
                    }
                  ]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__value",
                  "children": [
                    { "type": "strong", "children": [{ "type": "text", "value": "21" }] },
                    { "type": "text", "value": "/27 · 128×" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__label",
                  "children": [{ "type": "text", "value": "qe-writing-008" }]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__note",
                  "children": [
                    { "type": "text", "value": "Remove excessive whitespace between words" }
                  ]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv-bar-list__value",
                  "children": [
                    { "type": "strong", "children": [{ "type": "text", "value": "16" }] },
                    { "type": "text", "value": "/27 · 43×" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Only `div`, `span`, `table`, `tableRow`, `tableCell`, `strong` and `text` appear, all of which
`myst-to-tex` handles. The bar itself has **no node**: it is drawn by an upgrading renderer
from `items[].value` and `max`. Core's `grid` and `card` are deliberately absent —
`myst-to-tex` has no handler for them and drops the whole subtree from a LaTeX export while the
build still exits zero.

### The agreement rule

The properties and the children are two renderings of the same data, and they MUST agree
exactly. Normatively, for a node with `N` items:

- `children` holds exactly one `table`, whose `children` are the header row — always present,
  and always row 0 — followed by exactly `N` data rows.
- Every row holds the same number of cells, the header row included: three when at least one
  item has a non-null `note`, two otherwise. A column that is empty for one row gets an empty
  cell; it is never omitted.
- `columns` has exactly one entry per column, so its length *is* the row width.
- Data row *i* corresponds to `items[i]`, in the same order. The plugin never sorts.
- Row *i*'s label cell holds one `text` node whose `value` is `items[i].label`, character for
  character, including any marker such as the proposed-rule asterisk.
- Row *i*'s note cell holds `items[i].note`, or the em dash `—` when that is `null`.
- Row *i*'s value cell holds a `strong` node whose `text` value is `String(items[i].value)`.
- Every field a reader can see in the fallback is also a property, and every data property is
  visible in the fallback. The three exceptions are `layout`, `max` and `items[].tone`, which
  are drawing instructions for an upgrading renderer and have nothing to show in a table; the
  rule that keeps them honest is that none may ever be the only carrier of a distinction (see
  [Tone](#tone)).

`schema/bar-list.json` enforces the structural half of that rule outright: one header row, no
header cell anywhere else, a uniform row width, a `columns` length equal to that width, inner
nodes closed around their class, and no top-level `label`, `identifier` or `html_id` on any
node. Two things it cannot enforce. It cannot compare the *text* in a cell with the text in a
property — JSON Schema has no way to compare one part of an instance with another — and it
cannot pin the header row to index 0, because ajv's strict mode rejects a `prefixItems` tuple
with an open tail, so the schema settles for "exactly one header row" and the position is
asserted alongside the text agreement by the plugin test suite, against the page JSON the
engine writes.

### Root properties

| Property | Type | Required | In the fallback | Meaning |
| --- | --- | --- | --- | --- |
| `type` | `"div"` | yes | — | The contract defines no custom node types. |
| `class` | string | yes | — | `qe-dv qe-dv-bar-list` followed by the normalised `:class:` tokens. |
| `contract` | `"1.0"` | yes | — | Contract revision. A consumer that does not recognise it falls through to the children rather than guessing. |
| `primitive` | `"bar-list"` | yes | — | Dispatch key, so nothing has to split the class string. |
| `layout` | `"labelled"` \| `"compact"` | yes | drawing hint | Row anatomy for an upgrading renderer. Always emitted, never left to a renderer default. |
| `max` | number > 0 | yes | drawing hint | The value a full-width bar represents; the bar fraction is `value / max`. A value above `max` is clamped to a full bar, not rejected. |
| `total` | number > 0 \| `null` | yes | yes, as `/27` | The denominator printed after every value. `null` when the denominator belongs in the surrounding prose instead, as on the charts page where "(of 348)" is stated once above the list. |
| `columns` | array of 2–3 strings | yes | yes, as the header row | Column names for the fallback table, in fallback column order, one entry per column. Never `null`: the fallback always carries a header row, because a headerless table leaves the reader of the plain rendering with no column vocabulary. With no `:columns:` the directive falls back to the contract's own field names — `Item`, `Note`, `Value`, sliced to the table's width. |
| `items` | array, ≥ 1 | yes | yes, one row each | The bars, in render order. |
| `children` | exactly one `table` node | yes | — | The portable fallback. A renderer that upgrades the node ignores it entirely. |

`max` is resolved in exactly one order, and this is the only statement of it in the contract:
**`:max:` if given, else `:total:` if given, else the largest `items[].value`, else 1** (when
every value is zero, or the list is empty and the directive has already failed). The flagship
example above sets `:total: 27` and no `:max:`, so `max` is 27 — the scale
`Series Report.dc.html:222` uses when it computes `Math.round(reach / 27 * 100) + '%'`, and the
reason the top row is an 85% bar rather than a full one.

### Item properties

Every item carries all five keys, with an explicit `null` for an absent value, so a renderer
never branches on `undefined`. The item object is closed in the schema: a misspelt key is an
error, not a silently ignored property.

| Property | Type | Meaning |
| --- | --- | --- |
| `label` | string, 1–80 chars | The row label as it must read in plain text, including any textual marker. The charts page suffixes proposed rules with `*` (`Charts.dc.html:194`) and that marker lives here precisely so it survives print, LaTeX export and monochrome viewing, where the tone colour does not. |
| `value` | number ≥ 0 | The quantity the bar length encodes and the number printed at the right of the row. Signed quantities belong to `delta-list`. |
| `note` | string ≤ 160 \| `null` | A short plain-text gloss on the label — in the compliance pages, the rule's title. Plain text, no markup. |
| `secondary` | string ≤ 16 \| `null` | A short pre-formatted fragment printed after the value behind `" · "`, such as `"178×"`. Pre-formatted because the unit glyph is the author's vocabulary, not the plugin's. |
| `tone` | `neutral` \| `accent` \| `good` \| `warn` \| `bad` | Bar-fill hint; default `accent`. Never changes the emitted text. |

### How the fallback table is built

These rules are normative, so that two implementations of the contract emit byte-identical
fallbacks for the same data.

1. **Width.** The table is three columns wide when at least one item has a non-null `note`, and
   two columns otherwise. The width never varies between rows, the header row included:
   `myst-to-typst` declares the column count from the first row and then emits every cell as
   one flat, positional sequence with no row delimiter, so one short row shifts every cell
   after it a column to the left for the rest of the table.
2. **Header row.** Always emitted, always the first `tableRow`, with `header: true` on every
   one of its cells and the column's own `align` — `left` for the label and note columns,
   `right` for the value column. Each header cell holds a single `text` node, taken from
   `columns` in order. `myst-to-react` renders those as `<th>` and `myst-to-tex` follows them
   with an `\hline`, so a header costs nothing in portability.
   **No cell in any other row is ever a header.** `myst-to-tex` writes an `\hline` after every
   row whose *first* cell is a header, so row headers would rule the table after every line;
   and its long-table path counts leading header rows to find where the body starts, so a
   header cell in every row makes that count the row count and the body loop then skips every
   row, emitting a repeating running header and no body at all.
3. **Label cell.** `align: "left"`, holding one `span.qe-dv-bar-list__label` around a single
   `text` node carrying `label`.
4. **Note cell**, in a three-column table only. `align: "left"`, holding one
   `span.qe-dv-bar-list__note` around a single `text` node. When `note` is `null` that text
   node's `value` is the em dash `—` — the family's one spelling of an absent value, in every
   primitive and every fallback. The cell is present on every row either way, so the column
   count still holds, and the gap reads as a gap rather than as an invisible cell.
5. **Value cell.** `align: "right"`, holding one `span.qe-dv-bar-list__value` whose first
   child is `strong` around `String(value)`. A single `text` node follows it, built as
   `(total === null ? '' : '/' + total) + (secondary === null ? '' : ' · ' + secondary)`, and
   **omitted entirely when that string is empty**. All four combinations are therefore fixed:
   `23` then `/27 · 178×`; `23` then `/27`; `23` then ` · 178×`; and `273` alone. A null
   `total` or `secondary` gets no em dash, because neither is a column: they are suffixes
   inside the value cell, so their absence shortens the string rather than leaving a slot
   blank. The em dash belongs to the note cell, which is the only cell in the table that can
   otherwise be empty.
6. The `align` values describe the fallback table and say nothing about the alignment an
   upgrading renderer uses.

`samples/bar-list.json` carries a worked case of each: `valid[0]` for `total` and `secondary`
together with author-written column names, `valid[1]` for the eighteen-row compact list with
both null, `valid[2]` for a null `note` — rendered as `—` — beside a null `total` and the
default `Item, Note, Value` header, and `valid[3]` for a two-column table where no item has a
note.

### Directive options

`{bar-list}` takes **no argument**. Its body is a single MyST bullet list, one list item per
bar, or is empty when `:file:` is given. There is no item directive, and none is possible: a
container directive's `run()` executes *before* the directives nested in its body and receives
them as raw `mystDirective` nodes rather than as their output — `myst-parser` collects every
unprocessed directive with one `selectAll` in document order and runs them in a single pass —
and the nested items' `run()` then fires against nodes the container has already replaced, so
their output is computed and silently discarded and any diagnostic they defer is attached to a
node no longer in the tree. `{bar-list}` and its `{dv-bar-list}` alias are therefore the only
two names this primitive registers.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `:total:` | number > 0 | — (`total` is `null`) | The denominator printed on every row, and the bar scale unless `:max:` overrides it. The systemic list's rows read `23/27 · 178×`. |
| `:max:` | number > 0 | `:total:`, else the largest `value`, else 1 | The bar scale alone, when the scale is not a denominator worth repeating on every row. The reach chart scales eighteen bars against the 348-lecture corpus while printing bare counts. |
| `:layout:` | `labelled` \| `compact` | `labelled` | The two row anatomies the compliance pages use. A third member needs a second consumer. |
| `:columns:` | comma-separated labels | `Item, Note, Value`, sliced to the table's width | Names the fallback table's columns in the author's own vocabulary, rather than leaving the header row on the contract's generic field names. The count must match the fallback's width (2 or 3) or the directive fails. |
| `:file:` | path | — (data comes from the body) | CSV source. Mutually exclusive with a body list; exactly one of the two is required. |
| `:class:` | string | — | Extra class tokens, following the built-in `{div}` convention. The report theme uses it to give the systemic list and the reach chart different column widths without a new option. |

Deliberately absent, and each needs a second real consumer before it is reconsidered: `:sort:`,
`:limit:`, `:caption:`, `:legend:`, `:colour:`, `:width:`, `:min:`, per-column mapping options,
and any log or stacked mode. `:limit:` was in an earlier draft on the strength of the design
brief's `{qe-rule-reach-chart} | limit (default 18)` row, but that row belongs to a compliance
wrapper, and the wrappers emit these node shapes themselves rather than calling this directive
(REVIEW §9). Truncation is therefore the caller's job: a wrapper slices before it emits, and a
hand-author trims the source. Since the plugin never sorts, `:limit:` without `:sort:` would in
any case have taken the first *N* rows rather than the top *N*.

### Class normalisation

Core's `addClassOptions` is literally `node.class = data.options.class` — no normalisation and
no merging — so the directive does it: split the `:class:` value on `/\s+/`, drop empty tokens,
drop tokens already present, append the survivors in the order written, and join with single
spaces. On this primitive `:class: "  qe-systemic qe-dv  "` therefore yields exactly
`"qe-dv qe-dv-bar-list qe-systemic"`. The schema's `class` pattern encodes what that output
can look like: the two base tokens first and in that order, single spaces between tokens, no
whitespace inside a token, and neither base token repeated later in the string. The one part of
the rule a regular expression cannot state without a backreference — that an *author* token is
never repeated either — is left to the plugin tests.

### Authoring

The body is **one MyST bullet list and nothing else**: one top-level list item per bar, in
source order. The plugin never sorts, so sort the source.

**The item line.** A list item's first block must be a paragraph. Its inline content is
flattened to plain text and split at the **last** colon in that text: what precedes the colon
is `label`, trimmed, and must be non-empty; what follows is `value`, parsed as a number ≥ 0.
A first block that is not a paragraph, a paragraph with no colon, an empty label, or a value
that is blank, non-numeric or negative is an error naming the 1-based item number. A blank
value is a hole in the data, never a zero: `value` is the one field with no absent state,
because a bar with no length is not a bar.

**The field list.** A list item may carry **one nested bullet list**, as its second and last
block. Each of that list's items is a single paragraph read as `key: value`, split at the
**first** colon. `key` is trimmed, matched case-insensitively, and must be one of `note`,
`secondary`, `tone`; order does not matter. An unknown key, a repeated key, a field-list item
that is not a single paragraph, or any block in the list item after the field list is an error
naming the item.

**Absent values.** A field that is not written is absent, and so is one whose value is a null
token — `''`, `n/a`, `na`, `-`, `—`, `null`, matched case-insensitively after trimming: the
same set the CSV reader uses, so the two sources agree. An absent `note` or `secondary` is
`null` in the properties and an em dash in the fallback; an absent `tone` is `accent`.

**Markup.** Every field is flattened with `toText`, so a code span, link or emphasis inside a
label or a note contributes its text and loses its markup. `label` and `note` are plain strings
in contract 1.0, and carrying inline children into the properties would be a contract revision:
it is the one thing a bullet-list body offers that this primitive does not yet take up.

This is the source of the node shown above, and it produces it exactly.

```markdown
:::{bar-list}
:total: 27
:columns: Rule, Title, Lectures reached (of 27)
:class: qe-systemic

- qe-writing-006: 23
  - note: Capitalize lecture titles properly
  - secondary: 178×
- qe-fig-005: 21
  - note: Descriptive figure names for cross-referencing
  - secondary: 128×
- qe-writing-008: 16
  - note: Remove excessive whitespace between words
  - secondary: 43×
:::
```

Three colons are enough, because nothing in the body is a directive. A row that should be drawn
in the muted proposed-rule tone adds `- tone: neutral` to its field list.

Drop every option, and one note, and the same body gives `valid[2]`: no `:total:`, so no `/27`
after the values and `max` falls back to the largest value, 23; no `:columns:`, so the header
row reads `Item | Note | Value`; and the missing note on the middle row renders as `—`.

```markdown
:::{bar-list}

- qe-writing-006: 23
  - note: Capitalize lecture titles properly
  - secondary: 178×
- qe-fig-005: 21
  - secondary: 128×
- qe-writing-008: 16
  - note: Remove excessive whitespace between words
  - secondary: 43×
:::
```

The same list from a file: the compact layout, no `:total:`, and the proposed-rule marker
carried in the label rather than in the colour. The CSV is a hand-rolled one carrying this
contract's own columns — the charts page itself does not call this directive, because
`compliance.mjs` emits the node shape from `rule_reach.csv`, whose columns are different (see
[`:file:` CSV sources](#file-csv-sources) below).

```markdown
:::{bar-list}
:file: data/reach.csv
:layout: compact
:max: 348
:columns: Rule, Title, Lectures (of 348)
:class: qe-rule-reach-chart
:::
```

### `:file:` CSV sources

`:file:` names a CSV with a **header row** — the toolchain's reader takes record one as the
header, so columns are matched by name and their order in the file does not matter. Columns the
contract does not name are ignored, so a wider working CSV can be pointed at directly.

| Column | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `label` | yes | `items[].label` | Verbatim, including any marker. Empty is an error. |
| `value` | yes | `items[].value` | Parsed as a number ≥ 0. Empty, non-numeric or negative is an error; a blank cell is a hole in the data, never a zero. |
| `note` | no | `items[].note` | A null token (empty, `n/a`, `na`, `-`, `—`, `null`, matched case-insensitively after trimming) becomes `null`, and renders as an em dash in the fallback. |
| `secondary` | no | `items[].secondary` | Pre-formatted by the file. A null token becomes `null`. |
| `tone` | no | `items[].tone` | Must be one of the closed set. A null token becomes `"accent"`. |

An optional column missing from the header behaves as though every cell in it were blank, so a
file with only `label` and `value` gives a list with no notes and a two-column fallback.

The path resolves against the **project root** — the directory holding `myst.yml`, found by
walking up from the page being parsed — so the same `:file: data/rule_reach.csv` works from a
page at any depth. A path beginning `./` or `../` is the page-relative escape hatch; absolute
paths, and paths that escape the root, are refused. `DirectiveSpec.run` is synchronous, so the
read is synchronous and cached on path, mtime and size, and a regenerated CSV is a cache miss
on the next build.

Every problem — a missing or unreadable file, a missing `label` or `value` column, a malformed
row, a non-numeric `value`, a `tone` outside the closed set, a `:columns:` count that does not
match the table's width, a body that is not a single bullet list, an item line with no colon or
no value, an unknown or repeated field key, or a body given alongside `:file:` — is reported by
attaching the
diagnostic to the emitted node with `defer()` and returning `errorNode('bar-list', …)` in place
of the list, naming the file and the 1-based row. The family's document-stage
`diagnosticsTransform` re-raises it, and **that** is what `myst build --site --strict` counts:
a `fileError` raised inside a directive is logged but not counted, because `loadFile` clears a
file's stored messages on each load and then serves the cached mdast without re-running the
directive (QuantEcon/mystmd#95). The directive never relies on one.

The compliance CSVs do not map onto these columns and are not meant to. `rule_reach.csv`
(`rule,category,lectures_affected,total_occurrences,proposed`) and `series_rule_reach.csv` are
read by the `compliance.mjs` wrappers, which apply the published rubric and emit this node
shape themselves: `rule` (plus a `*` suffix when `proposed`) becomes `label`,
`lectures_affected` becomes `value`, the title from `rule_titles.csv` becomes `note`,
`total_occurrences` becomes `secondary` as `"178×"` for the systemic list and `null` for the
reach chart, and `proposed` selects tone `neutral` over `accent`. The wrappers share the
contract, not the code (REVIEW §9); the generic `:file:` source is for hand-rolled data files.

### Tone

Tone attaches **per item only**, as `items[].tone`. There is no root-level tone: a list with
one opinion sets the same tone on every item, which is what the systemic list does (all
`accent`).

A consumer maps tone to the bar fill and to nothing else. In the report theme: `accent` →
`#2c72b8` (the registry-rule blue), `neutral` → `#8ea8c4` (the muted proposed-rule blue),
`good` → `#3e7d4f`, `warn` → `#c07a1d`, `bad` → `#a63a2e`. The track behind the fill is
tone-independent (`#eeeade` labelled, `#f1ede4` compact). A theme with no colour for a tone
falls back to its accent rather than dropping the bar.

Two rules bound the hint. First, **tone never changes the emitted text**: the charts page marks
proposed rules by colour *and* by an asterisk (`Charts.dc.html:194-195`), and the asterisk is
what survives print, LaTeX export, colour-blind viewing and the plain fallback. Anything a
reader must be able to recover without colour belongs in `label`, `note` or `secondary`.
Second, the plugin derives no tone from a threshold — `bar-list` has no bands. Where the
compliance pages colour by score band it is `compliance.mjs` that applies the rubric and writes
the tone; the theme only ever sees the word.

### Renderer notes

Key on `div[class~=qe-dv-bar-list]` and draw entirely from the props. Report-theme metrics,
from the canvases:

| | `labelled` (`Series Report.dc.html:85-90`) | `compact` (`Charts.dc.html:70-75`) |
| --- | --- | --- |
| Grid | `130px 1fr minmax(120px,200px) 90px`, gap 14px | `130px 1fr 44px`, gap 12px |
| Row chrome | each row a card: white, 1px `#e7e3d9`, radius 8, padding 9/14, 7px apart | all rows in one card: white, 1px `#e7e3d9`, radius 12, padding 20, 6px apart |
| Label | chip, mono 11.5px/600 `#17538f` on `#eef2f7`, radius 4, centred | mono 12px `#414b5c`, right-aligned |
| Note | its own column, 13.5px `#414b5c` | the `title` attribute on the bar track |
| Bar | 6px track `#eeeade`, radius 3 | 16px track `#f1ede4`, radius 3 |
| Value | tabular 12.5px `#6a7180`, leading number `#1c2534`/700 | tabular 12.5px/600 `#414b5c` |

The legend beneath the reach chart (`Charts.dc.html:78-81`) is a sibling of the list, not part
of it: `bar-list` emits no legend.

### Fallback

With no custom renderer the node still reads as data, because every renderer in the path is a
registered one. `myst-to-react`'s `div` renderer emits
`<div className={classNames(node.class)}>` around the children, carrying the class string
verbatim into the DOM; its `table`, `tableRow` and `tableCell` renderers emit
`<table><tbody><tr><td>` (and `<th>` for a header cell), honouring `align` as
`text-left`/`text-right` utility classes; and its `span` renderer carries the
`qe-dv-bar-list__*` classes through. `DefaultComponent` — the path for node types nobody has
registered — is not involved at all. So a reader with the default book theme, the lecture
theme, or `compliance-lecture-style` before the report theme exists sees a real ranked table:
a header row reading `Rule | Title | Lectures reached (of 27)` — or `Item | Note | Value` where
the author named no columns, since the header is never omitted — then rows reading
`qe-writing-006 | Capitalize lecture titles properly | **23**/27 · 178×`, with an em dash
standing in for any note the author did not write. Only that first row is a header row; no data
cell is ever marked `header`. The rows are already in rank order, so the comparison the bars
make visually stays legible as a descending column of numbers, and the denominator and the
occurrence count travel with each row instead of living in a bar's width. Nothing is hidden in
props alone.

The same holds in export: `myst-to-tex` has handlers for `div`, `span`, `table`, `strong` and
`text`, so the rows reach a PDF intact where a custom node type would have been dropped in
silence. Three things about the text are worth stating rather than assuming. `×` is mapped to
`$\times$` and `—` to `---`, but the `·` (U+00B7) separator has no mapping in `myst-to-tex` and
passes through raw, so it depends on a Unicode-capable TeX engine — XeTeX or LuaTeX, or
pdfLaTeX with `inputenc` loaded; it is the only character the fallback emits that the converter
does not handle explicitly, and the export test asserts it. Backslashes and braces in a note
are escaped rather than dropped, which is correct but not pretty: the rule title
`Blackboard \mathbb{E}/\mathbb{P}/\mathbb{V}` in `valid[1]` reaches LaTeX as
`{\textbackslash}mathbb\{E\}/…` — legal, and legible enough to identify the rule, but not the
maths it names. A note that needs real markup is out of scope for contract 1.0, and this is
what that costs. And nothing in the fallback emits `→`, which `myst-to-tex` maps through its
`arrows` text replacements to a bare `\rightarrow` in text mode.

## `stacked-bar`

*One or more proportional stacked bars over a shared, ordered set of categories, each segment
sized by its share of that bar's total.*

Directive: `{stacked-bar}`, the one registered name · alias `{dv-stacked-bar}`, the documented
fallback if core ever claims the plain noun; exactly one of the two is registered at a time and
the alias registers the identical spec · renderer key: `div[class~=qe-dv-stacked-bar]`

There is no item directive. The data is a MyST pipe table in the body, or a CSV named by
`:file:`, and nothing else.

### Purpose

`stacked-bar` presents a composition: how a fixed population divides across a small, ordered
set of categories. Reach for it when the interesting fact is the *mix* rather than the
magnitude — the compliance pages use it twice, for the priority mix of one series (a single
headline bar) and for the priority mix of every series side by side (short bars under a shared
legend). A single quantity measured against a maximum is `bar-list`, not this; a matrix of
independent values is `heatmap`.

### Node tree

The root is a portable `div`. `children` is exactly one node — the fallback table — and every
measured number in the properties appears in it, so the node is legible with no custom renderer
at all. The data therefore lives exactly twice: once as properties of the root, once rendered in
the table. Nothing inside the table repeats it a third time — a cell carries `type` and
`children`, plus `header` on row 0 and `align` where the column is numeric, and never a
`contract`, a `primitive` or a copy of the segment it prints. No node here carries a top-level
`label`, `identifier` or `html_id`. This is the whole tree for the Series Report §5.6 bar, not
an excerpt:

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-stacked-bar",
  "contract": "1.0",
  "primitive": "stacked-bar",
  "dimension": "Priority",
  "unit": "lectures",
  "labels": "full",
  "legend": false,
  "size": "md",
  "categories": [
    {"label":"HIGH","tone":"bad"},
    {"label":"MEDIUM","tone":"warn"},
    {"label":"LOW","tone":"warn"},
    {"label":"NONE","tone":"good"}
  ],
  "bars": [
    {
      "label": "lecture-python-programming",
      "total": 27,
      "segments": [
        {"category":"HIGH","value":20,"share":74.1},
        {"category":"MEDIUM","value":0,"share":0},
        {"category":"LOW","value":5,"share":18.5},
        {"category":"NONE","value":2,"share":7.4}
      ]
    }
  ],
  "children": [
    {
      "type": "table",
      "children": [
        {
          "type": "tableRow",
          "children": [
            {"type":"tableCell","header":true,"children":[{"type":"text","value":"Priority (lectures)"}]},
            {
              "type": "tableCell",
              "header": true,
              "align": "right",
              "children": [{"type":"text","value":"lecture-python-programming"}]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {"type":"tableCell","children":[{"type":"text","value":"HIGH"}]},
            {"type":"tableCell","align":"right","children":[{"type":"text","value":"20"}]}
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {"type":"tableCell","children":[{"type":"text","value":"MEDIUM"}]},
            {"type":"tableCell","align":"right","children":[{"type":"text","value":"0"}]}
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {"type":"tableCell","children":[{"type":"text","value":"LOW"}]},
            {"type":"tableCell","align":"right","children":[{"type":"text","value":"5"}]}
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {"type":"tableCell","children":[{"type":"text","value":"NONE"}]},
            {"type":"tableCell","align":"right","children":[{"type":"text","value":"2"}]}
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "children": [{"type":"strong","children":[{"type":"text","value":"Total"}]}]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [{"type":"strong","children":[{"type":"text","value":"27"}]}]
            }
          ]
        }
      ]
    }
  ]
}
```

The node types used are `div`, `table`, `tableRow`, `tableCell`, `strong` and `text`, and every
one of them survives export. `myst-to-typst` has a handler for all six. `myst-to-tex` has a
handler for `div`, `table`, `strong` and `text`; it has none for `tableRow` or `tableCell`, but
never needs one, because its `table` handler walks the rows itself and calls `renderTableCell`
directly, so neither node type is ever dispatched and neither can reach the unhandled branch.
That is why the contract defines no custom node type: a node type an exporter *does* dispatch
and does not know logs an `Unhandled LaTeX conversion` error, and the entire subtree is dropped
from the `.tex` output while the build still exits 0.

### Root properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Portable node type. There is no custom node type in this contract. |
| `class` | string | yes | `qe-dv qe-dv-stacked-bar`, in that order, then any tokens from `:class:`, normalised as below. |
| `contract` | `"1.0"` | yes | Contract version. A consumer that does not know the version renders the children. |
| `primitive` | `"stacked-bar"` | yes | For consumers that dispatch on a property rather than on a class selector. |
| `dimension` | string, non-empty | yes | Name of the dimension the bars are broken into, from the directive argument. Default `"Category"`; the compliance pages pass `"Priority"`. |
| `unit` | string, non-empty | yes | What the values count, in lower case. Default `"count"`; the compliance pages pass `"lectures"`. |
| `labels` | `"full"` \| `"value"` | yes | Inline segment label style: `full` → `HIGH · 20`, `value` → `20`. Default `"full"`. |
| `legend` | boolean | yes | Whether a drawing consumer places a category colour key beneath the bars. Default `false`. |
| `size` | `"md"` \| `"sm"` | yes | Role hint, not a pixel height: `md` is a headline bar on its own, `sm` one row of a comparable stack. Default `"md"`. |
| `categories` | array, ≥ 1 | yes | The stack order, shared by every bar and never re-ordered by a consumer. From the body table's header row, or from `:categories:` on the `:file:` path. |
| `categories[].label` | string, non-empty | yes | Display text and key: `segments[i].category` equals it. The body table's header cell text; with `:file:`, also the CSV column header. |
| `categories[].tone` | `neutral` \| `accent` \| `good` \| `warn` \| `bad` | yes | Closed-vocabulary colour hint. Never a colour, never a threshold. Repeats are legal; see *Tone* below. |
| `bars` | array, ≥ 1 | yes | One entry per bar, in author order. Consumers never sort. |
| `bars[].label` | string, non-empty | yes | Label for this bar and its column header in the fallback. The body table's first cell in this bar's row. Required on every bar, including a lone one. |
| `bars[].total` | number ≥ 0 | yes | Sum of this bar's segment values, denormalised so no consumer has to reduce. |
| `bars[].segments` | array, ≥ 1 | yes | Exactly parallel to `categories`: same length, same order, zero-valued entries included. |
| `bars[].segments[].category` | string, non-empty | yes | Equal to `categories[i].label` at the same index. |
| `bars[].segments[].value` | number ≥ 0 | yes | The measured quantity for this category in this bar. Not necessarily an integer. |
| `bars[].segments[].share` | number, 0–100 | yes | The number nearest `value / total * 100` at one decimal place; `0` when `total` is `0`. |
| `children` | array, exactly 1 | yes | The fallback: one `table` node, described under *Fallback* below. |

The node carries no top-level `label`, `identifier` or `html_id`, and neither does any node
inside the fallback. That is a family rule with a mechanism behind it: `myst-cli`'s embed
transform runs `selectAll('[identifier],[label],[html_id]')` over an embedded subtree and
deletes all three from every node whose type is not `crossReference`, `cite`,
`footnoteDefinition`, `footnoteReference`, `captionNumber` or `link` — so a `div` or a
`tableCell` carrying one loses it, silently, and only when the page is embedded somewhere else.
The directive declares no `:name:` option and sets none of the three itself; the schema
accordingly declares no `identifier`. A `(target)=` anchor before the block still works, because
it is the engine's own target transform that attaches the anchor afterwards — but nothing in
this contract may depend on that property being there, since `{embed}` is exactly where it goes
missing. Note the rule bans a *top-level* property on an emitted node, not a field named
`label` inside an array: `categories[].label` and `bars[].label` are data and are untouched.

Six properties are *measured data* and every one of them is printed in the fallback table:
`dimension`, `unit`, the category labels, the bar labels, the segment values and the bar
totals. `share` is the single derived exception — it is not tabulated because it is exactly
reconstructible from `value` and `total`, both of which are. `labels`, `legend`, `size` and
`tone` are *presentation* properties: they instruct a drawing consumer and carry nothing the
fallback loses, because a plain reader gets the same distinctions from the category names and
the numbers themselves.

Six invariants a JSON Schema cannot express, which the plugin guarantees and the tests assert:
`segments.length === categories.length`; `segments[i].category === categories[i].label`;
`total` equals the sum of the segment values; `share` is derived from `value` and `total`
alone; the fallback's header row is row `0` (the schema can say the table holds exactly one
header row, but a position is pinnable only inside a closed tuple and the row count is open);
and every row of the fallback, header row included, holds exactly `1 + bars.length` cells. A
consumer may rely on all six.

The last one is not house style. `myst-to-typst` writes `tablex(columns: N, …)` from the first
row and then emits every cell as one flat positional sequence with no row delimiter, so a
single short row shifts every cell after it one column left for the rest of the table. A column
that is empty for one row gets an empty cell; it is never omitted.

### Directive options

`{stacked-bar}` is the only registered name. Its argument is the `dimension`.

| Option | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| *(argument)* | string | no | `Category` | Name of the dimension being split; becomes `dimension` and heads the fallback's first column. |
| `:tones:` | comma-separated tones | **yes** | — | Positional, parallel to the stack order; each is `neutral`, `accent`, `good`, `warn` or `bad`. One per value column of the body table, or one per entry of `:categories:`. |
| `:unit:` | string | no | `count` | What the values count, in lower case. |
| `:labels:` | `full` \| `value` | no | `full` | Inline segment label style. |
| `:legend:` | flag | no | `false` | Draw the category colour key beneath the bars. |
| `:size:` | `md` \| `sm` | no | `md` | Headline bar, or one row of a comparable stack. |
| `:file:` | path | no | — | CSV source. Mutually exclusive with a body table: giving both, or neither, is an error. |
| `:categories:` | comma-separated strings | on `:file:` | — | `:file:` only. Which CSV columns to read, by header, and in what stack order. A body table already fixes both, in its header row, so passing `:categories:` with one is an error. |
| `:rows:` | comma-separated entries | no | every data row, in file order | `:file:` only. Which first-column values to include, in what order, optionally renamed; see *`:file:` CSV sources* below. |
| `:class:` | string | no | — | Extra classes, appended after the two canonical tokens and normalised as below. |

`:categories:` is a *selector*, which is why it belongs to the `:file:` path alone.
`series_summary.csv` has fourteen columns and the chart wants four of them, so something has to
name them; a body table has only the columns the author wrote, so the header row is the stack
order and a second spelling of it could only disagree with the first. This is the same split
`heatmap` makes with its `:columns:`.

`:tones:` is required rather than defaulted, on both paths. In a stacked bar, unlike a stat
tile, two adjacent segments in the same fill have no visible boundary: a default of "everything
`neutral`" would draw a four-category bar as one solid rectangle and hide the composition,
which is the primitive's entire purpose. Both design uses supply tones, so requiring them costs
nothing. A `:tones:` list of a different length to the stack order is an error, not a
partially-toned bar.

Deliberately absent, because no compliance page needs them: segment colours (that is what
`tones` is for), bar height or gap, orientation, a percentage-versus-count mode, sorting,
totals on or off, animation, and axis ticks. There is no `:name:` either — a stacked bar is not
an enumerated container, so a preceding `(my-anchor)=` target is how you link to one, with the
caveat about anchors and `{embed}` under *Root properties*.

The directive normalises `:class:` itself, because core does none of it: `addClassOptions` is
literally `node.class = data.options.class`, so whatever the author typed would otherwise land on
the node verbatim. The rule is: split the option value on `/\s+/`, drop empty tokens, drop tokens
already present (`qe-dv` and `qe-dv-stacked-bar` included), append the survivors in the order
given, and join the whole string with single spaces. So `:class: qe-dv  priority-mix` yields
`qe-dv qe-dv-stacked-bar priority-mix`, and the schema's `class` pattern rejects anything the
rule cannot produce — a double space, a trailing space, or a repeated canonical token.

Note that `size`, `labels`, `legend` and `bars.length` are perfectly correlated across the
design: it exercises exactly two combinations — one bar at `md` with `full` labels and no
legend, or N bars at `sm` with `value` labels and a legend. The three options stay separate
because each value is genuinely used, but a request for a third combination is a request to
change the design, and a request for `:height:` or `:label-threshold:` is the same request in
other clothes.

### Authoring

Inline data is an ordinary MyST pipe table in the directive body. That is the MyST idiom for
tabular data — core's own tabular directives are `{csv-table}` and `{list-table}`, neither of
them a YAML block — and it is the body form `heatmap` and `data-table` take, so the three table
primitives in this family are authored the same way.

**There is no `{stacked-bar-item}`, and no item directive of any kind.** That is a fact about
the engine, not a preference. A container directive's `run()` executes **before** the directives
nested in its body: `myst-parser` collects every unprocessed directive with one `selectAll` in
document order and runs them in a single pass, so the container receives its items as raw
`mystDirective` nodes and never as their output. A probe plugin built against the real `myst`
CLI saw exactly `["mystDirective:itm","mystDirective:itm"]` where an item design assumes two
parsed bars. Worse, the nested items' own `run()` still fires afterwards, against nodes the
container has already replaced: their output is computed and silently discarded, and any
diagnostic they defer is attached to a node that is no longer in the tree. An item directive
here would be a second registered name that cannot do its job and cannot report that it failed
to — so the earlier `{stacked-bar-item}` design, and its `{dv-stacked-bar-item}` alias, are
gone rather than fixed.

The grammar, in full:

- **The header row is the stack order.** Its first cell labels the bar column for whoever reads
  the source and is not read by the directive — write what the bars are, or leave it empty.
  Every cell after it is one category, left to right, in the order the segments stack: its text
  becomes `categories[i].label`, which is also the key `bars[].segments[i].category` repeats,
  and `:tones:` is positional against these same columns.
- **Every following row is one bar**, in the order written; nothing sorts anywhere. Its first
  cell is the bar's label (`bars[].label`); every cell after it is that bar's value for the
  category heading that column (`bars[].segments[i].value`). `total` and `share` are derived,
  never authored.
- **Every row has the same number of cells as the header row.** A category a bar has none of
  gets a `0`. A short row is an error, not a row padded from the right.
- **Label cells are plain text.** A label is also a key — matched against a CSV header on the
  other path, and repeated in every segment — so a label cell holding a code span, a link or
  emphasis is an error rather than a silent flattening to its literal text.
- **Value cells are numbers**, non-negative, decimals allowed. A cell holding one of the
  family's null tokens is an error; see *`:file:` CSV sources*.
- Alignment markers in the delimiter row (`---:`) are the author's own formatting. The
  directive rebuilds the fallback from the parsed values, so the alignment there is the
  contract's — right for every value column — whatever the body table did.

A lone headline bar (Series Report §5.6, with its real numbers). This block emits exactly the
node shown under *Node tree* above:

````markdown
:::{stacked-bar} Priority
:tones: bad, warn, warn, good
:unit: lectures

| series                     | HIGH | MEDIUM | LOW | NONE |
| :------------------------- | ---: | -----: | --: | ---: |
| lecture-python-programming |   20 |      0 |   5 |    2 |
:::
````

Five bars over the same categories (Charts §5.8, with its real numbers):

````markdown
:::{stacked-bar} Priority
:tones: bad, warn, warn, good
:unit: lectures
:size: sm
:labels: value
:legend:

| series      | HIGH | MEDIUM | LOW | NONE |
| :---------- | ---: | -----: | --: | ---: |
| advanced    |   43 |      0 |  20 |    5 |
| python.myst |   81 |      1 |  46 |   17 |
| dp          |   34 |      0 |   9 |    9 |
| programming |   20 |      0 |   5 |    2 |
| intro       |   19 |      0 |  28 |    9 |
:::
````

The body table is not passed through into the node: the directive parses it and rebuilds the
fallback from the parsed values, so the `:file:` path and the body path converge on one node
shape. That rebuild is also why the fallback transposes the body — bars are rows here and
columns there — for the reason given under *Fallback*.

What the pipe table buys over the line-oriented `:values: 20, 0, 5, 2` grammar it replaces is
that a value sits under the header cell that names it, so a miscount is visible in the source
instead of surfacing as a `values` list one entry short of `:categories:`. The whole matrix
reads as a matrix, which is exactly the argument `heatmap` makes for the same body form.

### `:file:` CSV sources

With `:file:`, the CSV's **first column is the bar label** and each entry in `:categories:`
names a column to read by header. Every other column is ignored, so `series_summary.csv` —
whose header is
`series,lectures,writing,math,code,figures,references,links,admonitions,overall,HIGH,MEDIUM,LOW,NONE`
and which carries an aggregate `TOTAL` row — drives the priority mix untouched:

````markdown
:::{stacked-bar} Priority
:file: data/series_summary.csv
:categories: HIGH, MEDIUM, LOW, NONE
:tones: bad, warn, warn, good
:rows: lecture-python-advanced.myst as advanced, lecture-python.myst as python.myst, lecture-dp as dp, lecture-python-programming as programming, lecture-python-intro as intro
:unit: lectures
:size: sm
:labels: value
:legend:
:::
````

`bars[].label` comes from the first column, `bars[].segments[i].value` from the column named by
`categories[i]`, and `total` and `share` are derived. This block and the five-bar body table
under *Authoring* emit the same node, which is the point of having both paths: the CSV is the
one to use when the numbers are generated, the body table when they are written by hand.
`:file:` and a body table are mutually exclusive — giving both, or neither, is an error — and
`:categories:` and `:rows:` belong to the `:file:` path alone.

`:rows:` does three jobs, which is why there is no separate `sort`, `exclude` or `labels`
option. It **subsets** (keeping `series_summary.csv`'s aggregate `TOTAL` row out of the chart),
it **orders** (the charts page's sequence is by mean overall score ascending — 7.4, 7.7, 7.7,
8.0, 8.1 — not by HIGH share, so ordering is an authoring decision the file cannot supply), and
with the `csv-value as Display Label` form it **renames**. Renaming is not cosmetic: the
canvas's label column is 130px of 12px IBM Plex Mono, which fits `advanced` and not
`lecture-python-advanced.myst`, and without it `:file:` could not reproduce the only design
that drives this primitive from a CSV. An entry is split on its first ` as `; without one, the
first-column value is used verbatim.

The path resolves the way every `:file:` in this family resolves (`src/lib/project.mjs`):
project-relative by default, walking up from the page to the nearest `myst.yml`, so the same
`:file: data/series_summary.csv` works from a page at any depth; a path beginning `./` or `../`
is page-relative instead, which is the escape hatch for a page that keeps its data beside it.
An absolute path, and a path that resolves outside the project root, are both errors.

**Nulls.** The family has one vocabulary for a missing value and this primitive does not spell
it differently: the tokens that mean absent are exactly `DEFAULT_NULL_TOKENS` from
`src/lib/csv.mjs` — `''`, `n/a`, `na`, `-`, `—` and `null`, matched case-insensitively after
trimming — and an absent value is `null` in the properties, rendered as an em dash in a
fallback. There is no `:na-label:` option here and no bespoke token list, because **a priority
count has no null state at all**: every one of those tokens in a `:categories:` column is an
error naming the row, the column and the token it saw, never a silent zero, because a stacked
bar with a fabricated zero is a lie about a composition. So `value` is never `null`, the em
dash never appears in this fallback, and the distinction the family draws between "absent" and
"out of scope" — a second property, never a second spelling of nothing — has nothing to
distinguish here. `series_summary.csv` writes an empty cell for "category not in scope", which
is a null token and therefore an error; `scores.csv` additionally writes `out-of-scope`, which
is *not* a null token and fails one line later as a non-numeric value. Same outcome, one rule
less. The reader is RFC 4180 (quoted fields, embedded commas, doubled quotes),
dependency-free, and cached per build on path plus mtime so `myst start` picks up regenerated
CSVs.

### Tone

Tone attaches in exactly one place: `categories[].tone`. It never attaches to a bar and never
to a segment, because a category's meaning is constant across every bar in the node — HIGH
means the same thing in the `dp` bar as in the `intro` bar — and a segment inherits its tone by
index from `categories[i]`. The plugin emits no colour and encodes no threshold; a consumer
maps each tone to a fill plus a text colour readable on that fill (the design needs dark
`#4a4020` on its pale gold and white elsewhere, which is the consumer's contrast decision, not
the plugin's).

The five-tone vocabulary is deliberately smaller than the design's four-step ordinal ramp, so
**repeated tones are legal**: the compliance ramp is `bad, warn, warn, good`. Where two
categories that are adjacent in the drawn stack carry the same tone, a consumer **must** keep
them separable — either by shading within the tone family, or by a hairline divider drawn
between every segment. This is not a nicety. In the `python.myst` bar MEDIUM is 1 of 145 (0.7%,
below the inline-label threshold and so unlabelled) sitting directly against LOW at 31.7%;
drawn in one undifferentiated `warn` fill it reads as a single 32.4% LOW block and the MEDIUM
lecture simply disappears. The divider satisfies the rule unconditionally, so every consumer
can meet it.

Where a consumer *does* shade, the step is the category's **position in `categories`** —
earlier is the stronger step — which is exactly what the canvases show: MEDIUM a saturated
amber `#d98f4e`, LOW a paler gold of the same family one step down. That ordinal is derivable
from the array the consumer already has, so contract 1.0 adds no `shade` property and 1.1 will
not need to: a property whose value can be computed from the stack order would only be another
thing to drift.

The canvases disagree on two of the four compliance fills — LOW is `#c8b25a` in Series Report
§5.6 and `#e4cf7c` in Charts §5.8, NONE `#3e7d4f` against `#6fa87d` — which the report theme
must settle when it defines its `qec-` tokens. The node contract is unaffected either way: LOW
is a `warn` at index 2 and NONE a `good` at index 3 whichever hex wins.

### Renderer notes

- Draw segments in `categories` order, sized from `share` (or equivalently from `value` with
  proportional flex). Never re-order the stack to make same-tone categories contiguous: the
  order is the author's.
- Shares are rounded to one decimal and need not total exactly `100`. Let the **last drawn**
  segment absorb the remainder, not the last entry in `categories` — they differ whenever the
  final category is omitted.
- **Omit a segment whose share rounds to `0.0`** from the drawn bar; that subsumes exact zeros
  and matches the canvas's own `.filter(s => s.w !== '0.0%')`. The fallback table keeps the
  row, so it stays strictly more informative than the bar: the series canvas drops the
  zero-width MEDIUM segment and says "No MEDIUM lectures" in prose beneath, whereas the table
  says `MEDIUM 0` outright.
- **Draw an inline label only when `share > 6`.** Below that the text does not fit; both
  canvases use that threshold, and the design brief states it as "omit label when segment <
  ~6%". It is a typography convention of the consumer, not node data.
- Print every number — inline labels and table cells alike — with the minimum digits needed and
  at most one decimal place, with no thousands separator: `20`, `7.5`, `74.1`. Values are JSON
  numbers, so a source cell written `07` or `7.50` cannot round-trip its own spelling; a single
  formatting rule is what keeps a LaTeX, Typst and web rendering of the same node identical.
- `labels: "full"` renders `«category» · «value»`; `labels: "value"` renders the value alone.
- Draw `bars[].label` beside its bar when there is more than one bar. With a single bar do not
  draw it — the design puts the headline bar under its own section heading — but keep it as the
  figure's accessible name; it still heads the fallback column, which is why every bar carries
  one.
- Map `size` onto your own scale: in the report theme `md` is a 34px track and `sm` a 24px one.
- A bar whose `total` is `0` is legal: every share is `0` and the consumer draws an empty
  track. The generic primitive stays permissive here; a wrapper that knows an empty series is a
  data bug should be the thing that fails.

### Errors and warnings

Every problem below is reported through the family's deferred-diagnostic mechanism
(`src/lib/report.mjs`), never by a bare `fileError` inside the directive: a fatal message
raised in a directive is logged but is **not** counted by `myst build --site --strict`, because
`loadFile` clears a file's stored messages on each load and then serves cached mdast without
re-running directives (filed as QuantEcon/mystmd#95). The directive instead returns
`errorNode('stacked-bar', …)` — a visible error admonition carrying its own diagnostic — and
the document-stage `diagnosticsTransform` re-raises it on every pass, so the build both shows
the problem on the page and exits non-zero under `--strict`. A failed directive emits no
`qe-dv-stacked-bar` node at all.

On the directive: `:tones:` missing, of a different length to the stack order, or naming a tone
outside the closed set; both `:file:` and a body table, or neither; `:categories:` or `:rows:`
given alongside a body table; `:categories:` missing or empty on the `:file:` path; a duplicate
category label; a duplicate bar label; `:labels:` or `:size:` outside its choice list.

On the body table: a body that is not exactly one pipe table — prose, a nested directive, a
second table; a header row of fewer than two cells, which names no category; a row whose cell
count differs from the header row's, reported with both counts, because a ragged table is what
shifts every later cell one column left in the Typst export; a label cell that is empty, or
that holds anything but text; a value cell that is not a number, or is negative; and a value
cell holding one of the family's null tokens, which a composition has no way to represent.

On `:file:`: a missing or unreadable file; an absolute path, or one resolving outside the
project root; a `:categories:` entry that is not a column header in the CSV; a `:rows:` entry
whose first-column value is not in the file; and a field in a `:categories:` column that is
either a null token or otherwise non-numeric.

Deleting `series_summary.csv` therefore fails the build loudly, which is the acceptance
criterion this primitive has to meet.

### Fallback

With no custom renderer, `myst-to-react` renders the root through `DefaultComponent` as a plain
`<div class="qe-dv qe-dv-stacked-bar">` containing its children, and the book theme wraps the
table in its own `<div class="overflow-auto">`, so the reader sees a real HTML table: the class
string is emitted verbatim and nothing is hidden in props. The shape does not vary with
`bars.length`. Row 0 is the header row — a corner cell reading `dimension (unit)`, then one
cell per bar headed by that bar's label — and every row after it is a body row: one per
category, in stack order, then a bold `Total` row. **Row 0 is the only header row, every cell
in it carries `header: true`, and no cell in any other row does.** Value cells are
right-aligned, header cells over them included, so each column's heading sits over its numbers.
Every row holds the same number of cells, `1 + bars.length`.

For the Series Report bar that is:

| Priority (lectures) | lecture-python-programming |
| --- | ---: |
| HIGH | 20 |
| MEDIUM | 0 |
| LOW | 5 |
| NONE | 2 |
| **Total** | **27** |

and for the charts page, from the same node shape:

| Priority (lectures) | advanced | python.myst | dp | programming | intro |
| --- | ---: | ---: | ---: | ---: | ---: |
| HIGH | 43 | 81 | 34 | 20 | 19 |
| MEDIUM | 0 | 1 | 0 | 0 | 0 |
| LOW | 20 | 46 | 9 | 5 | 28 |
| NONE | 5 | 17 | 9 | 2 | 9 |
| **Total** | **68** | **145** | **52** | **27** | **56** |

This is what `compliance-lecture-style` gets while it builds against the default or lecture
theme, before the report theme exists, and it is what satisfies "everything works with JS
disabled".

**One header row, and only row 0.** This is the one place the section changed its mind, so it
is worth saying what was given up. The earlier shape also marked each row-label cell as a
header, which is the better accessible reading — a screen reader announced "HIGH,
lecture-python-programming, 20" rather than "lecture-python-programming, 20". What the family
rule buys instead is a table that exports. `myst-to-tex`'s `renderNodeToLatex` writes an
`\hline` after any row whose *first* cell is a header, so row headers ruled the table after
every single line and doubled the rule where the last `\hline` met `\bottomrule`; that much was
cosmetic. The uncosmetic half is the long-table path, which counts leading header rows to find
where the body starts: with a header cell in every row the count becomes the row count and the
body loop, `if (index < numHeaderRowsFound) return`, skips every row — a repeating running
header and no body at all. That was unreachable only because `longFigure` is set exclusively by
a multipage `{table}` container and nothing wraps this primitive in one, and a contract should
not rest on a wrapper never wrapping. With one header row both `myst-to-tex` paths are correct
and a `stacked-bar` inside a multipage container is merely unusual rather than empty.
`myst-to-typst` was always right — its `isHeaderRow` requires *every* cell in a row to be a
header, so it counted one head either way — and the two exporters now agree about which row
that is. The plain reader loses little: the corner cell names the first column, each category
is the first thing in its own row, and every value cell still has its bar's name in the column
header above it.

**Why the categories are the rows.** The fallback transposes the body table, which puts bars in
rows; the cross-primitive audit asked whether it should transpose the other way, so that the
five series read as rows here exactly as they do in the heatmap two sections above. It does
not, and the reason is the corner cell. `dimension (unit)` — `Priority (lectures)` — is the
only column heading this contract can name: the argument names the categories, and the bars are
not named collectively at all. Put the bars in the first column and the corner either heads the
wrong column or goes blank, and naming them properly means a new root property that no design
supplies and no `:file:` column carries. So the rule is: **the fallback's first column carries
the members of the named `dimension`, and the axis whose labels vary per node — the bars —
heads the remaining columns.** The consequence is real and better stated than hidden: on the
charts page the same five series are rows in the heatmap and columns here. The numbers agree
exactly; what decides the orientation is which axis the contract can name.

### Compliance mapping

`{qe-priority-bar}` in `compliance.mjs` emits this node directly — it builds the node rather
than calling this directive, and it owns the HIGH/MEDIUM/LOW/NONE vocabulary, its mapping onto
the closed tone set, and the short display names (`advanced`, `python.myst`, `dp`,
`programming`, `intro`) that `:rows: … as …` provides to generic authors. For one series it
reads that series' row of `series_summary.csv` and emits a single bar labelled with the series
name, `size: "md"`, `labels: "full"`, `legend: false`; for `all` it emits one bar per series
with `size: "sm"`, `labels: "value"`, `legend: true`, ordered by mean overall score ascending.
Both pass `dimension: "Priority"`, `unit: "lectures"` and the ramp `bad, warn, warn, good`. The
canvas caption "worst series first" and that ordering must be written down together in the
wrapper's own contract: the order is by score, not by HIGH share, and a caption that says
otherwise is exactly the drift these directives exist to prevent.

## `heatmap`

A rectangular matrix of numbers drawn as a colour-ramped grid: one row per entity, one column
per measure, one cell per value, with missing as a first-class state rather than a zero. Reach
for it when the question is "which cell is worst" across two axes at once — the compliance
charts page uses it for the mean score of each series in each rule category. Do not reach for
it when one axis would do (that is `bar-list`), when the reader needs exact values in rank
order (`data-table`), or when the cells are parts of a whole (`stacked-bar`).

**Directive** `{heatmap}` · **alias** `{dv-heatmap}` — the documented fallback if a future core
directive claims the plain noun. Exactly one name is registered at a time, the alias registers
the identical spec, and no other name is registered: there is no item directive here, and none
anywhere in the family. **Node**: a `div` classed `qe-dv qe-dv-heatmap`.

### Authoring

Data is authored in one of two places and nowhere else: an ordinary MyST **pipe table** in the
directive body, or a CSV named by `:file:`. One body form, and this is heatmap's — the family
gives each primitive exactly one, a pipe table to the three matrix primitives and a bullet list
to the five list primitives, so a reader who has met one body has met them all. A pipe table is
also the MyST idiom for tabular data — core's own `{table}` takes a body that is exactly this,
`{list-table}` takes a list body and `{csv-table}` takes a CSV body — and it is not a YAML body,
which the engineering review rules out for this family (REVIEW §7).

There is no `{heatmap-row}` or any other item directive, and the reason is the engine rather
than taste. `applyDirectives` collects every unprocessed directive with a single `selectAll` and
runs them in document order, outer before inner (`myst-parser/src/directives.ts:51-52`), so a
container's `run()` is handed its items as raw, unvalidated `mystDirective` nodes and never as
their emitted output. Worse, the items' own `run()` still fires afterwards, against nodes the
container has already replaced: their output is computed and silently discarded, and any
diagnostic they defer is attached to a node no longer in the tree. A table body is read once, by
one `run()`, with no such shadow pass — and it shows the matrix as a matrix rather than one line
at a time.

**The body grammar.** The body must be exactly one `table` node and nothing else, the check core
makes for its own body shape (`{list-table}` rejects a body that is not a single `list` in its
`validate`, `myst-directives/src/table.ts:100-101`) with `table` in place of `list`. Then:

- **Row 0 is the header row, and it names the columns.** Its first cell is the `corner`, the
  accessible name of the row-label column, which may be left empty. Each cell after that is one
  value column in display order, and its text becomes that column's `label`. The header row
  fixes the column count for the block.
- **Every row after it is one matrix row.** Its first cell is the row `label`; the rest are its
  values, one per column, in header order. A row carrying more or fewer cells than the header
  row is an error naming the row — the emitted table's rows all carry the same number of cells,
  and so must the body that describes them.
- **Keys default to labels** on this path — `rows[].key` from the row label, `columns[].key`
  from the column label — so both sets of labels must be unique within the block; a duplicate is
  an error, not a silent overwrite. `:file:` is the path that gives key and label separately.
- **Label cells are read as plain text.** `corner`, `columns[].label` and `rows[].label` are
  strings, so inline markup in a header or label cell is flattened to its text content rather
  than carried through; each emitted header and label cell holds one `text` node.
- **Value cells are a number or nothing.** A cell that is empty, or whose trimmed text is one of
  `n/a`, `na`, `-`, `—` or `null` matched case-insensitively — the toolchain's
  `DEFAULT_NULL_TOKENS`, read through `toNumber` — is a missing value: `null` in
  `rows[].values`, an em dash in the fallback cell. Any other non-numeric cell is an error
  naming the row and the column. The null token is a *bare* `-`, so a negative value written
  `-3` still parses as a number.
- **The alignment row is MyST's, not the directive's.** Whatever `:---:` markers the author
  writes are ignored: the emitted table always aligns the label column `left` and the value
  columns `right`.

```markdown
:::{heatmap}
:min: 4
:max: 10
:tone: good

| series      | Writing | Math | Code | Figures | Refs | Links | Admon |
| :---------- | ------: | ---: | ---: | ------: | ---: | ----: | ----: |
| advanced    |     4.6 |  5.8 |  7.3 |     6.3 |  9.2 |   9.2 |  10.0 |
| python.myst |     4.5 |  7.0 |  7.6 |     6.5 |  9.5 |   9.8 |  10.0 |
| dp          |     4.7 |  6.6 |  7.7 |     6.4 |  9.3 |   9.5 |  10.0 |
| programming |     4.1 |  9.0 |  8.4 |     7.3 |    — |   9.8 |   9.9 |
| intro       |     5.2 |  8.6 |  7.3 |     6.5 |  9.3 |   9.7 |  10.0 |
:::
```

That block spells the matrix of the compliance charts page, `programming`'s missing `Refs` cell
included; an empty cell there would mean the same thing. The body table itself is not passed
through, because the directive rebuilds the emitted table from the parsed values, so both
authoring paths converge on one node shape and one formatting path.

The same matrix from the scoreboard CSV, which is what the compliance charts page uses. This
block emits exactly the node shown under **Node tree** below:

```markdown
:::{heatmap}
:file: data/series_summary.csv
:rows: lecture-python-advanced.myst=advanced, lecture-python.myst=python.myst, lecture-dp=dp, lecture-python-programming=programming, lecture-python-intro=intro
:columns: writing=Writing, math=Math, code=Code, figures=Figures, references=Refs, links=Links, admonitions=Admon
:min: 4
:max: 10
:tone: good
:class: qec-chart
:::
```

`:file:` and a body are mutually exclusive: giving both, or neither, is an error. `:rows:` and
`:columns:` apply to the `:file:` path only — a body table already fixes both order and labels.

### Directive options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `:file:` | path | — | CSV source, resolved against the project root (the nearest `myst.yml` walking up from the page); a `./` or `../` prefix resolves against the page instead. Read synchronously and cached per build on path and mtime. Missing or unreadable is an error, which is how a deleted CSV fails a `--strict` build loudly. |
| `:rows:` | `key` or `key=Label`, comma-separated | every data row, in file order, keyed and labelled by the first column | `:file:` only. Selects, orders and renames rows. Real data needs all three: `series_summary.csv` carries a `TOTAL` row the heatmap must exclude, and the design orders the five series worst-overall-first, which is not the file order. A key absent from the file is an error, not a silent skip. |
| `:columns:` | `key` or `key=Label`, comma-separated | every column but the first, in file order | `:file:` only. Selects, orders and renames value columns. `series_summary.csv` has fourteen columns; the heatmap shows seven of them, two under shortened labels (`references` as `Refs`, `admonitions` as `Admon`). A key absent from the header is an error. |
| `:min:` | number | floor of the smallest value present | Bottom of the ramp domain, written to `scale.min`. The default lands on 4 for the compliance data, which is the design's figure — but a data-derived domain moves when the data moves, and two heatmaps on one page are then not comparable, so a wrapper reading a CSV should pass it explicitly. |
| `:max:` | number | ceiling of the largest value present | Top of the ramp domain, written to `scale.max`. The default lands on 10 for the compliance data. `max <= min` is an error. If the matrix holds no numeric value at all, neither default is defined and the directive reports an error naming the block: `:min:` and `:max:` must then be given. If the defaults produce a degenerate domain (every value equal), the directive warns and widens `max` to `min + 1`. |
| `:tone:` | `neutral` \| `accent` \| `good` \| `warn` \| `bad` | `accent` | What a value at `max` means, written to `tone`. The compliance heatmap passes `good`: high scores read positively, which is what makes the design's red-through-amber-to-green ramp correct rather than an arbitrary theme choice. Anything outside the closed set is an error. |
| `:precision:` | integer 0–3 | `1` | Decimal places for cell text, written to `precision`. The compliance heatmap uses the default, which is the design's `v.toFixed(1)`. The option exists because the printed form is not recoverable from the data: JSON numbers carry no trailing zeros, so the cell reading `10.0` is the number `10` on the wire, and a renderer drawing its own grid has no other way to format as the fallback does. Outside 0–3 is an error. |
| `:class:` | string | — | Family-wide. Author tokens to add to the node's class, split on whitespace. |

Seven data options plus the family-wide `class`, and no more. There is no per-cell colour, no
ramp definition, no sort, no caption and no row link: the ramp belongs to the consumer,
ordering belongs to whoever assembles the rows, and a heading above the block is ordinary
Markdown. An eighth data option needs a second consumer.

**There is no `na-label` option, and there is no `naLabel` property.** A missing value has one
spelling family-wide: `null` in the properties, an em dash `—` in the fallback cell, and the
`DEFAULT_NULL_TOKENS` set — `''`, `n/a`, `na`, `-`, `—`, `null`, matched case-insensitively
after trimming — as the tokens that mean absent on the way in. The draft carried a per-block
label for it, defaulting to `N/A`, on the argument that a project whose data writes `—` must be
able to say so; the token list already covers that, and the option bought nothing but a second
spelling of nothing for a reader moving between two blocks on one page. A primitive that has to
tell "absent" from "out of scope" gets a second property, never a second spelling — heatmap
does not, so `null` is the whole of its missing-value vocabulary. The design canvases do print
`N/A` in this cell (`Charts.dc.html:162`); the contract prints the em dash, and the renderer
notes below say so.

**Class normalisation.** Core does no normalisation whatsoever — `addClassOptions` is literally
`node.class = data.options.class` — so the directive does it. It splits `:class:` on
whitespace, drops empty tokens and tokens already present, appends the survivors to
`qe-dv qe-dv-heatmap` in the order written, and joins with single spaces. An author who writes
`qec-chart`, a doubled space and a repeated `qe-dv` therefore gets the class
`qe-dv qe-dv-heatmap qec-chart`.

### `:file:` CSV sources

The mapping is fixed and needs no `label-column` option: **the first column is always the
row-label column**, and its header becomes `corner`. Every other column is a candidate value
column, keyed by its CSV header.

For `lectures/data/series_summary.csv`, whose header is
`series,lectures,writing,math,code,figures,references,links,admonitions,overall,HIGH,MEDIUM,LOW,NONE`:

- `corner` becomes `series`, the first header cell, verbatim.
- `:columns:` picks `writing`, `math`, `code`, `figures`, `references`, `links` and
  `admonitions` — seven of the fourteen — and renames two, so `columns` is `[{key: "writing",
  label: "Writing"}, …, {key: "references", label: "Refs"}, {key: "admonitions", label:
  "Admon"}]`. `lectures`, `overall`, `HIGH`, `MEDIUM`, `LOW` and `NONE` are simply not
  selected.
- `:rows:` picks five of the six data rows — excluding `TOTAL` — and orders them
  worst-overall-first, so `rows[].key` holds the CSV series ids and `rows[].label` the
  shortened names the design shows.
- Each remaining field is parsed as a number by the toolchain's `toNumber`. A field that is
  empty, or whose trimmed text matches one of `n/a`, `na`, `-`, `—` or `null`
  case-insensitively — `DEFAULT_NULL_TOKENS` — becomes `null`:
  `lecture-python-programming` has an empty `references` field, so its fifth value is `null` and
  its fallback cell reads `—`. Any other non-numeric field is an error naming the row key and
  the column key, rather than a silent `NaN`.
- Numbers are never re-typed by hand, which is what preserves the design's "the charts cannot
  drift from the scoreboard" guarantee.

**The corner is the raw CSV header, deliberately.** `:columns:` and `:rows:` rename everything
else, so the fallback's header row reads `series | Writing | Math | …` — one lowercase key
beside seven Title Case labels. That is accepted rather than fixed: an eighth option to rename
one cell is not worth it, and the string is a genuine accessible name for the row-label column,
so it should be a readable word in the CSV. A project that wants a different corner label
authors the body table instead, where the first header cell is the corner and can say anything.

### Node tree

The full node for the `:file:` example above. Every row of the matrix appears in the fallback
table: the structured properties and the children are two renderings of one dataset, and they
agree index for index.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-heatmap qec-chart",
  "contract": "1.0",
  "primitive": "heatmap",
  "corner": "series",
  "columns": [
    { "key": "writing", "label": "Writing" },
    { "key": "math", "label": "Math" },
    { "key": "code", "label": "Code" },
    { "key": "figures", "label": "Figures" },
    { "key": "references", "label": "Refs" },
    { "key": "links", "label": "Links" },
    { "key": "admonitions", "label": "Admon" }
  ],
  "rows": [
    { "key": "lecture-python-advanced.myst", "label": "advanced", "values": [4.6, 5.8, 7.3, 6.3, 9.2, 9.2, 10] },
    { "key": "lecture-python.myst", "label": "python.myst", "values": [4.5, 7, 7.6, 6.5, 9.5, 9.8, 10] },
    { "key": "lecture-dp", "label": "dp", "values": [4.7, 6.6, 7.7, 6.4, 9.3, 9.5, 10] },
    { "key": "lecture-python-programming", "label": "programming", "values": [4.1, 9, 8.4, 7.3, null, 9.8, 9.9] },
    { "key": "lecture-python-intro", "label": "intro", "values": [5.2, 8.6, 7.3, 6.5, 9.3, 9.7, 10] }
  ],
  "scale": { "min": 4, "max": 10 },
  "tone": "good",
  "precision": 1,
  "children": [
    {
      "type": "table",
      "class": "qe-dv-fallback",
      "children": [
        {
          "type": "tableRow",
          "children": [
            { "type": "tableCell", "header": true, "align": "left", "children": [{ "type": "text", "value": "series" }] },
            { "type": "tableCell", "header": true, "align": "right", "children": [{ "type": "text", "value": "Writing" }] },
            { "type": "tableCell", "header": true, "align": "right", "children": [{ "type": "text", "value": "Math" }] },
            { "type": "tableCell", "header": true, "align": "right", "children": [{ "type": "text", "value": "Code" }] },
            { "type": "tableCell", "header": true, "align": "right", "children": [{ "type": "text", "value": "Figures" }] },
            { "type": "tableCell", "header": true, "align": "right", "children": [{ "type": "text", "value": "Refs" }] },
            { "type": "tableCell", "header": true, "align": "right", "children": [{ "type": "text", "value": "Links" }] },
            { "type": "tableCell", "header": true, "align": "right", "children": [{ "type": "text", "value": "Admon" }] }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            { "type": "tableCell", "align": "left", "children": [{ "type": "text", "value": "advanced" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "4.6" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "5.8" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "7.3" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "6.3" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.2" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.2" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "10.0" }] }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            { "type": "tableCell", "align": "left", "children": [{ "type": "text", "value": "python.myst" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "4.5" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "7.0" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "7.6" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "6.5" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.5" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.8" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "10.0" }] }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            { "type": "tableCell", "align": "left", "children": [{ "type": "text", "value": "dp" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "4.7" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "6.6" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "7.7" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "6.4" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.3" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.5" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "10.0" }] }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            { "type": "tableCell", "align": "left", "children": [{ "type": "text", "value": "programming" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "4.1" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.0" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "8.4" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "7.3" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "—" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.8" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.9" }] }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            { "type": "tableCell", "align": "left", "children": [{ "type": "text", "value": "intro" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "5.2" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "8.6" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "7.3" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "6.5" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.3" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "9.7" }] },
            { "type": "tableCell", "align": "right", "children": [{ "type": "text", "value": "10.0" }] }
          ]
        }
      ]
    },
    {
      "type": "paragraph",
      "class": "qe-dv-legend",
      "children": [{ "type": "text", "value": "Scale: 4 to 10; higher is better. — means no value." }]
    }
  ]
}
```

### Root properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | The only wrapper `myst-to-react`, `myst-to-tex` and `myst-to-typst` all handle. |
| `class` | string | yes | `qe-dv qe-dv-heatmap` first and in that order, then any author tokens. Matched by the schema against exactly what the directive's normalisation produces. |
| `contract` | `"1.0"` | yes | Contract revision, so a renderer can refuse a node it does not understand. |
| `primitive` | `"heatmap"` | yes | For consumers that dispatch on a property rather than on a class selector. |
| `corner` | string | no | Accessible name of the row-label column, printed in the fallback's top-left cell. Absent or empty means no corner label and an empty corner cell. |
| `columns` | `{key, label}[]` | yes | Columns in display order; index-aligned with every `rows[].values`. `key` is the machine id, `label` the text the header cell prints. At least one entry; keys non-empty and unique. |
| `rows` | `{key, label, values}[]` | yes | Rows in display order — never reordered by the plugin. `values` is `(number \| null)[]` with `values.length === columns.length`; `null` is a missing cell, printed as an em dash. |
| `scale` | `{min, max}` | yes | The ramp domain. A consumer computes `t = clamp((v - min) / (max - min), 0, 1)`; values outside the domain clamp rather than extend it. `max > min`. |
| `tone` | `neutral` \| `accent` \| `good` \| `warn` \| `bad` | yes | What a value at `scale.max` means. Always written, so a renderer never has to know the option default. A hint: no thresholds, no colours. |
| `precision` | integer 0–3 | yes | Decimals for cell text. Always written, because trailing zeros do not survive JSON and a renderer drawing its own grid must format as the fallback does. |
| `children` | mdast[] | yes | Exactly two nodes: the fallback `table`, then the legend `paragraph`. |

Five rules cannot be written in JSON Schema and are enforced by the directive instead, each
with a test: `values.length === columns.length`; `key` unique across `columns` and across
`rows`; `scale.max > scale.min`; every row of the fallback table carrying the same number of
cells, `columns.length + 1`, the header row included; and the fallback table agreeing with
`columns`, `rows` and `precision` cell for cell. The schema states each of them in the
description of the property it constrains, so the two halves of the contract cannot drift apart
silently.

One further rule is checked by the directive for a different reason: that the fallback table's
header row is the **first** row. JSON Schema 2020-12 can express it — `prefixItems` pins index 0
while `items` constrains the tail, with no length cap — but ajv's `strictTuples`, which the
contract harness turns on with `strict: true`, refuses a tuple whose tail is left open. The
schema therefore holds the table to exactly one all-header row without pinning its position, and
the test suite asserts the position. Everything else the schema can express, it does: no node it
describes may carry a top-level `label`, `identifier` or `html_id`; no node *below* the root may
carry `contract` or `primitive`, so an inner node stays dumb; the retired `naLabel` is
named and refused, because `additionalProperties` has to stay open for the engine's own keys and
a stale wrapper would otherwise slip one through unnoticed; and the `class` pattern rejects a
repeated family token, so a class string the directive would never emit fails here. All three
bans are written as property-name rules rather than a negated `required`, because ajv's
`strictRequired` — on under `strict: true` — refuses a `required` naming a property the schema
does not define.

### Tone

Tone attaches in exactly one place: a single `tone` string on the root node. There is no
per-cell and no per-row tone, and there must not be — cell colour comes from the continuous
ramp over `scale`, and a per-cell tone would fight it.

What `tone` names is the meaning of a value at `scale.max`, the one piece of domain sense a
consumer cannot infer from the numbers:

| `tone` | What high means | What a consumer does with it | In the legend |
| --- | --- | --- | --- |
| `good` | reads positively | diverging ramp, bad end at `scale.min` — the compliance case, red through amber to green | `higher is better` |
| `bad` | reads negatively | the same ramp with `t` replaced by `1 - t` — a violation-count matrix | `higher is worse` |
| `warn` | is cautionary | one amber hue, deepening with `t` | `higher needs attention` |
| `accent` | nothing beyond magnitude | the theme's accent hue, varying lightness and chroma; the default, and the least opinionated rendering of a stranger's data | nothing |
| `neutral` | nothing beyond magnitude | greys, for a matrix that should not compete with what surrounds it | nothing |

The consumer maps tone to colour; the plugin ships no colours and no thresholds. `accent` and
`neutral` are glossed with nothing in the legend because they claim no domain sense — there is
nothing to say in words.

The closed set is policed at two points, and deliberately with different strictness. Authoring is
strict: a `:tone:` outside the set is an error, because an author who mistypes it should hear
about it at build time rather than wonder why the ramp looks wrong. Rendering is tolerant: a
consumer meeting a tone it does not know — a node from a later contract, a hand-edited page —
renders it as `neutral` rather than failing, which is the family rule for every primitive that
carries a tone.

### Fallback

A theme with no `qe-dv-heatmap` renderer shows a complete, readable matrix and one sentence of
legend, because that is exactly what the children are. `myst-to-react` renders an unrecognised
`div` with its default component — a `<div>` around its children — so the first child becomes
an ordinary HTML table: a header row reading `series | Writing | Math | Code | Figures | Refs |
Links | Admon`, then five rows, one per series, each beginning with its label and continuing
with its seven values formatted at `precision`, with an em dash in the one cell that has no
value. Under it, the second child renders as the paragraph `Scale: 4 to 10; higher is better. —
means no value.` Verified against the default book theme, which emits
`<div class="qe-dv qe-dv-heatmap qec-chart"><div class="overflow-auto"><table>…` — the class
string is carried through verbatim, so `div[class~=qe-dv-heatmap]` selectors match and the
table scrolls in its own container rather than widening the page.

Every property that carries content is printed there: `corner`, every column label, every row
label, every value at `precision`, an em dash wherever a value is `null`, and the `scale`
endpoints with the sense of `tone` in words. Only the identifiers (`columns[].key`,
`rows[].key`) and the dispatch fields (`type`, `class`, `contract`, `primitive`) are not
printed, because they name things rather than say anything. Nothing is reachable only by
scraping properties.

The same holds off the web. `myst-to-tex` and `myst-to-typst` both have `table` and `paragraph`
handlers, so PDF and Typst export produce a real tabular and a real sentence; a `grid`- or
`card`-rooted node would instead be dropped from the `.tex` with "Unhandled LaTeX conversion"
while the build still exited 0, which is the whole reason the root is a `div`. With JavaScript
disabled the table is already in the server-rendered HTML.

What is lost without a renderer is only the colour channel, and the colour channel is redundant
by construction: it re-expresses numbers that are printed in every cell. That is also what
makes the upgraded rendering accessible rather than colour-dependent.

### Errors and warnings

A `fileError` raised inside a directive is logged but is **not** counted by `myst build --site
--strict`: `loadFile` clears a file's stored messages on each load and the second pass serves
the cached mdast without re-running directives, so a broken directive still exits 0 (filed as
QuantEcon/mystmd#95). Every diagnostic this primitive reports therefore goes through the
family's deferral mechanism, under the rule id `qe-datavis-heatmap`:

- A problem that still leaves a matrix — a degenerate data-derived domain — is attached to the
  emitted node with `defer(node, 'warn', …)`.
- A problem that leaves no matrix to emit — both or neither of `:file:` and a body; an
  unreadable `:file:`; a body that is not exactly one table; a `:rows:` or `:columns:` key
  absent from the CSV; a non-numeric cell that is neither empty nor a null token; a duplicate
  row or column key; a ragged row; `max <= min`; no numeric value and no explicit
  `:min:`/`:max:`; a `tone` outside the closed set; a `precision` outside 0–3 — returns
  `errorNode('heatmap', …)` in place of the `div`, a visible error admonition that carries its
  own deferred diagnostic.
- The family's document-stage `diagnosticsTransform` re-raises both kinds on every pass, which
  is where `--strict` can see them, and which keeps working on the incremental rebuilds of
  `myst start`, where the directive never runs again.

### Renderer notes

Geometry, from the design (README §5.8; `Charts.dc.html:46-60`): a white card, 1px `#e7e3d9`,
radius 12, padding 20, `overflow-x: auto` (`:46`); inside it a grid `130px repeat(N, 1fr)` with
gap 5 and a `min-width` that keeps cells legible — 720px at seven columns (`:47`). The corner
is an empty span (`:48`); column headers are 11.5px/700, uppercase, tracking .04em, `#8a8577`,
centred, with 4px bottom padding (`:49-51`). Cells are radius 6, `min-height` 44, centred,
13px/600, `font-variant-numeric: tabular-nums`, padding `0 10px`, text `#1c2534` (`:52-54`);
row labels are 12px/500 `#414b5c`, right-aligned, on no background (`:155-156`). A `null` cell
is `#e8e4da` on `#8a8577` (`:158-164`) showing an em dash — the canvas prints `N/A` there
(`:162`), and the contract's one spelling of a missing value replaces it, so the drawn grid and
the fallback table read the same.

Colour comes from `tone` and `scale`, never from the node. The reference ramp for `tone: good`
is the design's, at `Charts.dc.html:139-144`: `t = clamp((v - scale.min) / (scale.max -
scale.min), 0, 1)`, then `oklch(L C H)` with `H = 25 + 120t`, `C = 0.09`, `L = 0.62 + 0.13t` —
muted red at `t = 0`, muted green at `t = 1`. The canvas hard-codes `(v - 4) / 6`, which is
what `scale` generalises. `oklch()` needs no fallback in evergreen browsers or in Playwright's
Chromium (REVIEW §7).

The legend sits under the grid (margin-top 16, gap 8, 12px `#8a8577`, `Charts.dc.html:56-60`):
`scale.min`, a 180×8 radius-4 gradient bar, `scale.max`, then — only when some cell is `null` —
a 14×14 radius-3 `#e8e4da` swatch and an em dash. Render the endpoints as authored, without
applying `precision`: the design prints `4` and `10`, not `4.0` and `10.0`, and the fallback
paragraph does the same. Build the bar by sampling the same ramp function; the canvas
hard-codes its stops (`linear-gradient(90deg, #c0574a, #ddb35c, #6fa87d)`) and will drift from
the cells otherwise.

The card, not the page, is the scroll container: the page must not scroll horizontally at any
width ≥ 360px (REVIEW §7). Keep table semantics in the DOM — a real `<table>` with each row
label as `<th scope="row">` and `corner` naming that column, or a CSS grid with the matching
ARIA roles. An upgraded renderer replaces both children with its own grid and legend; it must
not render the fallback table as well.

### Portability notes

- **Only row 0 carries `header: true`, and every cell in it does.** No cell in any other row is
  ever a header — row-label cells included, which is the tempting mistake. In `myst-to-tex` an
  `\hline` is written after every row whose first cell is a header, so row headers rule the
  table after every line; and in the long-table path such rows are counted as header rows and
  then skipped from the body, which emits a repeating running header and no body at all
  (`packages/myst-to-tex/src/tables.ts:115-186`, fork @`12a8b26b`). `myst-to-typst` agrees from
  the other side: `countHeaderRows` counts every all-header row and writes
  `header-rows: N, repeat-header: true` (`packages/myst-to-typst/src/table.ts:12-22`, `:42`), so
  a second header row is repeated on every page break. The schema rejects a body row carrying a
  header cell and holds the table to exactly one header row, though not to its position — see
  above.
- **Every row carries the same number of cells, the header row included.** A column that is
  empty for a row gets an empty cell; it is never omitted. `myst-to-typst` takes the column
  count from the first row alone (`countColumns`, `packages/myst-to-typst/src/table.ts:4-10`)
  and then emits every cell as one flat positional sequence with no row delimiter
  (`tableRowHandler`, `:49-51`), so a single short row shifts every cell after it one column
  left for the rest of the table. LaTeX tolerates a short row; Typst silently corrupts.
- **No top-level `label`, `identifier` or `html_id` on any node this primitive emits.**
  `myst-cli`'s embed transform runs `selectAll('[identifier],[label],[html_id]')` over an
  embedded subtree and deletes all three from every node whose type is not `crossReference`,
  `cite`, `footnoteDefinition`, `footnoteReference`, `captionNumber` or `link`
  (`packages/myst-cli/src/transforms/embed.ts:61-66`), so a `div`, `paragraph` or `tableCell`
  carrying one loses it — and loses it only when the page is embedded elsewhere, which is the
  worst place to discover it. `columns[].label` and `rows[].label` are properties inside arrays,
  not node-level ones, and the transform never reaches them; the schema bans the node-level
  three at the root and in every fallback node.
- **The em dash exports on all three paths.** `—` is in `myst-to-tex`'s `textOnlyReplacements`
  and emits `---` (`packages/myst-to-tex/src/utils.ts:41`, spread into `textReplacements` at
  `:108` and applied in text mode at `:232`); `myst-to-typst` leaves it alone — its replacement
  is commented out (`packages/myst-to-typst/src/utils.ts:47`) — and a UTF-8 Typst source carries
  it verbatim; on the site path it is an ordinary character. The family's one spelling of a
  missing value is safe everywhere the fallback goes.
- **`align` is cheap and sometimes useful.** `myst-to-typst` emits `cellx(align: …)` from it
  (`packages/myst-to-typst/src/table.ts:62-64`); `myst-to-tex` ignores it; `myst-to-html` drops
  it, reading only `table.align`. Setting `left` on the label column and `right` on value
  columns costs nothing and improves Typst output.
- **No `grid`, no `card`, no custom node type, anywhere in the subtree.** `myst-to-tex` has no
  handler for them, logs an error, drops the whole subtree, and exits 0. The permitted
  node types here are `div`, `table`, `tableRow`, `tableCell`, `paragraph` and `text`.
- **Inner nodes are dumb.** Only the root carries `contract` and `primitive`; a table, row, cell
  or paragraph inside it carries a `class` and nothing else — no contract fields, and no second
  copy of the datum it renders. The data lives exactly twice, once as root properties and once
  rendered in the children, and a third copy would be one more thing to drift.
- **`qe-dv-fallback` and `qe-dv-legend` are conveniences, not guarantees.** `myst-to-html`'s
  table handler overwrites `node.data` with `hProperties: { align }` and never forwards
  `node.class` (`packages/myst-to-html/src/schema.ts:132-139`), so a theme styling
  `.qe-dv-fallback` gets it on the site path and not in `myst-to-html` output. Hide the
  fallback by replacing the children in the renderer, not by relying on the token.
- `myst-to-typst` also honours `style.backgroundColor` on a `tableCell`
  (`packages/myst-to-typst/src/table.ts:65-67`), so a Typst export could one day carry real
  cell fills. Deliberately not taken in 1.0: the plugin ships no colours.

## `data-table`

A typed table: every column declares the *kind* of value it holds, so a consumer can draw a
score as a bar, a priority as a badge or a "needs work" count as a fraction while the node
stays an ordinary MyST table underneath. Reach for it whenever a page shows one row per thing
measured and several typed values per row. It presents and never judges — thresholds such as
"Writing at or below 4 is red" belong to the wrapper that reads the data, and the node carries
only values and a tone hint per cell.

Directive `data-table`, alias `dv-data-table`. Both names are free in mystmd 1.10.1; the alias
exists in case a future core directive claims the plain noun, because core registers first and
wins a collision silently.

### Node tree

The root is a classed `div` carrying the whole table as node properties; its single child is
the portable `table` node rendering the same data. The two are **two renderings of one dataset
and they agree exactly, index for index** — that is the rule the rest of this section exists to
keep.

Below is the compliance ledger's landing-page triage table, complete: five columns, five rows,
nothing elided. It is `valid[0]` in [`samples/data-table.json`](../../samples/data-table.json),
where `valid[1]` is the series report's 27-row ranked table in full and `valid[2]` a three-row
table authored from a pipe-table body.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-data-table qe-triage-table",
  "contract": "1.0",
  "primitive": "data-table",
  "sortable": false,
  "columns": [
    {"key": "attn", "label": "Attn", "type": "badge", "align": "left"},
    {"key": "series", "label": "Series", "type": "code", "align": "left"},
    {
      "key": "score",
      "label": "Score / 10",
      "type": "bar",
      "align": "right",
      "max": 10,
      "decimals": 1
    },
    {"key": "needs-work", "label": "Needs work", "type": "fraction", "align": "right"},
    {"key": "weakest", "label": "Weakest categories", "type": "chips", "align": "left"}
  ],
  "rows": [
    [
      {"kind": "badge", "label": "HIGH", "tone": "bad"},
      {
        "kind": "code",
        "value": "lecture-python-advanced.myst",
        "url": "series/lecture-python-advanced.myst"
      },
      {"kind": "bar", "value": 7.4, "tone": "bad"},
      {"kind": "fraction", "value": 43, "of": 68},
      {"kind": "chips", "items": ["Writing 4.6", "Math 5.8"], "tone": "neutral"}
    ],
    [
      {"kind": "badge", "label": "HIGH", "tone": "bad"},
      {"kind": "code", "value": "lecture-python.myst", "url": "series/lecture-python.myst"},
      {"kind": "bar", "value": 7.7, "tone": "bad"},
      {"kind": "fraction", "value": 82, "of": 145},
      {"kind": "chips", "items": ["Writing 4.5", "Figures 6.5"], "tone": "neutral"}
    ],
    [
      {"kind": "badge", "label": "HIGH", "tone": "bad"},
      {"kind": "code", "value": "lecture-dp", "url": "series/lecture-dp"},
      {"kind": "bar", "value": 7.7, "tone": "bad"},
      {"kind": "fraction", "value": 34, "of": 52},
      {"kind": "chips", "items": ["Writing 4.7", "Figures 6.4"], "tone": "neutral"}
    ],
    [
      {"kind": "badge", "label": "HIGH", "tone": "bad"},
      {
        "kind": "code",
        "value": "lecture-python-programming",
        "url": "series/lecture-python-programming"
      },
      {"kind": "bar", "value": 8.0, "tone": "bad"},
      {"kind": "fraction", "value": 20, "of": 27},
      {"kind": "chips", "items": ["Writing 4.1", "Figures 7.3"], "tone": "neutral"}
    ],
    [
      {"kind": "badge", "label": "SOME", "tone": "warn"},
      {"kind": "code", "value": "lecture-python-intro", "url": "series/lecture-python-intro"},
      {"kind": "bar", "value": 8.1, "tone": "warn"},
      {"kind": "fraction", "value": 19, "of": 56},
      {"kind": "chips", "items": ["Writing 5.2", "Figures 6.5"], "tone": "neutral"}
    ]
  ],
  "children": [
    {
      "type": "table",
      "children": [
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "header": true,
              "align": "left",
              "children": [{"type": "text", "value": "Attn"}]
            },
            {
              "type": "tableCell",
              "header": true,
              "align": "left",
              "children": [{"type": "text", "value": "Series"}]
            },
            {
              "type": "tableCell",
              "header": true,
              "align": "right",
              "children": [{"type": "text", "value": "Score / 10"}]
            },
            {
              "type": "tableCell",
              "header": true,
              "align": "right",
              "children": [{"type": "text", "value": "Needs work"}]
            },
            {
              "type": "tableCell",
              "header": true,
              "align": "left",
              "children": [{"type": "text", "value": "Weakest categories"}]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "strong", "children": [{"type": "text", "value": "HIGH"}]}]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "link",
                  "url": "series/lecture-python-advanced.myst",
                  "children": [{"type": "inlineCode", "value": "lecture-python-advanced.myst"}]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [{"type": "text", "value": "7.4"}]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {"type": "strong", "children": [{"type": "text", "value": "43"}]},
                {"type": "text", "value": " / 68"}
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "text", "value": "Writing 4.6, Math 5.8"}]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "strong", "children": [{"type": "text", "value": "HIGH"}]}]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "link",
                  "url": "series/lecture-python.myst",
                  "children": [{"type": "inlineCode", "value": "lecture-python.myst"}]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [{"type": "text", "value": "7.7"}]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {"type": "strong", "children": [{"type": "text", "value": "82"}]},
                {"type": "text", "value": " / 145"}
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "text", "value": "Writing 4.5, Figures 6.5"}]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "strong", "children": [{"type": "text", "value": "HIGH"}]}]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "link",
                  "url": "series/lecture-dp",
                  "children": [{"type": "inlineCode", "value": "lecture-dp"}]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [{"type": "text", "value": "7.7"}]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {"type": "strong", "children": [{"type": "text", "value": "34"}]},
                {"type": "text", "value": " / 52"}
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "text", "value": "Writing 4.7, Figures 6.4"}]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "strong", "children": [{"type": "text", "value": "HIGH"}]}]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "link",
                  "url": "series/lecture-python-programming",
                  "children": [{"type": "inlineCode", "value": "lecture-python-programming"}]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [{"type": "text", "value": "8.0"}]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {"type": "strong", "children": [{"type": "text", "value": "20"}]},
                {"type": "text", "value": " / 27"}
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "text", "value": "Writing 4.1, Figures 7.3"}]
            }
          ]
        },
        {
          "type": "tableRow",
          "children": [
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "strong", "children": [{"type": "text", "value": "SOME"}]}]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [
                {
                  "type": "link",
                  "url": "series/lecture-python-intro",
                  "children": [{"type": "inlineCode", "value": "lecture-python-intro"}]
                }
              ]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [{"type": "text", "value": "8.1"}]
            },
            {
              "type": "tableCell",
              "align": "right",
              "children": [
                {"type": "strong", "children": [{"type": "text", "value": "19"}]},
                {"type": "text", "value": " / 56"}
              ]
            },
            {
              "type": "tableCell",
              "align": "left",
              "children": [{"type": "text", "value": "Writing 5.2, Figures 6.5"}]
            }
          ]
        }
      ]
    }
  ]
}
```

`children` is exactly one node, the `table`. Its first `tableRow` is the header row (`header:
true` on every cell); body row `i` renders `rows[i]`. Without `rank`, `rows[i][j]` is
`children[0].children[i + 1].children[j]`; with `rank`, a leading ordinal cell is prepended to
every row, so `rows[i][j]` is `children[0].children[i + 1].children[j + 1]`. The header row is
emitted even when `rows` is empty, because a table with no rows at all yields no columns, and
`myst-to-tex`'s `renderNodeToLatex` throws `invalid table format, no columns` when
`getColumnWidths` hands it none.

Four family rules govern that table. They are decided for all eight primitives, not per
primitive, and each is forced by an export path rather than a preference:

- **One header row, and only row 0.** Every cell of row 0 carries `header: true`; no cell of any
  other row carries `header` at all. `myst-to-tex`'s `tables.ts` writes a `\hline` after every
  row whose *first* cell is a header, so a row-header column rules the table after every single
  line; and its long-table path counts leading header rows to find where the body starts, so a
  header cell in every row makes that count the row count and the body loop skips every row —
  a repeating running header and no body at all.
- **Every row carries the same number of cells**, header row included: `columns.length`, plus
  one when `rank` is true. A column with nothing to say in a row gets an em dash, never a
  missing cell. `myst-to-typst` declares the column count from the first row and then emits
  every cell as one flat positional sequence with no row delimiter, so a single short row shifts
  every later cell one column left for the rest of the table.
- **Inner nodes are dumb.** A `tableRow` or a `tableCell` carries presentation and content only
  — `align`, `header`, `children`. Never `contract`, never `primitive`, never a second copy of
  the cell object it renders. Only the root describes itself, and the data lives exactly twice:
  once in `rows`, once in the children.
- **No `label`, `identifier` or `html_id` on any node this primitive emits**, root included.
  `myst-cli`'s `transforms/embed.ts` runs `selectAll('[identifier],[label],[html_id]')` over an
  embedded subtree and deletes all three from every node whose type is not `crossReference`,
  `cite`, `footnoteDefinition`, `footnoteReference`, `captionNumber` or `link`. A `div` or a
  `tableCell` carrying one keeps it on its own page and loses it silently the moment the page
  is embedded elsewhere — the worst failure mode there is, because the page it was written on
  still looks right. This says nothing about a property called `label` *inside* an array or an
  object: `columns[i].label` and a `badge` cell's `label` are fields of data, not properties of
  a node, and the transform never sees them.

The schema pins the first, third and fourth of those directly: exactly one all-header row, and
`contract`, `primitive`, `kind`, `label`, `identifier` and `html_id` closed off on the `table`,
its rows and its cells. Uniform arity and the header row's *position* cross-reference values
inside the instance, so they are plugin invariants below.

### Root properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Always `div`. No custom node types: `myst-to-tex` has no handler for one; it logs an error, drops the whole subtree from a LaTeX export, and still exits 0. |
| `class` | string | yes | `qe-dv qe-dv-data-table`, then any wrapper or author tokens, single-spaced. This is the renderer key. |
| `contract` | `"1.0"` | yes | Contract version this node conforms to. |
| `primitive` | `"data-table"` | yes | Primitive name, for consumers that dispatch on a property rather than a selector. |
| `columns` | array of column objects | yes | Display order, at least one, keys unique. The ordinal column added by `rank` is *not* listed here. |
| `rows` | array of arrays of cell objects | yes | Rows in the emitted order. Row `i` holds exactly one cell per entry of `columns`, in the same order, and cell `j`'s `kind` equals `columns[j].type`. May be empty. |
| `sortable` | boolean | yes | True when a consumer should offer client-side re-sorting. False means the order is editorial and no column is sortable. |
| `rank` | boolean | no, default `false` | True when a leading ordinal column labelled `#` is present, numbered 1…N over the emitted order. |
| `sort` | `{key, order}` | present exactly when `sortable` is true | The key and direction the rows are *already* in. `key` names a column whose own `sortable` is true; `order` is `asc` or `desc`. |
| `nulls` | `"last"` | present exactly when `sortable` is true | Where nulls go when a consumer re-sorts, in both directions. Contract 1.0 fixes this to `last`, matching the design's comparator. |
| `children` | array of one `table` node | yes | The plain rendering. Never empty; no cell in it is ever empty. |

The class string is built by the directive, not by core: `addClassOptions` is literally
`node.class = data.options.class`, with no normalisation and no merging. So the directive starts
from `qe-dv qe-dv-data-table`, splits the `:class:` value on whitespace, drops empty tokens and
tokens already present, appends what survives, and joins with single spaces. The schema's
`class` pattern matches exactly that: the two base tokens in order, then single-spaced tokens
that repeat neither of them.

### Column objects

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `key` | string, `^[a-z0-9]+(-[a-z0-9]+)*$` | yes | Stable identifier, unique in the table. The directive slugifies the header label; a wrapper sets it directly. |
| `label` | string | yes | Header text, rendered verbatim in the header row. |
| `type` | `text` \| `code` \| `number` \| `bar` \| `fraction` \| `badge` \| `chips` | yes | The kind every cell in this column carries. |
| `align` | `left` \| `right` \| `center` | yes | Copied onto every `tableCell` of the column. |
| `sortable` | boolean | no | Whether a consumer may re-sort on this column. Only `number`, `bar` and `fraction` columns may be sortable in 1.0, and none may be when the table's `sortable` is false. |
| `max` | number > 0 | required on `bar`, forbidden elsewhere | Full-scale value the bar is drawn against. |
| `decimals` | integer 0–4 | no, numeric columns only | Fixed decimal places in the plain rendering. Absent means the shortest exact form. Never applied to a null. |

`align` is **always written out** rather than left to a default, so a column and its cells can
never disagree. The value the directive writes is `right` for `number`, `bar` and `fraction`
columns and `left` for the rest; a wrapper may write anything it likes.

### Cell kinds

| Kind | Shape | Plain rendering | Where the design uses it |
| --- | --- | --- | --- |
| `text` | `{kind, value: string\|null, url?}` | the text, wrapped in a `link` when `url` is set | any label column |
| `code` | `{kind, value: string\|null, url?}` | an `inlineCode`, wrapped in a `link` when `url` is set | mono lecture and series names (§5.1, §5.6) |
| `number` | `{kind, value: number\|null, tone?, strong?}` | the formatted number, wrapped in `strong` when `strong` is true | the six category columns and Overall (§5.6) |
| `bar` | `{kind, value: number\|null, tone?}` | the formatted number alone; the track is the renderer's | the score bar (§5.1) |
| `fraction` | `{kind, value: number\|null, of, tone?}` | a `strong` numerator, then ` / ` and the denominator: `**43** / 68` | "needs work" (§5.1) |
| `badge` | `{kind, label, tone?}` | the label in `strong` | attention `HIGH`/`SOME` (§5.1), priority `HIGH`/`MEDIUM`/`LOW`/`NONE` (§5.6) |
| `chips` | `{kind, items: string[], tone?}` | the items joined with `, ` | weakest categories (§5.1) |

A `chips` cell is a cell kind, not a nested `chips` primitive: it emits no root node of its own.
Number formatting is one rule: with `decimals` set, `value.toFixed(decimals)`; otherwise the
shortest exact form, so `3` stays `3` and `7.5` stays `7.5`. That is why `decimals` is per
column — the ranked table prints its categories short and Overall always to one place.

Cell objects are **closed**: an unknown property is a schema error, not extra data, because a
misspelt `strong` that validated would be a value silently missing from the page.

### Null and empty renderings

The family has **one vocabulary for a missing value**: an absent value is `null` in the
properties and an em dash `—` in the fallback. Every kind that permits one renders it that way,
so no cell of the fallback table is ever blank and no consumer has to learn a second spelling.
There is no `naLabel` option, no per-column override, and the string `N/A` appears nowhere in
the node.

| Case | Plain rendering | Source |
| --- | --- | --- |
| `text` with `value: null` | `—` | — |
| `code` with `value: null` | `—`, as plain text: no code span and no link | — |
| `number` with `value: null` | `—` | README §5.6, "Null category = `—`" |
| `bar` with `value: null` | `—`; a renderer draws the empty track behind it | README §5.7 asks for `N/A` here; the family rule spells every absent value `—`, and the empty track carries the rest of the meaning |
| `fraction` with `value: null` | `— / 68` — the denominator is still shown, because `of` is data the fallback must not hide | — |
| `chips` with `items: []` | `—` | — |
| `rows: []` | the header row alone | — |

`decimals` is not applied to a null, and a cell whose `value` is null carries no `url` — there
is nothing to link.

A primitive that has to distinguish *absent* from *out of scope* does it with a second
property, never with a second spelling of nothing. Contract 1.0 carries no such property, which
is what makes `out-of-scope` an error rather than a second flavour of null — see
[`:file:` CSV sources](#file-csv-sources).

### Tone

Tone attaches to individual cells and nowhere else: to `number`, `bar`, `fraction`, `badge` and
`chips` cells, never to a column, a row or the table. `text` and `code` cells take none. Absent
means `neutral`. The vocabulary is closed — `neutral`, `accent`, `good`, `warn`, `bad` — and a
tone is a hint, never a colour and never a threshold.

What a consumer does with it is map it to a colour and nothing else. It must not re-derive a
threshold, because the primitive has already thrown the thresholds away: by the time a tone is
on the node, "Writing at or below 4" has become `tone: "bad"` and the rule that produced it
lives in the wrapper. The mapping read off the references, and recommended for the report
theme, is `bad` → `#a63a2e`, chip `#f6e5e2` on `#8c2f24`; `warn` → `#c07a1d`, chip `#f6ecd8` on
`#8a5a1a`; `neutral` → gold chip `#f0ece2`–`#f2edd7` on `#6b5d34`; `good` → green chip `#e5efe7`
on `#2e5e3b`; `accent` → blue `#eef2f7` on `#17538f`. That covers all four priority buckets of
§5.6 — `HIGH` → `bad`, `MEDIUM` → `warn`, `LOW` → `neutral`, `NONE` → `good` — because the
design's `LOW` badge already uses the gold it uses for the weakest-category chips.

Tone is the one property the fallback deliberately does not render, and it is safe to omit
because it carries no information the fallback is hiding: in every real case it is derived from
a value the plain table already shows — the `3` in the Writing cell, the word `HIGH` in the
badge. `strong` is separate from tone and means added weight only: the Overall column sets it on
every cell (the canvas renders that column at 700), and a Writing cell at or below 4 sets both
`strong: true` and `tone: "bad"` (the canvas sets colour and weight together).

### Sorting and rank

`rows` and the fallback table are already in the order `sort` describes, and the `rank` ordinals
run 1…N over that order. That is what makes the default view correct with JavaScript disabled,
which README §7 requires — "everything must work with JS disabled except sorting/filtering".
Sorting is an enhancement, not the only way to read the table. A consumer offering re-sorting
recomputes the ordinals on each sort — the first click on a header sorts ascending, a second
toggles — and marks the active column from `sort`.

Values sort on `value`; a `fraction` sorts on its numerator. Nulls take no part in the
comparison and are appended, in both directions, keeping their source order; ties keep source
order too, so the sort is stable. The single rule tying the pieces together, stated here once
and repeated nowhere in a different form: **`sort.key` is the `key` of a column whose own
`sortable` is `true`**, and both `sort` and `nulls` are present exactly when the table's
`sortable` is true.

### Authoring

Data is authored one of two ways and no others: in the directive body, or in a CSV named by
`:file:`. The body is **one MyST pipe table** — the family's single body form for the
table-shaped primitives, as a bullet list is for the list-shaped ones. There is no YAML body, no
`{list-table}` bullets-of-bullets, and above all **no per-row item directive**; `data-table` and
`dv-data-table` are the only names this primitive registers.

The item directive is not a style question — it does not work. `myst-parser`'s `directives.ts`
collects every unprocessed directive with one `selectAll` in document order and runs them in a
single pass, so a container's `run()` executes *before* the directives nested in its body and
receives them as raw `mystDirective` nodes, never as their output. Worse, a consumed item's
`run()` still fires afterwards, against a node the container has already replaced: its output is
computed and silently discarded, and any diagnostic it defers is attached to a node no longer in
the tree. A pipe table has none of that machinery, reads as the thing it is at a glance, carries
inline markdown in its cells, and stays legible at 27 rows where 27 nested directives would not.

```markdown
:::{data-table}
:types: code, number, number, text

| Lecture | Writing | Overall | Priority |
| --- | --- | --- | --- |
| [`about_py`](lectures/about_py) | 3 | 7.1 | HIGH |
| [`python_by_example`](lectures/python_by_example) | 3 | 7.2 | HIGH |
| [`pandas`](lectures/pandas) | 3 | 7.3 | HIGH |
:::
```

That emits `valid[2]` of the samples file exactly: `class: "qe-dv qe-dv-data-table"`, four
columns keyed `lecture`, `writing`, `overall` and `priority`, three rows, and a `table` child of
one header row and three body rows whose lecture cells are links wrapping code spans. Adding
`:class: qe-worked-example` would make the class `qe-dv qe-dv-data-table qe-worked-example`, and
nothing else about the node would change.

The grammar, exactly:

- The body holds **one pipe table and nothing else**. Any other block content in the body — a
  paragraph, a second table, a nested directive — is an error.
- **The header row names the columns.** Its cell text is the column's `label`, verbatim, and the
  `key` is the slugified label: `Score / 10` → `score-10`. Its cell count fixes the table's
  column count, and the columns are emitted in header order.
- **Every later row is one data row**, one cell per column, in the same order. A row with more or
  fewer cells than the header row is an error naming the row — never a ragged fallback table.
- **`:types:` types the columns positionally** against the header row: the *n*th type applies to
  the *n*th column. There is no inference from the cell contents.
- **The delimiter row's alignment markers are read and discarded.** `align` is written from the
  column's type — `right` for `number`, `left` for `text` and `code` — because a CSV cannot
  express a marker and the same data must give the same node whichever source it came from.
- **A cell's content is inline markdown**, reduced to a cell object by the rules below. An empty
  cell is `null`.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `:file:` | string | — | CSV source, resolved project-root relative (a `./` or `../` prefix makes it page-relative). Exactly one of `:file:` and a body is required; both, or neither, is an error. |
| `:columns:` | string | every source column, in source order | Comma-separated **CSV source column names** to include, in order. `:file:` only — a body names its columns in its header row. |
| `:types:` | string | every column `text` | Comma-separated `text`, `code` or `number`, positional against the included columns. There is no type inference. |
| `:sort:` | string | source or body order | `<key>`, optionally followed by `asc` or `desc` (default `asc`). Names a column typed `number`. |
| `:sortable:` | flag | absent → `false` | Emit `sortable: true`, and `sortable: true` on every `number` column. Requires `:sort:`. |
| `:rank:` | flag | absent → `false` | Prepend the ordinal `#` column. |
| `:class:` | string | — | Extra class tokens, normalised and appended after `qe-dv qe-dv-data-table`. |

Seven options, and that is the cap. `:sort:` alone orders the rows but records no `sort`
property, because a table nobody can re-sort has no sort state to record; `:sortable:` is what
turns the order into node data, and it needs `:sort:` to know which column the order belongs to.
There is no `:order:` option — neither compliance table needs one, both being ascending, and a
direction is one word inside `:sort:`.

The rich kinds (`bar`, `fraction`, `badge`, `chips`), the `decimals` and `max` properties,
per-cell `tone` and `strong`, and per-column `sortable` other than through the table-level flag,
are reachable from the node contract but **not** from the directive. `url` is the one in-between:
a body cell gets it from a markdown link, and a CSV cannot produce it at all. A table that needs
the rest is built by a wrapper that knows the domain — which is how both compliance tables are
produced, and what keeps `datavis` from turning into a charting DSL. Nothing in the option
surface sets a colour, a threshold or a width.

### Body cells

A pipe-table cell holds inline content only, which is exactly what a cell object can carry.
Cells reach the directive as parsed mdast, and the reduction is exact rather than best-effort.
Per the column's type:

- **`code`** — one `inlineCode`, giving `{kind: "code", value}`; or one `link` wrapping exactly
  one `inlineCode` or one `text`, giving `{kind: "code", value, url}`. An empty cell gives
  `value: null`.
- **`text`** — one `text` node, giving `{kind: "text", value}`; or one `link` wrapping exactly
  one `text`, giving `{kind: "text", value, url}`. An empty cell gives `value: null`.
- **`number`** — one `text` node, put through `toNumber` with `DEFAULT_NULL_TOKENS`, giving
  `{kind: "number", value}`.

The null tokens are the same six in a body as in a CSV, and in every column type: `''`, `n/a`,
`na`, `-`, `—` and `null`, matched case-insensitively after trimming. One vocabulary for a
missing value means a table converted from a CSV to a body, or from a `text` column to a
`number` one, does not quietly change what an empty-looking cell means.

Anything richer — bold, emphasis, inline maths, a footnote, two links in a cell, a link wrapping
mixed content — is an **error naming the row and the column**, not a silent flattening. A cell
whose markup cannot be represented in `rows` would make the children carry more than the
properties, and a consumer that upgraded the node would then show *less* than a plain theme.

The fallback children are built from the cell objects, never copied from the body mdast. The
agreement between `rows` and `children` is therefore structural: there is one code path that
turns a cell into `tableCell` children, and it is the same one for a CSV and for a body.

Validation of the body is three checks: the body holds exactly one `table` node and no other
block content; every row carries the same number of cells as the header row; and no cell of any
row but the first carries `header` — which a pipe table cannot produce anyway, and which the
emitted fallback would refuse regardless, since it is rebuilt from the cell objects rather than
re-parented from the body.

### `:file:` CSV sources

`:file:` is resolved by `resolveFile`: project-root relative by default, the root being the
nearest ancestor of the page holding `myst.yml`, with a `./` or `../` prefix meaning
page-relative. Absolute paths and paths escaping the project root are refused. The file is read
through the mtime-plus-size `FileCache`, so a regenerated file is a miss on the next read rather
than a stale hit, and parsed by `readCsv`, which requires a header row and rejects duplicate,
empty and surplus fields. The cache cannot do more than that: a fresh `myst build` always
reflects the current data, but `myst start` does not notice a CSV edit on its own — the engine
serves the page from its own mdast cache, keyed on the page's content hash, so the directive
never re-runs and the page updates only once the page itself is touched. That gap is
QuantEcon/mystmd#96.

The header row supplies the labels, and each key is the slugified label: `Score / 10` →
`score-10`, `lectures_affected` → `lectures-affected`. `:columns:` names source columns by their
header text and both selects and orders them; `:types:` types the selection positionally.

```markdown
:::{data-table}
:file: data/scores.csv
:columns: lecture, writing, math, code, figures, links, admonitions, overall
:types: code, number, number, number, number, number, number, number
:sort: overall
:sortable:
:rank:
:::
```

That is the **plain** variant of the series report's ranked table, and it is worth being precise
about what it does and does not give you. It gives the ordinal column, the ascending-Overall
order, seven sortable number columns, `—` in the categories that do not apply, and the CSV's own
header text as the labels. It does not give the links on the lecture names, the one-decimal
Overall, the bold Writing values or the priority badges: `url`, `decimals`, `strong` and `badge`
are wrapper-only, and the designed table is `valid[1]` of the samples file — a node the
compliance wrapper emits after applying the rubric, not one this directive can build.

**Nulls, and the one state contract 1.0 carries.** The tokens that mean absent are exactly `''`,
`n/a`, `na`, `-`, `—` and `null`, matched case-insensitively after trimming — the toolchain's
`DEFAULT_NULL_TOKENS` in `src/lib/csv.mjs`, the same set the family uses everywhere and the same
set a body cell is matched against. A match gives `value: null`, meaning *the measure does not
apply here*, and the fallback prints `—`. In a `number` column anything else that is not a finite
number is an error naming the row and the column, rather than a silent `NaN`.

REVIEW §6 (which amends README §3) records that `scores.csv` uses `N/A` **and** `out-of-scope`,
in its `jax` column, and asks for an explicit null spec. This is it. `N/A` is a null token like
the other five and is *not* preserved as a spelling: it becomes `null`, and it renders as `—`.
`out-of-scope` is not a null token at all — "not applicable" and "out of scope" are different
claims about the world, and the family rule for distinguishing them is a **second property, never
a second spelling of nothing**. Contract 1.0 carries no such property, so a column containing
`out-of-scope` is an error. A page needing both either excludes the column with `:columns:` (as
the example above excludes `references` and `jax`) or is built by a wrapper that maps
`out-of-scope` onto a state of its own. Adding that second property to `data-table` is a contract
bump, not a token.

**Links.** A CSV cannot produce a `url`. `text` and `code` cells sourced from a file carry the
value alone; the ranked table's links come from the compliance wrapper. A companion-column
convention — a source `lecture_url` consumed as the `url` of `lecture` — was considered and left
out of 1.0, because it is the first step towards a CSV that carries presentation. Likewise a CSV
cannot produce a `bar`, `fraction`, `badge` or `chips` column, and cannot set a tone.

### Errors and warnings

A `fileError` raised inside a **directive** is logged but is not counted by `myst build --site
--strict`: `loadFile` clears a file's stored messages each time it loads the file and then
serves the cached mdast without re-running the directive, so the message is gone before the
strict check harvests it. This is filed upstream as QuantEcon/mystmd#95. Every statement in this
section about reporting a problem therefore means the deferred mechanism in `src/lib/report.mjs`,
not a direct `fileError`.

A directive that cannot produce its table returns `errorNode('data-table', message)`: a visible
`admonition` of kind `error`, classed `qe-dv qe-dv-error qe-dv-data-table`, carrying the
diagnostic on `node.data.qeDiagnostics` with `ruleId: "qe-datavis-data-table"`.

```json
{
  "type": "admonition",
  "kind": "error",
  "class": "qe-dv qe-dv-error qe-dv-data-table",
  "children": [
    {"type": "admonitionTitle", "children": [{"type": "text", "value": "data-table directive"}]},
    {"type": "paragraph", "children": [{"type": "text", "value": "data/scores.csv: no such file"}]}
  ],
  "data": {
    "qeDiagnostics": [
      {
        "level": "error",
        "message": "data/scores.csv: no such file",
        "ruleId": "qe-datavis-data-table"
      }
    ]
  }
}
```

That node is **not** a `data-table` node and does not validate against
[`schema/data-table.json`](../../schema/data-table.json) — a failed directive emits an error
node in place of the table, so the page shows the problem instead of a hole. The family's
document-stage `diagnosticsTransform` re-raises the diagnostic on every pass, which is the only
place `--strict` accounting can see it, and it keeps working on incremental `myst start`
rebuilds where the directive never runs again. That is what makes README §9's acceptance
criterion 2 — "deleting a CSV fails the build loudly" — true rather than aspirational. A
consumer that wants the family quiet suppresses `qe-datavis-data-table` through `error_rules`.

Errors: a missing, unreadable or malformed file; `:file:` together with a body, or neither; a
body that is not exactly one pipe table; a body row whose cell count differs from the header
row's; a `:columns:` name absent from the header; a `:types:` list of the wrong length or naming
a kind the directive cannot emit; a non-numeric cell in a `number` column; `:sortable:` without
`:sort:`, or `:sort:` naming a column that is not typed `number`; a body cell whose markup
cannot be reduced. The one warning: a CSV with a header row and no data rows still builds — the
header row alone, `rows: []` — and attaches `defer(node, "warn", …)` rather than failing, because
an empty dataset is a legitimate state of a report.

### Invariants the plugin enforces

The schema catches everything a schema can. These seven cross-reference values inside the
instance, which JSON Schema cannot do, so the plugin checks them and the plugin's tests assert
them against the samples:

1. Column `key`s are unique within the table.
2. Every row has exactly `columns.length` cells, and cell `j`'s `kind` equals `columns[j].type`.
3. The children correspond: `children[0].children` has `rows.length + 1` entries; body row `i`
   renders `rows[i]` cell for cell in order, with the ordinal cell prepended when `rank` is
   true; and every `tableCell`'s `align` equals its column's `align` (`left` for the ordinal).
4. Every row of the fallback table, the header row included, has the same number of cells:
   `columns.length`, plus one when `rank` is true. No row is ever short.
5. The header row is `children[0].children[0]` — the schema pins that exactly one row is an
   all-header row, but not which one, because JSON Schema cannot fix a position in a
   variable-length array.
6. `sort.key` is the `key` of a column whose own `sortable` is `true`.
7. A `bar` cell's `value`, when not null, lies within `0 … columns[j].max`.

Invariants 3 to 5 are the ones that matter most, and they are why `samples/data-table.json`
carries every row of both design tables rather than an illustrative extract: a fixture that
truncates cannot catch an off-by-one under `rank`, and it cannot catch the one short row that
shifts a typst export by a column.

### Fallback

With no renderer at all, `myst-to-react` renders the root as a plain `<div>` holding a real
`<table>`. Verified by building a probe node with the real `myst` CLI: the default book theme
emits `<div class="qe-dv qe-dv-…"><div class="overflow-auto"><table>…</table></div></div>` with
the class string verbatim, so a `div[class~=qe-dv-data-table]` renderer key works and an
un-upgraded page still gets a real table. The triage table reads as five rows, the first of them
`HIGH · lecture-python-advanced.myst · 7.4 · **43** / 68 · Writing 4.6, Math 5.8` and the last
`SOME · lecture-python-intro · 8.1 · **19** / 56 · Writing 5.2, Figures 6.5`, with the series
names as links in a mono code span. The ranked table reads as its 27 rows, ordinals 1–27, `—`
in the categories that do not apply, every Overall value in bold, the Writing values at or
below 4 in bold too, bold priority words, already ordered worst-overall first. `myst-to-tex`
handles `div`, `link`, `strong` and `inlineCode` directly, and its `table` handler renders the
`tableRow`/`tableCell` subtree itself, so the same page exports to LaTeX as a tabular.

Exactly two things are missing without a renderer, and neither is information: the interaction
(re-sorting, which is why the emitted order is the one that matters) and the colour (tone, which
is derived from values the table already shows). Nothing lives in the properties that is not
also on the page — which is what lets `compliance-lecture-style` migrate to mystmd and build
with the default or the lecture theme before the report theme exists.

## `chips`

`chips` presents a *set of like things* as small labelled chips: the rules a series is clean
on, the categories dragging a score down, the rule ids attached to a trend row. Each chip is a
short monospaced id, a short plain label, or both, carrying a tone hint and one of two shapes.
Reach for it when the data is a list of names rather than a list of measurements — anything
with a number to compare belongs in `bar-list` or `stats`, and a row of page metadata belongs
in `badges`.

`chips` and `badges` draw the same pill and are not the same primitive: `chips` enumerates a
**set in the data**, `badges` qualifies **the page**. Every structural difference follows from
that. A set is variable in length and may be empty, so `items` has no minimum and an empty set
falls back to the empty-set notice; a set reads as an enumeration, so the fallback is a `list`.
A set is uniform, so `variant` and `tone` are the set's and every chip resolves to them, which
is what makes the span's tokens exactly validatable. `badges` is the mirror image on all three:
a fixed short row, `minItems: 1`, one `paragraph` read as a single line, with `tone` and
`emphasis` varying badge by badge.

| | |
| --- | --- |
| Directive | `{chips}`, alias `{dv-chips}` — two names, and no others |
| Body | one MyST bullet list, one list item per chip |
| Root node | `div`, class `qe-dv qe-dv-chips qe-dv-chips--<variant>` |
| Chip part | `span`, class `qe-dv qe-dv-chips__chip qe-dv-chips__chip--<variant> qe-dv-tone-<tone>` |
| Contract | `1.0` |
| Schema | [`schema/chips.json`](../../schema/chips.json), samples in [`samples/chips.json`](../../samples/chips.json) |
| Design source | Report brief §5.6 (clean-rules pills), §5.1 (weakest-category tags) |
| First consumer | `qe-clean-rules` in `compliance.mjs` |

### Node tree

The whole "Clean across the series" set from the series report — all sixteen rules, none
elided. This is `valid[0]` in `samples/chips.json`, byte for byte, and it is what the schema
validates. The data appears exactly twice: once as `items` on the root, once as the text of the
sixteen chip spans. Each span carries a `class` and nothing else.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-chips qe-dv-chips--pill qe-clean-rules",
  "contract": "1.0",
  "primitive": "chips",
  "variant": "pill",
  "tone": "good",
  "mark": "✓",
  "items": [
    { "id": "qe-admon-002", "label": "Dropdown class for solutions", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-code-002", "label": "Unicode Greek in code", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-code-005", "label": "quantecon timeit for benchmarking", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-fig-004", "label": "Caption formatting", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-fig-010", "label": "Plotly latex directive", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-link-001", "label": "Markdown links in-series", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-003", "label": "Square brackets for matrices", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-004", "label": "No bold matrices/vectors", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-005", "label": "Curly brackets for sequences", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-006", "label": "aligned environment for PDF", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-007", "label": "Automatic equation numbering", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-008", "label": "Explain special notation", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-011", "label": "Plain-letter distribution names", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-math-013", "label": "{eq} equation references", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-ref-001", "label": "Correct citation style", "tone": "good", "variant": "pill", "mark": "✓" },
    { "id": "qe-writing-009", "label": "Write \"IID\"", "tone": "good", "variant": "pill", "mark": "✓" }
  ],
  "children": [
    {
      "type": "list",
      "ordered": false,
      "spread": false,
      "children": [
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-admon-002" },
                    { "type": "text", "value": " — Dropdown class for solutions" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-code-002" },
                    { "type": "text", "value": " — Unicode Greek in code" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-code-005" },
                    { "type": "text", "value": " — quantecon timeit for benchmarking" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-fig-004" },
                    { "type": "text", "value": " — Caption formatting" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-fig-010" },
                    { "type": "text", "value": " — Plotly latex directive" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-link-001" },
                    { "type": "text", "value": " — Markdown links in-series" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-003" },
                    { "type": "text", "value": " — Square brackets for matrices" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-004" },
                    { "type": "text", "value": " — No bold matrices/vectors" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-005" },
                    { "type": "text", "value": " — Curly brackets for sequences" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-006" },
                    { "type": "text", "value": " — aligned environment for PDF" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-007" },
                    { "type": "text", "value": " — Automatic equation numbering" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-008" },
                    { "type": "text", "value": " — Explain special notation" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-011" },
                    { "type": "text", "value": " — Plain-letter distribution names" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-math-013" },
                    { "type": "text", "value": " — {eq} equation references" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-ref-001" },
                    { "type": "text", "value": " — Correct citation style" }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "listItem",
          "spread": false,
          "children": [
            {
              "type": "paragraph",
              "children": [
                {
                  "type": "span",
                  "class": "qe-dv qe-dv-chips__chip qe-dv-chips__chip--pill qe-dv-tone-good",
                  "children": [
                    { "type": "text", "value": "✓ " },
                    { "type": "inlineCode", "value": "qe-writing-009" },
                    { "type": "text", "value": " — Write \"IID\"" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Only `div`, `span`, `list`, `listItem`, `paragraph`, `inlineCode` and `text` appear here, and
the empty-set fallback below adds `emphasis` — seven node types in the ordinary case, eight in
all. Every one has a `myst-to-tex` handler, so a report page still exports to PDF; `grid` and
`card` are deliberately absent, because `myst-to-tex` has no handler for them and drops the
entire subtree from the `.tex` output while the build still exits 0. No `table` appears
anywhere in this primitive, so the family's rules on header rows and on uniform row arity have
no site here.

### Root properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Always `div`. The family defines no custom node types. |
| `class` | string | yes | Normalised, single-space-joined tokens: `qe-dv`, `qe-dv-chips`, the derived `qe-dv-chips--<variant>`, then any author tokens from `:class:`. |
| `contract` | `"1.0"` | yes | The contract version this node was emitted against, so a renderer can refuse a version it does not implement. |
| `primitive` | `"chips"` | yes | Primitive name, for consumers keying on properties rather than on class tokens. Only the root carries it. |
| `variant` | `"pill"` \| `"tag"` | yes | Shape of every chip in the set, resolved onto every entry of `items`. |
| `tone` | tone | yes | Tone hint for the set, defaulting to `neutral`, and the tone of every chip in it: a set is uniform in tone. Resolved onto every entry of `items`, so a consumer reading a chip never falls back to the root. |
| `mark` | string, 1–4 characters | no | Glyph drawn before every chip — `✓` in the clean-rules design. Resolved onto each chip and rendered into each span, so the fallback carries it as well. |
| `items` | array of chip objects | yes | The chips, in render order. Entry `i` is what the `i`-th chip span spells out. May be empty. |
| `children` | array, exactly one node | yes | The fallback: a `list` of one item per entry of `items` when `items` is non-empty, otherwise the empty-set paragraph. |

`chips` emits no `label`, `identifier` or `html_id` on any node — not on the root, not on a
span. `myst-cli`'s embed transform runs `selectAll('[identifier],[label],[html_id]')` over an
embedded subtree and deletes all three from every node whose type is not `crossReference`,
`cite`, `footnoteDefinition`, `footnoteReference`, `captionNumber` or `link`, so a `div` or
`span` carrying one loses it — and loses it only when the page is embedded somewhere else,
which is the worst way to find a bug. That is why a chip's own text is nested inside `items`
rather than sitting on a node as a top-level `label`: properties nested inside arrays and
objects are never visited by that transform, so `items[].label` is safe and a node-level
`label` is not. The schema forbids all three on the chip span. It cannot forbid them on the
root, because MyST itself adds them when a target precedes the directive (`(clean-rules)=`) and
the engine always adds `key` — which is why `additionalProperties` stays true there.

### The data lives exactly twice

Once as `items` on the root, once rendered as the text of the chip spans. A chip span carries a
`class` and nothing else: no `contract`, no `primitive`, no `part`, and no second copy of the
entry of `items` it renders. An earlier draft hung a complete duplicate `chip` object on every
span — a third copy of every datum, sixteen of them on the clean-rules set, held together by a
deep-equality invariant that the draft itself called a drift surface. It is gone. The root
properties are the machine-readable record, the spans are the plain rendering, and there is now
nothing in between to drift.

What the span gives up along with it is self-description. A chip span lifted out of a `chips`
root is a `span` with three class tokens and some text: enough for a CSS-only theme to style,
not enough for a consumer to read as data. Only the root says which primitive this is, and that
is the family rule rather than anything about chips.

The schema holds the two renderings together three ways:

- **The lengths agree.** Sixteen `items` under a one-item fallback list is rejected, and so is a
  fallback list carrying a span that no entry of `items` accounts for
  (`$defs/chipCountFollowsItems`, exact for one to twenty-four chips and open-ended above that,
  the same ladder `stats` uses for its rows).
- **The resolved values agree.** `variant` and `tone` are set-level and uniform, so a root that
  says `tone: good` must carry `good` on every entry of `items` and `qe-dv-tone-good` on every
  span; a root that says `variant: tag` must carry `qe-dv-chips--tag` on itself and
  `qe-dv-chips__chip--tag` on every span. Those checks used to live on the span, keyed against
  its own duplicate copy of the chip; with the duplicate gone they key against the root, which
  is the only remaining source.
- **The shape is pinned.** `list` → `listItem` → `paragraph` → `span`, one span per item, so a
  fallback holding a bare text node where a chip belongs is rejected.

That entry `i` is spelled out by the `i`-th span — mark, then id, then label, in that order —
is asserted by the AST conformance test, because JSON Schema cannot compare two values in one
document. A consumer reads whichever of the two is in front of it and never merges them.

### Item properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string, 1–64 characters | one of `id`/`label` | Short identifier, rendered monospaced — an `inlineCode` node in the fallback. |
| `label` | string, 1–120 characters | one of `id`/`label` | Plain-text label. Chips are small, so inline markup is flattened at build time. |
| `tone` | tone | yes | The set's tone, resolved onto the chip so a consumer never has to look up. |
| `variant` | `"pill"` \| `"tag"` | yes | The set's shape, resolved the same way. |
| `mark` | string, 1–4 characters | no | The resolved mark, if the set has one. |

`additionalProperties` is `false` on the chip object, so a misspelt field is a contract
violation rather than a private extension. A chip with neither `id` nor `label` is rejected by
the schema and is a deferred error in the directive.

**The chip is a part, not a ninth primitive.** The family is capped at eight primitives, and
the chip span says so by carrying no primitive name at all: its token is `qe-dv-chips__chip`
rather than `qe-dv-chip`, which reads as "the chip part of the `chips` primitive" and not as a
primitive in its own right. Implementers write one chip renderer keyed
`span[class~=qe-dv-chips__chip]`, which styles from the tokens on the span and never reads
anything above it, and a thin container renderer keyed `div[class~=qe-dv-chips]` that only lays
the children out. The sibling primitives do not share the part today — `data-table` defines a
`chips` cell kind of its own and `delta-list` renders its identifiers as plain `inlineCode` —
so that is headroom, not a cross-primitive dependency.

**Composition of a chip span's children.** Three parts, in order, with adjacent text runs
merged into one `text` node — one to three children, never more:

| Chip | `children` |
| --- | --- |
| `id` + `label` | `[inlineCode(id), text(" — " + label)]` |
| `id` only | `[inlineCode(id)]` |
| `label` only | `[text(label)]` |

A `mark` prefixes that content: with an id it is its own leading `text` node holding the glyph
and one space (`[text("✓ "), inlineCode(id), …]`); with a label and no id it is folded into the
label's text node (`[text("✓ Writing 4.6")]`). The separator is an em dash, which `myst-to-tex`
maps to `---`, and braces in a label such as `{eq} equation references` are escaped by
`stringToLatexText`.

### Class tokens

| Token | On | Meaning |
| --- | --- | --- |
| `qe-dv` | root, chip span | Family token. |
| `qe-dv-chips` | root | Primitive token. Renderer key: `div[class~=qe-dv-chips]`. |
| `qe-dv-chips--pill` / `--tag` | root | Derived from `variant`. |
| `qe-dv-chips__chip` | chip span | The chip part. Renderer key: `span[class~=qe-dv-chips__chip]`. |
| `qe-dv-chips__chip--pill` / `--tag` | chip span | Derived from the set's resolved `variant`. |
| `qe-dv-tone-<tone>` | chip span | Derived from the set's resolved `tone`. |

The **properties are canonical**; the tokens are generated from them and must never be read as
an independent source of truth. The schema holds the two in step anyway: a node whose `variant`
is `tag` while its class says `qe-dv-chips--pill` is rejected, and so is a chip span whose
variant or tone token disagrees with the root's resolved value.

Core does no normalisation of `:class:` whatsoever — `addClassOptions` is literally
`node.class = data.options.class` — so the directive does it: split the option value on
whitespace, drop empty tokens, drop tokens already present, drop any author token that is
itself a variant token (the variant is derived from the property, never from `:class:`), append
the survivors to the three derived tokens, and join with single spaces. The schema's `class`
pattern matches exactly that output — `qe-dv`, `qe-dv-chips` and `qe-dv-chips--<variant>` first,
in that order, then author tokens none of which is a base or variant token — so a double or
trailing space, a reordered head, or a repeated base or variant token is a defect, not a
cosmetic difference. It uses the same lookahead form as the other seven schemas.

### Authoring

The data is authored either in the directive body or in a CSV named by `:file:`, and the body
form is an ordinary MyST bullet list, one item per chip. **There is no `{chip}` directive.**

That is an engine fact, not a preference. `myst-parser` collects every unprocessed directive
with a single `selectAll` in document order and runs them in one pass, so a container's `run()`
executes **before** the directives nested in its body and is handed them as raw `mystDirective`
nodes, never as their output. It is worse than the container having to parse them itself: the
nested items' `run()` still fires afterwards, against nodes the container has already replaced,
so their output is computed and silently discarded, and any diagnostic they defer is attached
to a node that is no longer in the tree. A probe plugin built against the real `myst` CLI
confirmed both halves — the container saw `["mystDirective:itm","mystDirective:itm"]`, and of
three item runs only the one outside any container survived into the built page. A bullet list
has none of that: it is ordinary markdown, it carries inline markup, and it is what the
fallback is built from anyway.

**Grammar.** The body must be a single `list` node; `ordered` is ignored. Each `listItem` is
one chip, in list order, and must hold exactly one `paragraph` of inline content. Within that
paragraph:

- if the first inline child is an `inlineCode`, its value is the chip's **`id`** and everything
  after it is the label;
- otherwise the chip has no id, and the whole paragraph is the label;
- the **`label`** is that remaining inline content flattened to plain text with one leading
  separator run stripped: whitespace, then an optional `—`, `–` or `-`, then whitespace;
- a chip needs an id or a label, and a list item that yields neither is a deferred error.

A list item holding a nested sublist, a second paragraph or any other block is a deferred
warning: the first paragraph is read and the rest is dropped. A chip object has five fields
and three of them — `tone`, `variant`, `mark` — are set-level options, so a sublist would have
nothing left to carry. Content in the body outside the single list is dropped the same way.

The clean-rules set, three of its sixteen chips in source order:

```markdown
:::{chips}
:tone: good
:mark: ✓
:class: qe-clean-rules

- `qe-admon-002` — Dropdown class for solutions
- `qe-code-002` — Unicode Greek in code
- `qe-math-013` — {eq} equation references
:::
```

The body reads almost exactly as the fallback prints, which is the point of the form. `{eq}`
stays literal text — a MyST role needs a backtick immediately after the closing brace — and
`myst-to-tex`'s `stringToLatexText` escapes the braces on the way to PDF.

Either part may be omitted, but not both. Labels only, in the compact shape the triage table's
weakest-category cells use:

```markdown
:::{chips}
:variant: tag

- Writing 4.6
- Math 5.8
:::
```

Ids only, with the labels looked up in a CSV — the form `qe-clean-rules` compiles to:

```markdown
:::{chips}
:variant: pill
:tone: good
:mark: ✓
:file: data/rule_titles.csv

- `qe-admon-002`
- `qe-code-002`
:::
```

One consequence of "the first inline child" being the rule: a label that itself begins with a
code span cannot be authored in the body — ``- `pandas` is not a rule`` is read as the id
`pandas` with the label `is not a rule`. The grammar is deterministic rather than clever on
purpose, and the escape hatch is `:file:`, whose labels are never parsed at all.

A label authored in the body is parsed as MyST inline content and then flattened to plain text,
so the typographic replacements apply: `smartquotes` is on in MyST's default parser options,
and `Write "IID"` authored inline yields the label `Write “IID”` with curly quotes. Inline
markup other than the leading id — emphasis, a link, a second code span — is flattened with a
deferred warning, because chips are small. A label read from `:file:` keeps its straight
quotes. Where the exact string matters — comparing a label against a registry, diffing two
passes — use `:file:`. Both survive PDF export: `myst-to-tex`'s replacement map carries the
curly quotes as well as the straight ones.

`chips` and `dv-chips` are the primitive's only two registered names, two of the eight family
names verified free in mystmd 1.10.1, with a test that registers each and asserts ours is the
directive that ran — core registers before any plugin and wins a name collision silently.
`chip` and `dv-chip` are registered by nobody: with the item directive gone there is no second
name to defend, and no second chance at a silent core collision.

### Directive options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `:variant:` | `pill` \| `tag` | `pill` | Chip shape for the whole set. §5.6's bordered clean-rules pill (radius 999, 1px `#d3e2d6`, 12.5px, padding 5/12) and §5.1's filled weakest-category tag (radius 5, `#f0ece2`, 11.5px/600, padding 3/8) are genuinely different chips and no renderer can tell them apart from position. |
| `:tone:` | tone | `neutral` | Tone hint for the set, resolved onto every chip. The compliance pages need at least two: clean-rules chips are `good`, triage weakest-category chips are `neutral`. |
| `:mark:` | string, 1–4 characters | — | Glyph drawn before each chip. §5.6 fixes the clean-rules anatomy as `✓` + mono id + short title; without the mark the set loses the affordance that says these rules passed. |
| `:file:` | path to a CSV | — | Label lookup, or the whole data source. `qe-clean-rules` takes rule ids and reads titles from `rule_titles.csv`. |
| `:class:` | string | — | Extra class tokens, appended after the family's own. The family convention; use it rather than wrapping the directive in a `{div}`. |

The body is the sixth part of the surface and is described above: one bullet list, one item per
chip. With `:file:` and no body, the file is the data.

That is the whole surface, and each option answers a question the compliance pages actually
ask. What stayed out: no `limit`, no `sort`, no per-chip `href`, no split label/value, no
`:columns:`, no per-chip `mark`, and — new with the family rules — no per-chip `tone`, which
had nowhere left to live once the item directive went. Three have a cheap additive path if a
consumer ever needs them: `href` on the chip object, whose fallback child becomes a `link` node
around the existing inline content; `value: number` for chips like `Writing 4.6` whose number a
consumer wants to sort or align; and a per-chip tone, which would need a body syntax to carry
it and would relax the schema's uniformity check. None breaks contract `1.0` for a consumer
already written against it.

### `:file:` CSV sources

`:file:` names a comma-separated file with a header row, read with `fs.readFileSync` (a
directive's `run()` is synchronous and is handed only `vfile.path`) and parsed with the
family's dependency-free RFC 4180 reader — quoted fields, doubled quotes, embedded commas and
newlines, CRLF, a UTF-8 BOM. The path resolves against the project root, found by walking up
from the page to `myst.yml`; `./` and `../` are the page-relative escape hatch, and a path that
escapes the root is refused.

Columns are matched **by name**, never by position, so a reordered CSV cannot silently
mis-map:

| Role | Header | Also accepted | Notes |
| --- | --- | --- | --- |
| chip `id` | `id` | `rule` | Required. The value a list item's leading code span matches against. |
| chip `label` | `label` | `title` | Optional. Without the column, every chip read from the file is id-only. |

Every other column is ignored, which is what maps `rule_titles.csv` (`rule,title,proposed` per
brief §3) onto chips with no configuration at all: `rule` → `id`, `title` → `label`, `proposed`
dropped. RFC 4180 quoting is what carries a title containing double quotes — `Write "IID"` is
one of the sixteen clean rules — through to the chip label intact.

An absent cell is spelled in the family's one vocabulary rather than in a spelling of this
primitive's own: the tokens that mean absent are exactly an empty cell, `n/a`, `na`, `-`, `—`
and `null`, matched case-insensitively after trimming — the toolchain's `DEFAULT_NULL_TOKENS`
in `src/lib/csv.mjs`. An absent label leaves the chip id-only. Reading a whole file, a row with
no id but a label is a label-only chip and a row with neither is a deferred error naming the
row. `chips` has no value slot, so no chip ever renders as `—`: an em dash in a chip line is
always the id/label separator, never a missing value.

| Body | `:file:` | Behaviour |
| --- | --- | --- |
| present | absent | Chips exactly as authored. |
| present | present | The list items select and order the rows by id; the file supplies every label. |
| absent | present | Every data row becomes a chip, in file order. |
| absent | absent | A deferred error, and an error admonition in place of the set. |

With both a body and a file, in four steps:

1. Read the file and index its rows by the id column.
2. For each list item in body order, take its leading code span as the id. A list item with no
   leading code span selects no row: that is a deferred error.
3. An id with no matching row is a deferred error, naming the id and the file.
4. The label comes from the file's label column, or the chip is id-only if that cell is absent.
   A list item that also carries label text is a deferred warning, and the file's label wins.

There is no "the body's label wins" branch, which is what keeps a primitive whose job is "a
list of names" from growing a precedence language.

Reads are cached per build on path, mtime and size, so a build reading one CSV from several
pages parses it once, and a regenerated file is a miss on the next build. Under `myst start`
that is not enough: editing a CSV triggers a rebuild, but the page is served from the engine's
mdast cache and the directive never re-runs, so the page stays stale until the page itself is
touched. Verified against a running server and filed as QuantEcon/mystmd#96. A fresh
`myst build` always reflects current data, so deploys are unaffected.

### Tone

A set is uniform in tone. `tone` on the root is the set's tone, and `tone` on every chip object
is the same value, resolved at build time so that a consumer reading a chip never falls back to
the root and a renderer keyed on the span never looks up the tree. The schema enforces the
uniformity in both directions: every entry of `items` carries the root's tone, and every chip
span carries `qe-dv-tone-<that tone>`.

Per-chip variation is not reachable in contract `1.0`. It used to be — through the item
directive's `:tone:` option — and the item directive is gone; nothing in the current design
misses it, because **no set in the design mixes tones**. The trend section looks like a
counter-example and is not: its improving and regressing rule ids are two lists, in two columns
of a `repeat(auto-fit, minmax(340px, 1fr))` grid under their own uppercase labels
(`Compliance Report Theme.dc.html:182–206`), each list uniformly `good` or `bad` — two `chips`
sets, not one mixed set. Losing the override also bought back a check: with the span no longer
carrying its own copy of the chip, the root's tone is the only thing a span's tone token can be
validated against, and a uniform set makes that validation exact.

The plugin never derives a tone from a threshold. The rubric — red ≤ 5.0 < amber < 8.6 ≤ green,
HIGH/MEDIUM/LOW/NONE — lives in the compliance wrapper, and the palette lives in the theme. A
consumer maps each tone to a surface/text pair, plus a border for pills. The report theme's
mapping, read off the canvases:

| Tone | `tag` surface / text | `pill` surface / border / text | Where the design uses it |
| --- | --- | --- | --- |
| `neutral` | `#f0ece2` / `#6b5d34` | not designed | Weakest-category chips in the triage table (`Compliance Report Theme.dc.html:98`) |
| `accent` | `#eef2f7` / `#17538f` | not designed | Rule ids in the systemic-rules list (`Series Report.dc.html:87`) |
| `good` | `#eaf3ec` / `#3e7d4f` | `#eef4ef` / `#d3e2d6` / `#2e5e3b` | Improving rule ids (`Compliance Report Theme.dc.html:187`); the clean-rules pills (`Series Report.dc.html:145`) |
| `warn` | not designed | not designed | No chip usage in the current design — reserved by the family tone vocabulary |
| `bad` | `#f8ebe8` / `#a63a2e` | not designed | Regressing rule ids (`Compliance Report Theme.dc.html:199`) |

Five of the ten `variant` × `tone` combinations the contract permits are drawn. For the other
five, take the tag surface and text for that tone and render them at the pill's geometry, with
a 1px border one step darker than the surface; `warn` has no chip palette at all and takes the
theme's amber tint pair (`#f6ecd8` / `#8a5a1a`).

§5.7's severity tags are **not** chips, despite sharing that amber pair. REVIEW §9 resolves
`qe-issues`/`qe-issue` to a core `card` with a filter upgrade; the tags' geometry differs
(10.5px/700 with `letter-spacing: 0.07em` at `Lecture Report.dc.html:88`, against the tag's
otherwise invariant 11.5px/600); and their four levels cannot survive a five-tone vocabulary,
which would collapse CRITICAL (`#f6e5e2` / `#8c2f24`) onto HIGH (`#f8ebe8` / `#a63a2e`) and LOW
(`#f2edd7` / `#6b5d34`) onto `neutral`. They are out of scope for this primitive.

Geometry, likewise from the canvases: `pill` is 12.5px with `padding: 5px 12px`, `border-radius:
999px`, a 1px border and a 7px internal gap, with the id in mono 11.5px; `tag` is 11.5px/600
with `padding: 3px 7–8px`, `border-radius: 4–5px`, no border, and
`font-variant-numeric: tabular-nums`. Two radii in the brief's token list (`pill 999 · chip
4–6`) is why there are exactly two variants and no more.

### Errors and warnings

A `fileError` raised inside a directive is logged but is **not** counted by `myst build --site
--strict`: `loadFile` clears a file's stored warnings on each load and then serves the cached
mdast without re-running directives, so a directive-stage message is wiped before the strict
check reads it (QuantEcon/mystmd#95). So `chips` never reports a problem directly. It attaches
the diagnostic to the node it emits with `defer(node, 'error' | 'warn', message, { ruleId })`,
and the family's document-stage `diagnosticsTransform` re-raises it on every pass, which is the
only place `--strict` can see it. Where a failure leaves nothing to render, the directive
returns `errorNode('chips', message)` — a visible error admonition carrying its own deferred
error — so the problem is legible on the page as well as in the build log.

| Level | Condition |
| --- | --- |
| `error` | Neither a body nor `:file:` was given. Emits an error admonition in place of the set. |
| `error` | The body holds no bullet list at all. Emits an error admonition. |
| `error` | `:file:` is missing, unreadable, malformed, or resolves outside the project root. Emits an error admonition. |
| `error` | `:file:` has no `id` or `rule` column. Emits an error admonition, naming the columns it did find. |
| `error` | With `:file:`, a list item has no leading code span, so it selects no row. |
| `error` | With `:file:`, a chip's id matches no row in the file. |
| `error` | A row read from `:file:` has an absent id cell and no label to fall back on. |
| `error` | A list item yields neither an id nor a label. |
| `error` | `:variant:` or `:tone:` is outside its closed set, or `:mark:` is longer than four characters — it is a glyph, not a label. |
| `warn` | With `:file:`, a list item carries label text as well as an id; the file's label is used. |
| `warn` | The body holds content outside the single bullet list; it is dropped. |
| `warn` | A list item holds a nested sublist or a second block; only its first paragraph is read. |
| `warn` | A label held inline markup other than the leading id; it was flattened. |
| `warn` | A label is longer than 80 characters. Chips are meant to be short. |
| `warn` | `:file:` yielded no data rows; an empty set is emitted. |

### Fallback

With no renderer for either class, a plain theme shows an ordinary bulleted list, one chip per
line, in `items` order: the mark and a space, the id as `<code>`, an em dash, then the label —
`✓ qe-admon-002 — Dropdown class for solutions`. It is the body's own bullet list, wrapped
in spans. The sixteen clean rules read as a perfectly ordinary list of rule ids with
their titles, under whatever heading and lead paragraph the page already carries. Nothing is
held in a property that is not also on the page: the mark, the id and the label are all in the
text; `tone` and `variant` are hints, and they surface as the derived class tokens on each chip
span. `myst-to-react` renders `div` and `span` transparently, so the list is a real `<ul>` and
the ids are real `<code>` elements.

In LaTeX the same tree becomes an `itemize` of `✓ \texttt{qe-admon-002} --- Dropdown class for
solutions`: `myst-to-tex` renders `div` and `span` through `renderChildren`, and the em dash has
a replacement. The one thing with no replacement is the mark itself — there is no `✓` entry in
that map, so the glyph reaches the `.tex` file verbatim, which xelatex and lualatex set and
pdflatex does not. `:mark:` is optional; a project exporting PDF through pdflatex should leave
it unset rather than have the contract quietly drop a glyph that the HTML fallback shows.

When `items` is empty the single child is a paragraph holding an emphasised `None.`, so a
section under its own heading is never blank:

```json
{ "type": "paragraph", "children": [ { "type": "emphasis", "children": [ { "type": "text", "value": "None." } ] } ] }
```

A theme that wants the wrapped chip layout without writing a renderer at all can flatten the
fallback in CSS alone, styling each chip from the tokens the spans already carry:

```css
.qe-dv-chips ul { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
.qe-dv-chips li p { margin: 0; }
.qe-dv-chips__chip--pill { border-radius: 999px; border: 1px solid; padding: 5px 12px; font-size: 12.5px; }
.qe-dv-chips__chip--tag { border-radius: 5px; padding: 3px 8px; font-size: 11.5px; font-weight: 600; }
.qe-dv-tone-good { background: #eef4ef; border-color: #d3e2d6; color: #2e5e3b; }
```

## `badges`

A row of short pill badges carrying page metadata — the pass being reported, what it is
compared against, corpus size, audit date, pinned snapshot commit. Reach for it when a page
needs a line of qualifiers under or beside its title, where each pill is a label rather than a
measurement; reach for `chips` when the pills are data points in their own right and for
`stats` when the thing being shown is a number. The primitive is deliberately small: a badge is
a label, a tone, a fill and an optional link, and nothing else.

`badges` and `chips` draw the same pill and are not the same primitive: `badges` qualifies
**the page**, `chips` enumerates a **set in the data**. Every structural difference follows
from that. A row of qualifiers is fixed and short and never empty, so `items` is `minItems: 1`
and a row with no badges is a build error; it reads as one line, so the fallback is a single
`paragraph` with the separator span carrying the gap. Each qualifier is judged on its own, so
`tone` and `emphasis` vary badge by badge. `chips` is the mirror image on all three: a set may
be empty, falls back to a `list`, and is uniform in `variant` and `tone`.

Directive `badges`, alias `dv-badges`. Both names are free in mystmd 1.10.1 and the alias is
registered from v1, so content already written against it keeps working the day a core
directive claims the plain noun — core registers first and wins silently, with no error.

### Node tree

The root is a `div`. `items` is the machine-readable record and the `paragraph` child is a
genuine plain rendering of the same badges in the same order: `items[i]` describes the *i*-th
badge span, and the two must agree exactly. The datum lives exactly twice — once as a root
property, once rendered in the children — and never a third time: the spans below carry a
`class` and nothing else. This is the landing page's header row (`Compliance Report
Theme.dc.html:67–71`), complete, and it is `valid[0]` in
[`samples/badges.json`](../../samples/badges.json).

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-badges qe-pass-badges",
  "contract": "1.0",
  "primitive": "badges",
  "items": [
    {
      "label": "Pass 2026-08",
      "tone": "neutral",
      "emphasis": "solid"
    },
    {
      "label": "vs 2026-05",
      "tone": "neutral",
      "emphasis": "outline"
    },
    {
      "label": "348 lectures · 5 series",
      "tone": "neutral",
      "emphasis": "outline"
    },
    {
      "label": "49 rules",
      "tone": "neutral",
      "emphasis": "outline"
    }
  ],
  "children": [
    {
      "type": "paragraph",
      "children": [
        {
          "type": "span",
          "class": "qe-dv-badge qe-dv-tone-neutral qe-dv-emph-solid",
          "children": [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "value": "Pass 2026-08"
                }
              ]
            }
          ]
        },
        {
          "type": "span",
          "class": "qe-dv-badge-sep",
          "children": [
            {
              "type": "text",
              "value": " · "
            }
          ]
        },
        {
          "type": "span",
          "class": "qe-dv-badge qe-dv-tone-neutral qe-dv-emph-outline",
          "children": [
            {
              "type": "text",
              "value": "vs 2026-05"
            }
          ]
        },
        {
          "type": "span",
          "class": "qe-dv-badge-sep",
          "children": [
            {
              "type": "text",
              "value": " · "
            }
          ]
        },
        {
          "type": "span",
          "class": "qe-dv-badge qe-dv-tone-neutral qe-dv-emph-outline",
          "children": [
            {
              "type": "text",
              "value": "348 lectures · 5 series"
            }
          ]
        },
        {
          "type": "span",
          "class": "qe-dv-badge-sep",
          "children": [
            {
              "type": "text",
              "value": " · "
            }
          ]
        },
        {
          "type": "span",
          "class": "qe-dv-badge qe-dv-tone-neutral qe-dv-emph-outline",
          "children": [
            {
              "type": "text",
              "value": "49 rules"
            }
          ]
        }
      ]
    }
  ]
}
```

A badge that links carries an ordinary markdown link, and the link's target is lifted onto the
item as `href` so a renderer reading `items` alone does not lose it. This is the snapshot badge
of the lecture header row, extracted from `valid[1]`. The canvas badge
(`Lecture Report.dc.html:51`) is an unlinked `span`; the link here is this contract adding the
obvious target for a pinned commit, and it is what exercises `href`:

```json
{
  "item": {
    "label": "snapshot ceec881028",
    "tone": "neutral",
    "emphasis": "outline",
    "href": "https://github.com/QuantEcon/lecture-python-programming/commit/ceec881028"
  },
  "span": {
    "type": "span",
    "class": "qe-dv-badge qe-dv-tone-neutral qe-dv-emph-outline",
    "children": [
      {
        "type": "link",
        "url": "https://github.com/QuantEcon/lecture-python-programming/commit/ceec881028",
        "children": [
          {
            "type": "text",
            "value": "snapshot ceec881028"
          }
        ]
      }
    ]
  }
}
```

### Root properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Portable node. `myst-to-tex` renders it as flow (`myst-to-tex/src/index.ts:295`) and `myst-to-typst` likewise (`myst-to-typst/src/index.ts:447`). |
| `class` | string | yes | Exactly `qe-dv qe-dv-badges`, then the normalised tokens from `:class:`. Normalisation rule below. |
| `contract` | `"1.0"` | yes | Contract revision the node was emitted against, so a theme can refuse or adapt to a node it does not implement. |
| `primitive` | `"badges"` | yes | Primitive name, so a consumer dispatches on a property rather than parsing the class string. |
| `items` | array, ≥ 1 | yes | One entry per badge, in display order. A row with no badges is a build error, never an empty node. |
| `items[].label` | string, non-empty | yes | Plain-text flattening of the badge's inline content. Definition below. |
| `items[].tone` | `neutral` \| `accent` \| `good` \| `warn` \| `bad` | yes | Colour-family hint. Always resolved by the directive, so a consumer never has to know a default. |
| `items[].emphasis` | `outline` \| `solid` | yes | Fill hint, orthogonal to tone. Always resolved, never absent. |
| `items[].href` | string, no whitespace | no | Present when, and only when, the badge's whole content is one link; equals that link's `url`. |
| `children` | array, ≥ 1 | yes | The fallback row. Revision 1.0 emits exactly one `paragraph`. |

Downstream MyST transforms add keys to every node in the tree: `keysTransform` stamps a `key` on
all of them (`myst-transforms/src/keys.ts:9`, run at `myst-cli/src/process/mdast.ts:509`), the
parser leaves `position`, and a `(target)=` on the line before the block transfers `label`,
`identifier` and `html_id` onto the root (`myst-transforms/src/targets.ts:28–36` via
`myst-common/src/utils.ts:94–116`). A validator must therefore allow unknown properties on the
root and on the spans, and [`schema/badges.json`](../../schema/badges.json) does. What it refuses
on a span is the short list of keys the directive must never emit there, given under *Fallback
children* below. Inside `items[]` nothing unknown is allowed at all: a key there is a typo and is
rejected.

**The `class` normalisation rule.** Core does no normalising whatsoever — `addClassOptions` is
literally `node.class = data.options.class` (`myst-directives/src/utils.ts:53–55`) — so the
directive must do it, or a `:class:` value with a stray space would emit a node that fails this
contract's own schema. The directive splits the `:class:` value on `/\s+/`, drops empty tokens,
drops tokens already present (`qe-dv`, `qe-dv-badges`, and any earlier duplicate), appends the
survivors in order, and joins everything with single spaces. The root `class` is therefore
always the two family tokens followed by zero or more further tokens, with no leading, trailing
or doubled space, which is exactly what the schema's pattern asserts.

**The `label` flattening rule.** `label` is a depth-first walk over *all* descendants of the
badge span, collecting the `value` of every `text` and `inlineCode` node in document order,
then collapsing whitespace runs to single spaces and trimming. The walk is recursive because a
badge's content is routinely nested: a solid badge's content sits inside a `strong`, and a
linked badge's inside a `link`. Code delimiters are not part of the value, so `` rule
`qe-admon-003` `` flattens to `rule qe-admon-003`.

**No null vocabulary.** The family's rule for a missing value — `null` in the properties, an em
dash in the fallback — has no site in this primitive, because nothing here is nullable. `label`,
`tone` and `emphasis` are always resolved, and `href` is not a datum of its own but a fact about
how the label is rendered: absent means the label is not a link, which the fallback shows by the
label not being a link, so `href` is omitted rather than set to `null`. There is no `naLabel`
option, no `"N/A"`, no em-dash placeholder and no bespoke spelling of nothing. If a later revision
needs to tell "absent" from "out of scope", it gets a second property, never a second spelling.

### Fallback children

The paragraph alternates badge spans and separator spans, opening and closing with a badge
span, so a row of *n* badges has 2*n* − 1 children.

| Node | Class | Properties | Children |
| --- | --- | --- | --- |
| badge | `qe-dv-badge qe-dv-tone-<tone> qe-dv-emph-<emphasis>` | none | inline mdast for the label; a badge whose class carries `qe-dv-emph-solid` wraps its whole content in exactly one `strong` |
| separator | `qe-dv-badge-sep` | none | one `text` node, value `" · "` |

**Inner nodes carry a class and nothing else.** Tone and emphasis reach a CSS-only theme as the
two class tokens and a renderer as `items[i].tone` and `items[i].emphasis`, so repeating them as
span properties would make one datum live three times, and a third copy is a drift surface rather
than a feature. Nothing below the root carries `contract` or `primitive` either: a
`primitive: "badge"` on a span would name a ninth primitive, one with no directive and no schema.
And no node this directive emits carries a top-level `label`, `identifier` or `html_id` —
`myst-cli/src/transforms/embed.ts:61–66` runs `selectAll('[identifier],[label],[html_id]')` over
an embedded subtree and deletes all three from every node that is not a crossReference, cite,
footnote node, captionNumber or link, so a span carrying one loses it silently, and only once the
page is embedded elsewhere. `items[].label` is untouched by that transform: it is a key inside an
array, not a property of a node.

The fallback is a paragraph and not a table, so the family's fallback-table rules — a header row
on row 0 and nowhere else, and the same number of cells in every row — have no site here.

The separator span is load-bearing rather than decorative: adjacent inline spans render with no
gap, so without it `27 lecturesaudited 2026-08-21` is what a plain theme shows. A theme that
upgrades badges individually hides `.qe-dv-badge-sep`; a theme that renders the whole row from
`items` ignores the children entirely.

Class tokens in full: `qe-dv` · `qe-dv-badges` (root) · `qe-dv-badge` ·
`qe-dv-tone-neutral|accent|good|warn|bad` · `qe-dv-emph-outline|solid` · `qe-dv-badge-sep`.
Renderer keys are `div[class~=qe-dv-badges]` for the row and `span[class~=qe-dv-badge]` for a
per-badge upgrade. Note that `myst-to-html` registers no `div` or `span` handler
(`myst-to-html/src/schema.ts:187`), so class hooks are reliable on the `myst-to-react` path the
themes use and are not guaranteed in a direct HTML export.

**What the schema checks and what a test must check.** The schema pins each span's class to the
`qe-dv-badge qe-dv-tone-<tone> qe-dv-emph-<emphasis>` shape, requires a span whose class carries
`qe-dv-emph-solid` to hold exactly one `strong`, and rejects a span carrying any of `tone`,
`emphasis`, `contract`, `primitive`, `item`, `items`, `label`, `identifier` or `html_id`. What
it cannot do is relate two sibling arrays, or constrain a child by its position, and both of
those carry real invariants. The test suite therefore has to enforce the rest, and a node that
satisfies this schema is not yet conformant. First the count: `items.length` equals the number of
badge spans. Then `items[i]` and the *i*-th badge span must agree on every field. `items[i].label`
equals that span's flattened text; `items[i].tone` and `items[i].emphasis` equal the tone and
emphasis tokens in that span's class; and `items[i].href` is present exactly when that span's
whole content is
one `link`, with the same `url` — both directions, so a linked span with no `href` on the item
fails too. The row's shape is the other half: the paragraph's children alternate strictly, a
badge span at every even index and a separator at every odd one, giving 2*n* − 1 children for
*n* badges, so the row opens and closes with a badge and never carries two separators in a row.

The positional half is not expressible here rather than merely omitted. Ajv's strict mode,
which `scripts/validate-contract.mjs` runs, accepts a `prefixItems` tuple only when it is
closed — `minItems` *and* a matching `maxItems` or `items: false`, all three together; a tuple
with an open tail is rejected at compile time whatever else accompanies it, which is exactly
the shape "the row opens with a badge span, then anything" needs. The schema instead requires
every child to be one of the two span shapes and at least one of them to be a badge, and leaves
ordering to the test.

### Directive options

The surface is capped at what the compliance pages need (PLAN.md:201, REVIEW.md:354), which is
four things: a leading badge, a wrapper class, a row tone and a data file.

| Option | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| *argument* | myst (inline) | no | — | The leading badge, emitted with `emphasis: "solid"`. Giving it the argument slot keeps the common case option-free. |
| `:class:` | string | no | — | Extra tokens, normalised and appended after `qe-dv qe-dv-badges`. This is how a wrapper marks its variant (`qe-pass-badges`) so a theme can upgrade one row differently from another. |
| `:tone:` | `neutral` \| `accent` \| `good` \| `warn` \| `bad` | no | `neutral` | Tone for every badge in the row, including the leading one. Row-level only. |
| `:file:` | string | no | — | Path to a CSV supplying the badges, resolved from the project root. Cannot be combined with a body list; may be combined with the argument, which then leads the row. |

Deliberately absent: `:label:`, a per-badge `href` option, `:sep:`, `:align:`, and any item
directive. There is no per-badge directive to register: the family registers one directive name
per primitive plus its `dv-` alias fallback, and item directives are not merely unfashionable but
unbuildable. `applyDirectives` collects every unprocessed directive with one `selectAll` and runs
them in document order, outer before inner (`myst-parser/src/directives.ts:51–52`, the result
applied at `:149`), so a container's `run()` is handed its items as *unprocessed* `mystDirective`
nodes and would have to re-read raw, unvalidated attributes; worse, the items' own `run()` still
fires afterwards, against nodes the container has already replaced, so their output is computed
and silently discarded and any diagnostic they defer hangs off a node no longer in the tree. A
bullet-list body avoids all of that and follows core's own precedent — `{list-table}` reads
exactly such a body, and rejects one that is not a single `list` node in its own `validate`
(`myst-directives/src/table.ts:100–101`). `:label:` is absent for a different reason: registering
it would put `label` and `identifier` on the root, which is exactly what `{embed}` strips.

Both `:tone:` and `:file:` were held to the second-consumer rule, and both survive it for
reasons worth writing down rather than assuming. Every badge in the four canvases is `neutral`,
so `:tone:` has no in-house consumer today; it stays because `items[].tone` is a *required*
property and a hand-authored page must be able to resolve it without a JavaScript wrapper — a
contract that forces every author through `compliance.mjs` to set a required field is not a
contract. `:file:` likewise has no in-house consumer for this primitive — `qe-pass-badges`
composes its labels from `snapshot.json` and `series_summary.csv` and emits the node directly —
and stays because PLAN.md:88 mandates inline and CSV sources for all eight directives, and
because a consumer outside QuantEcon with a generated metadata file is precisely the audience
the family is for. Per-badge tone and emphasis are reachable from both of those paths and from
a wrapper; there is no directive option for them, because no page needs one. **The node
contract is deliberately richer than the authoring directive.**

### Authoring

The argument is the leading badge and the only one rendered solid; the body is an ordinary MyST
bullet list, one badge per item. The landing page's row:

```markdown
:::{badges} Pass 2026-08
:class: qe-pass-badges
- vs 2026-05
- 348 lectures · 5 series
- 49 rules
:::
```

A row with no leading badge — the series and lecture headers have none — simply omits the
argument:

```markdown
:::{badges}
- 27 lectures
- audited 2026-08-21
- snapshot ceec881028
- judgment review: all lectures
:::
```

List items keep their inline markup, which is how a badge links or shows a monospace id without
an option for either. A whole-label link becomes the item's `href`:

```markdown
:::{badges}
- lectures/python_by_example.md
- audited 2026-08-26
- [snapshot ceec881028](https://github.com/QuantEcon/lecture-python-programming/commit/ceec881028)
- rule `qe-admon-003`
:::
```

The body grammar is exact, and the parser enforces every clause of it.

- **The body is a single `list` node and nothing else** — no paragraph before it, no trailing text
  after it. `ordered` is ignored, so a numbered list authors the same badges in the same order.
- **Every child of that list is a `listItem` holding exactly one `paragraph`**, and that paragraph
  holds inline content only.
- **One list item is one badge.** The paragraph's inline children become the badge span's
  children, and their flattening becomes `items[].label`.
- **A nested sublist maps onto nothing, and so does a second block.** A badge is a label, a tone,
  a fill and an optional link, and the body supplies only the label, so a sublist, a second
  paragraph or a code block inside an item has no field to land in. Both are the body error
  rather than a silent drop — reach for `bar-list` or `stats` when an item needs a description or
  a number beside its label.
- **A label must not be empty** once flattened.
- **A label may contain at most one `link`, covering the whole label.** That is what keeps
  `label` plus `href` a complete description of a badge — a link covering half a label would put
  a field in the children that no property records, which is the one thing this contract exists
  to prevent.

Badge order is the argument first, then list items in source order.

### `:file:` CSV sources

`:file:` names an RFC-4180 CSV resolved against the project root — the directory holding
`myst.yml`, found by walking up from `vfile.path` — or against the page itself when the path
starts with `./` or `../`. It is read synchronously through the family's file cache, keyed on
path, modification time and size.

A cell counts as absent when it holds one of the family's null tokens — `''`, `n/a`, `na`, `-`,
`—` or `null`, matched case-insensitively after trimming, the `DEFAULT_NULL_TOKENS` set in
`src/lib/csv.mjs` — and not merely when it is empty, so a `-` in the `href` column means "no
link" rather than a relative URL called `-`.

| Column | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `label` | yes | `items[].label`, and the badge span's single `text` child | Literal text, never parsed as markdown, so a `·`, `*` or `_` in a cell stays a character. A null token here is an empty label, which is an error rather than a blank badge. |
| `tone` | no | `items[].tone` | One of the five tones; an absent cell falls back to the row's `:tone:`. |
| `emphasis` | no | `items[].emphasis` | `outline` or `solid`; an absent cell means `outline`. |
| `href` | no | `items[].href`, and a `link` wrapping the badge span's content | An absent cell leaves the badge unlinked, and `href` is then omitted from the item rather than set to `null`. |

Row order is badge order. Unknown columns are ignored without a message, because these CSVs are
shared artefacts generated for several tools. The landing row as a CSV:

```
label,tone,emphasis,href
Pass 2026-08,neutral,solid,
vs 2026-05,neutral,outline,
348 lectures · 5 series,neutral,outline,
49 rules,neutral,outline,
```

One caveat on freshness: a fresh `myst build` always reflects the current data, but `myst
start` serves a page from its own mdast cache, keyed on the page's content hash, so editing
only the CSV does not re-run the directive. Touch the page. The gap is QuantEcon/mystmd#96.

### Errors and warnings

A `fileError` raised inside a directive is logged but is **not** counted by `myst build --site
--strict`: `loadFile` clears a file's stored warnings on each load and then serves the cached
mdast without re-running directives, so a directive-stage message is wiped before the strict
check harvests it (QuantEcon/mystmd#95). Every condition below is therefore reported with
`errorNode(primitive, message)` from `src/lib/report.mjs`, which returns a visible error
admonition carrying its own deferred diagnostic, and the family's document-stage
`diagnosticsTransform` re-raises it on every pass so `--strict` exits non-zero. The `ruleId` is
`qe-datavis-badges`, so a project can suppress the family through `error_rules`.

| Condition | Message |
| --- | --- |
| No argument, no body items and no CSV rows | `badges: no badges to render` |
| Body is not a single list, or an item is not exactly one paragraph of inline content — a nested sublist, a second block, a stray paragraph beside the list | `badges: body must be a bullet list, one badge per item` |
| `:file:` and a body list both given | `badges: :file: and a body list cannot be combined` |
| Unknown `:tone:` value, or an unknown `tone` cell | `badges: unknown tone "<value>"` |
| Unknown `emphasis` cell | `badges: unknown emphasis "<value>"` |
| A label whose link covers only part of it, or which holds more than one link | `badges: a badge label may hold at most one link, covering the whole label` |
| Empty label, from the argument, a list item, or a `label` cell holding a null token | `badges: empty badge label` |
| CSV missing or unreadable | `badges: cannot read <path>` |
| CSV has no `label` column | `badges: <path> has no "label" column` |

### Tone

Tone attaches per badge, in two places that must agree: `items[i].tone`, and the
`qe-dv-tone-<tone>` token in the *i*-th badge span's class. The span does not repeat it as a
property — one datum, two renderings, and no third copy. Nothing carries a tone at the root:
the row's `:tone:` is resolved into every item at build time, so a consumer never has to know a
default or walk up for an inherited value.

A consumer maps a tone to a colour family and does nothing else with it. The plugin encodes no
threshold: it does not know that a Writing score of 4.1 is bad, only that the wrapper asked for
`bad`. That is what keeps the rubric in `compliance.mjs` and out of both the generic plugin and
the theme. Tone is the one property with no plain-text expression in the fallback, and
deliberately so: a tone names a colour family, and plain text has no colour. It travels into
the fallback as the span's class token, which is the most a renderer-free rendering can
carry.

Emphasis is a separate axis, and unlike tone it *is* visible with no renderer, because a solid
badge's content is wrapped in a `strong`. It selects the fill within whichever colour family
the tone names: `outline` is the bordered metadata pill (mono 12px, `#6a7180` on the page
ground, 1px `#ddd8cc`, radius 999) and `solid` is the filled pill, `#f2f0eb` on `#14243c` for
neutral — colours written throughout as *foreground* on *background*. The report theme
therefore needs one ramp per tone with two fills, ten combinations in all, of which the
compliance pages use one.

Every badge in the four canvases is neutral, and the landing row's `Pass 2026-08` (`Compliance
Report Theme.dc.html:68`) is the only filled badge in any of them. The five-tone vocabulary is
carried anyway because it is the family's fixed convention and because the schema must validate
a wrapper that reaches for `good` or `bad` later. A third, tinted fill does exist in the design
language — the lecture header's `HIGH PRIORITY` label, `#8c2f24` on `#f6e5e2` (`Lecture
Report.dc.html:46`) — but it is not part of this primitive: that label sits beside the `h1` at
radius 6, not in the pill row, and stays a classed `span` in `compliance.mjs` until a second
consumer justifies a `soft` emphasis value.

### Fallback

With no custom renderer a plain theme renders the root as a `<div>` and the paragraph inside
it, so the row reads as one line of metadata:

> **Pass 2026-08** · vs 2026-05 · 348 lectures · 5 series · 49 rules

The leading badge survives as bold, the rest as plain text, and a linked badge stays a working
link. Nothing is hidden in properties: every label a reader needs is in the children, and every
field the children render is in `items`.

The LaTeX path carries the same content: `myst-to-tex` has handlers for `div`
(`myst-to-tex/src/index.ts:295`), `span` (`:299`), `strong` (`:308`), `inlineCode` (`:317`) and
`link` (`:368`), so the row renders as flow with its inline markup intact. `myst-to-typst` has
`div` and `span` handlers too (`myst-to-typst/src/index.ts:447` and `:450`). One claim narrowed
to what was actually verified: `·` (U+00B7) appears nowhere in `myst-to-tex/src`, so the
converter passes it through unchanged as UTF-8 — whether the resulting `.tex` compiles depends
on the template's input and font encoding (T1 plus `textcomp`, or `fontspec`, rather than OT1),
which has not been tested end to end. `|` is likewise unmapped and renders as an em dash under
OT1, which is why the separator is a middle dot and not a pipe.

Two caveats worth stating for authors. The separator is the same middle dot the house style
uses *inside* labels, so `348 lectures · 5 series` is indistinguishable from two badges in the
plain rendering; split such a label into two badges if that matters. And a badge whose label
uses `inlineCode` gains almost nothing visually, since the whole pill row is already mono 12px
in the design — the backticks are worth it only where the monospace marks an identifier a
reader will copy.

## `delta-list`

A signed change list: named items whose measured value moved between two comparable periods,
grouped under labels the producer chooses. Its canonical form is the two-column
improving/regressing block on the compliance landing page, so a reader sees at a glance which
rules got better and which got worse. Reach for it when the story is *movement between two
snapshots of one measure*; reach for `bar-list` when the story is the magnitude of a single
snapshot.

**Directive** `{delta-list}` — one registered name, plus the documented alias `{dv-delta-list}`
in case a future core directive claims the plain one. There are no item directives: the data is
either a MyST bullet list in the body or a CSV named by `:file:`. Both names are free in mystmd
1.10.1, and the test suite re-checks them against the engine on every run. **Emits** a `div` —
no custom node type, no `grid` and no `card`, because `myst-to-tex` has no handler for those and
drops the whole subtree from a LaTeX export while the build still exits 0.

### Node tree

The example below is the compliance landing page's block in full, and it is the same object as
`samples/delta-list.json` `valid[0]` and as the shape `schema/delta-list.json` validates.
Nothing is elided: eight items in the data means eight list items in the fallback.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-delta-list",
  "contract": "1.0",
  "primitive": "delta-list",
  "unit": "%",
  "precision": 0,
  "groups": [
    {
      "label": "Largest improvements",
      "tone": "good",
      "items": [
        {
          "label": "qe-writing-008",
          "from": 78,
          "to": 68,
          "description": "Remove excessive whitespace between words",
          "tone": "good"
        },
        {
          "label": "qe-writing-006",
          "from": 47,
          "to": 38,
          "description": "Capitalise lecture titles properly",
          "tone": "good"
        },
        {
          "label": "qe-fig-008",
          "from": 62,
          "to": 56,
          "description": "Figure-directive option conventions",
          "tone": "good"
        },
        {
          "label": "qe-writing-001",
          "from": 55,
          "to": 50,
          "description": "Use one sentence per paragraph",
          "tone": "good"
        }
      ]
    },
    {
      "label": "All regressions",
      "tone": "bad",
      "items": [
        {
          "label": "qe-fig-004",
          "from": 9,
          "to": 17,
          "description": "Caption formatting conventions",
          "tone": "bad"
        },
        {
          "label": "qe-fig-001",
          "from": 62,
          "to": 64,
          "description": "Do not set figure size unless necessary",
          "tone": "bad"
        },
        {
          "label": "qe-fig-003",
          "from": 46,
          "to": 47,
          "description": "No matplotlib embedded titles",
          "tone": "bad"
        },
        {
          "label": "qe-code-002",
          "from": 18,
          "to": 19,
          "description": "Use unicode Greek letters in code",
          "tone": "bad"
        }
      ]
    }
  ],
  "children": [
    {
      "type": "div",
      "class": "qe-dv-delta-group",
      "children": [
        {
          "type": "paragraph",
          "children": [
            {
              "type": "span",
              "class": "qe-dv-delta-group-label",
              "children": [
                {
                  "type": "strong",
                  "children": [
                    {
                      "type": "text",
                      "value": "Largest improvements"
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "list",
          "ordered": false,
          "spread": false,
          "children": [
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-writing-008"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "Remove excessive whitespace between words"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "78% to 68%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-writing-006"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "Capitalise lecture titles properly"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "47% to 38%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-fig-008"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "Figure-directive option conventions"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "62% to 56%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-writing-001"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "Use one sentence per paragraph"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "55% to 50%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "div",
      "class": "qe-dv-delta-group",
      "children": [
        {
          "type": "paragraph",
          "children": [
            {
              "type": "span",
              "class": "qe-dv-delta-group-label",
              "children": [
                {
                  "type": "strong",
                  "children": [
                    {
                      "type": "text",
                      "value": "All regressions"
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "list",
          "ordered": false,
          "spread": false,
          "children": [
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-fig-004"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "Caption formatting conventions"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "9% to 17%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-fig-001"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "Do not set figure size unless necessary"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "62% to 64%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-fig-003"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "No matplotlib embedded titles"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "46% to 47%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "spread": true,
              "children": [
                {
                  "type": "paragraph",
                  "children": [
                    {
                      "type": "span",
                      "class": "qe-dv-delta-id",
                      "children": [
                        {
                          "type": "inlineCode",
                          "value": "qe-code-002"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-desc",
                      "children": [
                        {
                          "type": "text",
                          "value": "Use unicode Greek letters in code"
                        }
                      ]
                    },
                    {
                      "type": "text",
                      "value": " — "
                    },
                    {
                      "type": "span",
                      "class": "qe-dv-delta-value",
                      "children": [
                        {
                          "type": "strong",
                          "children": [
                            {
                              "type": "text",
                              "value": "18% to 19%"
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Six structural rules make the properties and the children one object rather than two:

1. `groups.length === children.length`, and `groups[i]` describes `children[i]`. The schema
   enforces this: `groups` and `children` are both bounded at four entries, so the equality is
   four `if`/`then` branches rather than a comment.
2. `groups[i].items.length` equals the number of `listItem`s in `children[i].children[1]`, and
   `items[j]` describes the `j`-th of them. Not expressible in JSON Schema; the plugin's
   conformance test asserts it against the emitted AST.
3. Every field of an item except `tone` appears in the matching list item: `label` as the
   `inlineCode` value, `description` as the content of `span.qe-dv-delta-desc`, `from` and `to`
   inside `span.qe-dv-delta-value`. Nothing is reachable only by scraping the children, and
   nothing but `tone` is reachable only from the properties.
4. The value text is `format(from) + " to " + format(to)`, where `format(n)` is
   `n.toFixed(precision) + unit`. There is no special case when `from === to`: it reads
   "50% to 50%". The signed change is `to − from`, derived by the consumer and deliberately
   absent from the node so the two can never drift.
5. The data lives exactly twice — once in the properties, once rendered in the children — and
   only the root is self-describing. `contract` and `primitive` sit on the root and nowhere
   else; every inner node carries a `class` and nothing more, never a second copy of the item it
   renders. The schema enforces it: each fallback node `$ref`s `dumbInnerNode`, which sets
   `contract`, `primitive`, `groups` and `item` to `false`.
6. No node carries a top-level `label`, `identifier` or `html_id`.
   `myst-cli/src/transforms/embed.ts` runs `selectAll('[identifier],[label],[html_id]')` over an
   embedded subtree and deletes all three from every node whose type is not `crossReference`,
   `cite`, `footnoteDefinition`, `footnoteReference`, `captionNumber` or `link` — so a `div` or
   `span` carrying one loses it silently, and only once the page is embedded elsewhere.
   `groups[].label` and `items[].label` are properties *inside* an array of plain objects, not
   properties of a node, and the selector never reaches them.

The only property with two representations is `description`: a plain string, which is what a
`:file:` source always yields and what a one-text-node bullet yields, or an array of inline MyST
nodes when the bullet carried markup. A string is mirrored as the single `text` child of the
description span; an array *is* that span's children. Those nodes come from a closed set —
`text`, `strong`, `emphasis`, `inlineCode` and `link`, at any depth — and the schema enforces it
rather than describing it: `myst-to-tex` has a handler for each of the five, and a node of any
other type would be dropped from the `.tex` export with the build still exiting 0. A description
that parses to anything outside the set is a deferred error.

Every `qe-dv-*` token in this contract sits on a `div` or a `span`. Those are the node types
whose `class` `myst-to-react` passes through to the DOM — its `paragraph`, `list`, `listItem`
and `strong` renderers drop `node.class` on the floor, so a token placed there would be
invisible to CSS while still matching an AST selector, which fails quietly. That is why the
group label and the value sit inside spans rather than carrying a class on their `strong`, and
why the items list carries no token at all: reach it as `.qe-dv-delta-group ul` in CSS, or as
`div[class~=qe-dv-delta-group] > list` from an AST selector. A CSS-only theme can therefore
style every part of the block. What it cannot see is `tone`, which is a property and never
reaches the DOM; tone-driven colour needs a renderer that reads `groups[].tone` and
`groups[].items[].tone`.

### Root properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Portable node type; `myst-to-tex` and `myst-to-typst` both handle it |
| `class` | string | yes | `qe-dv qe-dv-delta-list` first, in that order, then any author tokens. Match with `div[class~=qe-dv-delta-list]`, never on equality |
| `contract` | `"1.0"` | yes | Revision of the `qe-dv` node contract. A consumer that does not know the version renders the children and ignores the properties |
| `primitive` | `"delta-list"` | yes | Dispatch key, so a consumer need not parse the class string. The root is the only node that carries it |
| `unit` | string, ≤ 12 chars | no | Suffix appended with no separating space; default `""`. Include a leading space yourself if the unit needs one (`" pp"`). The compliance trend uses `"%"` |
| `precision` | integer 0–3 | no | Decimal places the emitter used, as `toFixed(precision)`; default `0`. A renderer re-formatting the raw numbers must use the same value |
| `groups` | array, 1–4 | yes | The groups, in display order. Two is the canonical shape |
| `groups[].label` | string, non-empty | yes | Group heading, plain text — no `▲`/`▼`, no count, no colon. Reproduced verbatim in the group's label span |
| `groups[].tone` | tone | yes | `neutral` \| `accent` \| `good` \| `warn` \| `bad`. Always present: the directive resolves its `:tone:` default (itself `neutral`) onto every group |
| `groups[].items` | array, ≥ 1 | yes | Rows in the producer's order; the plugin never sorts and never truncates |
| `items[].label` | string, non-empty | yes | The item's identifier, e.g. `qe-writing-008`. Rendered as an `inlineCode` chip, so keep it short and identifier-like |
| `items[].from` | number | yes | Value in the earlier period. A number, never null: 1.0 has no representation for an item that did not exist then, so producers exclude non-comparable items |
| `items[].to` | number | yes | Value in the later period, on the same terms |
| `items[].description` | string, or array of inline nodes | no | What the item is, in words. Equals the content of the matching `span.qe-dv-delta-desc`. Absent means the row renders as identifier plus value — there is no placeholder |
| `items[].tone` | tone | yes | Always present: the item's own tone, or its group's, resolved at build time so no consumer implements inheritance |
| `children` | array, 1–4 | yes | The fallback: one `div.qe-dv-delta-group` per group, same order, same length |

Class tokens: `qe-dv` and `qe-dv-delta-list` on the root, `qe-dv-delta-group` on each group div,
`qe-dv-delta-group-label` on its heading span, and `qe-dv-delta-id`, `qe-dv-delta-desc` and
`qe-dv-delta-value` on the three parts of a row. Those seven are the whole published set, and a
`class` is the whole of what an inner node carries. There are no internal or transient tokens,
because there are no transient nodes: one directive builds the whole tree in one `run()`.

### Directive options

The surface is capped at what the compliance pages actually need. `:unit:` and `:precision:`
write the two root properties of the same names; the compliance data is whole percentages and
sets `precision` at its default. Neither is family-wide — the family has not settled one
spelling for how a number is printed, and carries four: `display` per item (`stats`),
`precision` on the root (`heatmap`, here), `decimals` per column (`data-table`), and nothing at
all where the fallback text is the only record (`bar-list`, `stacked-bar`). `unit` is shared
with `stacked-bar` alone.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| argument | string | none | Label for the single implicit group formed when the body's bullets are items rather than groups, or when a `:file:` source has no `group` column. Required in exactly those two cases; ignored, with a deferred warning, when the body carries groups |
| `:file:` | path | none | A wide CSV source, resolved against the project root. Mutually exclusive with a body: giving both, or neither, is a deferred error |
| `:unit:` | string | `""` | Becomes `unit` |
| `:precision:` | integer 0–3 | `0` | Becomes `precision`. Non-integer or out of range is a deferred error |
| `:tone:` | tone | `neutral` | The container default. Fills every group that names no tone of its own, and through the group every item that names none. A value outside the closed set is a deferred error |
| `:class:` | string | `""` | Author tokens appended to the family tokens, after normalisation (below) |

There is no `:limit:` and no `:sort:`. Ordering and truncation belong to whoever produces the
data — the compliance wrapper already does both — and adding them here is the first step into a
charting DSL. There is no `:na-label:` either, and no `N/A` anywhere in this contract: an item
whose value is missing in one of the two periods is not a delta, so the producer leaves it out.

`:class:` is normalised by the directive, not by core. Core's `addClassOptions` is literally
`node.class = data.options.class`, with no merging at all, so letting it run would wipe the
family tokens. The directive instead splits the option value on `/\s+/`, drops empty tokens,
drops tokens already present, appends the survivors to `qe-dv qe-dv-delta-list` and joins the
result with single spaces. That is exactly what the schema's `class` pattern matches.

**How problems are reported.** A `fileError` raised inside a directive is logged but not
counted by `myst build --site --strict`, so a broken directive exits 0 (QuantEcon/mystmd#95).
Every diagnostic in this contract therefore goes through the family's toolchain instead. A
recoverable problem is attached to the emitted node with
`defer(node, 'error' | 'warn', message, { ruleId })`; a problem that leaves nothing sensible to
emit returns `errorNode('delta-list', message)`, a visible error admonition carrying its own
diagnostic.
The document-stage `diagnosticsTransform` re-raises both, which is what makes `--strict` count
them and the build fail loudly.

### Authoring

The body is one MyST bullet list and nothing else. There are no `{delta}` or `{delta-group}`
item directives, and the reason is mechanical rather than stylistic. `myst-parser` collects
every unprocessed directive in a single pass — `selectAll('mystDirective[processed=false]',
tree)` in `packages/myst-parser/src/directives.ts`, document order, outer before inner — and
runs them in one `forEach`. A container's `run()` therefore fires *before* the directives nested
in its body and receives them as raw `mystDirective` nodes, never as their output. Worse, those
nested `run()`s still fire afterwards, against nodes the container has already replaced: their
output is computed and silently discarded, and any diagnostic they defer is attached to a node
no longer in the tree. `myst-ext-grid` survives the same ordering only because it re-parents
`data.body` untouched and never reads a card's output.

Ordinary markdown has no such problem. With `body: { type: 'myst' }`, `contentFromNode` hands
`run()` the *parsed* children of the body (`packages/myst-parser/src/utils.ts`), so a bullet-list
body arrives as one fully expanded `list` node with the inline markup of every bullet already
parsed — code spans, links and emphasis included, which is what makes a description worth
having.

**The grammar.** The body must be a single `list` node (`ordered` is ignored; the emitted
fallback list is always unordered). Every top-level `listItem` is either a **group** — a
paragraph naming it, followed by a nested list of its items — or an **item**, and they must all
be the same kind. Mixing the two in one body is a deferred error, and so is a body that is not a
list, a second list, or a stray paragraph beside the list.

An item bullet is one paragraph in three fields, the third optional, plus an optional tone
marker:

```text
- `<identifier>`: <from> to <to> — <description>
```

- **Identifier** — the bullet's first inline child, and it must be an `inlineCode` span. It
  becomes `items[].label` and is reproduced verbatim as the `inlineCode` value of the matching
  row. A bullet that does not open with a code span is a deferred error naming the bullet.
- **Values** — a colon, then two numbers separated by the word `to`, matched as
  `/^\s*:\s*(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s*/` against the text node that follows
  the code span; they become `from` and `to`. Core's `text_join` rule means the run between two
  markup spans arrives as one `text` node, so there is always exactly one node to match. Both
  are required and neither may be a null token: a value that exists in one period only is not a
  delta. The word `to` rather than `→` is the same choice the emitted text makes, for the same
  reason — see *Fallback*.
- **Description** — optional: everything after the first separator, which is ` — ` or ` -- `.
  Both spellings are accepted because myst-parser converts neither into the other. Its
  markdown-it core rule list is `['normalize', 'block', 'inline', 'linkify', 'text_join']`
  (`packages/myst-parser/src/config.ts`) and only `smartquotes` is enabled on top of it
  (`packages/myst-parser/src/myst.ts`), so the `replacements` rule never runs and `---` stays
  three hyphens. Splitting on the *first* separator rather than the last is what lets a
  description contain em dashes of its own. The description keeps its inline markup: one text
  node is stored as the string form of `items[].description`, anything richer as the array of
  inline nodes, and `span.qe-dv-delta-desc` mirrors whichever it is.
- **Tone** — optional, written `(tone: <tone>)` at the very end of the bullet and stripped
  before the description is taken. Parentheses rather than braces: a role is `{name}`
  *immediately followed by backticks* (`packages/markdown-it-myst/src/roles.ts`), so a bare
  `{good}` is literal text today — but a contract that depends on a construct staying
  meaningless is one engine release from breaking, and `(tone: good)` can never be anything but
  text.

A group bullet is a paragraph naming the group, optionally carrying the same tone marker,
followed by exactly one nested list whose bullets are items. The paragraph's plain text, marker
removed and trimmed, becomes `groups[].label`; markup there is flattened to its text content
with a deferred warning, because the property is a string. An empty label, a group bullet with
no sublist, one with two sublists, and one with a second paragraph are all deferred errors.

The source below is the third rendering of the one dataset: it emits exactly the node in *Node
tree*, so nothing is abbreviated here either — a group labelled "All regressions" showing fewer
rows than the group holds would be the same lie in the source that it would be in the fallback.

```markdown
:::{delta-list}
:unit: %
:precision: 0

- Largest improvements (tone: good)
  - `qe-writing-008`: 78 to 68 — Remove excessive whitespace between words
  - `qe-writing-006`: 47 to 38 — Capitalise lecture titles properly
  - `qe-fig-008`: 62 to 56 — Figure-directive option conventions
  - `qe-writing-001`: 55 to 50 — Use one sentence per paragraph
- All regressions (tone: bad)
  - `qe-fig-004`: 9 to 17 — Caption formatting conventions
  - `qe-fig-001`: 62 to 64 — Do not set figure size unless necessary
  - `qe-fig-003`: 46 to 47 — No matplotlib embedded titles
  - `qe-code-002`: 18 to 19 — Use unicode Greek letters in code
:::
```

For a single group, drop the group level: the bullets are items, the container's argument
carries the group label, and `:tone:` gives that implicit group its tone. This is `samples/delta-list.json` `valid[1]`, less the `qe-trend` class
token its wrapper appends. The first item shows a description carrying inline markup, which is
stored as the array form; the second omits its description to show the row that renders as
identifier plus value. Neither group nor container names a tone, so the group resolves to
`neutral` while both items keep the `good` they were given.

```markdown
:::{delta-list} Like for like, evidence layer alone
:precision: 1

- `overall`: 8.2 to 8.4 — Mean of in-scope categories, measured from `history_mechanical.csv` (tone: good)
- `writing`: 6.6 to 7.1 (tone: good)
:::
```

Three colons are enough for both, because nothing nests: the body is markdown, not directives.

### `:file:` CSV sources

`:file:` takes a **wide, already-shaped** CSV — one row per item — with a required header row
matched case-insensitively. Column order does not matter; unknown columns are ignored with a
deferred warning.

| Column | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `label` | yes | `items[].label` | Non-empty; becomes the `inlineCode` chip |
| `from` | yes | `items[].from` | Parsed as a number; anything else, a null token included, is a deferred error |
| `to` | yes | `items[].to` | Parsed as a number, on the same terms |
| `description` | no | `items[].description` | Always the string form — a bundled plugin has no MyST parser. A null-token cell drops both the property and the span |
| `group` | no | `groups[].label` | Rows sharing a value form one group, ordered by first appearance |
| `tone` | no | `items[].tone`, and `groups[].tone` when a group's rows agree | A null-token cell means the row names none and takes its group's; any other value outside the closed set is a deferred error |

Absent is spelled once for the whole family, and this primitive does not add a spelling. The
tokens that mean absent in a cell are the toolchain's `DEFAULT_NULL_TOKENS` in
`src/lib/csv.mjs` — `''`, `n/a`, `na`, `-`, `—`, `null`, trimmed and matched
case-insensitively. In `description`, `group` and `tone` such a cell means the column was not
filled in for that row. In `from` or `to` it is a deferred error, because `delta-list` has no
null value: an item that exists in only one of the two periods has no delta to show, so the
producer excludes it rather than spelling the gap. The em dashes in the fallback are field
separators, never a rendered null.

Rows are used in file order: the plugin never sorts and never truncates, so the producer
decides which items appear and in what order. If any row carries a non-empty `group`, every row
must; if there is no `group` column the container's argument supplies the single group's label
and is required. A group's tone is the common tone of its rows when they agree, and otherwise
the container's `:tone:` default with each row keeping its own — which is how a
compliance-shaped CSV with `tone=good` on every improving row reproduces the canvas. A row with
no tone token takes its group's, so every emitted item carries one either way. A missing or
unreadable file, a missing required column, or a file with zero data rows returns an
`errorNode`.

The path resolves the way every `:file:` in this family resolves (`src/lib/project.mjs`):
project-relative by default, walking up from the page to the nearest `myst.yml`, so the same
`:file: data/rules.csv` works from a page at any depth; a path beginning `./` or `../` is
page-relative instead. An absolute path, and a path resolving outside the project root, are
both errors.

The compliance wrapper does **not** go through this path. `rule_reach_history.csv` is long
format (`period,corpus_size,rule,lectures_affected,total_occurrences,share_pct`): choosing two
periods, pivoting on `rule`, joining `rule_titles.csv` for the description, deciding that a
falling share is an improvement, and taking the largest four are all rubric work. `{qe-trend}`
does that in `compliance.mjs` and emits this node directly, appending `qe-trend` to the class
string as it goes — and resolving tone onto every group and item exactly as the directive does,
because the node contract is the same node contract.

### Tone

Tone attaches in exactly two places: `groups[].tone` and `groups[].items[].tone`. Both are
always present on an emitted node, because resolution happens once, at build time, in one
direction: the container's `:tone:` (default `neutral`) fills any group that names none, and a
group's tone fills any of its items that name none. A consumer therefore paints the node in
front of it and never implements inheritance — the same rule the rest of the family follows, so
a renderer written for one primitive's tones is written for all of them.

No tone is ever derived from the numbers: a falling share of affected lectures is good, a
falling share of passing tests is bad, and the node cannot tell the two apart. The sign of
`to − from` is arithmetic, the tone is the judgement, and the judgement is the producer's.

A consumer maps tone to the whole visual treatment of the group and its rows — the heading
colour, the identifier chip's foreground and background, and the value's colour. The reference
maps `good` to `#3e7d4f` on a `#eaf3ec` chip and `bad` to `#a63a2e` on a `#f8ebe8` chip. The
direction marker comes from the tone too, and only from `good` and `bad`: `good` draws `▲`,
`bad` draws `▼`, and `neutral`, `accent` and `warn` draw no marker and colour only. Neither
glyph appears anywhere in the emitted text, deliberately — see the fallback note below.
`neutral` is the safe rendering for any tone a consumer does not handle; `accent` and `warn` are
unused by the compliance pages but are part of the family's closed vocabulary and must not be
rejected.

Tone is the one property with no plain-text rendering, and that is by design: it is a hint, not
data, and a colour hint has nothing to say once the colour is gone. The group labels are
written to carry the direction in words for exactly that reason — "Largest improvements", not
"Improvements".

### Fallback

With no custom renderer, `myst-to-react` renders the root as a plain `<div>` holding its
children, so a reader gets one `<div>` per group, each a bold label followed by a genuine
`<ul>`. For the node above, all eight rows, that is:

> **Largest improvements**
> - `qe-writing-008` — Remove excessive whitespace between words — **78% to 68%**
> - `qe-writing-006` — Capitalise lecture titles properly — **47% to 38%**
> - `qe-fig-008` — Figure-directive option conventions — **62% to 56%**
> - `qe-writing-001` — Use one sentence per paragraph — **55% to 50%**
>
> **All regressions**
> - `qe-fig-004` — Caption formatting conventions — **9% to 17%**
> - `qe-fig-001` — Do not set figure size unless necessary — **62% to 64%**
> - `qe-fig-003` — No matplotlib embedded titles — **46% to 47%**
> - `qe-code-002` — Use unicode Greek letters in code — **18% to 19%**

Every identifier, description and number is ordinary text; nothing but the tone hint is hidden
in the properties. The groups stack rather than sitting side by side, which is what the design's
`auto-fit` `minmax(340px, 1fr)` rule does at narrow widths anyway. It needs no JavaScript, it
prints, and it exports: `myst-to-tex` has handlers for `div`, `span`, `list`, `listItem`,
`paragraph`, `text`, `strong` and `inlineCode`, so the block reaches LaTeX as an `itemize` whose
lines read `\texttt{…} --- … --- \textbf{…}`.

There is no fallback table here, and so none of the table hazards apply: no header row to place
wrongly, no row arity to keep uniform. A list is the right fallback for this data — one bullet
per datum, in the producer's order — and it is also exactly the shape the body is authored in,
which is why the source, the properties and the fallback can be read against one another line by
line.

The value reads "78% to 68%" rather than "78% → 68%" on purpose. In `myst-to-tex`'s
`stringToLatexText` the `arrows` table is spread into `textReplacements`, which is consulted
before `mathReplacements`, so `→` is emitted as a bare `\rightarrow` in text mode — a math-only
command that stops `pdflatex`. The arrow, like the `▲`/`▼` markers, belongs to the renderer;
the emitted text stays inside the safe subset.

## Classed cards and grids

*The shapes the compliance wrappers emit for wins, issues and findings — the one part of the contract that is not one of the eight generic primitives.*

Three regions of the compliance design are card sets rather than data visualisations: the landing page's **biggest-wins** grid (brief §5.3), its **fix-immediately** finding cards (§5.4), and the lecture report's filterable **issue** cards (§5.7). They differ from the eight primitives in one decisive way: each card carries **authored prose** — a description, a problem statement, an example — alongside its measured numbers. Prose cannot ride as a string property, because it must keep its code spans and links; so for cards the structured data and the readable rendering are not two views of one array, they are two halves of one object.

This section specifies the container, the card, and the three compliance variants. It also settles the `grid`/`card` question, which decision D3 left in a state that the engine does not support.

### The `grid`/`card` problem, and the decision

REVIEW §2 (D3) says every directive emits a portable tree of "`div`/`span` nodes with a `class` … plus the core `grid` and `card` nodes", and lists as its third benefit that "PDF export keeps working". Those two clauses are in conflict. Checked against the fork at `12a8b26b` (v1.10.1, qe-v10):

| Node type | `myst-to-tex` | `myst-to-typst` |
| --- | --- | --- |
| `div`, `span`, `paragraph`, `text`, `strong`, `emphasis`, `inlineCode`, `link`, `list`, `listItem`, `table` | handler | handler |
| `card`, `cardTitle` | **none** | handler |
| `footer` | **none** | handler that **returns without writing anything** |
| `grid`, `grid-item`, `header` | **none** | **none** |

An unhandled type is not a formatting degradation. `TexSerializer.renderChildren` (`packages/myst-to-tex/src/index.ts:580–595`) raises `Unhandled LaTeX conversion for node of "<type>"` and **does not recurse**, so the entire subtree is dropped from the `.tex`. It is raised as a `fileError`, but that does not save you: `--strict` accounting lives only in the site build path, so `myst build --tex --strict` logs the message and **still exits 0**, verified. The content is simply gone and the build says it succeeded. Typst's `footer() { return; }` (`myst-to-typst/src/index.ts:519`) is worse in kind: the export succeeds and the footer's content is silently discarded.

Mapped onto the design, that means core `grid` + `card` would drop **the whole wins section and the whole fix-immediately section** from a PDF of the landing page, and every issue card from a PDF of a lecture report, with a successful exit code either way. Those are not decorative regions; they are the report's editorial argument. And in Typst, where `card` does survive, the wins card's `footer` — the row that carries the reach number — would vanish while the build reported success.

There is a second, independent objection. The core `grid` node carries `columns: [1, 2, 2, 3]`, four breakpoint integers. The wins grid is `repeat(auto-fit, minmax(300px, 1fr))` and the issue and finding lists are flex columns, not grids at all. Core `grid` cannot express any of the three layouts, so it buys presentation the theme must override anyway, at the cost of the subtree.

**Recommendation: option (b).** The compliance wrappers emit **classed `div` structures that mirror the card anatomy**, using only node types both serialisers handle, and themes match on class. No `grid`, `grid-item`, `card`, `cardTitle`, `header` or `footer` node is emitted anywhere in this family. **This amends D3 on one point:** the phrase "plus the core `grid` and `card` nodes" is withdrawn; the rest of D3 — portable trees, class hooks, tone hints, data as properties, no custom node types — stands unchanged and is what makes the amendment cheap.

**The cost, plainly.** In a theme with no renderer, a card set renders as a stack of plain `<div>`s — a bold title line, a paragraph of prose, a plain footer line — rather than the boxed cards the default book theme draws for a core `card`. The pre-theme build (PLAN Phase 1b's exit: `compliance-lecture-style` building against the default or lecture theme) therefore looks like headed prose rather than a card deck. That is the whole price, and it is paid in a transitional state whose acceptance criterion is already "plain tables for every region". The contract also has to name a card anatomy that core already names, which is four extra class tokens.

**Two alternatives were weighed and rejected.**

Option (a), core `grid`/`card` with the LaTeX loss recorded, trades a permanent, silent data loss in every export path for prettier chrome in one transitional build. A contract whose stated purpose is that content survives the theme cannot have its three most editorial regions disappear when the theme is removed.

Option (c) in its only credible form — adding `grid`, `card`, `header` and `footer` handlers to `myst-to-tex` in the QuantEcon fork — is a genuine fix but the wrong instrument here. It would make report PDFs correct only on a forked CLI, which contradicts the reason the family is generic at all, and it is an upstream contribution rather than a contract decision. It belongs in `UPSTREAM-CANDIDATES.yml`: if those handlers ever land upstream, this section's anatomy tokens map onto them one for one, and the migration is mechanical.

### The card kit

Two node shapes, four anatomy tokens, and a variant token supplied by the wrapper.

| Token | On | Meaning |
| --- | --- | --- |
| `qe-dv` | container, card | Family token. |
| `qe-dv-cards` | container | The card-set kit. |
| `qe-dv-card` | card | One card. |
| `qe-dv-card__title` | child of a card | The identifying line. Exactly one, always first. |
| `qe-dv-card__body` | child of a card | The authored prose. At most one. |
| `qe-dv-card__aside` | child of a card | A self-contained secondary block. At most one. |
| `qe-dv-card__footer` | child of a card | Derived facts, restated in words. At most one. |
| `qe-dv-tone-<tone>` | card | Derived from the card's `tone`, so a CSS-only theme can colour it. |
| `qe-dv-cards__summary` | child of a container | The optional counts line that stands in for the filter chips. |
| `qe-wins` / `qe-issues` / `qe-findings` | container | Compliance variant. |
| `qe-win` / `qe-issue` / `qe-finding` | card | Compliance variant. |
| `qe-issue--critical` \| `--high` \| `--medium` \| `--low` | card | Compliance qualifier, where the tone vocabulary is coarser than the design's palette. |

Class order is fixed: family, kit, variant, qualifier, derived tone. **This settles for cards a question the `heatmap` and `chips` specifications both left open** — wrappers do add their own token, appended after the kit tokens, and the derived `qe-dv-tone-<tone>` token is emitted. The same convention should be ratified across the eight primitives.

**The container** is a `div` holding the cards in author order. It never sorts.

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Portable. |
| `class` | string | yes | `qe-dv qe-dv-cards`, then the variant token. |
| `contract` | `"1.0"` | yes | Contract version. |
| `primitive` | `"cards"` | yes | Dispatch without parsing the class string. |
| `variant` | kebab-case string | yes | The wrapper's variant name, matching the token after `qe-`. The datavis family defines none; the compliance family defines `win`, `issue` and `finding`. |
| `layout` | `"grid"` \| `"stack"` | yes | `grid` is the wins deck (`auto-fit minmax` in the theme); `stack` is a single column. Not a column count — the responsive rule in §7 is the theme's. |
| `count` | integer ≥ 0 | yes | Number of cards. Lets the renderer draw an "All · 11" chip without walking the children. |
| `filter` | object | no | A single-select filter over one card property. See `qe-issue`. |
| `children` | array | yes | The optional summary paragraph, then one card `div` per card, in display order. |

**The card** is a `div` and is self-sufficient: a bare `{qe-finding}` outside any container emits one, exactly as a `chip` span stands alone outside a `chips` root.

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"div"` | yes | Portable. |
| `class` | string | yes | `qe-dv qe-dv-card`, variant token, qualifier, `qe-dv-tone-<tone>`. |
| `contract` | `"1.0"` | yes | Contract version. |
| `primitive` | `"card"` | yes | Dispatch key. |
| `variant` | kebab-case string | yes | Matches the container's when it has one. |
| `title` | string, non-empty | yes | The card's identifying line as plain text. For a finding this is the source location; one property name across the three variants is worth more than matching a CSV column name. |
| `url` | string | no | Where the title resolves to. Findings only, in this design. |
| `tone` | tone | yes | The card's own colour family, driving its stripe or ground. Not the tone of anything inside it. |

Then the variant's own properties, specified below. Cards carry no `label`, `identifier` or `html_id` of their own: `myst-cli`'s embed transform deletes those from any non-reference node it copies, so a fact stored there would silently disappear inside `{embed}`. Everything the card knows sits in the properties above or nested inside them.

**Anatomy rules.** The four anatomy children appear at most once each, always in the order title, body, aside, footer. `__title` and `__footer` are `paragraph` nodes; `__body` and `__aside` are `div` nodes holding flow content, because that is where authored markdown lands. `__body` is the slot a renderer reads back and re-slots; everything else it may redraw from the properties.

**Agreement rule.** Every value in a card's properties appears verbatim in that card's children, and the children introduce no fact that is not either a property or authored prose. A test asserts property-by-property containment against the flattened text of the matching child. This is the cards' form of the invariant the primitives express as index-for-index correspondence, and it is what makes the fallback honest rather than decorative.

### `qe-win` — biggest-wins cards

A curated fix and the share of the corpus it lifts. Container `layout: "grid"`.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-cards qe-wins",
  "contract": "1.0",
  "primitive": "cards",
  "variant": "win",
  "layout": "grid",
  "count": 8,
  "children": [
    {
      "type": "div",
      "class": "qe-dv qe-dv-card qe-win qe-dv-tone-neutral",
      "contract": "1.0",
      "primitive": "card",
      "variant": "win",
      "title": "Name your figures",
      "tone": "neutral",
      "rule": "qe-fig-005",
      "tag": { "label": "MECHANICAL", "tone": "good", "variant": "tag" },
      "reach": 273,
      "total": 348,
      "share": 78,
      "children": [
        {
          "type": "paragraph",
          "class": "qe-dv-card__title",
          "children": [
            { "type": "strong", "children": [{ "type": "text", "value": "Name your figures" }] },
            { "type": "text", "value": " · " },
            {
              "type": "span",
              "class": "qe-dv qe-dv-chip qe-dv-chip--tag qe-dv-tone-good",
              "contract": "1.0",
              "primitive": "chip",
              "chip": { "label": "MECHANICAL", "tone": "good", "variant": "tag" },
              "children": [{ "type": "text", "value": "MECHANICAL" }]
            }
          ]
        },
        {
          "type": "div",
          "class": "qe-dv-card__body",
          "children": [
            {
              "type": "paragraph",
              "children": [
                { "type": "text", "value": "Add a " },
                { "type": "inlineCode", "value": "name:" },
                { "type": "text", "value": " so figures can be cross-referenced with " },
                { "type": "inlineCode", "value": "numref" },
                { "type": "text", "value": "." }
              ]
            }
          ]
        },
        {
          "type": "paragraph",
          "class": "qe-dv-card__footer",
          "children": [
            { "type": "strong", "children": [{ "type": "text", "value": "273" }] },
            { "type": "text", "value": " of 348 lectures · 78%" }
          ]
        }
      ]
    }
  ]
}
```

The other seven cards follow the same shape: Collapse double spaces `qe-writing-008` 237/348 = 68%; Figure sizes `qe-fig-001` 224 = 64%; Line widths `qe-fig-008` 196 = 56%; Plot titles → captions `qe-fig-003` 165 = 47% (human); Heading capitalisation `qe-writing-006` 132 = 38%; Expectation notation `qe-math-010` 124 = 36%; Narrative citations `qe-ref-001` 106 = 30% (human).

| Property | Type | Meaning |
| --- | --- | --- |
| `rule` | string | The registry rule the win corresponds to. This is the key that makes the numbers underivable by hand — see the authoring note. |
| `tag` | chip object | The effort tag, a `chips` chip object with `variant: "tag"`. `MECHANICAL` → tone `good`, `HUMAN PASS` → tone `warn`. Deep-equal to the chip span in `__title`, exactly as `chips` requires of `items[i]`. |
| `reach` | integer ≥ 0 | Lectures the fix touches. |
| `total` | integer > 0 | Corpus size the reach is measured against. |
| `share` | integer 0–100 | `Math.round(reach / total * 100)`, pre-computed so the drawn bar and the fallback text cannot disagree. |

**The band ramp is the theme's, not the contract's.** The design bands the bar and the percentage badge by share — `≥ 75%` `#173f6d`, `≥ 60%` `#2c72b8`, `≥ 45%` `#5f8fc2`, `≥ 30%` `#96b3d2` — four steps of one hue, which the five-tone vocabulary cannot express and should not try to. The card carries `share`; the theme bands it, exactly as `heatmap` carries `scale` and the theme owns the oklch ramp. The band legend beneath the grid ("Share of corpus · ≥ 75% · ≥ 60% …") is theme chrome generated from the theme's own thresholds, and no node is emitted for it.

**Authoring.** `{qe-wins}` wraps `{qe-win}` items; the title is the item's argument, the description its markdown body, and `:rule:` and `:effort:` its options. All eight wins in the design map onto a `rule_reach.csv` row whose `lectures_affected` is exactly the reach the canvas shows, so **`reach`, `total` and `share` are read and derived, never typed** — `:reach:` is refused with a `fileError`, `total` comes from the `TOTAL` row of `series_summary.csv`, and goal 2's "the visuals cannot drift from the measured data" holds for this region without a verification step.

### `qe-issue` — issue cards

A filterable list of rule violations found in one lecture. Container `layout: "stack"`, with a `filter`.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-cards qe-issues",
  "contract": "1.0",
  "primitive": "cards",
  "variant": "issue",
  "layout": "stack",
  "count": 11,
  "filter": {
    "key": "severity",
    "facets": [
      { "value": "critical", "label": "Critical", "count": 1 },
      { "value": "high", "label": "High", "count": 4 },
      { "value": "medium", "label": "Medium", "count": 4 },
      { "value": "low", "label": "Low", "count": 2 }
    ]
  },
  "children": [
    {
      "type": "paragraph",
      "class": "qe-dv-cards__summary",
      "children": [
        { "type": "text", "value": "11 issues: 1 critical, 4 high, 4 medium, 2 low." }
      ]
    },
    {
      "type": "div",
      "class": "qe-dv qe-dv-card qe-issue qe-issue--critical qe-dv-tone-bad",
      "contract": "1.0",
      "primitive": "card",
      "variant": "issue",
      "title": "Use tick count management for nested directives",
      "tone": "bad",
      "severity": "critical",
      "tag": { "label": "CRITICAL", "tone": "bad", "variant": "tag" },
      "rule": "qe-admon-003",
      "count": 2,
      "lines": ["499", "549"],
      "children": [
        {
          "type": "paragraph",
          "class": "qe-dv-card__title",
          "children": [
            {
              "type": "span",
              "class": "qe-dv qe-dv-chip qe-dv-chip--tag qe-dv-tone-bad",
              "contract": "1.0",
              "primitive": "chip",
              "chip": { "label": "CRITICAL", "tone": "bad", "variant": "tag" },
              "children": [{ "type": "text", "value": "CRITICAL" }]
            },
            { "type": "text", "value": " " },
            { "type": "inlineCode", "value": "qe-admon-003" },
            { "type": "text", "value": " — " },
            {
              "type": "strong",
              "children": [
                { "type": "text", "value": "Use tick count management for nested directives" }
              ]
            },
            { "type": "text", "value": " ×2" }
          ]
        },
        {
          "type": "div",
          "class": "qe-dv-card__body",
          "children": [
            {
              "type": "paragraph",
              "children": [
                { "type": "inlineCode", "value": "{exercise-start}" },
                {
                  "type": "text",
                  "value": " fence (3 ticks) is never closed — the directive swallows the rest of the block, including the nested "
                },
                { "type": "inlineCode", "value": "{hint}" },
                { "type": "text", "value": " and the " },
                { "type": "inlineCode", "value": "{exercise-end}" },
                { "type": "text", "value": " that follow it." }
              ]
            }
          ]
        },
        {
          "type": "paragraph",
          "class": "qe-dv-card__footer",
          "children": [{ "type": "text", "value": "lines 499, 549" }]
        }
      ]
    }
  ]
}
```

| Property | Type | Meaning |
| --- | --- | --- |
| `severity` | `critical` \| `high` \| `medium` \| `low` | The compliance vocabulary, carried literally because it is finer than the tone set. |
| `tag` | chip object | The severity tag; label is the severity upper-cased. |
| `rule` | string | Rule id, rendered as `inlineCode`. |
| `count` | integer ≥ 1 | Occurrences. Verified against `violations.csv` / `judgment.csv`; a mismatch is a `fileError`. |
| `lines` | array of strings | The line references shown, in source order. When `lines.length < count` the remainder was truncated for readability, and the footer says so. |

**Severity has four steps and the tone vocabulary has three that fit**, so `critical` and `high` both map to `bad` (the design's `#8c2f24`/`#f6e5e2` and `#a63a2e`/`#f8ebe8` are two shades of one family), `medium` to `warn` and `low` to `neutral` — the same collapse the `data-table` specification makes for priority badges, and for the same reason. The fourth shade is recovered by the `qe-issue--critical` class token, not by a sixth tone. A theme that cannot separate them renders critical and high identically; the tag label still says which is which, and so does the fallback.

**The `filter` object.** `key` names the card property the facets match on. `facets` is the **full vocabulary in rank order, including zero-count values**, so the chip row does not change shape from one lecture to the next. The "All" chip is drawn from the container's `count` and is not a facet. Contract 1.0 defines single-select only; a multi-select filter, a second key and a URL-bound filter state are all out.

Acceptance criterion 7 is met structurally: every card is a child, so the unfiltered list is what the server renders and what a reader with JavaScript disabled sees. The filter is a pure client-side narrowing of nodes already on the page. Because the chip row is an interaction rather than content, no node is emitted for it — and in its place the container emits the `qe-dv-cards__summary` paragraph, which puts the same counts in the text where a plain theme, a printed page and a PDF can all read them.

**Authoring.** `{qe-issues}` wraps `{qe-issue}` items: title as the argument, example prose as the markdown body, `:severity:`, `:rule:`, `:count:` and `:lines:` as options. Issue text is necessarily authored (REVIEW §6: lines and examples exist only in the generated report markdown), and `:count:` is the typed number the plugin verifies.

### `qe-finding` — fix-immediately cards

A structural defect, where it is, and the state of the issue and pull request that will fix it. Container `layout: "stack"`.

```json
{
  "type": "div",
  "class": "qe-dv qe-dv-card qe-finding qe-dv-tone-bad",
  "contract": "1.0",
  "primitive": "card",
  "variant": "finding",
  "title": "lecture-python-programming · python_by_example.md:499, :549",
  "url": "https://github.com/QuantEcon/lecture-python-programming/blob/ceec881028/lectures/python_by_example.md#L499",
  "tone": "bad",
  "rule": "qe-admon-003",
  "issue": {
    "ref": "programming#—",
    "title": "Close unterminated {exercise-start} fences",
    "state": "open",
    "url": "https://github.com/QuantEcon/lecture-python-programming/issues"
  },
  "pr": {
    "ref": "programming#— fix fences",
    "state": "open",
    "url": "https://github.com/QuantEcon/lecture-python-programming/pulls"
  },
  "checked": "2026-08-26",
  "children": [
    {
      "type": "paragraph",
      "class": "qe-dv-card__title",
      "children": [
        {
          "type": "link",
          "url": "https://github.com/QuantEcon/lecture-python-programming/blob/ceec881028/lectures/python_by_example.md#L499",
          "children": [
            {
              "type": "inlineCode",
              "value": "lecture-python-programming · python_by_example.md:499, :549"
            }
          ]
        },
        { "type": "text", "value": " — " },
        { "type": "inlineCode", "value": "qe-admon-003" }
      ]
    },
    {
      "type": "div",
      "class": "qe-dv-card__body",
      "children": [
        {
          "type": "paragraph",
          "children": [
            {
              "type": "strong",
              "children": [
                { "type": "text", "value": "Two " },
                { "type": "inlineCode", "value": "{exercise-start}" },
                { "type": "text", "value": " fences are never closed" }
              ]
            },
            {
              "type": "text",
              "value": " — the directive swallows the rest of the exercise, including a nested "
            },
            { "type": "inlineCode", "value": "{hint}" },
            {
              "type": "text",
              "value": ". The only two malformed gated directives in 690 across the corpus; the exercise and its hint do not render as intended."
            }
          ]
        }
      ]
    },
    {
      "type": "div",
      "class": "qe-dv-card__aside qe-finding__status",
      "children": [
        {
          "type": "paragraph",
          "class": "qe-finding__issue",
          "children": [
            { "type": "text", "value": "Issue: " },
            {
              "type": "link",
              "url": "https://github.com/QuantEcon/lecture-python-programming/issues",
              "children": [
                { "type": "text", "value": "Close unterminated {exercise-start} fences" }
              ]
            },
            { "type": "text", "value": " — " },
            { "type": "inlineCode", "value": "programming#—" },
            { "type": "text", "value": " · open" }
          ]
        },
        {
          "type": "paragraph",
          "class": "qe-finding__pr qe-finding__pr--open",
          "children": [
            { "type": "text", "value": "Fixing PR: " },
            {
              "type": "link",
              "url": "https://github.com/QuantEcon/lecture-python-programming/pulls",
              "children": [{ "type": "inlineCode", "value": "programming#— fix fences" }]
            },
            { "type": "text", "value": " · open" }
          ]
        },
        {
          "type": "paragraph",
          "class": "qe-finding__checked",
          "children": [
            {
              "type": "emphasis",
              "children": [{ "type": "text", "value": "Status as of 2026-08-26." }]
            }
          ]
        }
      ]
    }
  ]
}
```

| Property | Type | Meaning |
| --- | --- | --- |
| `rule` | string | Rule id, or a plain descriptor where no rule applies (`cross-reference`, `synced copy` in the design). |
| `issue` | object \| null | `{ ref, title, state, url }`. `state` is `open` \| `closed`. Null when no issue has been filed. |
| `pr` | object \| null | `{ ref, state, url }`. `state` is `merged` \| `open` \| `none`. When `none`, `ref` carries the reason ("no fixing PR yet", "resolved by upstream sync") and `url` may be null. |
| `checked` | date string `YYYY-MM-DD` | When the states were last read, per D4. Always emitted; the card is a claim about a moving target and must say when it was true. |

**Issue and pull-request state is its own vocabulary and carries no tone.** The design colours an open issue green `#3e7d4f`, a closed one purple `#7d5bb5`, and badges the PR MERGED `#7d5bb5`/`#f1ecf8`, OPEN `#3e7d4f`/`#e8f0e9`, NO PR `#8a8577`/`#f1ede4`. Purple has no member of the five-tone set, and forcing it into `accent` would misdescribe both the tone vocabulary and the GitHub convention. So the status block carries the literal state strings and the derived tokens `qe-finding__pr--merged` \| `--open` \| `--none`, and the theme maps state to colour directly. Tone exists so a stranger's theme can colour data it does not understand; a merge state is not that kind of data. This is the line that stops the tone set growing a sixth member.

**The `⇋`, `⎇` and `·` status icons are not emitted.** None of them has an entry in `myst-to-tex`'s replacement tables (`packages/myst-to-tex/src/utils.ts`), so they would reach the `.tex` file raw. They are decoration; `pr.state` already carries the meaning, and the theme draws the glyph. `×` and `—` are safe and are used: `—` maps to `---`, and `×` is in `mathReplacements`, which `stringToLatexText` wraps in `$…$`. `→` is deliberately avoided everywhere in this family — `arrows` is spread into `textReplacements`, so it emits a bare `\rightarrow` in text mode and stops `pdflatex`, the same trap the `delta-list` specification records.

**Authoring.** `{qe-findings}` wraps `{qe-finding}` items; a lone `{qe-finding}` emits a bare card. The location is the argument, the problem statement the markdown body, and `:rule:` the one option. `issue`, `pr` and `checked` come from `findings.csv` (`where, rule, issue_url, issue_state, pr_url, pr_state, checked_at`) keyed on the location and rule, per D4 — never typed in the page. `url` is composed from the series repository and the pinned commit in `snapshot.json`. The "Note — a correction to the previous pass" block that closes the same section in the design is a standard admonition (§5.5) and is not part of this kit.

### Fallback rendering

With no custom renderer, `myst-to-react` renders each `div` through `DefaultComponent` as a plain `<div>` containing its children, so a card set reads as a run of short, complete blocks. The wins deck becomes eight of these:

> **Name your figures** · MECHANICAL
> Add a `name:` so figures can be cross-referenced with `numref`.
> **273** of 348 lectures · 78%

The issue list opens with "11 issues: 1 critical, 4 high, 4 medium, 2 low." and then reads:

> CRITICAL `qe-admon-003` — **Use tick count management for nested directives** ×2
> `{exercise-start}` fence (3 ticks) is never closed — the directive swallows the rest of the block, including the nested `{hint}` and the `{exercise-end}` that follow it.
> lines 499, 549

and a finding reads:

> [`lecture-python-programming · python_by_example.md:499, :549`](…) — `qe-admon-003`
> **Two `{exercise-start}` fences are never closed** — the directive swallows the rest of the exercise, including a nested `{hint}`. …
> Issue: [Close unterminated {exercise-start} fences](…) — `programming#—` · open
> Fixing PR: [`programming#— fix fences`](…) · open
> *Status as of 2026-08-26.*

Every number, identifier, state and date in the properties is present as text; nothing is hidden. What is lost is the card box, the effort and severity tints, the reach bar, the severity stripe, the status ring and the filter chips — colour and chrome, in every case re-expressing something the text already says.

The same holds off the web, which is the point of the amendment. Every node type used here — `div`, `paragraph`, `text`, `strong`, `emphasis`, `inlineCode`, `link`, `span` — has a handler in both `myst-to-tex` and `myst-to-typst`, so a report page carrying wins, issues and findings exports to PDF and to Typst with all three regions intact, and `myst build --pdf --strict` does not fail on them.

### Renderer keys

Key on the **variant** token: `div[class~=qe-win]`, `div[class~=qe-issue]`, `div[class~=qe-finding]` for the cards, and `div[class~=qe-wins]`, `div[class~=qe-issues]`, `div[class~=qe-findings]` for the containers. `selectRenderer` in `myst-to-react` accepts `unist-util-select` selectors, so these are legal keys. The contract deliberately does **not** rely on selector precedence between two keys that both match one node: `qe-dv-cards` and `qe-dv-card` are CSS hooks and property-dispatch aids, not renderer keys. A renderer draws from the properties and re-slots `__body` (and, for a finding, may re-slot `__aside`) as authored mdast; it never needs to parse the other anatomy children.

The effort and severity tags are `chips` chip spans, so a theme implements **one** chip renderer keyed `span[class~=qe-dv-chip]` and gets the tags for free — the card kit shares the primitives' vocabulary rather than inventing a parallel one.

### Deliberately absent

No `columns` or width property on the container: the `auto-fit minmax` grids and the flex-wrap behaviour of the finding card are the theme's responsive rules (§7), and the no-horizontal-overflow gate tests them there. No colour, band, hex or threshold property anywhere. No `icon`. No `href` on a tag. No `sort` — card order is the wrapper's, and it is already reach-descending for wins and severity-descending for issues. No multi-select filter, no second filter key, no URL-bound filter state. No card-level `label`/`identifier`, for the embed-transform reason above. And no core `grid`, `grid-item`, `card`, `cardTitle`, `header` or `footer` node, which is the whole of this section's argument.

The same four-token kit covers the design's remaining card families — the series report's numbered recommendation cards (§5.6) and the landing page's navigation cards — with a variant token apiece and no new machinery. They are not specified here because no wrapper emits them yet; when one does, it adds a token, not a shape.
## Checking an implementation against this contract

The schemas in [`schema/`](./schema) are the machine-readable half of this document, one file
per primitive, JSON Schema draft 2020-12. They validate a primitive's **root node**: its type,
its class tokens, its contract and primitive properties, and every data property, down to the
closed tone vocabulary and the shape of each item. They deliberately do not try to validate
the children beyond their structure, because the rule that the properties and the children
say the same thing is a correspondence between two trees and not something JSON Schema can
express.

[`samples/`](./samples) carries the fixtures, one file per primitive, each with two arrays:

- `valid` — complete, realistic nodes built from the compliance report's real data. These are
  what an implementer should read first, and what a renderer can be developed against before
  any directive exists.
- `invalid` — nodes that **must** be rejected, each with a `because` saying what the schema is
  meant to catch. A negative case that quietly passes is worse than no negative case, so the
  validator fails when one is accepted.

`npm run test:contract` checks all of it: that every primitive has a schema and samples, that
every schema compiles under ajv in strict mode, that every valid sample validates and every
invalid one does not, and that each valid sample satisfies the invariants this document states
in prose — root type `div`, both class tokens present, `primitive` matching the file,
`contract` a string, and children that are not empty — and that each valid sample still
validates once every node under it carries the `key` and `position` the engine stamps on an
emitted tree, so a schema that accepts only hand-written fixtures does not pass.

That last check is the one worth keeping honest. A primitive whose fallback renders nothing
passes every other test and fails the only thing this contract is for.

## Implementing the contract in a theme

A theme implements as many or as few primitives as it wants; anything it does not implement
still renders, because the fallback is real content rather than a placeholder.

The recommended renderer key is a class selector. `myst-to-react`'s `selectRenderer` accepts
`unist-util-select` selectors, so `div[class~=qe-dv-stats]` matches the primitive without
matching a page's own `{div}` blocks, and survives an author adding their own class tokens.
A consumer that is not `myst-to-react` can match on the `primitive` property instead; the two
are always consistent.

Verified, so a theme author need not take it on trust: the default MyST book theme renders a
primitive with no custom renderer as

```html
<div class="qe-dv qe-dv-stats">
  <div aria-label="table content" class="overflow-auto">
    <table>…</table>
  </div>
</div>
```

The class string is emitted verbatim, so the selector above works, and the table is the
theme's own table with the theme's own horizontal-overflow wrapper.

A renderer reads the root node's properties and draws whatever it likes. It should ignore
properties it does not recognise rather than failing, treat an unfamiliar `tone` as
`neutral`, and — the one thing that actually matters for accessibility — keep the fallback
children reachable in some form, because they carry the data in a shape a screen reader and a
`Ctrl-F` both understand.
