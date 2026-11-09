/*
 * Copyright (C) 2014 Ryan Michela
 * Copyright (C) 2016 Ronald Jack Jenkins Jr.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
package com.ryanmichela.trees.rendering;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.function.UnaryOperator;

import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.MultipleFacing;

public class JungleVinePopulator {

  /** dx, dz of a vine's cell relative to the block it clings to, in the order N, S, E, W (also
   *  LeafDecorator's). */
  static final int[][] SIDES = {{0, -1}, {0, 1}, {1, 0}, {-1, 0}};
  /** The face of the vine block that touches that block, per side. */
  static final BlockFace[] FACES = {BlockFace.SOUTH, BlockFace.NORTH, BlockFace.WEST, BlockFace.EAST};

  public static void populate(final WorldChangeTracker tracker, final Random r) {
    final List<WorldChange> newChanges = new ArrayList<>();
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind != WorldChange.Kind.WOOD) {
        continue;
      }
      for (int s = 0; s < SIDES.length; s++) {
        final WorldChangeKey side = new WorldChangeKey(change.location.getBlockX() + SIDES[s][0],
                                                       change.location.getBlockY(),
                                                       change.location.getBlockZ() + SIDES[s][1]);
        if ((r.nextInt(3) > 0) && (tracker.getChange(side) == null)) {
          newChanges.add(new WorldChange(side.toVector(), Material.VINE, orient(FACES[s]),
                                         WorldChange.Kind.VINE, -1));
        }
      }
    }
    for (final WorldChange newChange : newChanges) {
      tracker.addChange(newChange, false);
    }
  }

  /** A vine block clinging to its one face {@code direction}. */
  static UnaryOperator<BlockData> orient(final BlockFace direction) {
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
}
