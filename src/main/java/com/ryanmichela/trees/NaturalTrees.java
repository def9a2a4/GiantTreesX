package com.ryanmichela.trees;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.logging.Logger;

import org.bukkit.configuration.Configuration;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.Plugin;

/**
 * Which trees grow naturally in which biome: the natural-trees and natural-tree-sizes sections
 * of config.yml, read once when the plugin enables. Tree files are only looked up when a tree
 * grows, so a tree file added later (say tree.OAK_BIG.xml) spawns without a restart.
 */
final class NaturalTrees {

  /** The pseudo-biome of trees that grow above lush caves, whatever the surface biome. */
  static final String LUSH_CAVES = "LUSH_CAVES";

  static final String GIANT = "giant";
  static final String HUGE = "huge";
  static final String BIG = "big";
  private static final List<String> SIZES = List.of(GIANT, HUGE, BIG);

  /** Biome variants that use another biome's entry unless they have their own. */
  static final Map<String, String> VARIANTS = Map.ofEntries(
      Map.entry("FLOWER_FOREST", "FOREST"),
      Map.entry("WINDSWEPT_FOREST", "FOREST"),
      Map.entry("OLD_GROWTH_BIRCH_FOREST", "BIRCH_FOREST"),
      Map.entry("SPARSE_JUNGLE", "JUNGLE"),
      Map.entry("SNOWY_TAIGA", "TAIGA"),
      Map.entry("SAVANNA_PLATEAU", "SAVANNA"),
      Map.entry("WINDSWEPT_SAVANNA", "SAVANNA"),
      Map.entry("ERODED_BADLANDS", "BADLANDS"),
      Map.entry("WOODED_BADLANDS", "BADLANDS"));

  /** One tree file that may grow, with its pick weight. */
  record Candidate(String fileName, double weight, String biome) {}

  /** One biome's entry: its chance and the tree files it may grow, in config order. */
  static final class Entry {
    final String biome;
    /** Percent chance per chunk. */
    final double chance;
    /** File name (tree.X.xml) to weight, for every size of every listed tree. */
    final Map<String, Double> files;

    Entry(final String biome, final double chance, final Map<String, Double> files) {
      this.biome = biome;
      this.chance = chance;
      this.files = files;
    }

    /** The files that exist in {@code folder} and have a positive weight. */
    List<Candidate> candidates(final File folder) {
      final List<Candidate> out = new ArrayList<>();
      for (final Map.Entry<String, Double> e : this.files.entrySet()) {
        if (e.getValue() > 0 && new File(folder, e.getKey()).isFile()) {
          out.add(new Candidate(e.getKey(), e.getValue(), this.biome));
        }
      }
      return out;
    }
  }

  private final Map<String, Entry> entries;

  private NaturalTrees(final Map<String, Entry> entries) {
    this.entries = entries;
  }

  /**
   * The entry for a biome key (FLOWER_FOREST): its own, else the one of the biome it is a
   * variant of, else null.
   */
  Entry forBiome(final String biome) {
    final Entry own = this.entries.get(biome);
    if (own != null) {
      return own;
    }
    final String parent = VARIANTS.get(biome);
    return parent == null ? null : this.entries.get(parent);
  }

  Entry lushCaves() {
    return this.entries.get(LUSH_CAVES);
  }

  /**
   * Reads the config. Warnings (unknown biome keys, names without tree files, bad values) go to
   * the plugin's log; {@code knownBiomes} is null when the server's biomes can't be listed.
   */
  static NaturalTrees load(final Plugin plugin, final Set<String> knownBiomes) {
    final Logger log = plugin.getLogger();
    final Configuration config = plugin.getConfig();
    if (config.get("natural-tree-weights", null) != null) {
      log.warning("config.yml: natural-tree-weights is no longer used; set the trees of each biome"
                  + " in natural-trees and the sizes in natural-tree-sizes (see the bundled"
                  + " config.yml)");
    }
    final double defaultChance = clampChance(config.getDouble("treeGrowthPercentChance"),
                                             "treeGrowthPercentChance", log);
    final Map<String, Double> sizes = new LinkedHashMap<>();
    final ConfigurationSection sizeSection = ownOrDefault(config, "natural-tree-sizes");
    for (final String size : SIZES) {
      sizes.put(size, sizeSection == null ? 1.0 : sizeSection.getDouble(size, 1.0));
    }

    final Map<String, Entry> entries = new LinkedHashMap<>();
    final ConfigurationSection section = ownOrDefault(config, "natural-trees");
    if (section == null) {
      return new NaturalTrees(entries);
    }
    final File folder = plugin.getDataFolder();
    for (final String key : section.getKeys(false)) {
      final String biome = biomeKey(key);
      final String where = "config.yml: natural-trees." + key;
      if (knownBiomes != null && !LUSH_CAVES.equals(biome) && !knownBiomes.contains(biome)) {
        log.warning(where + ": no biome of that name on this server");
      }
      final Object value = section.get(key, null);
      double chance = defaultChance;
      Object trees = value;
      final Map<String, Double> ownSizes = new LinkedHashMap<>(sizes);
      if (value instanceof ConfigurationSection biomeSection) {
        trees = biomeSection.get("trees", null);
        if (biomeSection.contains("chance", true)) {
          chance = clampChance(biomeSection.getDouble("chance"), key + ".chance", log);
        }
        final ConfigurationSection s = biomeSection.getConfigurationSection("sizes");
        if (s != null) {
          for (final String size : s.getKeys(false)) {
            final String name = size.toLowerCase(Locale.ROOT);
            if (SIZES.contains(name)) {
              ownSizes.put(name, s.getDouble(size));
            } else {
              log.warning(where + ".sizes: unknown size " + size + " (giant, huge or big)");
            }
          }
        }
      }
      final Map<String, Double> files = new LinkedHashMap<>();
      for (final Map.Entry<String, Double> tree : treeWeights(trees, where, log).entrySet()) {
        final List<String> names = expand(tree.getKey());
        if (names.stream().noneMatch(n -> new File(folder, n).isFile())) {
          log.warning(where + ": no tree file for " + tree.getKey() + " (looked for "
                      + String.join(", ", names) + ")");
        }
        for (final String name : names) {
          files.putIfAbsent(name, tree.getValue() * ownSizes.get(sizeOf(name)));
        }
      }
      entries.put(biome, new Entry(biome, chance, files));
    }
    return new NaturalTrees(entries);
  }

  /** Tree name -> weight from a list ([OAK, BIRCH], weight 1 each), a name, or a map. */
  private static Map<String, Double> treeWeights(final Object trees, final String where,
                                                 final Logger log) {
    final Map<String, Double> out = new LinkedHashMap<>();
    if (trees == null) {
      return out;
    }
    if (trees instanceof ConfigurationSection map) {
      for (final String name : map.getKeys(false)) {
        out.put(name.toUpperCase(Locale.ROOT), map.getDouble(name));
      }
    } else if (trees instanceof List<?> list) {
      for (final Object name : list) {
        out.putIfAbsent(String.valueOf(name).toUpperCase(Locale.ROOT), 1.0);
      }
    } else if (trees instanceof String name) {
      out.put(name.toUpperCase(Locale.ROOT), 1.0);
    } else {
      log.warning(where + ": expected a list of tree names, a name or a map of names to weights");
    }
    return out;
  }

  /**
   * The files a tree name grows: NAME, NAME_HUGE and NAME_BIG. A name that already ends in
   * _HUGE or _BIG is just that file.
   */
  static List<String> expand(final String name) {
    if (name.endsWith("_HUGE") || name.endsWith("_BIG")) {
      return List.of("tree." + name + ".xml");
    }
    return List.of("tree." + name + ".xml", "tree." + name + "_HUGE.xml",
                   "tree." + name + "_BIG.xml");
  }

  /** The size of a tree file, by its name: tree.X_HUGE.xml is huge, tree.X_BIG.xml big. */
  static String sizeOf(final String fileName) {
    final String name = fileName.endsWith(".xml")
        ? fileName.substring(0, fileName.length() - 4) : fileName;
    if (name.endsWith("_HUGE")) {
      return HUGE;
    }
    if (name.endsWith("_BIG")) {
      return BIG;
    }
    return GIANT;
  }

  /** FLOWER_FOREST from "flower_forest", "minecraft:flower_forest", ... */
  static String biomeKey(final String key) {
    String k = key.trim();
    if (k.regionMatches(true, 0, "minecraft:", 0, "minecraft:".length())) {
      k = k.substring("minecraft:".length());
    }
    return k.toUpperCase(Locale.ROOT);
  }

  /**
   * A section as written in the server's config.yml, or the bundled one when that config has
   * none (getConfigurationSection would return an empty section there, and get with a key would
   * fill in bundled values for keys the admin removed).
   */
  private static ConfigurationSection ownOrDefault(final Configuration config, final String path) {
    final Object own = config.get(path, null);
    if (own instanceof ConfigurationSection) {
      return (ConfigurationSection) own;
    }
    final Configuration defaults = config.getDefaults();
    return defaults == null ? null : defaults.getConfigurationSection(path);
  }

  private static double clampChance(final double chance, final String name, final Logger log) {
    if (chance > 100.0) {
      log.warning(name + " > 100. Assuming 100.");
      return 100.0;
    }
    if (chance < 0.0) {
      log.warning(name + " < 0. Assuming zero.");
      return 0.0;
    }
    return chance;
  }

  /** The biome keys a server has (FOREST, PALE_GARDEN, ...), or null when they can't be listed. */
  static Set<String> serverBiomes() {
    try {
      final Set<String> out = new HashSet<>();
      io.papermc.paper.registry.RegistryAccess.registryAccess()
          .getRegistry(io.papermc.paper.registry.RegistryKey.BIOME)
          .forEach(b -> out.add(biomeKey(b.getKey().getKey())));
      return Collections.unmodifiableSet(out);
    } catch (final Throwable t) {
      return null;
    }
  }
}
