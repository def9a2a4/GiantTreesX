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

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

import org.bukkit.Material;

/**
 * Maps a tree file's WoodType to blocks. Every block is looked up by name at runtime, so wood
 * types whose blocks only exist on newer servers (e.g. poplar, added in 26.3) fall back to
 * another wood type instead of failing on older ones. Keep in sync with treeTypeMaterials in
 * docs/viewer/src/materials.js.
 */
public class TreeType {

  /** Extra blocks added around the drawn tree (see TreeRenderer). */
  public enum Decoration {
    NONE,
    /** Vines on the sides of wood blocks (JungleVinePopulator). */
    TRUNK_VINES,
    /** Vines hanging down the sides of leaves (LeafDecorator). */
    LEAF_VINES,
    /** {@link #hangingMaterial} hanging below leaves (LeafDecorator). */
    HANGING
  }

  private static final class Spec {
    final String wood;
    /** Leaf block names and weights; the first one is the tree's raw leaf block. */
    final String[] leaves;
    final int[] weights;
    final Decoration decoration;
    final String hanging;
    /** WoodType used when wood or the first leaf block doesn't exist on this server. */
    final String fallback;
    int capLevel = Integer.MAX_VALUE;
    boolean noisyLeaves = true;
    /** Bottom block of a hanging strand; null for {@link #hanging} with its tip state set. */
    String hangingTip;
    /** A leaf bottom grows a strand one in this many times; strand length range. */
    int hangingOneIn = 4;
    int hangingMin = 1;
    int hangingMax = 6;

    Spec(final String wood, final String[] leaves, final int[] weights,
         final Decoration decoration, final String hanging, final String fallback) {
      this.wood = wood;
      this.leaves = leaves;
      this.weights = weights;
      this.decoration = decoration;
      this.hanging = hanging;
      this.fallback = fallback;
    }
  }

  private static final Map<String, Spec> SPECS = new LinkedHashMap<>();

  private static void add(final String woodType, final String wood, final String leaf,
                          final Decoration decoration, final String fallback) {
    SPECS.put(woodType, new Spec(wood, new String[] {leaf}, new int[] {1}, decoration, null, fallback));
  }

  static {
    add("Oak", "OAK_LOG", "OAK_LEAVES", Decoration.NONE, null);
    add("Spruce", "SPRUCE_LOG", "SPRUCE_LEAVES", Decoration.NONE, "Oak");
    add("Birch", "BIRCH_LOG", "BIRCH_LEAVES", Decoration.NONE, "Oak");
    add("Cherry", "CHERRY_LOG", "CHERRY_LEAVES", Decoration.NONE, "Oak");
    add("Jungle", "JUNGLE_LOG", "JUNGLE_LEAVES", Decoration.TRUNK_VINES, "Oak");
    add("Acacia", "ACACIA_LOG", "ACACIA_LEAVES", Decoration.NONE, "Oak");
    add("Dark Oak", "DARK_OAK_LOG", "DARK_OAK_LEAVES", Decoration.NONE, "Oak");
    add("Mangrove", "MANGROVE_LOG", "MANGROVE_LEAVES", Decoration.TRUNK_VINES, "Oak");
    add("Mangrove_roots", "MANGROVE_ROOTS", "MANGROVE_LEAVES", Decoration.NONE, "Oak");
    SPECS.put("Pale Oak", new Spec("PALE_OAK_LOG", new String[] {"PALE_OAK_LEAVES"}, new int[] {1},
        Decoration.HANGING, "PALE_HANGING_MOSS", "Dark Oak"));
    add("Swamp Oak", "OAK_LOG", "OAK_LEAVES", Decoration.LEAF_VINES, "Oak");
    // mushroom branches are part of the cap
    add("Red Mushroom", "MUSHROOM_STEM", "RED_MUSHROOM_BLOCK", Decoration.NONE, "Oak");
    SPECS.get("Red Mushroom").capLevel = 1;
    SPECS.get("Red Mushroom").noisyLeaves = false;
    add("Brown Mushroom", "MUSHROOM_STEM", "BROWN_MUSHROOM_BLOCK", Decoration.NONE, "Oak");
    SPECS.get("Brown Mushroom").capLevel = 1;
    SPECS.get("Brown Mushroom").noisyLeaves = false;
    // 26.3+: on older servers poplar trees are grown as birch
    SPECS.put("Poplar", new Spec("POPLAR_LOG",
        new String[] {"YELLOW_POPLAR_LEAVES", "ORANGE_POPLAR_LEAVES", "RED_POPLAR_LEAVES"},
        new int[] {5, 3, 2}, Decoration.NONE, null, "Birch"));
    // weeping vines hang from under the cap: plant blocks with a (fully grown) tip at the bottom
    SPECS.put("Crimson", new Spec("CRIMSON_STEM", new String[] {"NETHER_WART_BLOCK", "SHROOMLIGHT"},
        new int[] {14, 1}, Decoration.HANGING, "WEEPING_VINES_PLANT", "Oak"));
    SPECS.get("Crimson").hangingTip = "WEEPING_VINES";
    SPECS.get("Crimson").hangingOneIn = 6;
    SPECS.get("Crimson").hangingMin = 1;
    SPECS.get("Crimson").hangingMax = 9;
    SPECS.put("Warped", new Spec("WARPED_STEM", new String[] {"WARPED_WART_BLOCK", "SHROOMLIGHT"},
        new int[] {14, 1}, Decoration.NONE, null, "Oak"));
    // fungus caps keep their smooth wart domes
    SPECS.get("Crimson").noisyLeaves = false;
    SPECS.get("Warped").noisyLeaves = false;
    SPECS.put("Azalea", new Spec("OAK_LOG", new String[] {"AZALEA_LEAVES", "FLOWERING_AZALEA_LEAVES"},
        new int[] {3, 2}, Decoration.NONE, null, "Oak"));
  }

  /** Wood types already reported as unavailable, so the notice is logged once. */
  private static final Set<String> NOTIFIED = ConcurrentHashMap.newKeySet();

  public Material leafMaterial;
  public Material woodMaterial;
  /** Default weighted leaf mix (WoodStyle uses it when the config sets none); empty for one leaf. */
  public final Map<Material, Integer> leafMix;
  public final Decoration decoration;
  /** Block hung below leaves for {@link Decoration#HANGING}, otherwise null. */
  public final Material hangingMaterial;
  /** Bottom (tip) block of each hanging strand: {@link #hangingMaterial} unless the type has its
   *  own tip block (weeping vines); null without {@link Decoration#HANGING}. */
  public final Material hangingTipMaterial;
  /** {@link Decoration#HANGING}: a leaf bottom grows a strand when hash % hangingOneIn == 0, of
   *  hangingMin to hangingMax blocks (see LeafDecorator). */
  public final int hangingOneIn;
  public final int hangingMin;
  public final int hangingMax;
  /** Stems of this level and deeper are drawn with the leaf block (Draw3d); MAX_VALUE for none. */
  public final int capLevel;
  /** Leaf clusters get an uneven, lumpy surface (Draw3d); false keeps plain ellipsoids. */
  public final boolean noisyLeaves;

  public TreeType(final String treeType) {
    this(treeType, null);
  }

  /**
   * @param logger where to log a one-time notice when the wood type's blocks are missing on this
   *               server and a fallback is used; null for none
   */
  public TreeType(final String treeType, final Logger logger) {
    Spec spec = SPECS.getOrDefault(treeType, SPECS.get("Oak"));
    String name = SPECS.containsKey(treeType) ? treeType : "Oak";
    while (lookup(spec.wood) == null || lookup(spec.leaves[0]) == null) {
      if (logger != null && NOTIFIED.add(name)) {
        logger.info(name + " blocks are not available on this server version; growing "
                    + spec.fallback + " instead");
      }
      name = spec.fallback;
      spec = SPECS.get(name);
    }
    this.woodMaterial = lookup(spec.wood);
    this.leafMaterial = lookup(spec.leaves[0]);
    final Map<Material, Integer> mix = new LinkedHashMap<>();
    if (spec.leaves.length > 1) {
      for (int i = 0; i < spec.leaves.length; i++) {
        final Material m = lookup(spec.leaves[i]);
        if (m != null) {
          mix.put(m, spec.weights[i]);
        }
      }
    }
    this.leafMix = Collections.unmodifiableMap(mix);
    final Material hanging = spec.hanging == null ? null : lookup(spec.hanging);
    final Material hangingTip = spec.hangingTip == null ? hanging : lookup(spec.hangingTip);
    this.decoration = spec.decoration == Decoration.HANGING && (hanging == null || hangingTip == null)
        ? Decoration.NONE : spec.decoration;
    this.hangingMaterial = this.decoration == Decoration.HANGING ? hanging : null;
    this.hangingTipMaterial = this.decoration == Decoration.HANGING ? hangingTip : null;
    this.hangingOneIn = spec.hangingOneIn;
    this.hangingMin = spec.hangingMin;
    this.hangingMax = spec.hangingMax;
    this.capLevel = spec.capLevel;
    this.noisyLeaves = spec.noisyLeaves;
  }

  private static Material lookup(final String name) {
    return Material.getMaterial(name);
  }

  /** Every block name the table can produce (for the viewer equivalence harness). */
  public static Set<String> candidateMaterialNames() {
    final Set<String> names = new LinkedHashSet<>();
    for (final Spec s : SPECS.values()) {
      names.add(s.wood);
      Collections.addAll(names, s.leaves);
      if (s.hanging != null) {
        names.add(s.hanging);
      }
      if (s.hangingTip != null) {
        names.add(s.hangingTip);
      }
    }
    return names;
  }
}
