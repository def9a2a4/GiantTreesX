package com.ryanmichela.trees.rendering;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

import org.bukkit.Material;
import org.bukkit.block.data.Ageable;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.type.HangingMoss;
import org.bukkit.util.Vector;

/**
 * Hangs strands below a tree's leaves: vines down the sides of leaf blocks (swamp trees) or a
 * hanging block such as pale hanging moss or weeping vines straight below them.
 * <p>
 * Every decision is a hash of the seed and the leaf position, and strands only test the blocks the
 * tree had before decorating, so the result doesn't depend on the tracker's iteration order. Kept
 * in sync with decorateLeaves in docs/viewer/src/render.js.
 */
final class LeafDecorator {

  /** A leaf side grows a vine when hash % VINE_ONE_IN == 0. */
  static final int VINE_ONE_IN = 10;
  static final int VINE_MIN = 2;
  static final int VINE_MAX = 8;
  /** HANGING thinning on top of the type's own odds: a leaf bottom grows a strand when
   *  hash % (TreeType.hangingOneIn * HANGING_SPARSER) == 0. */
  static final int HANGING_SPARSER = 2;

  private LeafDecorator() {
  }

  static void populate(final WorldChangeTracker tracker, final TreeType type, final int seed) {
    if (type.decoration == TreeType.Decoration.LEAF_VINES) {
      vines(tracker, seed);
    } else if (type.decoration == TreeType.Decoration.HANGING) {
      hanging(tracker, type, seed);
    }
  }

  private static void vines(final WorldChangeTracker tracker, final int seed) {
    // cell -> face index; where two strands meet, the lower face index wins
    final Map<WorldChangeKey, Integer> cells = new HashMap<>();
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
        final int vx = x + JungleVinePopulator.SIDES[s][0];
        final int vz = z + JungleVinePopulator.SIDES[s][1];
        final int length = VINE_MIN + Math.floorMod(h >>> 8, VINE_MAX - VINE_MIN + 1);
        for (int vy = y; vy > y - length && vy >= 1; vy--) {
          final WorldChangeKey key = new WorldChangeKey(vx, vy, vz);
          if (tracker.getChange(key) != null) {
            break;
          }
          final Integer old = cells.get(key);
          if (old == null || s < old) {
            cells.put(key, s);
          }
        }
      }
    }
    final List<WorldChange> added = new ArrayList<>(cells.size());
    for (final Map.Entry<WorldChangeKey, Integer> e : cells.entrySet()) {
      added.add(new WorldChange(e.getKey().toVector(), Material.VINE,
                                JungleVinePopulator.orient(JungleVinePopulator.FACES[e.getValue()]),
                                WorldChange.Kind.VINE, -1));
    }
    for (final WorldChange c : added) {
      tracker.addChange(c, false);
    }
  }

  /**
   * Strands of {@link TreeType#hangingMaterial} below leaf bottoms, ending in
   * {@link TreeType#hangingTipMaterial} (the same block with its tip state for pale hanging moss,
   * a fully grown WEEPING_VINES below WEEPING_VINES_PLANT for crimson fungi).
   */
  private static void hanging(final WorldChangeTracker tracker, final TreeType type,
                              final int seed) {
    final int oneIn = type.hangingOneIn * HANGING_SPARSER;
    final int min = type.hangingMin;
    final int max = type.hangingMax;
    final List<WorldChange> added = new ArrayList<>();
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind != WorldChange.Kind.LEAVES) {
        continue;
      }
      final int x = change.location.getBlockX();
      final int y = change.location.getBlockY();
      final int z = change.location.getBlockZ();
      final int h = hash(seed, x, y, z, 4);
      if (Math.floorMod(h, oneIn) != 0) {
        continue;
      }
      final int length = min + Math.floorMod(h >>> 8, max - min + 1);
      // strands stop at the first block of the tree, so two never share a cell
      int bottom = y;
      for (int vy = y - 1; vy >= y - length && vy >= 1; vy--) {
        if (tracker.getChange(new WorldChangeKey(x, vy, z)) != null) {
          break;
        }
        bottom = vy;
      }
      for (int vy = y - 1; vy >= bottom; vy--) {
        final boolean tip = vy == bottom;
        added.add(new WorldChange(new Vector(x, vy, z),
                                  tip ? type.hangingTipMaterial : type.hangingMaterial, tip(tip),
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

  private static UnaryOperator<BlockData> tip(final boolean tip) {
    return blockData -> {
      if (blockData instanceof HangingMoss) {
        ((HangingMoss) blockData).setTip(tip);
      } else if (tip && blockData instanceof Ageable) {
        // a fully grown vine tip doesn't keep growing down
        final Ageable ageable = (Ageable) blockData;
        ageable.setAge(ageable.getMaximumAge());
      }
      return blockData;
    };
  }
}
