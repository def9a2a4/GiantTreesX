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

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;
import java.util.logging.Level;

import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Biome;
import org.bukkit.configuration.Configuration;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.generator.BlockPopulator;
import org.bukkit.plugin.Plugin;

import com.ryanmichela.trees.rendering.TreeRenderer;

public class TreePopulator extends BlockPopulator {

  private final Plugin plugin;

  public TreePopulator(final Plugin plugin) {
    this.plugin = plugin;
  }

  @Override
  public void populate(final World world, final Random random, final Chunk chunk) {
    try {
      
      final Location refPoint = new Location(world,
    		  (chunk.getX() * 16) + random.nextInt(16),
    		  64,
              (chunk.getZ() * 16) + random.nextInt(16)
      );
      final TreeGround ground = TreeGround.at(world, refPoint.getBlockX(), refPoint.getBlockZ());
      refPoint.setY(ground.block().getY());
      
      // by key string, so biomes newer than the compile-time API (dappled_forest) work too
      final String biomeName = this.simplifyBiome(world.getBiome(refPoint.getBlockX(), refPoint.getBlockY(), refPoint.getBlockZ()));
      // only on soil, never on or in another tree, and in water only in swamps
      final boolean waterOk = "MANGROVE_SWAMP".equals(biomeName) || "SWAMP".equals(biomeName);

      if (ground.canGrowNaturally(waterOk) && this.treeCanGrow(random)) {

        // the surface biome's tree files, plus the azalea trees (biome.LUSH_CAVES-*.xml) when the
        // column has a lush cave below: like vanilla, they grow above lush caves in any biome
        final List<String> names = new ArrayList<>();
        if (this.isAcceptableBiome(biomeName)) {
          names.addAll(this.biomeTreeFiles(biomeName));
        }
        final List<String> lush = ground.soil() && !ground.underFluid()
            ? this.biomeTreeFiles(LUSH_CAVES) : List.<String>of();
        if (!lush.isEmpty() && hasLushCaveBelow(world, refPoint.getBlockX(), refPoint.getBlockY(),
                                                refPoint.getBlockZ())) {
          names.addAll(lush);
        }
        if (names.isEmpty()) {
          return;
        }
        // picked with the chunk's random from sorted lists, so a world seed always grows the same
        // trees; weighted by the natural-tree-weights config section
        final String treeName = this.pickWeighted(names, random);
        final File treeFile = new File(this.plugin.getDataFolder(), treeName);
        final File rootFile = new File(this.plugin.getDataFolder(),
                                       treeName.substring(0, treeName.length() - 4) + ".root.xml");
        // a missing root file just means no roots (TreeRenderer checks)
        final TreeRenderer renderer = new TreeRenderer(this.plugin);
        renderer.renderTree(refPoint, treeFile, rootFile, random.nextInt(), false);
      }
    } catch (Exception ex) {
      plugin.getLogger().log(Level.SEVERE, "Exception caught generating giant tree", ex);
    }
  }

  /** The biome folder for azalea trees: they grow above lush caves, whatever the surface biome. */
  static final String LUSH_CAVES = "LUSH_CAVES";
  /** Blocks between biome samples on the way down (biomes are stored per 4 x 4 x 4 cell). */
  private static final int BIOME_SAMPLE_STEP = 4;

  /**
   * The tree files of a biome, sorted: biome.<BIOME>.xml or biome.<BIOME>-<anything>.xml (not
   * roots).
   */
  private List<String> biomeTreeFiles(final String biomeName) {
    final String prefix = "biome." + biomeName;
    final File[] files = this.plugin.getDataFolder().listFiles((dir, name) ->
        name.endsWith(".xml") && !name.endsWith(".root.xml")
        && (name.equals(prefix + ".xml") || name.startsWith(prefix + "-")));
    if (files == null) {
      return List.of();
    }
    return Arrays.stream(files).map(File::getName).sorted().toList();
  }

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
   * Picks one biome tree file at random, weighted by the {@code natural-tree-weights} config
   * section. Keys are tree names, the part of the file name after {@code biome.<BIOME>-}
   * (e.g. {@code OAK_HUGE} for {@code biome.FOREST-OAK_HUGE.xml}); a key starting with
   * {@code *} matches every name ending in the rest ({@code "*_HUGE"}). An exact key beats a
   * {@code *} key, the longest {@code *} key wins among those, and unlisted trees weigh
   * {@code default} (1 if unset). Weights of 0 or less never spawn.
   */
  String pickWeighted(final List<String> files, final Random random) {
    final ConfigurationSection weights = this.weightsSection();
    final double[] cumulative = new double[files.size()];
    double total = 0;
    for (int i = 0; i < files.size(); i++) {
      total += Math.max(0.0, weightOf(weights, treeName(files.get(i))));
      cumulative[i] = total;
    }
    if (total <= 0) {
      return files.get(random.nextInt(files.size()));
    }
    final double roll = random.nextDouble() * total;
    for (int i = 0; i < cumulative.length; i++) {
      if (roll < cumulative[i]) {
        return files.get(i);
      }
    }
    return files.get(files.size() - 1);
  }

  /**
   * The natural-tree-weights section of config.yml, or the bundled one when an older config
   * has none (getConfigurationSection would return an empty section there).
   */
  private ConfigurationSection weightsSection() {
    final String path = "natural-tree-weights";
    final Configuration config = this.plugin.getConfig();
    final Object own = config.get(path, null);
    if (own instanceof ConfigurationSection) {
      return (ConfigurationSection) own;
    }
    final Configuration defaults = config.getDefaults();
    return defaults == null ? null : defaults.getConfigurationSection(path);
  }

  /**
   * biome.FOREST-OAK_HUGE.xml -> OAK_HUGE (everything after the biome and its hyphen; biome
   * names have no hyphen), biome.FOREST.xml -> "".
   */
  static String treeName(final String file) {
    String name = file;
    if (name.startsWith("biome.")) {
      name = name.substring("biome.".length());
    }
    if (name.endsWith(".xml")) {
      name = name.substring(0, name.length() - 4);
    }
    final int hyphen = name.indexOf('-');
    return hyphen >= 0 ? name.substring(hyphen + 1) : "";
  }

  static double weightOf(final ConfigurationSection weights, final String name) {
    if (weights == null) {
      return 1.0;
    }
    String best = null;
    for (final String key : weights.getKeys(false)) {
      if (key.equals(name)) {
        return weights.getDouble(key);
      }
      if (key.startsWith("*") && name.endsWith(key.substring(1))
          && (best == null || key.length() > best.length())) {
        best = key;
      }
    }
    if (best != null) {
      return weights.getDouble(best);
    }
    return weights.getDouble("default", 1.0);
  }

  // complete list of biomes for reference
  /*
  Biome OCEAN = getBiome("ocean");
  Biome PLAINS = getBiome("plains");
  Biome DESERT = getBiome("desert");
  Biome WINDSWEPT_HILLS = getBiome("windswept_hills");
  Biome FOREST = getBiome("forest");
  Biome TAIGA = getBiome("taiga");
  Biome SWAMP = getBiome("swamp");
  Biome MANGROVE_SWAMP = getBiome("mangrove_swamp");
  Biome RIVER = getBiome("river");
  Biome NETHER_WASTES = getBiome("nether_wastes");
  Biome THE_END = getBiome("the_end");
  Biome FROZEN_OCEAN = getBiome("frozen_ocean");
  Biome FROZEN_RIVER = getBiome("frozen_river");
  Biome SNOWY_PLAINS = getBiome("snowy_plains");
  Biome MUSHROOM_FIELDS = getBiome("mushroom_fields");
  Biome BEACH = getBiome("beach");
  Biome JUNGLE = getBiome("jungle");
  Biome SPARSE_JUNGLE = getBiome("sparse_jungle");
  Biome DEEP_OCEAN = getBiome("deep_ocean");
  Biome STONY_SHORE = getBiome("stony_shore");
  Biome SNOWY_BEACH = getBiome("snowy_beach");
  Biome BIRCH_FOREST = getBiome("birch_forest");
  Biome DARK_FOREST = getBiome("dark_forest");
  Biome SNOWY_TAIGA = getBiome("snowy_taiga");
  Biome OLD_GROWTH_PINE_TAIGA = getBiome("old_growth_pine_taiga");
  Biome WINDSWEPT_FOREST = getBiome("windswept_forest");
  Biome SAVANNA = getBiome("savanna");
  Biome SAVANNA_PLATEAU = getBiome("savanna_plateau");
  Biome BADLANDS = getBiome("badlands");
  Biome WOODED_BADLANDS = getBiome("wooded_badlands");
  Biome SMALL_END_ISLANDS = getBiome("small_end_islands");
  Biome END_MIDLANDS = getBiome("end_midlands");
  Biome END_HIGHLANDS = getBiome("end_highlands");
  Biome END_BARRENS = getBiome("end_barrens");
  Biome WARM_OCEAN = getBiome("warm_ocean");
  Biome LUKEWARM_OCEAN = getBiome("lukewarm_ocean");
  Biome COLD_OCEAN = getBiome("cold_ocean");
  Biome DEEP_LUKEWARM_OCEAN = getBiome("deep_lukewarm_ocean");
  Biome DEEP_COLD_OCEAN = getBiome("deep_cold_ocean");
  Biome DEEP_FROZEN_OCEAN = getBiome("deep_frozen_ocean");
  Biome THE_VOID = getBiome("the_void");
  Biome SUNFLOWER_PLAINS = getBiome("sunflower_plains");
  Biome WINDSWEPT_GRAVELLY_HILLS = getBiome("windswept_gravelly_hills");
  Biome FLOWER_FOREST = getBiome("flower_forest");
  Biome ICE_SPIKES = getBiome("ice_spikes");
  Biome OLD_GROWTH_BIRCH_FOREST = getBiome("old_growth_birch_forest");
  Biome OLD_GROWTH_SPRUCE_TAIGA = getBiome("old_growth_spruce_taiga");
  Biome WINDSWEPT_SAVANNA = getBiome("windswept_savanna");
  Biome ERODED_BADLANDS = getBiome("eroded_badlands");
  Biome BAMBOO_JUNGLE = getBiome("bamboo_jungle");
  Biome SOUL_SAND_VALLEY = getBiome("soul_sand_valley");
  Biome CRIMSON_FOREST = getBiome("crimson_forest");
  Biome WARPED_FOREST = getBiome("warped_forest");
  Biome BASALT_DELTAS = getBiome("basalt_deltas");
  Biome DRIPSTONE_CAVES = getBiome("dripstone_caves");
  Biome LUSH_CAVES = getBiome("lush_caves");
  Biome DEEP_DARK = getBiome("deep_dark");
  Biome MEADOW = getBiome("meadow");
  Biome GROVE = getBiome("grove");
  Biome SNOWY_SLOPES = getBiome("snowy_slopes");
  Biome FROZEN_PEAKS = getBiome("frozen_peaks");
  Biome JAGGED_PEAKS = getBiome("jagged_peaks");
  Biome STONY_PEAKS = getBiome("stony_peaks");
  Biome CHERRY_GROVE = getBiome("cherry_grove");
  */

  /**
   * Biomes that grow giant trees, by the name simplifyBiome returns (biome.NAME-*.xml files).
   * Matched by key rather than Biome constants so biomes that only exist on newer servers (e.g.
   * dappled_forest, 26.3) can be listed without breaking older ones.
   */
  private static final Set<String> TREE_BIOMES = new HashSet<>(Arrays.asList(
      "FOREST", "BIRCH_FOREST", "CHERRY_GROVE", "SWAMP", "MANGROVE_SWAMP", "JUNGLE", "BADLANDS",
      "DARK_FOREST", "TAIGA", "SAVANNA", "PALE_GARDEN", "MUSHROOM_FIELDS", "DAPPLED_FOREST"));

  private boolean isAcceptableBiome(final String biome) {
    return biome != null && TREE_BIOMES.contains(biome);
  }

  /** Groups biome variants under the name used by the biome.NAME-*.xml files, or null. */
  private String simplifyBiome(final Biome biome) {

	  switch (biome.getKey().value().toUpperCase(Locale.ROOT)) {

      case "FOREST":
      case "WINDSWEPT_FOREST":
      case "FLOWER_FOREST":
        return "FOREST";
      case "BIRCH_FOREST":
      case "OLD_GROWTH_BIRCH_FOREST":
        return "BIRCH_FOREST";
      case "CHERRY_GROVE":
        return "CHERRY_GROVE";
      case "SWAMP":
        return "SWAMP";
      case "MANGROVE_SWAMP":
        return "MANGROVE_SWAMP";
      case "JUNGLE":
      case "SPARSE_JUNGLE":
        return "JUNGLE";
      case "DARK_FOREST":
        return "DARK_FOREST";
      case "PALE_GARDEN":
        return "PALE_GARDEN";
      case "TAIGA":
      case "SNOWY_TAIGA":
        return "TAIGA";
      case "SAVANNA":
      case "WINDSWEPT_SAVANNA":
      case "SAVANNA_PLATEAU":
        return "SAVANNA";
      case "BADLANDS":
      case "ERODED_BADLANDS":
      case "WOODED_BADLANDS":
        return "BADLANDS";
      case "MUSHROOM_FIELDS":
        return "MUSHROOM_FIELDS";
      case "DAPPLED_FOREST": // 26.3+
        return "DAPPLED_FOREST";
      default:
        return null;
	  }
  }

  private boolean treeCanGrow(final Random random) {
    double growChance = this.plugin.getConfig().getDouble("treeGrowthPercentChance");
    if (growChance > 100.0) {
      growChance = 100.0;
      this.plugin.getLogger().warning("treeGrowthPercentChance > 100. Assuming 100.");
    }
    if (growChance < 0.0) {
      growChance = 0.0;
      this.plugin.getLogger().warning("treeGrowthPercentChance < 0. Assuming zero.");
    }
    final double randomRoll = random.nextDouble() * 100.0;
    return growChance > randomRoll;
  }
}
