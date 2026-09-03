/**
 * Shared machinery for the end-to-end plugin tests: bundle a plugin, lay out a throwaway
 * MyST project, run the real `myst` CLI over it and read back the page JSON.
 *
 * Two choices are worth stating, because they are what keep this suite fast and free of
 * network dependencies:
 *
 *   - The fixture project points `site.template` at `tests/fixtures/template`, a directory
 *     holding nothing but a `template.yml`. `myst build --site` requires a site template to
 *     resolve, and the default resolves over the network from the template registry. A local
 *     stand-in removes that dependency; the tests assert on `_build/site/content/*.json`,
 *     which the engine writes regardless of what the template renders. (The CLI still makes
 *     one outbound call per run, an update check, and tolerates its failure — so the suite
 *     passes with the network denied but is not silent on it.)
 *   - `--strict` accounting lives in the site build path (`processSite`), so a test that
 *     asserts a build fails must use `--site`, not `--md` or `--tex`.
 */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { bundleFamily, repoRoot } from '../../scripts/bundle.mjs';

const exec = promisify(execFile);

export const testsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE = path.join(testsRoot, 'fixtures', 'template');
export const BUILD_TIMEOUT_MS = 180_000;

/** Whether the real `myst` CLI is on PATH. */
export function mystAvailable() {
  try {
    execFileSync('myst', ['--version'], { encoding: 'utf8', timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * The skip reason for the plugin tests when `myst` is missing — or, on CI, a hard failure.
 *
 * A skipped `describe` block folds a dozen tests into one "skipped" line and exits 0, which
 * is how a runner with no `myst` on it turns a red suite green. Locally that is a
 * convenience; on CI it would mean the plugin tests had silently stopped running, so there
 * the absence of the CLI is an error thrown at import time, which no test can skip past.
 */
export const skipWithoutMyst = mystAvailable()
  ? false
  : 'the myst CLI is not on PATH (install mystmd to run the plugin tests)';

if (skipWithoutMyst && process.env.CI) {
  throw new Error(`${skipWithoutMyst}; on CI that is a failure, not a skip`);
}

/** Make a throwaway directory that the caller is responsible for removing. */
export function tempDir(prefix) {
  // `realpathSync` because macOS reaches its temp directory through a symlink, and the
  // project-root walk compares real paths.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/**
 * Bundle a plugin entry point to a single file, exactly as a release asset is built.
 *
 * @param {string} entry repo-relative path of the entry module
 * @param {string} name bundle name, without the extension
 * @param {string} outdir
 * @returns {Promise<string>} the bundle's absolute path
 */
export async function bundleTo(entry, name, outdir) {
  const { outfile } = await bundleFamily({ name, entry }, { outdir });
  return outfile;
}

/** A YAML scalar that survives any path: JSON string syntax is valid YAML double-quoting. */
const yaml = (value) => JSON.stringify(String(value));

/**
 * Write a fixture project.
 *
 * @param {string} dir
 * @param {{plugins?: string[], files?: Record<string, string>, toc?: string[]}} spec
 *   `files` maps project-relative paths to contents; directories are created as needed.
 *   `toc` defaults to every `.md` file in `files`, in insertion order.
 */
export function writeProject(dir, spec) {
  const files = spec.files ?? {};
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  const toc = spec.toc ?? Object.keys(files).filter((name) => name.endsWith('.md'));
  // Every path is quoted: a temp directory on a CI runner may contain a space, a colon or a
  // hash, any of which turns an unquoted YAML value into something else.
  const lines = [
    'version: 1',
    'project:',
    '  title: Plugin Fixture',
    ...(spec.plugins?.length
      ? ['  plugins:', ...spec.plugins.map((plugin) => `    - ${yaml(plugin)}`)]
      : []),
    '  toc:',
    ...toc.map((file) => `    - file: ${yaml(file)}`),
    'site:',
    '  title: Plugin Fixture',
    `  template: ${yaml(TEMPLATE)}`,
    '',
  ];
  fs.writeFileSync(path.join(dir, 'myst.yml'), lines.join('\n'));
  return dir;
}

/**
 * Run `myst build --site` in a fixture project.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} — never rejects on a
 *   non-zero exit, because a failing build is the assertion in several tests.
 */
export async function mystBuild(cwd, { strict = false } = {}) {
  const args = ['build', '--site', ...(strict ? ['--strict'] : [])];
  try {
    const { stdout, stderr } = await exec('myst', args, { cwd, timeout: BUILD_TIMEOUT_MS });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error),
    };
  }
}

/** Read one built page's JSON. `slug` is the page's TOC slug, e.g. 'index'. */
export function readPage(cwd, slug = 'index') {
  return JSON.parse(fs.readFileSync(path.join(cwd, '_build', 'site', 'content', `${slug}.json`), 'utf8'));
}

/** Every node of a given type in a page's mdast, in document order. */
export function selectAll(tree, type) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === type) found.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(tree);
  return found;
}

/** The concatenated text of a node's subtree. */
export function textOf(node) {
  let text = '';
  const walk = (current) => {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) return current.forEach(walk);
    if (typeof current.value === 'string') text += current.value;
    if (Array.isArray(current.children)) current.children.forEach(walk);
  };
  walk(node);
  return text;
}

export { repoRoot };
