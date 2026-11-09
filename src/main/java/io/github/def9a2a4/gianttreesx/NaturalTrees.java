package io.github.def9a2a4.gianttreesx;

import java.io.File;
import java.util.ArrayList;
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

  /**
   * One biome's entry: its chance (percent per chunk) and the tree files (tree.X.xml) it may grow
   * with their weights, in config order.
   */
  record Entry(String biome, double chance, Map<String, Double> files) {

    /** Whether any listed file has a positive weight (whether or not it exists). */
    boolean hasTrees() {
      return this.files.values().stream().anyMatch(w -> w > 0);
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
   * the plugin's log.
   */
  static NaturalTrees load(final Plugin plugin, final Set<String> knownBiomes) {
    final Logger log = plugin.getLogger();
    final Configuration config = plugin.getConfig();
    if (config.get("natural-tree-weights", null) != null) {
      log.warning("config.yml: natural-tree-weights is no longer used; set the trees of each biome"
                  + " in natural-trees and the sizes in natural-tree-sizes (see the bundled"
                  + " config.yml)");
    }
    final double defaultChance = chance(config.get("treeGrowthPercentChance"), 0.0,
                                        "config.yml: treeGrowthPercentChance", log);
    final Configuration defaults = config.getDefaults();
    final ConfigurationSection bundled = defaults == null
        ? null : defaults.getConfigurationSection("natural-trees");

    // the bundled sizes, then the ones this config sets (a partial section keeps the rest)
    final Map<String, Double> sizes = new LinkedHashMap<>();
    for (final String size : SIZES) {
      sizes.put(size, 1.0);
    }
    if (defaults != null) {
      readSizes(defaults.getConfigurationSection("natural-tree-sizes"), sizes,
                "bundled natural-tree-sizes", log);
    }
    if (config.get("natural-tree-sizes", null) instanceof ConfigurationSection own) {
      readSizes(own, sizes, "config.yml: natural-tree-sizes", log);
    }

    final Map<String, Entry> entries = new LinkedHashMap<>();
    final Object own = config.get("natural-trees", null);
    final ConfigurationSection section;
    if (own instanceof ConfigurationSection ownSection) {
      section = ownSection;
    } else {
      if (own != null) {
        log.warning("config.yml: natural-trees must be a map of biomes to trees; no natural trees"
                    + " grow (\"natural-trees: {}\" says that without this warning)");
        return new NaturalTrees(entries);
      }
      // no section in this config (an older one): the bundled trees
      section = bundled;
    }
    if (section == null) {
      return new NaturalTrees(entries);
    }
    final File folder = plugin.getDataFolder();
    // bundled biomes are not checked: DAPPLED_FOREST only exists from 26.3 on
    final Set<String> bundledBiomes = new HashSet<>();
    if (bundled != null) {
      bundled.getKeys(false).forEach(k -> bundledBiomes.add(biomeKey(k)));
    }
    for (final String key : section.getKeys(false)) {
      final String biome = biomeKey(key);
      final String where = "config.yml: natural-trees." + key;
      if (!LUSH_CAVES.equals(biome) && !knownBiomes.contains(biome)
          && !bundledBiomes.contains(biome)) {
        log.warning(where + ": no biome of that name on this server");
      }
      if (entries.containsKey(biome)) {
        log.warning(where + ": " + biome + " is listed twice; using this one");
      }
      final Object value = section.get(key, null);
      double chance = defaultChance;
      Object trees = value;
      final Map<String, Double> ownSizes = new LinkedHashMap<>(sizes);
      if (value instanceof ConfigurationSection biomeSection) {
        trees = biomeSection.get("trees", null);
        if (trees == null) {
          log.warning(where + ": no trees listed, so none grow here (add trees: [...])");
        }
        if (biomeSection.contains("chance", true)) {
          chance = chance(biomeSection.get("chance"), defaultChance, where + ".chance", log);
        }
        readSizes(biomeSection.getConfigurationSection("sizes"), ownSizes, where + ".sizes", log);
      }
      final Map<String, Double> files = new LinkedHashMap<>();
      for (final Map.Entry<String, Double> tree : treeWeights(trees, where, log).entrySet()) {
        final List<String> names = expand(tree.getKey());
        if (names.stream().noneMatch(n -> new File(folder, n).isFile())) {
          log.warning(where + ": no tree file for " + tree.getKey() + " (looked for "
                      + String.join(", ", names) + ")");
        }
        // a sized name (OAK_HUGE: 10) sets that file's weight even when OAK is listed too
        final boolean sized = names.size() == 1;
        for (final String name : names) {
          final double weight = tree.getValue() * ownSizes.get(sizeOf(name));
          if (sized) {
            files.put(name, weight);
          } else {
            files.putIfAbsent(name, weight);
          }
        }
      }
      entries.put(biome, new Entry(biome, chance, files));
    }
    return new NaturalTrees(entries);
  }

  /** Puts the giant/huge/big weights of {@code section} (if any) into {@code sizes}. */
  private static void readSizes(final ConfigurationSection section, final Map<String, Double> sizes,
                                final String where, final Logger log) {
    if (section == null) {
      return;
    }
    for (final String size : section.getKeys(false)) {
      final String name = size.toLowerCase(Locale.ROOT);
      if (SIZES.contains(name)) {
        sizes.put(name, weight(section.get(size), sizes.get(name), where + "." + size, log));
      } else {
        log.warning(where + ": unknown size " + size + " (giant, huge or big)");
      }
    }
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
        out.put(name.toUpperCase(Locale.ROOT), weight(map.get(name), 0.0, where + "." + name, log));
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

  /** A weight: a number of 0 or more, else {@code fallback} with a warning. */
  private static double weight(final Object value, final double fallback, final String where,
                               final Logger log) {
    final double w = number(value, fallback, where, log);
    if (w < 0) {
      log.warning(where + ": " + value + " is negative; using 0");
      return 0.0;
    }
    return w;
  }

  /** A number from the config, else {@code fallback} with a warning (getDouble would give 0). */
  private static double number(final Object value, final double fallback, final String where,
                               final Logger log) {
    if (value instanceof Number n) {
      return n.doubleValue();
    }
    log.warning(where + ": \"" + value + "\" is not a number; using " + fallback);
    return fallback;
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

  /**
   * FLOWER_FOREST from "flower_forest", "minecraft:flower_forest", ... Any namespace is dropped,
   * as the populator and the biome registry list go by the name alone.
   */
  static String biomeKey(final String key) {
    final String k = key.trim();
    return k.substring(k.indexOf(':') + 1).toUpperCase(Locale.ROOT);
  }

  /** A percent chance: a number clamped to 0-100, else {@code fallback} with a warning. */
  private static double chance(final Object value, final double fallback, final String where,
                               final Logger log) {
    final double chance = number(value, fallback, where, log);
    if (chance < 0.0 || chance > 100.0) {
      log.warning(where + ": " + chance + " is outside 0-100; using " + (chance < 0 ? 0 : 100));
    }
    return Math.max(0.0, Math.min(100.0, chance));
  }

  /** The biome keys a server has (FOREST, PALE_GARDEN, ...). */
  static Set<String> serverBiomes() {
    final Set<String> out = new HashSet<>();
    io.papermc.paper.registry.RegistryAccess.registryAccess()
        .getRegistry(io.papermc.paper.registry.RegistryKey.BIOME)
        .forEach(b -> out.add(biomeKey(b.getKey().getKey())));
    return out;
  }
}
