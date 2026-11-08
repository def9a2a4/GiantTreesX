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
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import com.ryanmichela.trees.cost.ItemCost;

import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;

import com.ryanmichela.trees.rendering.TreeRenderer;

public class PlantTreeEventHandler implements Listener {

  /** default bone meal cost of a 5x5 (giant) pattern */
  private static final int DEFAULT_BONE_MEAL = 64;
  /** default bone meal cost of a huge tree (full 3x3 ring) */
  private static final int DEFAULT_BONE_MEAL_HUGE = 32;
  /** default bone meal cost of a big tree (3x3 plus shape) */
  private static final int DEFAULT_BONE_MEAL_BIG = 16;
  /** widest pattern accepted; patterns are 3x3 or 5x5 squares with the core in the centre */
  private static final int MAX_PATTERN_SIZE = 5;
  /** pattern code for a "don't care" cell, which matches any block (e.g. the plus shape's corners) */
  private static final char ANY_BLOCK = '-';

  /** Tree size tiers: what a pattern grows, and so what it costs. */
  enum Tier {
    GIANT("a giant "), HUGE("a huge "), BIG("a big ");

    final String article;

    Tier(final String article) {
      this.article = article;
    }

    /**
     * The tier of the tree a pattern grows: by its name's suffix (_huge, or _small from older
     * configs, and _big), else by its shape: 5x5 giant, full 3x3 huge, 3x3 with "don't care"
     * cells big.
     */
    static Tier of(final String patternName, final int size, final int wildcards) {
      final String name = patternName.toLowerCase(Locale.ROOT);
      if (name.endsWith("_huge") || name.endsWith("_small")) {
        return HUGE;
      }
      if (name.endsWith("_big")) {
        return BIG;
      }
      if (size == MAX_PATTERN_SIZE) {
        return GIANT;
      }
      return wildcards == 0 ? HUGE : BIG;
    }
  }

  private Material coreblock;
  private boolean enabled;
  private final Plugin plugin;
  private final PopupHandler popup;
  /**
   * sorted most specific first: 5x5 before 3x3, and among patterns of one size those with fewer
   * "don't care" cells first, so a full 3x3 ring wins over the plus shape inside it
   */
  private final List<PhysicalCraftingRecipe> recipes = new ArrayList<>();
  private final TreeRenderer renderer;
  /** Sapling codes whose block this server doesn't have; patterns using them are skipped. */
  private static final java.util.Set<Character> unavailableCodes = new java.util.HashSet<>();

  private static final HashMap<Character, Material> patternMaterialMap;
  static {
	  patternMaterialMap = new HashMap<Character, Material>() {
		  private static final long serialVersionUID = 1L; {
			  put('A', Material.ACACIA_SAPLING); 
			  put('O', Material.OAK_SAPLING);
			  put('D', Material.DARK_OAK_SAPLING);
			  put('B', Material.BIRCH_SAPLING);
			  put('M', Material.MANGROVE_PROPAGULE);
			  put('S', Material.SPRUCE_SAPLING);
			  put('J', Material.JUNGLE_SAPLING);
			  put('C', Material.CHERRY_SAPLING);
			  put('R', Material.RED_MUSHROOM);
			  put('N', Material.BROWN_MUSHROOM);
			  put('F', Material.CRIMSON_FUNGUS);
			  put('W', Material.WARPED_FUNGUS);
			  put('Z', Material.AZALEA);
			  put('Y', Material.FLOWERING_AZALEA);
			  put('H', Material.BLUE_ORCHID);
		  }
	  };
	  // looked up by name: these blocks don't exist on every supported server version
	  putIfAvailable('P', "PALE_OAK_SAPLING");
	  putIfAvailable('L', "POPLAR_SAPLING"); // 26.3+
  }

  private static void putIfAvailable(final char code, final String material) {
	  final Material m = Material.getMaterial(material);
	  if (m != null) {
		  patternMaterialMap.put(code, m);
	  } else {
		  unavailableCodes.add(code);
	  }
  }

  	/*
  	 * Load up tree recipes and validate
  	 */
	public PlantTreeEventHandler(final Plugin plugin) {
		this.plugin = plugin;
		this.renderer = new TreeRenderer(plugin);
		this.popup = new PopupHandler(plugin);

		try {
			// Read config and create tree recipes
			int boneMealConsumed = DEFAULT_BONE_MEAL;
			if (!plugin.getConfig().contains("bone-meal-consumed")) {
				plugin.getLogger().warning("Warning: Please include a bone-meal-consumed config setting");
			} else {
				boneMealConsumed = plugin.getConfig().getInt("bone-meal-consumed");
			}
			// huge and big trees cost less; bone-meal-consumed-small (configs from before the size
			// tiers) still sets the huge cost when bone-meal-consumed-huge isn't set
			final int boneMealHuge = configuredInt("bone-meal-consumed-huge",
					configuredInt("bone-meal-consumed-small",
							plugin.getConfig().getInt("bone-meal-consumed-huge", DEFAULT_BONE_MEAL_HUGE)));
			final int boneMealBig = plugin.getConfig().getInt("bone-meal-consumed-big", DEFAULT_BONE_MEAL_BIG);

			if (!plugin.getConfig().contains("core")) {
				plugin.getLogger().warning("Warning: Please include a core block config setting");
				coreblock = Material.EMERALD_BLOCK;
			} else {
				// matchMaterial ignores case and accepts "minecraft:emerald_block"
				final String core = plugin.getConfig().getString("core");
				coreblock = core == null ? null : Material.matchMaterial(core);
				if (coreblock == null || !coreblock.isBlock()) {
					plugin.getLogger().warning("Warning: Invalid core block provided. Default to EMERALD_BLOCK");
					coreblock = Material.EMERALD_BLOCK;
				}
			}

			final ConfigurationSection patternSection = plugin.getConfig().getConfigurationSection("planting-patterns");
			if (patternSection == null) {
				plugin.getLogger().warning("Warning: no planting-patterns config section; survival planting of trees is off");
				enabled = false;
				return;
			}
			for (final String pattern : patternSection.getKeys(false)) {
				final Material[][] patternmaterials = parsePattern(pattern, patternSection.getStringList(pattern));
				if (patternmaterials != null) {
					final PhysicalCraftingRecipe recipe = new PhysicalCraftingRecipe(pattern, coreblock, patternmaterials, 0);
					final int cost = switch (Tier.of(pattern, recipe.getSize(), recipe.getWildcards())) {
						case GIANT -> boneMealConsumed;
						case HUGE -> boneMealHuge;
						case BIG -> boneMealBig;
					};
					recipes.add(new PhysicalCraftingRecipe(pattern, coreblock, patternmaterials, cost));
				}
			}
			recipes.sort(Comparator.comparingInt(PhysicalCraftingRecipe::getSize).reversed()
					.thenComparingInt(PhysicalCraftingRecipe::getWildcards));
			enabled = true;
		} catch (final Exception e) {
			plugin.getLogger().severe(
					"The planting-pattern config section is invalid! Disabling survival planting of giant trees. " + e.toString());
			enabled = false;
		}
	}

	/** The int set at {@code path} in the server's own config.yml (not the bundled defaults), else {@code def}. */
	private int configuredInt(final String path, final int def) {
		final Object value = plugin.getConfig().get(path, null);
		if (value instanceof Number) {
			return ((Number) value).intValue();
		}
		if (value != null) {
			try {
				return Integer.parseInt(value.toString().trim());
			} catch (final NumberFormatException e) {
				plugin.getLogger().warning("Invalid " + path + " '" + value + "', using " + def);
			}
		}
		return def;
	}

	/**
	 * Parses one planting pattern: a 3x3 or 5x5 square of sapling codes with X (the core block)
	 * in the centre and - for "don't care" cells (returned as null). Logs the problem and returns
	 * null when the pattern is invalid.
	 */
	private Material[][] parsePattern(final String pattern, final List<String> patternrows) {
		final int size = patternrows.size();
		if (size != 3 && size != 5) {
			plugin.getLogger().severe("Error: Invalid dimensions for pattern " + pattern + ". Needs to be a 3x3 or 5x5 matrix.");
			return null;
		}
		final Material[][] patternmaterials = new Material[size][size];
		for (int row = 0; row < size; row++) {
			final String patternrow = patternrows.get(row);
			if (patternrow.length() != size) {
				plugin.getLogger().severe("Error: Dimensions for pattern " + pattern + " do not match. Needs to be a "
						+ size + "x" + size + " matrix.");
				return null;
			}
			for (int col = 0; col < size; col++) {
				final char code = patternrow.charAt(col);
				final boolean centre = row == size / 2 && col == size / 2;
				if (centre != (code == 'X')) {
					plugin.getLogger().severe("Error: pattern " + pattern + " needs exactly one X (the core block), in the centre");
					return null;
				}
				if (code == 'X') {
					patternmaterials[row][col] = coreblock;
				} else if (code == ANY_BLOCK) {
					patternmaterials[row][col] = null;
				} else if (unavailableCodes.contains(code)) {
					plugin.getLogger().info("Skipping planting pattern " + pattern + ": its sapling ("
							+ code + ") does not exist on this server version");
					return null;
				} else if (patternMaterialMap.containsKey(code)) {
					patternmaterials[row][col] = patternMaterialMap.get(code);
				} else {
					plugin.getLogger().severe("Error: " + code + " is not a valid sapling code in pattern " + pattern);
					return null;
				}
			}
		}
		return patternmaterials;
	}

    @EventHandler
	public void onPlayerInteract(final PlayerInteractEvent event) {
		if (!enabled) {
			return;
		}

		// the event fires once per hand; only handle the main hand so nothing runs twice
		if (event.getHand() != EquipmentSlot.HAND) {
			return;
		}

		final Block clickedBlock = event.getClickedBlock();
		if (clickedBlock == null || event.getAction() != Action.RIGHT_CLICK_BLOCK) {
			return;
		}
		final ItemStack itemInMainHand = event.getPlayer().getInventory().getItemInMainHand();
		if (clickedBlock.getType() != this.coreblock || itemInMainHand.getType() != Material.BONE_MEAL) {
			return;
		}

		if (!event.getPlayer().hasPermission("gianttrees.grow")) {
			return;
		}

		// recipes are sorted most specific first: a 5x5 ring wins over the 3x3 ring inside it,
		// and a full 3x3 ring over the plus shape inside that
		PhysicalCraftingRecipe recipe = null;
		Material[][] matched = null;
		for (final PhysicalCraftingRecipe candidate : recipes) {
			matched = candidate.matchingOrientation(blocksAround(clickedBlock, candidate.getSize()));
			if (matched != null) {
				recipe = candidate;
				break;
			}
		}
		if (recipe == null) {
			popup.sendPopup(event.getPlayer(), "Unable to match this pattern");
			return;
		}

		final ItemCost cost = new ItemCost(Material.BONE_MEAL, recipe.getBoneMealCost());
		if (!cost.isAffordable(event.getPlayer())) {
			popup.sendPopup(event.getPlayer(), "You need " + recipe.getBoneMealCost() + " bone meal to grow this tree");
			return;
		}

		final String treeType = recipe.getTreeName().toUpperCase(Locale.ROOT);
		// mix in the position so trees grown in the same world don't all share one shape
		final Random seed = new Random(clickedBlock.getWorld().getSeed()
				^ ((long) clickedBlock.getX() * 341873128712L)
				^ ((long) clickedBlock.getZ() * 132897987541L));
		final File treeFile = new File(plugin.getDataFolder(), "tree." + treeType + ".xml");
		final File rootFile = new File(plugin.getDataFolder(), "tree." + treeType + ".root.xml");
		event.setCancelled(true);
		cost.apply(event.getPlayer());
		final Tier tier = Tier.of(recipe.getTreeName(), recipe.getSize(), recipe.getWildcards());
		popup.sendPopup(event.getPlayer(), "Stand back! Generating " + tier.article + treeType + " tree!");
		clearBlocks(clickedBlock, matched);
		renderer.renderTree(clickedBlock.getLocation(), treeFile, rootFile, seed.nextInt(), true);
	}

    /*
     * The size x size blocks around (and including) the core block, indexed [z][x] like the
     * patterns: rows run along z, columns along x.
     */
    private static Material[][] blocksAround(Block core, int size) {
		final int half = size / 2;
		final Material[][] worldblocks = new Material[size][size];
		for (int x = 0; x < size; x++) {
			for (int z = 0; z < size; z++) {
				worldblocks[x][z] = core.getRelative(z - half, 0, x - half).getType();
			}
		}
		return worldblocks;
    }

    /*
     * Clear the core block and the saplings of the matched pattern; "don't care" cells (null in
     * the matched orientation) are left alone.
     * Need to do this as some trees do not overwrite/eliminate these
     *
     * @param - location of core block
     * @param - the matched orientation of the pattern, indexed like blocksAround
     */
    private void clearBlocks(Block coreblock, Material[][] matched) {
		final int size = matched.length;
		final int half = size / 2;
		for (int x = 0; x < size; x++) {
			for (int z = 0; z < size; z++) {
				if (matched[x][z] != null) {
					coreblock.getRelative(z - half, 0, x - half).setType(Material.AIR);
				}
			}
		}
    }
}
