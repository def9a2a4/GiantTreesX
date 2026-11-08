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
package com.ryanmichela.trees;

import java.util.Arrays;
import org.bukkit.Material;

/**
 * PhysicalCraftingRecipe represents the Material pattern for a tree and
 * is used to match against the blocks laid out horizontally in the world
 */
public class PhysicalCraftingRecipe {

  private String treename = null;
  private final int size;
  private final Material coreblock;
  private final int boneMealCost;
  /** the pattern in all distinct orientations (1 when every rotation looks the same, else 4) */
  private final Material[][][] orientations;

  /**
   * Creates a PhysicalCraftingRecipe from a 2D pattern of materials.
   * The pattern must be an odd-sized square (3x3 or 5x5) with the core block in the centre.
   *
   * @param treename - Name of the tree - matches tree filename
   * @param coreblock - The material of the central core block
   * @param pattern - The square of Materials to match.
   * @param boneMealCost - bone meal consumed when this recipe grows a tree
   */
  public PhysicalCraftingRecipe(String treename, Material coreblock, final Material[][] pattern, int boneMealCost) {
    this.treename = treename;
    this.coreblock = coreblock;
    this.size = pattern.length;
    this.boneMealCost = boneMealCost;

    final Material[][] r0 = copy(pattern);
    final Material[][] r1 = rotateCW(r0);
    final Material[][] r2 = rotateCW(r1);
    final Material[][] r3 = rotateCW(r2);
    if (Arrays.deepEquals(r0, r1)) {
      this.orientations = new Material[][][] { r0 };
    } else {
      this.orientations = new Material[][][] { r0, r1, r2, r3 };
    }
  }

  public void setTreeName(String treename) {
	  this.treename = treename;
  }

  /** Name of the tree for this recipe (the planting-patterns key) */
  public String getTreeName() {
	  return this.treename;
  }

  /** Width of the square pattern (3 or 5) */
  public int getSize() {
    return this.size;
  }

  /** Bone meal consumed when this recipe grows a tree */
  public int getBoneMealCost() {
    return this.boneMealCost;
  }

  public Material getCoreBlock() {
    return this.coreblock;
  }

  /**
   * Determines if this PhysicalCraftingRecipe matches the blocks in the world, in any of the
   * four 90 degree orientations.
   *
   * @param worldblocks - size x size blocks around the clicked core block
   * @return true or false if a match was found
   */
  public boolean matches(Material[][] worldblocks) {
    for (final Material[][] orientation : this.orientations) {
      if (Arrays.deepEquals(worldblocks, orientation)) {
        return true;
      }
    }
    return false;
  }

  private static Material[][] copy(Material[][] matrix) {
    final Material[][] ret = new Material[matrix.length][];
    for (int r = 0; r < matrix.length; r++) {
      ret[r] = matrix[r].clone();
    }
    return ret;
  }

  /** Returns a copy of a square matrix rotated 90 degrees clockwise */
  private static Material[][] rotateCW(Material[][] matrix) {
    final int n = matrix.length;
    final Material[][] ret = new Material[n][n];
    for (int r = 0; r < n; r++) {
      for (int c = 0; c < n; c++) {
        ret[c][n - 1 - r] = matrix[r][c];
      }
    }
    return ret;
  }
}
