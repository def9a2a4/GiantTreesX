package com.ryanmichela.trees.rendering;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.type.HangingMoss;
import org.bukkit.util.Vector;

/**
 * Hangs strands below a tree's leaves: vines down the sides of leaf blocks (swamp trees) or a
 * hanging block such as pale hanging moss straight below them.
 * <p>
 * Every decision is a hash of the seed and the leaf position, and strands only test the blocks the
 * tree had before decorating, so the result doesn't depend on the tracker's iteration order. Kept
 * in sync with decorateLeaves in docs/viewer/src/render.js.
 */
final class LeafDecorator {

  /** A leaf side grows a vine when hash % VINE_ONE_IN == 0. */
  static final int VINE_ONE_IN = 5;
  static final int VINE_MIN = 2;
  static final int VINE_MAX = 12;
  /** A leaf bottom grows a hanging strand when hash % HANGING_ONE_IN == 0. */
  static final int HANGING_ONE_IN = 4;
  static final int HANGING_MIN = 1;
  static final int HANGING_MAX = 6;

  /** dx, dz of the vine's cell relative to the leaf, in the order N, S, E, W. */
  private static final int[][] SIDES = {{0, -1}, {0, 1}, {1, 0}, {-1, 0}};
  /** The face of the vine block that touches the leaf, per side (as JungleVinePopulator). */
  private static final BlockFace[] FACES = {BlockFace.SOUTH, BlockFace.NORTH, BlockFace.WEST, BlockFace.EAST};

  private LeafDecorator() {
  }

  static void populate(final WorldChangeTracker tracker, final TreeType type, final int seed) {
    if (type.decoration == TreeType.Decoration.LEAF_VINES) {
      vines(tracker, seed);
    } else if (type.decoration == TreeType.Decoration.HANGING) {
      hanging(tracker, type.hangingMaterial, seed);
    }
  }

  private static void vines(final WorldChangeTracker tracker, final int seed) {
    // cell -> face index; where two strands meet, the lower face index wins
    final Map<WorldChangeKey, Integer> cells = new HashMap<>();
    final WorldChangeKey probe = new WorldChangeKey();
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind != WorldChange.Kind.LEAVES) {
        continue;
      }
      final int x = change.location.getBlockX();
      final int y = change.location.getBlockY();
      final int z = change.location.getBlockZ();
      for (int s = 0; s < 4; s++) {
        final int h = hash(seed, x, y, z, s);
        if (Math.floorMod(h, VINE_ONE_IN) != 0) {
          continue;
        }
        final int vx = x + SIDES[s][0];
        final int vz = z + SIDES[s][1];
        final int length = VINE_MIN + Math.floorMod(h >>> 8, VINE_MAX - VINE_MIN + 1);
        for (int vy = y; vy > y - length && vy >= 1; vy--) {
          probe.x = vx;
          probe.y = vy;
          probe.z = vz;
          if (tracker.getChange(probe) != null) {
            break;
          }
          final WorldChangeKey key = new WorldChangeKey(vx, vy, vz);
          final Integer old = cells.get(key);
          if (old == null || s < old) {
            cells.put(key, s);
          }
        }
      }
    }
    final List<WorldChange> added = new ArrayList<>(cells.size());
    for (final Map.Entry<WorldChangeKey, Integer> e : cells.entrySet()) {
      added.add(new WorldChange(e.getKey().toVector(), Material.VINE, face(FACES[e.getValue()]),
                                WorldChange.Kind.VINE, -1));
    }
    for (final WorldChange c : added) {
      tracker.addChange(c, false);
    }
  }

  private static void hanging(final WorldChangeTracker tracker, final Material material,
                              final int seed) {
    final List<WorldChange> added = new ArrayList<>();
    final WorldChangeKey probe = new WorldChangeKey();
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind != WorldChange.Kind.LEAVES) {
        continue;
      }
      final int x = change.location.getBlockX();
      final int y = change.location.getBlockY();
      final int z = change.location.getBlockZ();
      final int h = hash(seed, x, y, z, 4);
      if (Math.floorMod(h, HANGING_ONE_IN) != 0) {
        continue;
      }
      final int length = HANGING_MIN + Math.floorMod(h >>> 8, HANGING_MAX - HANGING_MIN + 1);
      // strands stop at the first block of the tree, so two never share a cell
      int bottom = y;
      for (int vy = y - 1; vy >= y - length && vy >= 1; vy--) {
        probe.x = x;
        probe.y = vy;
        probe.z = z;
        if (tracker.getChange(probe) != null) {
          break;
        }
        bottom = vy;
      }
      for (int vy = y - 1; vy >= bottom; vy--) {
        added.add(new WorldChange(new Vector(x, vy, z), material, tip(vy == bottom),
                                  WorldChange.Kind.HANGING, -1));
      }
    }
    for (final WorldChange c : added) {
      tracker.addChange(c, false);
    }
  }

  /** 32-bit position hash; docs/viewer/src/render.js computes the same with Math.imul. */
  static int hash(final int seed, final int x, final int y, final int z, final int salt) {
    int h = seed;
    h = h * 0x9E3779B1 + x;
    h = h * 0x9E3779B1 + y;
    h = h * 0x9E3779B1 + z;
    h = h * 0x9E3779B1 + salt;
    h ^= h >>> 16;
    h *= 0x85EBCA6B;
    h ^= h >>> 13;
    h *= 0xC2B2AE35;
    h ^= h >>> 16;
    return h;
  }

  private static UnaryOperator<BlockData> face(final BlockFace direction) {
    return blockData -> {
      if (blockData instanceof MultipleFacing) {
        final MultipleFacing facing = (MultipleFacing) blockData;
        facing.setFace(BlockFace.NORTH, false);
        facing.setFace(BlockFace.SOUTH, false);
        facing.setFace(BlockFace.EAST, false);
        facing.setFace(BlockFace.WEST, false);
        facing.setFace(direction, true);
      }
      return blockData;
    };
  }

  private static UnaryOperator<BlockData> tip(final boolean tip) {
    return blockData -> {
      if (blockData instanceof HangingMoss) {
        ((HangingMoss) blockData).setTip(tip);
      }
      return blockData;
    };
  }
}
