/**
 * Project-root resolution for `:file:` directive sources.
 *
 * `DirectiveSpec.run` is synchronous and the only location it is handed is `vfile.path`, the
 * absolute path of the markdown file being parsed. A `:file:` option must therefore be
 * resolved without any async lookup and without knowing the working directory, which for
 * `myst build` is not reliably the project root.
 *
 * The rule this module implements: walk up from the page's own directory until a `myst.yml`
 * is found, and treat that directory as the project root. `:file:` paths resolve against the
 * project root, not against the page, so that the same `:file: data/scores.csv` works from a
 * page at any depth in the tree. A path may also be written relative to the page by prefixing
 * it with `./` or `../`, which is the escape hatch for a page that keeps data beside itself.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The file whose presence marks a MyST project root. */
export const PROJECT_MARKER = 'myst.yml';

/**
 * Find the MyST project root by walking up from a starting path.
 *
 * @param {string} from a file or directory path inside the project
 * @returns {string|null} the absolute directory holding `myst.yml`, or `null` if there is none
 */
export function findProjectRoot(from) {
  if (!from) return null;
  let dir = path.resolve(from);
  // A path that exists and is a directory starts there; anything else starts at its parent,
  // which covers both a real file and a path that has not been written yet.
  try {
    if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir);
  }
  // path.dirname('/') === '/', so the root of the filesystem terminates the walk.
  for (let previous = null; dir !== previous; previous = dir, dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, PROJECT_MARKER))) return dir;
  }
  return null;
}

/** Thrown when a `:file:` source cannot be resolved to a readable path inside the project. */
export class ResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/**
 * Resolve a `:file:` option to an absolute path.
 *
 * @param {string} file the `:file:` value as written by the author
 * @param {string} pagePath the absolute path of the page being parsed (`vfile.path`)
 * @param {{root?: string, allowOutsideRoot?: boolean}} [options]
 *   `root` overrides project-root discovery. `allowOutsideRoot` (default false) permits a
 *   resolved path outside the project root; it exists for tests, not for content.
 * @returns {{path: string, root: string|null, relative: string}}
 */
export function resolveFile(file, pagePath, options = {}) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new ResolutionError('a file source must be a non-empty path');
  }
  const raw = file.trim();
  if (path.isAbsolute(raw)) {
    throw new ResolutionError(
      `"${raw}" is an absolute path; write it relative to the project root so the project stays portable`,
    );
  }

  const root = options.root ?? findProjectRoot(pagePath);
  // './x' and '../x' are explicitly page-relative; everything else is project-relative.
  const pageRelative = /^\.\.?[/\\]/.test(raw);

  let base;
  if (pageRelative) {
    if (!pagePath) {
      throw new ResolutionError(
        `"${raw}" is written relative to the page, but the page has no path on disk`,
      );
    }
    base = path.dirname(path.resolve(pagePath));
  } else {
    if (!root) {
      throw new ResolutionError(
        `cannot resolve "${raw}": no ${PROJECT_MARKER} was found above ${pagePath ?? 'the page'}`,
      );
    }
    base = root;
  }

  const resolved = path.resolve(base, raw);

  if (root && !options.allowOutsideRoot) {
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ResolutionError(
        `"${raw}" resolves outside the project root ${root}; data must live inside the project`,
      );
    }
  }

  return {
    path: resolved,
    root: root ?? null,
    relative: root ? path.relative(root, resolved) : resolved,
  };
}
