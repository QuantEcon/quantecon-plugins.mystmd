/**
 * A probe plugin that exercises the whole toolchain end to end against the real `myst` CLI.
 *
 * It is deliberately not one of the eight contract primitives — those are
 * QuantEcon/quantecon-plugins.mystmd#5 and #6. Its job is to prove, through a real build,
 * that the pieces #4 delivers actually work in the engine rather than only in unit tests:
 * `:file:` resolution from a page at depth, the CSV reader, the mtime-and-size cache across
 * an incremental rebuild, deferred diagnostics reaching `--strict`, and the fact that a
 * bundled multi-file source tree loads at all.
 *
 * It is bundled by the tests exactly the way `datavis.mjs` is bundled for release, so a
 * regression in the bundle step fails here too.
 */
import { readCsv, requireColumns, typed } from '../../../src/lib/csv.mjs';
import { fileCache } from '../../../src/lib/cache.mjs';
import { resolveFile } from '../../../src/lib/project.mjs';
import { defer, diagnosticsTransform, errorNode } from '../../../src/lib/report.mjs';

const probeDirective = {
  name: 'probe-table',
  doc: 'Read a two-column CSV and emit a classed div wrapping a real table.',
  options: {
    file: { type: String, required: true, doc: 'CSV path, relative to the project root.' },
    label: { type: String, doc: 'A label carried through as a node property.' },
  },
  run(data, vfile) {
    const file = data.options?.file;
    let resolved;
    try {
      resolved = resolveFile(file, vfile?.path);
    } catch (error) {
      return [errorNode('probe', error.message)];
    }

    let table;
    try {
      table = fileCache.read(resolved.path, (text) => {
        const parsed = readCsv(text);
        requireColumns(parsed, ['rule', 'reach'], resolved.relative);
        return typed(parsed.rows, ['reach']);
      });
    } catch (error) {
      return [errorNode('probe', `cannot read ${resolved.relative}: ${error.message}`)];
    }

    const rows = table.map((row) => ({ rule: row.rule, reach: row.reach }));
    const node = {
      type: 'div',
      class: 'qe-dv qe-dv-probe',
      contract: '1.0',
      primitive: 'probe',
      source: resolved.relative,
      label: data.options?.label ?? null,
      rows,
      children: [
        {
          type: 'table',
          children: [
            headerRow(['rule', 'reach']),
            ...rows.map((row) => bodyRow(row.rule, row.reach)),
          ],
        },
      ],
    };
    // A row with no reach is a hole in the data, not a zero: warn without failing the build.
    const holes = rows.filter((row) => row.reach === null).map((row) => row.rule);
    if (holes.length > 0) {
      defer(node, 'warn', `no reach recorded for ${holes.join(', ')} in ${resolved.relative}`);
    }
    return [node];
  },
};

function headerRow(names) {
  return {
    type: 'tableRow',
    children: names.map((name) => ({
      type: 'tableCell',
      header: true,
      children: [{ type: 'text', value: name }],
    })),
  };
}

function bodyRow(rule, reach) {
  return {
    type: 'tableRow',
    children: [
      { type: 'tableCell', children: [{ type: 'inlineCode', value: String(rule) }] },
      {
        type: 'tableCell',
        align: 'right',
        children: [{ type: 'text', value: reach === null ? '—' : String(reach) }],
      },
    ],
  };
}

export default {
  name: 'Toolchain probe',
  directives: [probeDirective],
  // The same transform the real family registers: without it a deferred diagnostic is
  // logged but never counted by `--strict`.
  transforms: [diagnosticsTransform],
};
