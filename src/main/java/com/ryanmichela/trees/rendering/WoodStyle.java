package com.ryanmichela.trees.rendering;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.logging.Logger;

import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;

/**
 * How a tree's wood and leaves are turned into blocks, read from the {@code wood} config section
 * with optional per-wood-type overrides under {@code wood_types.<WoodType>}.
 */
public class WoodStyle {

  public enum Mode {
    /** Every wood block is a log (the pre-4.0 look). */
    ALL_LOG,
    /** Bark-on-all-sides wood blocks on the outside, logs in the core. */
    MIXED,
    /** Bark-on-all-sides wood blocks on the outside, stripped logs in the core. */
    MIXED_STRIPPED
  }

  public final Mode mode;
  /** Percent chance (0-100) that a tree's trunk is hollow. */
  public final double hollowChance;
  /** Blocks of wall, bark included, left around a hollow trunk. */
  public final int hollowWallThickness;
  /** Weighted leaf blocks; empty means "use the wood type's own leaves". */
  public final Map<Material, Integer> leaves;

  public WoodStyle(final Mode mode, final double hollowChance,
                   final int hollowWallThickness, final Map<Material, Integer> leaves) {
    this.mode = mode;
    this.hollowChance = hollowChance;
    this.hollowWallThickness = hollowWallThickness;
    this.leaves = leaves;
  }

  /** The legacy look: logs everywhere, never hollow, the wood type's own leaves. */
  public static WoodStyle legacy() {
    return new WoodStyle(Mode.ALL_LOG, 0, 2, new LinkedHashMap<>());
  }

  /**
   * Resolves the style for {@code woodType} (the tree file's WoodType param, e.g. "Dark Oak"):
   * keys under {@code wood_types.<woodType>} win over the same keys under {@code wood}.
   */
  public static WoodStyle fromConfig(final ConfigurationSection config, final String woodType,
                                     final Logger logger) {
    final ConfigurationSection base = config.getConfigurationSection("wood");
    final ConfigurationSection override = config.getConfigurationSection("wood_types." + woodType);

    final String modeName = pick(override, base, "style", "mixed");
    Mode mode;
    try {
      mode = Mode.valueOf(modeName.toUpperCase(Locale.ROOT));
    } catch (final IllegalArgumentException e) {
      logger.warning("Unknown wood style '" + modeName + "', using mixed");
      mode = Mode.MIXED;
    }

    final double hollowChance = Math.max(0, Math.min(100,
        Double.parseDouble(pick(override, base, "hollow_chance", "0"))));
    final int wallThickness = Math.max(1,
        Integer.parseInt(pick(override, base, "hollow_wall_thickness", "2")));

    final Map<Material, Integer> leaves = new LinkedHashMap<>();
    final ConfigurationSection leafSection = override != null && override.isConfigurationSection("leaves")
        ? override.getConfigurationSection("leaves")
        : null;
    if (leafSection != null) {
      for (final String key : leafSection.getKeys(false)) {
        final Material material = Material.matchMaterial(key);
        final int weight = leafSection.getInt(key);
        if (material == null || !material.isBlock()) {
          logger.warning("Ignoring unknown leaf block '" + key + "' for wood type " + woodType);
        } else if (weight > 0) {
          leaves.put(material, weight);
        }
      }
    }

    return new WoodStyle(mode, hollowChance, wallThickness, leaves);
  }

  private static String pick(final ConfigurationSection override, final ConfigurationSection base,
                             final String key, final String fallback) {
    if (override != null && override.contains(key)) {
      return String.valueOf(override.get(key));
    }
    if (base != null && base.contains(key)) {
      return String.valueOf(base.get(key));
    }
    return fallback;
  }
}
