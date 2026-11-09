package com.ryanmichela.trees.rendering;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
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
  /** Weighted leaf blocks; empty means "use the wood type's own (single) leaf block". */
  public final Map<Material, Integer> leaves;

  public WoodStyle(final Mode mode, final double hollowChance,
                   final int hollowWallThickness, final Map<Material, Integer> leaves) {
    this.mode = mode;
    this.hollowChance = hollowChance;
    this.hollowWallThickness = hollowWallThickness;
    this.leaves = leaves;
  }

  /**
   * Resolves the style for {@code woodType} (the tree file's WoodType param, e.g. "Dark Oak"):
   * keys under {@code wood_types.<woodType>} win over the same keys under {@code wood}.
   * {@code defaultLeaves} (the wood type's own {@link TreeType#leafMix}) is used when the config
   * sets no leaves.
   */
  public static WoodStyle fromConfig(final ConfigurationSection config, final String woodType,
                                     final Map<Material, Integer> defaultLeaves,
                                     final Logger logger) {
    final ConfigurationSection base = config.getConfigurationSection("wood");
    final ConfigurationSection override = config.getConfigurationSection("wood_types." + woodType);

    final String modeName = pick(override, base, "style", "mixed");
    Mode mode;
    try {
      mode = Mode.valueOf(modeName.toUpperCase(Locale.ROOT));
    } catch (final IllegalArgumentException e) {
      warnOnce(logger, "Unknown wood style '" + modeName + "', using mixed");
      mode = Mode.MIXED;
    }

    final double hollowChance = Math.max(0, Math.min(100,
        number(override, base, "hollow_chance", "0", woodType, logger)));
    final int wallThickness = Math.max(1, (int)
        number(override, base, "hollow_wall_thickness", "2", woodType, logger));

    final Map<Material, Integer> leaves = new LinkedHashMap<>();
    final ConfigurationSection leafSection = override == null ? null
        : override.getConfigurationSection("leaves");
    if (leafSection != null) {
      for (final String key : leafSection.getKeys(false)) {
        final Material material = Material.matchMaterial(key);
        final int weight = leafSection.getInt(key);
        if (material == null || !material.isBlock()) {
          warnOnce(logger, "Ignoring unknown leaf block '" + key + "' for wood type " + woodType);
        } else if (weight > 0) {
          leaves.put(material, weight);
        }
      }
    }

    if (leaves.isEmpty()) {
      // the wood type's own leaves, which for some (e.g. Poplar) are a mix
      leaves.putAll(defaultLeaves);
    }
    return new WoodStyle(mode, hollowChance, wallThickness, leaves);
  }

  /**
   * A numeric config value, or {@code fallback} with a warning when it is not a number, so one
   * typo does not stop every tree from rendering. Fractions are truncated for whole-number keys.
   */
  private static double number(final ConfigurationSection override, final ConfigurationSection base,
                               final String key, final String fallback, final String woodType,
                               final Logger logger) {
    final String value = pick(override, base, key, fallback);
    try {
      final double parsed = Double.parseDouble(value.trim());
      if (Double.isFinite(parsed)) {
        return parsed;
      }
    } catch (final NumberFormatException e) {
      // fall through to the warning
    }
    warnOnce(logger, "Invalid " + key + " '" + value + "' for wood type " + woodType + ", using " + fallback);
    return Double.parseDouble(fallback);
  }

  /** Styles are resolved for every tree, so each config problem is logged only the first time. */
  private static final Set<String> WARNED = ConcurrentHashMap.newKeySet();

  private static void warnOnce(final Logger logger, final String message) {
    if (WARNED.add(message)) {
      logger.warning(message);
    }
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
