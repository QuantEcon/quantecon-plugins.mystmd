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
 *
 * Either way the data has to live inside the project. That is a portability rule rather than
 * a security boundary — an author who can write `:file:` can already read their own disk —
 * but a project that reads outside its own tree does not build anywhere else, and the check
 * that says so has to mean it. So containment is checked on real paths: a symlink inside the
 * project that points outside it is refused, as is a page-relative path from a page that has
 * no project above it at all.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The file whose presence marks a MyST project root. */
export const PROJECT_MARKER = 'myst.yml';

/**
 * Find the MyST project root by walking up from a starting path.
 *
 * Where two projects nest, the nearer one wins, which is what a page in a sub-project means
 * by "the project".
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
 * The real path of the longest existing prefix of `target`, joined to the rest.
 *
 * `fs.realpathSync` throws on a path that does not exist yet, and a `:file:` target may not
 * exist — that is the missing-CSV case the caller reports separately. So the walk goes up to
 * the nearest ancestor that does exist, resolves that, and re-attaches the tail.
 */
function realpathLenient(target) {
  let existing = target;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), ...tail);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return target;
      tail.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/** Whether `child` is `parent` or inside it, comparing whole path segments. */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** A path relative to the root, always with forward slashes, whatever the platform. */
function posixRelative(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

/**
 * Resolve a `:file:` option to an absolute path.
 *
 * @param {string} file the `:file:` value as written by the author
 * @param {string} pagePath the absolute path of the page being parsed (`vfile.path`)
 * @param {{root?: string, allowOutsideRoot?: boolean}} [options]
 *   `root` overrides project-root discovery and must be an absolute path. `allowOutsideRoot`
 *   (default false) permits a resolved path outside the project root; it exists for tests,
 *   not for content.
 * @returns {{path: string, root: string|null, relative: string}}
 *   `path` is the OS path to read. `relative` is the path from the root with forward slashes,
 *   so a node property built from it is the same on every platform.
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

  let root;
  if (options.root !== undefined && options.root !== '') {
    if (typeof options.root !== 'string' || !path.isAbsolute(options.root)) {
      throw new ResolutionError(`a root override must be an absolute path, got ${JSON.stringify(options.root)}`);
    }
    root = options.root;
  } else {
    root = findProjectRoot(pagePath);
  }

  // './x' and '../x' are explicitly page-relative; everything else is project-relative.
  const pageRelative = /^\.\.?[/\\]/.test(raw);

  if (!root && !options.allowOutsideRoot) {
    throw new ResolutionError(
      `cannot resolve "${raw}": no ${PROJECT_MARKER} was found above ${pagePath ?? 'the page'}`,
    );
  }

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
    // Lexical first, so the message can quote the path the author wrote; then physical, so
    // a symlink cannot make the lexical answer a lie.
    if (!isInside(root, resolved) || !isInside(realpathLenient(root), realpathLenient(resolved))) {
      throw new ResolutionError(
        `"${raw}" resolves outside the project root ${root}; data must live inside the project`,
      );
    }
  }

  return {
    path: resolved,
    root: root ?? null,
    relative: root ? posixRelative(root, resolved) : resolved,
  };
}
