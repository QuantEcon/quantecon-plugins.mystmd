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
 * rejected is accepted, and prints the schema path that should have caught it.
 *
 * `ajv` is a devDependency, which the bundle constraint permits: nothing here is bundled
 * into a plugin. Hand-rolling a JSON Schema subset was the alternative and was rejected —
 * schemas checked by a partial implementation of the spec are not checked.
 *
 * Usage: node scripts/validate-contract.mjs [--verbose]
 * Exit codes: 0 all checks passed · 1 a check failed · 2 the fixtures are malformed
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

function fail(message) {
  problems.push(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${path.relative(repoRoot, file)}: not readable as JSON — ${error.message}`);
    return null;
  }
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
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
  if (!schemaNames.includes(primitive)) fail(`schema/${primitive}.json is missing`);
  if (!sampleNames.includes(primitive)) fail(`samples/${primitive}.json is missing`);
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
    } else if (verbose) {
      notes.push(`  ${where} correctly rejected: ${entry.because}`);
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

if (verbose && notes.length) console.log(notes.join('\n'));

if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''}:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(schemaNames.length === 0 || sampleNames.length === 0 ? 2 : 1);
}

console.log(
  `contract OK — ${schemaNames.length} schemas, ${sampleNames.length} sample files, ${checks} checks`,
);
