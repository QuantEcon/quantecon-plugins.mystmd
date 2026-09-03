/**
 * A read-through file cache that survives `myst start`'s incremental rebuilds.
 *
 * A build re-parses many pages in one process, and several of them may read the same data
 * file. A cache keyed on path alone would pin the first version of that file for the life of
 * the process: regenerate the data and nothing would change until you restarted. Keying on
 * the file's modification time and size instead makes a regenerated file a miss on the very
 * next read, so the plugin never serves stale data it has been asked for again.
 *
 * What this cache cannot do, and what the toolchain issue's third acceptance criterion asked
 * for: make `myst start` notice a CSV edit on its own. Verified behaviour is that editing a
 * data file triggers a full site rebuild, but the engine serves the page from its own mdast
 * cache — keyed on the page's content hash, which has not changed — so the directive never
 * runs and this cache is never consulted. The page updates as soon as the page itself is
 * touched. A plugin cannot register a data file as a dependency of a page; that gap is
 * QuantEcon/mystmd#96. Until it closes, the honest statement is that a fresh `myst build`
 * always reflects the current data, and `myst start` needs the page touched.
 *
 * Modification time alone is not enough. Some filesystems store `mtime` at one-second
 * granularity, and a data file rewritten twice inside the same second with the same length is
 * a real possibility for generated data. Size is added as a cheap second key, and `stat` is
 * called on every read regardless, so the cost of a hit is one `stat` rather than one read
 * plus a parse.
 */
import fs from 'node:fs';

/** A cache of parsed file contents keyed on path, modification time and size. */
export class FileCache {
  #entries = new Map();

  #hits = 0;

  #misses = 0;

  /**
   * Read and parse a file, returning a cached result when the file has not changed.
   *
   * @template T
   * @param {string} filePath absolute path to read
   * @param {(text: string, filePath: string) => T} parse called only on a miss
   * @returns {T}
   */
  read(filePath, parse) {
    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch (error) {
      // Drop any stale entry so a file that reappears is re-read rather than resurrected.
      this.#entries.delete(filePath);
      throw error;
    }
    // `mtimeMs` is a float on some platforms; the raw value is the most precise key available.
    const stamp = `${stats.mtimeMs}:${stats.size}`;
    const entry = this.#entries.get(filePath);
    if (entry && entry.stamp === stamp) {
      this.#hits += 1;
      return entry.value;
    }
    this.#misses += 1;
    const value = parse(fs.readFileSync(filePath, 'utf8'), filePath);
    this.#entries.set(filePath, { stamp, value });
    return value;
  }

  /** Forget one path, or the whole cache when called with no argument. */
  invalidate(filePath) {
    if (filePath === undefined) this.#entries.clear();
    else this.#entries.delete(filePath);
  }

  /** Cache statistics, for tests and for diagnosing a rebuild that is doing too much work. */
  get stats() {
    return { size: this.#entries.size, hits: this.#hits, misses: this.#misses };
  }
}

/**
 * The cache every directive in a bundle shares.
 *
 * One instance per loaded bundle is the right granularity: `myst` loads a plugin once per
 * session, so this lives exactly as long as the build does.
 */
export const fileCache = new FileCache();
