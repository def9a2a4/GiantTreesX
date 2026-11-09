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

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;
import java.util.logging.Level;

import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.generator.BlockPopulator;
import org.bukkit.plugin.Plugin;

import io.github.def9a2a4.gianttreesx.rendering.TreeRenderer;

public class TreePopulator extends BlockPopulator {

  private final Plugin plugin;
  private final NaturalTrees natural;

  public TreePopulator(final Plugin plugin, final NaturalTrees natural) {
    this.plugin = plugin;
    this.natural = natural;
  }

  @Override
  public void populate(final World world, final Random random, final Chunk chunk) {
    try {
      final int x = (chunk.getX() * 16) + random.nextInt(16);
      final int z = (chunk.getZ() * 16) + random.nextInt(16);
      final TreeGround ground = TreeGround.at(world, x, z);
      final Location refPoint = ground.block().getLocation();

      // by key string, so biomes newer than the compile-time API (dappled_forest) work too
      final String biome = world.getBiome(refPoint.getBlockX(), refPoint.getBlockY(), refPoint.getBlockZ())
                                .getKey().value().toUpperCase(Locale.ROOT);
      // only on soil, never on or in another tree, and in water only in swamps
      final boolean waterOk = "MANGROVE_SWAMP".equals(biome) || "SWAMP".equals(biome);
      if (!ground.canGrowNaturally(waterOk)) {
        return;
      }

      // the surface biome's trees, plus the LUSH_CAVES (azalea) trees when the column has a
      // lush cave below: like vanilla, they grow above lush caves in any biome. The surface
      // biome's chance applies, or LUSH_CAVES's where the surface biome grows no trees. Files
      // are only looked for after the roll, as most chunks grow nothing.
      final NaturalTrees.Entry surface = this.natural.forBiome(biome);
      final NaturalTrees.Entry lush = ground.soil() && !ground.underFluid()
          ? this.natural.lushCaves() : null;
      final NaturalTrees.Entry chanceOf = surface != null && surface.hasTrees() ? surface : lush;
      if (chanceOf == null || random.nextDouble() * 100.0 >= chanceOf.chance()) {
        return;
      }
      final File folder = this.plugin.getDataFolder();
      final List<NaturalTrees.Candidate> candidates = new ArrayList<>();
      if (surface != null) {
        candidates.addAll(surface.candidates(folder));
      }
      // checked after the roll too: it samples the biome all the way down
      if (lush != null && lush.hasTrees() && hasLushCaveBelow(world, refPoint.getBlockX(),
                                                              refPoint.getBlockY(), refPoint.getBlockZ())) {
        candidates.addAll(lush.candidates(folder));
      }
      // picked with the chunk's random from lists in config order, so a world seed always grows
      // the same trees
      final NaturalTrees.Candidate pick = pickWeighted(candidates, random);
      if (pick == null) {
        return;
      }
      if (this.plugin.getConfig().getBoolean("verbose-logging", false)) {
        // the entry it came from, and the biome there when that differs (FOREST (FLOWER_FOREST))
        this.plugin.getLogger().info("Natural tree " + pick.fileName() + " in " + pick.biome()
                                     + (pick.biome().equals(biome) ? "" : " (" + biome + ")"));
      }
      new TreeRenderer(this.plugin).renderTree(refPoint, new File(folder, pick.fileName()),
                                               random.nextInt(), false);
    } catch (Exception ex) {
      plugin.getLogger().log(Level.SEVERE, "Exception caught generating giant tree", ex);
    }
  }

  /** Blocks between biome samples on the way down (biomes are stored per 4 x 4 x 4 cell). */
  private static final int BIOME_SAMPLE_STEP = 4;

  /**
   * Whether the column at {@code x}, {@code z} has a lush caves biome somewhere below
   * {@code surfaceY}, sampled every few blocks down to the bottom of the world.
   */
  static boolean hasLushCaveBelow(final World world, final int x, final int surfaceY, final int z) {
    for (int y = surfaceY - BIOME_SAMPLE_STEP; y >= world.getMinHeight(); y -= BIOME_SAMPLE_STEP) {
      if ("lush_caves".equals(world.getBiome(x, y, z).getKey().value())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Picks one candidate at random, weighted; a file listed twice (azalea in a surface biome
   * and in LUSH_CAVES) counts once. Null when no candidate has a positive weight.
   */
  static NaturalTrees.Candidate pickWeighted(final List<NaturalTrees.Candidate> candidates,
                                             final Random random) {
    final Set<String> seen = new HashSet<>();
    final List<NaturalTrees.Candidate> unique = new ArrayList<>();
    double total = 0;
    for (final NaturalTrees.Candidate c : candidates) {
      if (c.weight() > 0 && seen.add(c.fileName())) {
        unique.add(c);
        total += c.weight();
      }
    }
    if (unique.isEmpty()) {
      return null;
    }
    double roll = random.nextDouble() * total;
    for (final NaturalTrees.Candidate c : unique) {
      roll -= c.weight();
      if (roll < 0) {
        return c;
      }
    }
    return unique.get(unique.size() - 1);
  }
}
