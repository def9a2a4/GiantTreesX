package com.ryanmichela.trees;

import java.util.EnumSet;
import java.util.Random;
import java.util.Set;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.TileState;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.Plugin;

/**
 * Vanilla's azalea tree root system: a column of rooted dirt from the tree's base down toward the
 * lush cave below, with hanging roots where it comes out of the cave ceiling. World dependent and
 * not part of the generated tree, so the viewer doesn't show it.
 */
public final class AzaleaRoots {

  /** Longest rooted dirt column; a cave further down gets no roots. */
  static final int MAX_COLUMN = 20;
  /** Hanging roots are scattered this far (horizontally) around the column's bottom ... */
  private static final int HANGING_RADIUS = 3;
  /** ... and this far up or down from it, onto the cave ceiling, ... */
  private static final int HANGING_SPAN = 2;
  /** ... in this many tries (vanilla's numbers). */
  private static final int HANGING_ATTEMPTS = 20;

  private AzaleaRoots() {
  }

  /** Whether a tree of this WoodType (the tree file's WoodType param) gets azalea roots. */
  public static boolean appliesTo(final String woodType) {
    return "Azalea".equalsIgnoreCase(woodType);
  }

  /**
   * Replaces the ground under {@code base} (the block the tree stands on) with rooted dirt, down
   * to at most {@link #MAX_COLUMN} blocks and stopping at the first block that is not stone or
   * soil. When the column ends at air (a cave), hanging roots go under it and around it on the
   * cave ceiling. Leaves protected blocks and (with {@code protect_block_entities}) block
   * entities alone. Must run on the main thread.
   */
  public static void place(final Plugin plugin, final Location base) {
    final World world = base.getWorld();
    if (world == null) {
      return;
    }
    final Protection protection = new Protection(plugin.getConfig());
    final int x = base.getBlockX();
    final int z = base.getBlockZ();
    final int top = Math.min(base.getBlockY(), world.getMaxHeight() - 1);
    final int bottom = Math.max(world.getMinHeight(), top - MAX_COLUMN + 1);
    for (int y = top; y >= bottom; y--) {
      final Block block = world.getBlockAt(x, y, z);
      if (block.getType().isAir()) {
        if (y < top) {
          hangingRoots(world, block, protection, new Random(((long) x * 341873128712L) ^ ((long) z * 132897987541L) ^ y));
        }
        return;
      }
      if (!isReplaceable(block.getType()) || protection.isProtected(block)) {
        return;
      }
      block.setType(Material.ROOTED_DIRT, false);
    }
  }

  /** Hanging roots right under the column and scattered on the cave ceiling around it. */
  private static void hangingRoots(final World world, final Block underColumn, final Protection protection,
                                   final Random random) {
    placeHanging(underColumn, protection);
    for (int i = 0; i < HANGING_ATTEMPTS; i++) {
      final int y = underColumn.getY() + random.nextInt(2 * HANGING_SPAN + 1) - HANGING_SPAN;
      if (y <= world.getMinHeight() || y >= world.getMaxHeight() - 1) {
        continue;
      }
      placeHanging(world.getBlockAt(underColumn.getX() + random.nextInt(2 * HANGING_RADIUS + 1) - HANGING_RADIUS, y,
                                    underColumn.getZ() + random.nextInt(2 * HANGING_RADIUS + 1) - HANGING_RADIUS),
                   protection);
    }
  }

  /** Hanging roots in an air block under a full block, like vanilla's canSurvive. */
  private static void placeHanging(final Block block, final Protection protection) {
    if (block.getType().isAir() && block.getRelative(0, 1, 0).getType().isOccluding()
        && !protection.isProtected(block)) {
      block.setType(Material.HANGING_ROOTS, false);
    }
  }

  /** What rooted dirt grows through: stone (stone, deepslate, tuff, ...) and soil. */
  static boolean isReplaceable(final Material type) {
    return Tag.BASE_STONE_OVERWORLD.isTagged(type) || TreeGround.isSoil(type) || type == Material.GRAVEL;
  }

  /** The protect_block_entities and protected_blocks settings, as the tree placement reads them. */
  private static final class Protection {
    private final boolean blockEntities;
    private final Set<Material> blocks = EnumSet.noneOf(Material.class);

    Protection(final ConfigurationSection config) {
      this.blockEntities = config.getBoolean("protect_block_entities", true);
      for (final String name : config.getStringList("protected_blocks")) {
        final Material material = Material.matchMaterial(name);
        if (material != null) {
          this.blocks.add(material);
        }
      }
    }

    boolean isProtected(final Block block) {
      return this.blocks.contains(block.getType())
             || (this.blockEntities && block.getState(false) instanceof TileState);
    }
  }
}
