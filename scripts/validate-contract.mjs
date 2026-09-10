/**
 * Check the contract's sample nodes against the contract's schemas.
 *
 * `CONTRACT.md` is prose, and prose drifts from the code that is supposed to implement it.
 * The schemas in `schema/` are the machine-readable half, and this script is what keeps them
 * honest: every primitive has a schema, every schema has samples, every sample marked valid
 * validates, and — the half that is usually missing — every sample marked invalid is
 * actually rejected, for the reason it claims.
 *
 * A negative case that quietly passes is worse than no negative case, because it reads as
 * coverage. So `because` is not a comment: the script fails if a sample expected to be
 * rejected is accepted, and prints the schema path that should have caught it. A fixture
 * rejected by the wrong rule reads as coverage too, so an invalid sample may also carry an
 * optional `rejectedAt` naming the `instancePath` its rejection must land on; where it is
 * present it is asserted, and where it is absent nothing changes.
 *
 * `ajv` is a devDependency, which the bundle constraint permits: nothing here is bundled
 * into a plugin. Hand-rolling a JSON Schema subset was the alternative and was rejected —
 * schemas checked by a partial implementation of the spec are not checked.
 *
 * Usage: node scripts/validate-contract.mjs [--verbose]
 * Exit codes: 0 all checks passed · 1 a check failed · 2 the fixtures could not be read — a
 * schema or sample file is missing, or is not valid JSON — so no verdict on the checks exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = path.join(repoRoot, 'schema');
const sampleDir = path.join(repoRoot, 'samples');
const verbose = process.argv.includes('--verbose');

/** The eight primitives the contract defines. A schema for anything else is a mistake. */
const PRIMITIVES = [
  'badges',
  'bar-list',
  'chips',
  'data-table',
  'delta-list',
  'heatmap',
  'stacked-bar',
  'stats',
];

const problems = [];
const notes = [];
let checks = 0;
/** Set when a schema or sample file is missing or unparsable: the run cannot reach a verdict. */
let unreadable = false;

function fail(message) {
  problems.push(message);
}

function readJson(file) {
  const where = path.relative(repoRoot, file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    unreadable = true;
    fail(`${where}: cannot be read — ${error.code ?? error.message}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    unreadable = true;
    fail(`${where}: not valid JSON — ${error.message}`);
    return null;
  }
}

function listJson(dir) {
  if (!fs.existsSync(dir)) {
    unreadable = true;
    fail(`${path.relative(repoRoot, dir)}/ is missing`);
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

const schemaNames = listJson(schemaDir);
const sampleNames = listJson(sampleDir);

// 1. Every primitive has a schema and a sample file, and nothing else is present.
for (const primitive of PRIMITIVES) {
  if (!schemaNames.includes(primitive)) {
    unreadable = true;
    fail(`schema/${primitive}.json is missing`);
  }
  if (!sampleNames.includes(primitive)) {
    unreadable = true;
    fail(`samples/${primitive}.json is missing`);
  }
}
for (const name of schemaNames) {
  if (!PRIMITIVES.includes(name)) fail(`schema/${name}.json is not one of the eight primitives`);
}
for (const name of sampleNames) {
  if (!PRIMITIVES.includes(name)) fail(`samples/${name}.json is not one of the eight primitives`);
}

// 2. Every schema compiles, and they compile together so a $ref between them resolves.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validators = new Map();
for (const name of schemaNames) {
  const schema = readJson(path.join(schemaDir, `${name}.json`));
  if (!schema) continue;
  if (typeof schema.$id !== 'string') fail(`schema/${name}.json has no $id`);
  if (typeof schema.title !== 'string') fail(`schema/${name}.json has no title`);
  if (typeof schema.description !== 'string') fail(`schema/${name}.json has no description`);
  try {
    validators.set(name, ajv.compile(schema));
    checks += 1;
  } catch (error) {
    fail(`schema/${name}.json does not compile — ${error.message}`);
  }
}

// 3. Every sample validates, or is rejected, as it says it should be.
for (const name of sampleNames) {
  const validate = validators.get(name);
  if (!validate) continue;
  const samples = readJson(path.join(sampleDir, `${name}.json`));
  if (!samples) continue;

  const valid = samples.valid ?? [];
  const invalid = samples.invalid ?? [];
  if (!Array.isArray(valid) || valid.length === 0) {
    fail(`samples/${name}.json has no "valid" samples`);
  }
  if (!Array.isArray(invalid) || invalid.length === 0) {
    fail(`samples/${name}.json has no "invalid" samples; a schema that rejects nothing is untested`);
  }

  valid.forEach((node, index) => {
    checks += 1;
    if (!validate(node)) {
      const detail = (validate.errors ?? [])
        .map((error) => `      ${error.instancePath || '/'} ${error.message}`)
        .join('\n');
      fail(`samples/${name}.json valid[${index}] was rejected:\n${detail}`);
    }
  });

  invalid.forEach((entry, index) => {
    checks += 1;
    const where = `samples/${name}.json invalid[${index}]`;
    if (typeof entry?.because !== 'string' || entry.because.trim() === '') {
      fail(`${where} has no "because": say what the schema is meant to catch`);
    }
    if (!('node' in (entry ?? {}))) {
      fail(`${where} has no "node"`);
      return;
    }
    if (validate(entry.node)) {
      fail(`${where} was accepted but should have been rejected: ${entry.because}`);
    } else {
      // A fixture rejected for a reason other than the one its `because` names still reads as
      // coverage while testing nothing: the rule it claims to exercise may not fire at all,
      // masked by an unrelated rule further up the tree. Naming the keyword that must catch it
      // is hard to state in general, but the place the rejection lands is not, so a fixture may
      // record the `instancePath` it expects and have that asserted. The field is OPTIONAL by
      // design — around ninety fixtures predate it, and a check that demanded annotating all of
      // them at once would simply not be adopted — so it is checked only where it is present,
      // and a fixture without one is exactly as valid as it was before.
      if ('rejectedAt' in entry) {
        checks += 1;
        const expected = entry.rejectedAt;
        if (typeof expected !== 'string') {
          fail(`${where} has a "rejectedAt" that is not a string: it names an instancePath, such as "/children/0"`);
        } else {
          const paths = (validate.errors ?? []).map((error) => error.instancePath);
          if (!paths.includes(expected)) {
            const seen = [...new Set(paths)].map((p) => `"${p}"`).join(', ') || 'none';
            fail(
              `${where} is rejected, but not at "${expected}" — the rejection landed at ${seen}, so the rule its "because" names may not be the rule that caught it`,
            );
          }
        }
      }
      if (verbose) notes.push(`  ${where} correctly rejected: ${entry.because}`);
    }
  });
}

// 4. The invariants the contract states about every root node, checked against the samples
//    rather than trusted: the shared four properties are what makes a node identifiable.
for (const name of sampleNames) {
  const samples = readJson(path.join(sampleDir, `${name}.json`));
  for (const node of samples?.valid ?? []) {
    checks += 1;
    const classes = String(node?.class ?? '').split(/\s+/);
    if (node?.type !== 'div') fail(`samples/${name}.json: a root node must have type "div"`);
    if (!classes.includes('qe-dv')) fail(`samples/${name}.json: class must include "qe-dv"`);
    if (!classes.includes(`qe-dv-${name}`)) {
      fail(`samples/${name}.json: class must include "qe-dv-${name}"`);
    }
    if (node?.primitive !== name) fail(`samples/${name}.json: primitive must be "${name}"`);
    if (typeof node?.contract !== 'string') fail(`samples/${name}.json: contract must be a string`);
    // The rule the whole contract rests on: the fallback must render something.
    if (!Array.isArray(node?.children) || node.children.length === 0) {
      fail(
        `samples/${name}.json: children are empty — a primitive whose fallback renders nothing does not implement this contract`,
      );
    }
  }
}

// 5. A tree the directive actually emits is not the hand-written fixture: mystmd stamps a
//    `key` on every node, the parser leaves a `position`, the family's own report helper may
//    leave a `data`, and the target transform stamps `label`, `identifier` and `html_id` on an
//    anchored block's root — so a schema closed against any of those accepts every fixture and
//    rejects every real tree. Decorate every node of every valid sample the way the engine
//    would — the root and everything reachable through `children`, which is the walk the
//    engine's transforms do; a data object that happens to carry a `type` field is not a node —
//    and validate again. See `decorate()` for why the anchor keys stop at the root.

/** The keys `decorate()` stamps on every node, and so the ones a closed node must admit. */
const NODE_KEYS = ['key', 'position', 'data'];
/** The keys `decorate()` stamps on the root alone. Never on an inner node — see below. */
const ROOT_ONLY_KEYS = ['label', 'identifier', 'html_id'];

/**
 * Stamp a fixture the way the engine stamps a real tree, so the schema is judged against what
 * it will actually see rather than against a hand-written ideal.
 *
 * Three sorts of key arrive on a node without a directive ever writing them:
 *
 * - `key` and `position`. mystmd keys every node, and the parser leaves the source span behind.
 * - `data`. An ordinary mdast field, and the one this family's deferred-diagnostics mechanism
 *   writes: `src/lib/report.mjs` defers a diagnostic onto the node it concerns rather than
 *   emitting it at directive time, so any node in an emitted tree may carry a `data`. A schema
 *   that closes a node against `data` therefore rejects a tree the family itself produces,
 *   which is exactly the failure this step exists to catch — so `data` is stamped on every
 *   node, alongside `key` and `position`.
 * - `label`, `identifier` and `html_id`. The engine's target transform lifts a `(target)=` line
 *   onto the block that follows it and stamps all three together. It stamps them on the BLOCK —
 *   that is, on our root — and nowhere else, so they are stamped here on the root alone.
 *
 * That last distinction is load-bearing, and is why this walk has a root/non-root split at all.
 * Every primitive's schema bans the three anchor keys on every node below the root, deliberately:
 * a `label` on a table cell is not an anchor, it is an emitter copying a field it should not
 * have copied, and `myst-cli`'s embed transform strips the three from any node that is not a
 * cross-reference, cite, footnote, captionNumber or link in any case. Stamping them on inner
 * nodes here would demand that every schema in the family accept them everywhere, which would
 * dismantle the ban rather than test it. So the recursion drops them, and only the root carries
 * them: the relaxation is exercised where it is real, and the ban stays enforced where it is.
 */
function decorate(node, isRoot = true) {
  if (!node || typeof node !== 'object') return node;
  const copy = {
    ...node,
    key: 'engine-key',
    position: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    data: {},
  };
  if (isRoot) {
    copy.label = 'engine-target-label';
    copy.identifier = 'engine-target-label';
    copy.html_id = 'engine-target-label';
  }
  if (Array.isArray(node.children)) copy.children = node.children.map((child) => decorate(child, false));
  return copy;
}
for (const name of sampleNames) {
  const validate = validators.get(name);
  const samples = readJson(path.join(sampleDir, `${name}.json`));
  if (!validate || !samples) continue;
  (samples.valid ?? []).forEach((node, index) => {
    checks += 1;
    if (!validate(decorate(node))) {
      // Name the offending key where the schema closed against one of the keys we stamp; a
      // schema may also refuse an anchor key by typing or by a `false` subschema rather than by
      // `additionalProperties`, so fall back to the raw errors instead of printing nothing.
      const stamped = [...NODE_KEYS, ...ROOT_ONLY_KEYS];
      const closures = (validate.errors ?? []).filter((error) =>
        stamped.includes(error.params?.additionalProperty),
      );
      const detail = (closures.length ? closures : (validate.errors ?? []))
        .slice(0, 3)
        .map((error) =>
          error.params?.additionalProperty
            ? `      ${error.instancePath || '/'} rejects "${error.params.additionalProperty}"`
            : `      ${error.instancePath || '/'} ${error.message}`,
        )
        .join('\n');
      fail(
        `samples/${name}.json valid[${index}] is rejected once every node carries the engine's key, position and data, and the root the target transform's label, identifier and html_id — a real emitted tree would fail this schema:\n${detail}`,
      );
    }
  });
}

// 6. The anchor trio travels together, in every primitive.
//
//    A `(target)=` line stamps `label`, `identifier` and `html_id` on the block that follows it,
//    and the engine writes them as a set: 52,059 labels fuzzed through `normalizeLabel` and
//    `createHtmlId` produce all three or nothing but a bare `label`, and never once an
//    `identifier` without an `html_id`. So a root carrying `identifier` alone, or `html_id` with
//    only one of its companions, is not a tree the engine can emit — it is a wrapper inventing a
//    key, and every schema must refuse it.
//
//    `label` ALONE is the exception, and it is legal. Give a directive `:label: '` and
//    `normalizeLabel` returns an empty identifier, so `transferTargetAttrs` copies the label and
//    silently drops the other two: the engine emits a lone `label`, exits 0, and warns about
//    nothing. A rule binding `label` to the other two would therefore reject a real tree, which
//    is the defect the root relaxation exists to avoid. Hence two dependencies per schema, not
//    three.
//
//    This check exists because the rule itself cannot be trusted to stay put. It is expressed
//    differently in different schemas — bare on the root where the keys are declared inline, and
//    inside a `$def` where they are not — and nothing compares the copies, so a schema that
//    quietly stops enforcing it looks exactly like one that never did. Asking each schema what it
//    ACCEPTS is idiom-blind, and it is deliberately here in `scripts/` rather than in the schemas:
//    `schema/1.0/` freezes at v1.0.0 and is never edited again, and this file does not.
const ANCHOR_KEYS = ['label', 'identifier', 'html_id'];
/** Every proper non-empty subset of the trio, minus the one the engine really emits. */
const ILLEGAL_ANCHOR_SUBSETS = [
  ['identifier'],
  ['html_id'],
  ['label', 'identifier'],
  ['label', 'html_id'],
  ['identifier', 'html_id'],
];
for (const name of sampleNames) {
  const validate = validators.get(name);
  const samples = readJson(path.join(sampleDir, `${name}.json`));
  const base = samples?.valid?.[0];
  if (!validate || !base) continue;

  for (const subset of ILLEGAL_ANCHOR_SUBSETS) {
    checks += 1;
    const node = { ...base };
    for (const key of ANCHOR_KEYS) delete node[key];
    for (const key of subset) node[key] = `anchor-${name}`;
    if (validate(node)) {
      fail(
        `schema/${name}.json accepts a root carrying ${subset.join(' and ')} without the rest of the anchor trio — the engine stamps label, identifier and html_id as a set, so a partial anchor is an emitter's invention`,
      );
    }
  }

  // The other half of the same rule, and the reason it is two dependencies rather than three:
  // a lone `label` IS emitted, so a schema that refuses it is wrong in the opposite direction.
  checks += 1;
  const loneLabel = { ...base };
  for (const key of ANCHOR_KEYS) delete loneLabel[key];
  loneLabel.label = `anchor-${name}`;
  if (!validate(loneLabel)) {
    fail(
      `schema/${name}.json rejects a root carrying only a label, which mystmd emits whenever a :label: option normalises to an empty identifier — the anchor rule must bind identifier and html_id, never label`,
    );
  }

  // And the ordinary case, which is the one an over-eager rule breaks. Without this a schema
  // that refused the trio outright would satisfy every assertion above — each illegal subset
  // rejected, for the wrong reason — and the relaxation these checks exist to protect would be
  // silently undone. Step 5 covers it incidentally, by decorating every root; stating it here
  // means the anchor rule is tested by one block rather than by two that must be read together.
  checks += 1;
  const fullTrio = { ...base };
  for (const key of ANCHOR_KEYS) fullTrio[key] = `anchor-${name}`;
  if (!validate(fullTrio)) {
    fail(
      `schema/${name}.json rejects a root carrying the whole anchor trio, which is what a (target)= line stamps — the root must admit all three together`,
    );
  }
}

if (verbose && notes.length) console.log(notes.join('\n'));

if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''}:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(unreadable ? 2 : 1);
}

console.log(
  `contract OK — ${schemaNames.length} schemas, ${sampleNames.length} sample files, ${checks} checks`,
);
