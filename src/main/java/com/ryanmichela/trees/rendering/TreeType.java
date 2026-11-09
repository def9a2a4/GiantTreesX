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
 * types whose blocks only exist on newer servers (poplar, added in 26.3) fall back to another
 * wood type instead of failing on older ones. Keep in sync with treeTypeMaterials in
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

  /** Leaf block names and weights (the first one is the tree's raw leaf block); hanging: the
   *  block hung below leaves for {@link Decoration#HANGING}, otherwise null. */
  private record Spec(String wood, String[] leaves, int[] weights, Decoration decoration,
                      String hanging) {}

  private static final Map<String, Spec> SPECS = new LinkedHashMap<>();

  private static void add(final String woodType, final String wood, final String leaf,
                          final Decoration decoration) {
    SPECS.put(woodType, new Spec(wood, new String[] {leaf}, new int[] {1}, decoration, null));
  }

  static {
    add("Oak", "OAK_LOG", "OAK_LEAVES", Decoration.NONE);
    add("Spruce", "SPRUCE_LOG", "SPRUCE_LEAVES", Decoration.NONE);
    add("Birch", "BIRCH_LOG", "BIRCH_LEAVES", Decoration.NONE);
    add("Cherry", "CHERRY_LOG", "CHERRY_LEAVES", Decoration.NONE);
    add("Jungle", "JUNGLE_LOG", "JUNGLE_LEAVES", Decoration.TRUNK_VINES);
    add("Acacia", "ACACIA_LOG", "ACACIA_LEAVES", Decoration.NONE);
    add("Dark Oak", "DARK_OAK_LOG", "DARK_OAK_LEAVES", Decoration.NONE);
    // vines hang from the leaves, like vanilla's leave_vine decorator (no vines on the trunk)
    add("Mangrove", "MANGROVE_LOG", "MANGROVE_LEAVES", Decoration.LEAF_VINES);
    add("Mangrove_roots", "MANGROVE_ROOTS", "MANGROVE_LEAVES", Decoration.NONE);
    SPECS.put("Pale Oak", new Spec("PALE_OAK_LOG", new String[] {"PALE_OAK_LEAVES"}, new int[] {1},
        Decoration.HANGING, "PALE_HANGING_MOSS"));
    add("Swamp Oak", "OAK_LOG", "OAK_LEAVES", Decoration.LEAF_VINES);
    add("Red Mushroom", "MUSHROOM_STEM", "RED_MUSHROOM_BLOCK", Decoration.NONE);
    add("Brown Mushroom", "MUSHROOM_STEM", "BROWN_MUSHROOM_BLOCK", Decoration.NONE);
    SPECS.put("Poplar", new Spec("POPLAR_LOG",
        new String[] {"YELLOW_POPLAR_LEAVES", "ORANGE_POPLAR_LEAVES", "RED_POPLAR_LEAVES"},
        new int[] {5, 3, 2}, Decoration.NONE, null));
    // weeping vines hang from under the cap: plant blocks with a (fully grown) tip at the bottom
    SPECS.put("Crimson", new Spec("CRIMSON_STEM", new String[] {"NETHER_WART_BLOCK", "SHROOMLIGHT"},
        new int[] {14, 1}, Decoration.HANGING, "WEEPING_VINES_PLANT"));
    SPECS.put("Warped", new Spec("WARPED_STEM", new String[] {"WARPED_WART_BLOCK", "SHROOMLIGHT"},
        new int[] {14, 1}, Decoration.NONE, null));
    SPECS.put("Azalea", new Spec("OAK_LOG", new String[] {"AZALEA_LEAVES", "FLOWERING_AZALEA_LEAVES"},
        new int[] {3, 2}, Decoration.NONE, null));
  }

  /** Wood type grown instead when the wood or first leaf block is missing: 26.3+ poplar on older
   *  servers. */
  private static final Map<String, String> FALLBACKS = Map.of("Poplar", "Birch");
  /** Mushroom branches are part of the cap ({@link #capLevel}). */
  private static final Map<String, Integer> CAP_LEVELS = Map.of("Red Mushroom", 1, "Brown Mushroom", 1);
  /** Mushroom caps and fungus wart domes stay smooth ({@link #noisyLeaves} false). */
  private static final Set<String> SMOOTH_LEAVES = Set.of("Red Mushroom", "Brown Mushroom", "Crimson", "Warped");
  /** Leaf mixes that grow in patches ({@link #patchLeaves}); the others are picked per block. */
  private static final Set<String> PATCH_LEAVES = Set.of("Poplar");
  /** Drooping boughs ({@link #leafDroop}). */
  private static final Map<String, Double> LEAF_DROOPS = Map.of("Spruce", 0.6);
  /** Bottom block of a hanging strand when not the hanging block itself (with its tip state). */
  private static final Map<String, String> HANGING_TIPS = Map.of("Crimson", "WEEPING_VINES");
  /** hangingOneIn, hangingMin, hangingMax; default 4, 1, 6. */
  private static final Map<String, int[]> HANGING_SHAPES = Map.of("Crimson", new int[] {6, 1, 9});
  /** Prop roots that reach into the mud become muddy mangrove roots, like vanilla's. */
  private static final Map<String, String> GROUND_WOODS = Map.of("Mangrove_roots", "MUDDY_MANGROVE_ROOTS");

  /** Wood types already reported as unavailable, so the notice is logged once. */
  private static final Set<String> NOTIFIED = ConcurrentHashMap.newKeySet();

  public final Material leafMaterial;
  public final Material woodMaterial;
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
  /** A leaf mix (the default one or a configured one) grows in patches about a leaf cluster wide
   *  (WoodStyler.LeafMix), like autumn poplar crowns; false picks every leaf block on its own
   *  by weight (WoodStyler.pickLeaf), e.g. azalea's sprinkled flowering leaves. */
  public final boolean patchLeaves;
  /** Leaf clusters sink this many blocks per block outward from the trunk (Draw3d); 0 for none. */
  public final double leafDroop;
  /** {@link #woodMaterial} blocks placed into solid ground become this block when the tree is
   *  placed (TreeRenderer); null to leave them as they are. */
  public final Material groundWoodMaterial;

  public TreeType(final String treeType) {
    this(treeType, null);
  }

  /**
   * @param logger where to log a one-time notice when the wood type's blocks are missing on this
   *               server and a fallback is used; null for none
   */
  public TreeType(final String treeType, final Logger logger) {
    String name = SPECS.containsKey(treeType) ? treeType : "Oak";
    Spec spec = SPECS.get(name);
    if (FALLBACKS.containsKey(name)
        && (Material.getMaterial(spec.wood) == null || Material.getMaterial(spec.leaves[0]) == null)) {
      if (logger != null && NOTIFIED.add(name)) {
        logger.info(name + " blocks are not available on this server version; growing "
                    + FALLBACKS.get(name) + " instead");
      }
      name = FALLBACKS.get(name);
      spec = SPECS.get(name);
    }
    this.woodMaterial = Material.getMaterial(spec.wood);
    this.leafMaterial = Material.getMaterial(spec.leaves[0]);
    final Map<Material, Integer> mix = new LinkedHashMap<>();
    if (spec.leaves.length > 1) {
      for (int i = 0; i < spec.leaves.length; i++) {
        final Material m = Material.getMaterial(spec.leaves[i]);
        if (m != null) {
          mix.put(m, spec.weights[i]);
        }
      }
    }
    this.leafMix = Collections.unmodifiableMap(mix);
    this.decoration = spec.decoration;
    this.hangingMaterial = spec.hanging == null ? null : Material.getMaterial(spec.hanging);
    this.hangingTipMaterial = HANGING_TIPS.containsKey(name)
        ? Material.getMaterial(HANGING_TIPS.get(name)) : hangingMaterial;
    final int[] shape = HANGING_SHAPES.getOrDefault(name, new int[] {4, 1, 6});
    this.hangingOneIn = shape[0];
    this.hangingMin = shape[1];
    this.hangingMax = shape[2];
    this.capLevel = CAP_LEVELS.getOrDefault(name, Integer.MAX_VALUE);
    this.noisyLeaves = !SMOOTH_LEAVES.contains(name);
    this.patchLeaves = PATCH_LEAVES.contains(name);
    this.leafDroop = LEAF_DROOPS.getOrDefault(name, 0.0);
    this.groundWoodMaterial = GROUND_WOODS.containsKey(name)
        ? Material.getMaterial(GROUND_WOODS.get(name)) : null;
  }

  /** Every block name the table can produce (for the viewer equivalence harness). */
  public static Set<String> candidateMaterialNames() {
    final Set<String> names = new LinkedHashSet<>();
    for (final Map.Entry<String, Spec> e : SPECS.entrySet()) {
      final Spec s = e.getValue();
      names.add(s.wood);
      Collections.addAll(names, s.leaves);
      if (s.hanging != null) {
        names.add(s.hanging);
      }
      if (HANGING_TIPS.containsKey(e.getKey())) {
        names.add(HANGING_TIPS.get(e.getKey()));
      }
      if (GROUND_WOODS.containsKey(e.getKey())) {
        names.add(GROUND_WOODS.get(e.getKey()));
      }
    }
    return names;
  }
}
