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

import org.bukkit.Material;
import org.bukkit.block.data.BlockData;
import org.bukkit.util.Vector;

import java.util.function.UnaryOperator;

class WorldChange {

  /** What part of the tree a change belongs to; decides how {@link WoodStyler} treats it. */
  enum Kind {
    WOOD, LEAVES, VINE,
    /** A block hanging straight down from leaves, e.g. pale hanging moss (LeafDecorator). */
    HANGING
  }

  public Material material;
  public final UnaryOperator<BlockData> blockDataMutator;
  public final Vector location;
  public final Kind kind;
  /** Arbaro stem level for wood (0 = trunk), -1 when not applicable. */
  public final int level;

  WorldChange(final Vector location, final Material material,
              final UnaryOperator<BlockData> blockDataMutator) {
    this(location, material, blockDataMutator, Kind.WOOD, -1);
  }

  WorldChange(final Vector location, final Material material,
              final UnaryOperator<BlockData> blockDataMutator, final Kind kind,
              final int level) {
    this.location = location;
    this.material = material;
    this.blockDataMutator = blockDataMutator;
    this.kind = kind;
    this.level = level;
  }
}
