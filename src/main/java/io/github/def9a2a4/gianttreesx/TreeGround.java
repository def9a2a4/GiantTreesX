package io.github.def9a2a4.gianttreesx;

import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;

/**
 * Where a tree planted in a world column would stand: the ground below anything that is not
 * ground (air, plants, snow, leaves, other trees' logs, water).
 *
 * @param block      the ground block; trees are rendered with their base at this block
 * @param soil       whether that block is soil a tree can grow from (dirt, grass, podzol, mud,
 *                   moss, sand, terracotta, ...) rather than rock, gravel, ice, snow, ...
 * @param underFluid whether water (or lava) lies above the ground
 * @param underTree  whether the column went through another tree's trunk (logs or mushroom stems)
 */
public record TreeGround(Block block, boolean soil, boolean underFluid, boolean underTree) {

  /** Finds the ground in the column at {@code x}, {@code z}. */
  public static TreeGround at(final World world, final int x, final int z) {
    Block block = world.getHighestBlockAt(x, z);
    final int minY = world.getMinHeight();
    boolean underFluid = false;
    boolean underTree = false;
    while (block.getY() > minY && isCover(block)) {
      underFluid |= block.isLiquid();
      underTree |= isTrunk(block.getType());
      block = block.getRelative(0, -1, 0);
    }
    return new TreeGround(block, isSoil(block.getType()), underFluid, underTree);
  }

  /**
   * Whether a tree may grow here on its own (world generation): on soil, not inside another
   * tree's trunk, and not under water unless {@code waterOk} (swamps).
   */
  public boolean canGrowNaturally(final boolean waterOk) {
    return this.soil && !this.underTree && (waterOk || !this.underFluid);
  }

  /** Blocks looked through on the way down to the ground. */
  static boolean isCover(final Block block) {
    final Material type = block.getType();
    if (type.isAir() || block.isLiquid() || !type.isSolid()) {
      return true; // air, water, grass, flowers, ferns, vines, saplings, crops, snow layers, ...
    }
    if (Tag.LEAVES.isTagged(type) || isTrunk(type)) {
      return true;
    }
    final String name = type.name();
    return name.endsWith("_CARPET") // moss carpet, wool carpet
           || name.endsWith("MUSHROOM_BLOCK")
           || type == Material.SNOW || type == Material.POWDER_SNOW
           || type == Material.MANGROVE_ROOTS
           || type == Material.BAMBOO || type == Material.BAMBOO_SAPLING
           || type == Material.SUGAR_CANE || type == Material.COCOA
           || type == Material.BEE_NEST;
  }

  private static boolean isTrunk(final Material type) {
    return Tag.LOGS.isTagged(type) || type == Material.MUSHROOM_STEM;
  }

  /**
   * Blocks a tree can grow from. Listed by name as well as by {@code #dirt}: from Minecraft 26.x
   * on, grass, podzol and mycelium moved out of {@code #dirt} into new tags ({@code #grass_blocks},
   * {@code #substrate_overworld}) that the 1.21 API this plugin compiles against doesn't have.
   */
  static boolean isSoil(final Material type) {
    return SOIL.contains(type)
           || Tag.DIRT.isTagged(type)
           || Tag.SAND.isTagged(type)
           || Tag.TERRACOTTA.isTagged(type); // badlands
  }

  private static final java.util.Set<Material> SOIL = soil(
      "GRASS_BLOCK", "DIRT", "COARSE_DIRT", "ROOTED_DIRT", "PODZOL", "MYCELIUM", "MUD",
      "MUDDY_MANGROVE_ROOTS", "MOSS_BLOCK", "PALE_MOSS_BLOCK", "FARMLAND", "DIRT_PATH", "CLAY");

  /** Looked up by name, so a block missing on this server version is just left out. */
  private static java.util.Set<Material> soil(final String... names) {
    final java.util.Set<Material> set = java.util.EnumSet.noneOf(Material.class);
    for (final String name : names) {
      final Material m = Material.matchMaterial(name);
      if (m != null) {
        set.add(m);
      }
    }
    return set;
  }
}
