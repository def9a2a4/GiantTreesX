package io.github.def9a2a4.gianttreesx.rendering;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.function.UnaryOperator;

import org.bukkit.Tag;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.type.Leaves;

/**
 * Makes a tree's leaves decay like vanilla ones once its wood is gone.
 * <p>
 * The tracker places blocks without physics, so leaves would keep the default distance (7, "no log
 * nearby") and decay on their first random tick. This pass computes vanilla's distance instead:
 * 1 next to a log, otherwise one more than the nearest neighbouring leaf, through leaves only, up
 * to 6. Leaves in range become non-persistent with that distance. The few still out of range
 * (Draw3d's leaf-cluster cores reach almost all of them) stay persistent rather than rotting away
 * as soon as the tree is placed.
 */
final class LeafDecay {

  /** Vanilla's leaf-decay range: leaves further than this (through leaves) from a log decay. */
  static final int MAX_DISTANCE = 6;

  private static final int[][] FACES = {
    {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}
  };

  private LeafDecay() {
  }

  /** Runs after {@link WoodStyler}, which settles which blocks are logs (hollows are air). */
  static void apply(final WorldChangeTracker tracker) {
    final Map<WorldChangeKey, WorldChange> leaves = new HashMap<>();
    final ArrayDeque<WorldChangeKey> queue = new ArrayDeque<>();
    final Map<WorldChangeKey, Integer> distance = new HashMap<>();
    for (final WorldChange change : tracker.getChanges()) {
      final WorldChangeKey key = new WorldChangeKey(change.location.getBlockX(),
          change.location.getBlockY(), change.location.getBlockZ());
      if (change.kind == WorldChange.Kind.LEAVES && Tag.LEAVES.isTagged(change.material)) {
        leaves.put(key, change);
      } else if (change.kind == WorldChange.Kind.WOOD && Tag.LOGS.isTagged(change.material)) {
        distance.put(key, 0);
        queue.add(key);
      }
    }
    // breadth-first from every log, through leaves only
    while (!queue.isEmpty()) {
      final WorldChangeKey key = queue.poll();
      final int next = distance.get(key) + 1;
      if (next > MAX_DISTANCE) {
        continue;
      }
      for (final int[] f : FACES) {
        final WorldChangeKey n = new WorldChangeKey(key.x() + f[0], key.y() + f[1], key.z() + f[2]);
        if (leaves.containsKey(n) && !distance.containsKey(n)) {
          distance.put(n, next);
          queue.add(n);
        }
      }
    }
    for (final Map.Entry<WorldChangeKey, WorldChange> e : leaves.entrySet()) {
      final Integer d = distance.get(e.getKey());
      if (d != null) {
        final WorldChange change = e.getValue();
        change.blockDataMutator = decaying(change.blockDataMutator, d);
      }
    }
  }

  private static UnaryOperator<BlockData> decaying(final UnaryOperator<BlockData> base,
                                                   final int distance) {
    return blockData -> {
      final BlockData data = base.apply(blockData);
      if (data instanceof Leaves leaves) {
        leaves.setPersistent(false);
        leaves.setDistance(distance);
      }
      return data;
    };
  }
}
