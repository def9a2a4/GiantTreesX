package com.ryanmichela.trees.rendering;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

import org.bukkit.Material;

/**
 * Assigns final wood and leaf blocks once a tree's geometry is drawn.
 * <p>
 * Every wood block gets a depth: 1 for blocks with a non-wood face neighbour (the outer layer),
 * 2 for blocks touching only wood but next to a depth-1 block, and so on inward. The
 * {@link WoodStyle} then picks bark, core and hollow blocks from that depth.
 */
final class WoodStyler {

  private static final int[][] FACES = {
      {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}
  };

  private WoodStyler() {
  }

  static void apply(final WorldChangeTracker tracker, final WoodStyle style, final int seed) {
    final boolean hollow = style.hollowChance > 0
                           && new Random(seed).nextDouble() * 100 < style.hollowChance;
    final boolean needsDepth = style.mode != WoodStyle.Mode.ALL_LOG || hollow;
    final Map<Long, Integer> depth = needsDepth ? woodDepth(tracker) : null;

    for (final WorldChange change : tracker.getChanges()) {
      final int x = change.location.getBlockX();
      final int y = change.location.getBlockY();
      final int z = change.location.getBlockZ();

      if (change.kind == WorldChange.Kind.LEAVES) {
        if (!style.leaves.isEmpty()) {
          change.material = pickLeaf(style.leaves, x, y, z, seed);
        }
        continue;
      }
      if (change.kind != WorldChange.Kind.WOOD || depth == null) {
        continue;
      }

      final int d = depth.get(key(x, y, z));
      if (hollow && change.level == 0 && y >= 1 && d > style.hollowWallThickness) {
        // only the trunk above the base is carved, so the tree stays anchored
        change.material = Material.AIR;
      } else if (style.mode == WoodStyle.Mode.MIXED || style.mode == WoodStyle.Mode.MIXED_STRIPPED) {
        if (d == 1) {
          change.material = barkOf(change.material);
        } else if (style.mode == WoodStyle.Mode.MIXED_STRIPPED) {
          change.material = strippedOf(change.material);
        }
      }
    }
  }

  /** Multi-source BFS from the outer layer inward over 6-connected wood blocks. */
  private static Map<Long, Integer> woodDepth(final WorldChangeTracker tracker) {
    final Map<Long, Integer> depth = new HashMap<>();
    final Map<Long, Boolean> isWood = new HashMap<>();
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind == WorldChange.Kind.WOOD) {
        isWood.put(key(change.location.getBlockX(), change.location.getBlockY(),
                       change.location.getBlockZ()), Boolean.TRUE);
      }
    }

    final ArrayDeque<long[]> queue = new ArrayDeque<>();
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind != WorldChange.Kind.WOOD) {
        continue;
      }
      final int x = change.location.getBlockX();
      final int y = change.location.getBlockY();
      final int z = change.location.getBlockZ();
      for (final int[] f : FACES) {
        if (!isWood.containsKey(key(x + f[0], y + f[1], z + f[2]))) {
          depth.put(key(x, y, z), 1);
          queue.add(new long[] {x, y, z});
          break;
        }
      }
    }

    while (!queue.isEmpty()) {
      final long[] p = queue.poll();
      final int next = depth.get(key((int) p[0], (int) p[1], (int) p[2])) + 1;
      for (final int[] f : FACES) {
        final int nx = (int) p[0] + f[0];
        final int ny = (int) p[1] + f[1];
        final int nz = (int) p[2] + f[2];
        final long k = key(nx, ny, nz);
        if (isWood.containsKey(k) && !depth.containsKey(k)) {
          depth.put(k, next);
          queue.add(new long[] {nx, ny, nz});
        }
      }
    }
    return depth;
  }

  /** OAK_LOG -> OAK_WOOD, CRIMSON_STEM -> CRIMSON_HYPHAE; unchanged when there is no such block. */
  static Material barkOf(final Material log) {
    final String name = log.name();
    if (name.endsWith("_LOG")) {
      return orSame(name.substring(0, name.length() - 4) + "_WOOD", log);
    }
    if (name.endsWith("_STEM")) {
      return orSame(name.substring(0, name.length() - 5) + "_HYPHAE", log);
    }
    return log;
  }

  /** OAK_LOG -> STRIPPED_OAK_LOG; unchanged when there is no such block. */
  static Material strippedOf(final Material log) {
    final String name = log.name();
    if (name.endsWith("_LOG") || name.endsWith("_STEM")) {
      return orSame("STRIPPED_" + name, log);
    }
    return log;
  }

  private static Material orSame(final String name, final Material fallback) {
    final Material material = Material.getMaterial(name);
    return material != null ? material : fallback;
  }

  /** Position-hashed weighted pick, so the result doesn't depend on iteration order. */
  static Material pickLeaf(final Map<Material, Integer> weights, final int x, final int y,
                           final int z, final int seed) {
    int total = 0;
    for (final int w : weights.values()) {
      total += w;
    }
    long h = seed;
    h = h * 0x9E3779B97F4A7C15L + x;
    h = h * 0x9E3779B97F4A7C15L + y;
    h = h * 0x9E3779B97F4A7C15L + z;
    h ^= (h >>> 31);
    h *= 0xBF58476D1CE4E5B9L;
    h ^= (h >>> 29);
    int roll = (int) Math.floorMod(h, (long) total);
    for (final Map.Entry<Material, Integer> e : weights.entrySet()) {
      roll -= e.getValue();
      if (roll < 0) {
        return e.getKey();
      }
    }
    return weights.keySet().iterator().next();
  }

  static long key(final int x, final int y, final int z) {
    return ((long) (x & 0x1FFFFF) << 42) | ((long) (y & 0x1FFFFF) << 21) | (z & 0x1FFFFF);
  }
}
