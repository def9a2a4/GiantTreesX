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
    final LeafMix leafMix = style.leaves.isEmpty() ? null : new LeafMix(style.leaves);

    for (final WorldChange change : tracker.getChanges()) {
      final int x = change.location.getBlockX();
      final int y = change.location.getBlockY();
      final int z = change.location.getBlockZ();

      if (change.kind == WorldChange.Kind.LEAVES) {
        if (leafMix != null) {
          change.material = leafMix.pick(x, y, z, seed);
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

  /**
   * A weighted leaf mix, picked per block from the position and tree seed only, so the result
   * doesn't depend on iteration order. Kept in sync with LeafMix in docs/viewer/src/materials.js.
   * <p>
   * Leaves come in patches instead of per-block noise: space is split into jittered Voronoi cells
   * about the size of a leaf cluster ({@link #CELL} blocks apart), and each cell gets one primary
   * leaf, picked with the mix weights. Up to {@link #MAX_BLEND_PERCENT} percent of a cell's
   * blocks (a per-cell amount) take a leaf next to the primary in the mix order instead, so with
   * yellow, orange, red a yellow patch only gets some orange. Leaves weighing at most a tenth of
   * the mix (e.g. shroomlights in a wart cap) are accents: never a patch's primary, sprinkled over
   * single blocks at their weight.
   */
  static final class LeafMix {
    /** Voronoi cell spacing in blocks, roughly a leaf cluster's diameter. */
    static final int CELL = 7;
    static final int MAX_BLEND_PERCENT = 10;
    private static final int SALT_POINT = 1;
    private static final int SALT_CELL = 2;
    private static final int SALT_ACCENT = 3;
    private static final int SALT_BLEND = 4;

    private final Material[] primary;
    private final int[] primaryWeight;
    private final int primaryTotal;
    private final Material[] accent;
    private final int[] accentWeight;
    private final int total;

    LeafMix(final Map<Material, Integer> weights) {
      int sum = 0;
      for (final int w : weights.values()) {
        sum += w;
      }
      int primaries = 0;
      for (final int w : weights.values()) {
        if (w * 10 > sum) {
          primaries++;
        }
      }
      final boolean allPrimary = primaries == 0;
      final int n = allPrimary ? weights.size() : primaries;
      primary = new Material[n];
      primaryWeight = new int[n];
      accent = new Material[weights.size() - n];
      accentWeight = new int[accent.length];
      int p = 0;
      int a = 0;
      int pt = 0;
      for (final Map.Entry<Material, Integer> e : weights.entrySet()) {
        if (allPrimary || e.getValue() * 10 > sum) {
          primary[p] = e.getKey();
          primaryWeight[p++] = e.getValue();
          pt += e.getValue();
        } else {
          accent[a] = e.getKey();
          accentWeight[a++] = e.getValue();
        }
      }
      primaryTotal = pt;
      total = sum;
    }

    Material pick(final int x, final int y, final int z, final int seed) {
      if (accent.length > 0) {
        int roll = (hash(seed, x, y, z, SALT_ACCENT) >>> 1) % total;
        for (int i = 0; i < accent.length; i++) {
          roll -= accentWeight[i];
          if (roll < 0) {
            return accent[i];
          }
        }
      }
      if (primary.length == 1) {
        return primary[0];
      }

      // nearest jittered cell point, in 1/256 blocks relative to the block's own cell
      final int cx = Math.floorDiv(x, CELL);
      final int cy = Math.floorDiv(y, CELL);
      final int cz = Math.floorDiv(z, CELL);
      final int bx = ((x - cx * CELL) << 8) + 128;
      final int by = ((y - cy * CELL) << 8) + 128;
      final int bz = ((z - cz * CELL) << 8) + 128;
      int best = Integer.MAX_VALUE;
      int wx = 0;
      int wy = 0;
      int wz = 0;
      for (int dx = -1; dx <= 1; dx++) {
        for (int dy = -1; dy <= 1; dy++) {
          for (int dz = -1; dz <= 1; dz++) {
            final int h = hash(seed, cx + dx, cy + dy, cz + dz, SALT_POINT);
            final int ex = bx - (dx * CELL * 256 + (h & 0xFF) * CELL);
            final int ey = by - (dy * CELL * 256 + ((h >>> 8) & 0xFF) * CELL);
            final int ez = bz - (dz * CELL * 256 + ((h >>> 16) & 0xFF) * CELL);
            final int d = ex * ex + ey * ey + ez * ez;
            if (d < best) {
              best = d;
              wx = cx + dx;
              wy = cy + dy;
              wz = cz + dz;
            }
          }
        }
      }

      final int ch = hash(seed, wx, wy, wz, SALT_CELL);
      int roll = (ch >>> 1) % primaryTotal;
      int idx = 0;
      while (roll >= primaryWeight[idx]) {
        roll -= primaryWeight[idx];
        idx++;
      }
      final int blendPercent = (ch >>> 24) % (MAX_BLEND_PERCENT + 1);
      final int bh = hash(seed, x, y, z, SALT_BLEND);
      if ((bh >>> 1) % 100 < blendPercent) {
        if (idx == 0) {
          idx = 1;
        } else if (idx == primary.length - 1 || (bh & 1) == 0) {
          idx--;
        } else {
          idx++;
        }
      }
      return primary[idx];
    }

    /** 32-bit integer hash (murmur3 style), cheap and exact to port to JavaScript. */
    static int hash(final int seed, final int a, final int b, final int c, final int salt) {
      int h = seed ^ (salt * 0x9E3779B9);
      h = Integer.rotateLeft(h ^ (a * 0xCC9E2D51), 13) * 5 + 0xE6546B64;
      h = Integer.rotateLeft(h ^ (b * 0xCC9E2D51), 13) * 5 + 0xE6546B64;
      h = Integer.rotateLeft(h ^ (c * 0xCC9E2D51), 13) * 5 + 0xE6546B64;
      h ^= h >>> 16;
      h *= 0x85EBCA6B;
      h ^= h >>> 13;
      h *= 0xC2B2AE35;
      h ^= h >>> 16;
      return h;
    }
  }

  static long key(final int x, final int y, final int z) {
    return ((long) (x & 0x1FFFFF) << 42) | ((long) (y & 0x1FFFFF) << 21) | (z & 0x1FFFFF);
  }
}
