/**
 * Shared machinery for the end-to-end plugin tests: bundle a plugin, lay out a throwaway
 * MyST project, run the real `myst` CLI over it and read back the page JSON.
 *
 * Two choices are worth stating, because they are what keep this suite fast and offline:
 *
 *   - The fixture project points `site.template` at `tests/fixtures/template`, a directory
 *     holding nothing but a `template.yml`. `myst build --site` requires a site template to
 *     resolve, and the default resolves over the network from the template registry. A local
 *     stand-in removes that dependency; the tests assert on `_build/site/content/*.json`,
 *     which the engine writes regardless of what the template renders.
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

/** Whether the real `myst` CLI is on PATH; the plugin tests skip without it. */
export function mystAvailable() {
  try {
    execFileSync('myst', ['--version'], { encoding: 'utf8', timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

export const skipWithoutMyst = mystAvailable()
  ? false
  : 'the myst CLI is not on PATH (install mystmd to run the plugin tests)';

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

/**
 * Write a fixture project.
 *
 * @param {string} dir
 * @param {{plugins?: string[], files?: Record<string, string>, toc?: string[], strictTemplate?: boolean}} spec
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
  const lines = [
    'version: 1',
    'project:',
    '  title: Plugin Fixture',
    ...(spec.plugins?.length
      ? ['  plugins:', ...spec.plugins.map((plugin) => `    - ${plugin}`)]
      : []),
    '  toc:',
    ...toc.map((file) => `    - file: ${file}`),
    'site:',
    '  title: Plugin Fixture',
    `  template: ${TEMPLATE}`,
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
