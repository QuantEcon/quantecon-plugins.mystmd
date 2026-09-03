/** Unit tests for the mtime-and-size keyed read-through cache in src/lib/cache.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { FileCache, fileCache } from '../../src/lib/cache.mjs';

let dir;
let file;

before(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qe-cache-')));
  file = path.join(dir, 'data.csv');
  fs.writeFileSync(file, 'a\n1\n');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('parses once and serves the cached value while the file is unchanged', () => {
  const cache = new FileCache();
  let parses = 0;
  const parse = (text) => {
    parses += 1;
    return text.trim();
  };
  assert.equal(cache.read(file, parse), 'a\n1');
  assert.equal(cache.read(file, parse), 'a\n1');
  assert.equal(parses, 1);
  assert.deepEqual(cache.stats, { size: 1, hits: 1, misses: 1 });
});

test('re-reads after the file changes, which is what myst start needs', () => {
  const cache = new FileCache();
  let parses = 0;
  const parse = (text) => {
    parses += 1;
    return text.trim();
  };
  cache.read(file, parse);
  // Rewrite with different content and stamp an unambiguously later mtime, so the test does
  // not depend on the filesystem's mtime granularity.
  fs.writeFileSync(file, 'a\n2\n');
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(file, later, later);
  assert.equal(cache.read(file, parse), 'a\n2');
  assert.equal(parses, 2);
});

test('re-reads when the size changes even if the mtime does not', () => {
  const cache = new FileCache();
  let parses = 0;
  const parse = (text) => {
    parses += 1;
    return text.trim();
  };
  const twin = path.join(dir, 'twin.csv');
  fs.writeFileSync(twin, 'a\n1\n');
  const stamp = new Date(Date.now() - 60_000);
  fs.utimesSync(twin, stamp, stamp);
  cache.read(twin, parse);
  // Same modification time, different length: only the size key catches this.
  fs.writeFileSync(twin, 'a\n1\n2\n');
  fs.utimesSync(twin, stamp, stamp);
  assert.equal(cache.read(twin, parse), 'a\n1\n2');
  assert.equal(parses, 2);
});

test('propagates a read error and forgets the stale entry', () => {
  const cache = new FileCache();
  const gone = path.join(dir, 'gone.csv');
  fs.writeFileSync(gone, 'a\n1\n');
  assert.equal(cache.read(gone, (text) => text.trim()), 'a\n1');
  fs.rmSync(gone);
  assert.throws(() => cache.read(gone, (text) => text.trim()), { code: 'ENOENT' });
  assert.equal(cache.stats.size, 0, 'the stale entry should not survive a failed read');
});

test('invalidate clears one path or the whole cache', () => {
  const cache = new FileCache();
  cache.read(file, (text) => text.trim());
  cache.invalidate(file);
  assert.equal(cache.stats.size, 0);
  cache.read(file, (text) => text.trim());
  cache.invalidate();
  assert.equal(cache.stats.size, 0);
});

test('the shared instance is a FileCache', () => {
  assert.ok(fileCache instanceof FileCache);
});
