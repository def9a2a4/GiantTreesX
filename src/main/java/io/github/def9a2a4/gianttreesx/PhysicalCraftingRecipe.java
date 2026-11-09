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
package io.github.def9a2a4.gianttreesx;

import java.util.Arrays;
import org.bukkit.Material;

/**
 * PhysicalCraftingRecipe represents the Material pattern for a tree and
 * is used to match against the blocks laid out horizontally in the world.
 * A null cell in the pattern is a "don't care" cell: it matches any block.
 */
public class PhysicalCraftingRecipe {

  private final String treename;
  private final int size;
  /** number of "don't care" (null) cells; fewer means more specific */
  private final int wildcards;
  /** the pattern in all distinct orientations (1 when every rotation looks the same, else 4) */
  private final Material[][][] orientations;

  /**
   * Creates a PhysicalCraftingRecipe from a 2D pattern of materials.
   * The pattern must be an odd-sized square (3x3 or 5x5) with the core block in the centre.
   * Null cells match any block.
   *
   * @param treename - Name of the tree - matches tree filename
   * @param pattern - The square of Materials to match.
   */
  public PhysicalCraftingRecipe(String treename, final Material[][] pattern) {
    this.treename = treename;
    this.size = pattern.length;
    int dontCare = 0;
    for (final Material[] row : pattern) {
      for (final Material cell : row) {
        if (cell == null) {
          dontCare++;
        }
      }
    }
    this.wildcards = dontCare;

    final Material[][] r0 = pattern;
    final Material[][] r1 = rotateCW(r0);
    final Material[][] r2 = rotateCW(r1);
    final Material[][] r3 = rotateCW(r2);
    if (Arrays.deepEquals(r0, r1)) {
      this.orientations = new Material[][][] { r0 };
    } else {
      this.orientations = new Material[][][] { r0, r1, r2, r3 };
    }
  }

  /** Name of the tree for this recipe (its key in planting.patterns) */
  public String getTreeName() {
	  return this.treename;
  }

  /** Width of the square pattern (3 or 5) */
  public int getSize() {
    return this.size;
  }

  /** Number of "don't care" cells; recipes with fewer are more specific and are tried first */
  public int getWildcards() {
    return this.wildcards;
  }

  /**
   * The orientation of the pattern that matches the blocks in the world (null cells are the
   * "don't care" cells), or null when none does.
   *
   * @param worldblocks - size x size blocks around the clicked core block
   */
  /** Whether {@code other} is the same pattern, in some rotation: the two could never be told apart. */
  public boolean samePattern(final PhysicalCraftingRecipe other) {
    return this.size == other.size && this.matchingOrientation(other.orientations[0]) != null
           && other.matchingOrientation(this.orientations[0]) != null;
  }

  public Material[][] matchingOrientation(Material[][] worldblocks) {
    for (final Material[][] orientation : this.orientations) {
      if (fits(orientation, worldblocks)) {
        return orientation;
      }
    }
    return null;
  }

  private static boolean fits(Material[][] pattern, Material[][] worldblocks) {
    for (int r = 0; r < pattern.length; r++) {
      for (int c = 0; c < pattern[r].length; c++) {
        if (pattern[r][c] != null && pattern[r][c] != worldblocks[r][c]) {
          return false;
        }
      }
    }
    return true;
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
