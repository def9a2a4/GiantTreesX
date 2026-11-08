// Simulates java.util.HashMap<WorldChangeKey, ?> iteration order (new HashMap<>(1000)),
// needed because JungleVinePopulator draws randoms while iterating tracker.getChanges().
//
// Without treeified bins the order is: bucket index (spread(hash) & (n-1)) ascending, and within a
// bucket, node insertion order (resize splits preserve relative order). When a bin reaches
// TREEIFY_THRESHOLD the real HashMap converts it to a red-black tree whose linked order depends on
// tree shape (and on System.identityHashCode for equal hashes, which is non-deterministic). We report
// whether that happened so callers can flag potential divergence.

/** WorldChangeKey.hashCode() */
export function keyHash(x, y, z) {
  let r = x | 0;
  r = (Math.imul(31, r) + y) | 0;
  r = (Math.imul(31, r) + z) | 0;
  return r;
}

/**
 * @param {import('./voxels.js').VoxelStore} store entries in node-creation order
 * @returns {{order: Int32Array, treeified: boolean, tableSize: number}}
 */
export function hashMapIterationOrder(store) {
  const n = store.n;
  const spread = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const h = keyHash(store.x[i], store.y[i], store.z[i]);
    spread[i] = h ^ (h >>> 16);
  }
  // final table size: starts at 1024 (tableSizeFor(1000)), doubles when ++size > 0.75*cap
  let cap = 1024;
  // detect treeification: simulate insertion with per-bucket counts at each capacity phase
  let treeified = false;
  {
    let counts = new Int32Array(cap);
    let size = 0;
    for (let i = 0; i < n; i++) {
      const b = spread[i] & (cap - 1);
      // putVal: binCount >= TREEIFY_THRESHOLD - 1 when appending to a list of length >= 8
      if (counts[b] >= 8) treeified = true;
      counts[b]++;
      if (++size > cap * 0.75) {
        cap *= 2;
        counts = new Int32Array(cap);
        for (let j = 0; j <= i; j++) counts[spread[j] & (cap - 1)]++;
      }
    }
  }
  // stable counting sort by final bucket
  const mask = cap - 1;
  const bucketStart = new Int32Array(cap + 1);
  for (let i = 0; i < n; i++) bucketStart[(spread[i] & mask) + 1]++;
  for (let b = 0; b < cap; b++) bucketStart[b + 1] += bucketStart[b];
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[bucketStart[spread[i] & mask]++] = i;
  return { order, treeified, tableSize: cap };
}
