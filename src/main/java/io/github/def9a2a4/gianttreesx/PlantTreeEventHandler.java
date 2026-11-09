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

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

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

import io.github.def9a2a4.gianttreesx.rendering.TreeFiles;
import io.github.def9a2a4.gianttreesx.rendering.TreeRenderer;

public class PlantTreeEventHandler implements Listener {

  /** widest pattern accepted; patterns are 3x3 or 5x5 squares with the core in the centre */
  private static final int MAX_PATTERN_SIZE = 5;
  /** pattern code for a "don't care" cell, which matches any block */
  private static final char ANY_BLOCK = '-';

  /** Tree size tiers: what a pattern grows, and so what it costs. */
  enum Tier {
    GIANT("a giant "), HUGE("a huge "), BIG("a big ");

    final String article;

    Tier(final String article) {
      this.article = article;
    }

    /** Its key in the config's planting.sizes, planting.bone-meal and planting.core sections. */
    String key() {
      return this.name().toLowerCase(Locale.ROOT);
    }

    /**
     * The tier of the tree a pattern grows: by its name's suffix (_huge, _big), else by its
     * shape: 5x5 giant, full 3x3 huge, 3x3 with "don't care" cells big.
     */
    static Tier of(final String patternName, final int size, final int wildcards) {
      final String name = patternName.toLowerCase(Locale.ROOT);
      if (name.endsWith("_huge")) {
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

  /** The block in the middle of each size's patterns (X): by default emerald for giant and huge
   *  trees, bone block for big ones, so the same 3x3 ring grows either. */
  private final Map<Tier, Material> coreBlocks = new EnumMap<>(Tier.class);
  private final Plugin plugin;
  /**
   * sorted most specific first: 5x5 before 3x3, and among patterns of one size those with fewer
   * "don't care" cells first, so a full ring wins over a pattern with gaps inside it
   */
  private final List<PhysicalCraftingRecipe> recipes = new ArrayList<>();
  private final Map<Tier, Integer> boneMeal = new EnumMap<>(Tier.class);
  private final TreeRenderer renderer;
  private final TreeFiles trees;
  /** Sapling codes whose block this server doesn't have; patterns using them are skipped. */
  private static final Set<Character> unavailableCodes = new HashSet<>();

  private static final Map<Character, Material> patternMaterialMap = new HashMap<>();
  static {
	  patternMaterialMap.put('A', Material.ACACIA_SAPLING);
	  patternMaterialMap.put('O', Material.OAK_SAPLING);
	  patternMaterialMap.put('D', Material.DARK_OAK_SAPLING);
	  patternMaterialMap.put('B', Material.BIRCH_SAPLING);
	  patternMaterialMap.put('M', Material.MANGROVE_PROPAGULE);
	  patternMaterialMap.put('S', Material.SPRUCE_SAPLING);
	  patternMaterialMap.put('J', Material.JUNGLE_SAPLING);
	  patternMaterialMap.put('C', Material.CHERRY_SAPLING);
	  patternMaterialMap.put('P', Material.PALE_OAK_SAPLING);
	  patternMaterialMap.put('R', Material.RED_MUSHROOM);
	  patternMaterialMap.put('N', Material.BROWN_MUSHROOM);
	  patternMaterialMap.put('F', Material.CRIMSON_FUNGUS);
	  patternMaterialMap.put('W', Material.WARPED_FUNGUS);
	  patternMaterialMap.put('Z', Material.AZALEA);
	  patternMaterialMap.put('Y', Material.FLOWERING_AZALEA);
	  patternMaterialMap.put('H', Material.BLUE_ORCHID);
	  // looked up by name: poplar only exists from 26.3 on
	  final Material poplar = Material.getMaterial("POPLAR_SAPLING");
	  if (poplar != null) {
		  patternMaterialMap.put('L', poplar);
	  } else {
		  unavailableCodes.add('L');
	  }
  }

  	/*
  	 * Load up tree recipes and validate
  	 */
	public PlantTreeEventHandler(final Plugin plugin, final TreeFiles trees) {
		this.plugin = plugin;
		this.trees = trees;
		this.renderer = new TreeRenderer(plugin, trees);
		final var config = plugin.getConfig();

		// getInt / getBoolean fall back to the bundled config.yml for settings the server's lacks
		for (final Tier tier : Tier.values()) {
			boneMeal.put(tier, config.getInt("planting.bone-meal." + tier.key()));
		}

		// planting.core: one block for every size (older configs), or one per size
		for (final Tier tier : Tier.values()) {
			final String name = config.isConfigurationSection("planting.core")
					? config.getString("planting.core." + tier.key())
					: config.getString("planting.core");
			final Material fallback = tier == Tier.BIG ? Material.BONE_BLOCK : Material.EMERALD_BLOCK;
			// matchMaterial ignores case and accepts "minecraft:emerald_block"
			Material core = name == null ? fallback : Material.matchMaterial(name);
			if (core == null || !core.isBlock()) {
				plugin.getLogger().warning("Invalid core block '" + name + "' for " + tier.key()
						+ " trees, using " + fallback);
				core = fallback;
			}
			coreBlocks.put(tier, core);
		}

		// the server's own patterns, or the bundled ones when its config has none
		final ConfigurationSection patternSection =
				config.get("planting.patterns", null) instanceof ConfigurationSection own ? own
						: config.getDefaults().getConfigurationSection("planting.patterns");
		for (final String pattern : patternSection.getKeys(false)) {
			final List<String> rows = patternSection.getStringList(pattern);
			final int wildcards = (int) String.join("", rows).chars().filter(c -> c == ANY_BLOCK).count();
			final Tier tier = Tier.of(pattern, rows.size(), wildcards);
			final Material[][] patternmaterials = parsePattern(pattern, rows, coreBlocks.get(tier));
			if (patternmaterials != null) {
				final PhysicalCraftingRecipe recipe = new PhysicalCraftingRecipe(pattern, patternmaterials);
				// a size turned off in planting.sizes: its patterns are left out, so a smaller
				// pattern inside the laid-out saplings can match instead
				if (!config.getBoolean("planting.sizes." + tier.key())) {
					continue;
				}
				if (!trees.exists(treeFile(recipe))) {
					plugin.getLogger().warning("Planting pattern " + pattern + " has no tree file ("
							+ treeFile(recipe) + "); it grows nothing");
				}
				recipes.add(recipe);
			}
		}
		recipes.sort(Comparator.comparingInt(PhysicalCraftingRecipe::getSize).reversed()
				.thenComparingInt(PhysicalCraftingRecipe::getWildcards));
	}

	/**
	 * Parses one planting pattern: a 3x3 or 5x5 square of sapling codes with X (the core block,
	 * {@code core}) in the centre and - for "don't care" cells (returned as null). Logs the
	 * problem and returns null when the pattern is invalid.
	 */
	private Material[][] parsePattern(final String pattern, final List<String> patternrows,
	                                  final Material core) {
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
					patternmaterials[row][col] = core;
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
		// the event fires once per hand; only handle the main hand so nothing runs twice
		if (event.getHand() != EquipmentSlot.HAND) {
			return;
		}

		final Block clickedBlock = event.getClickedBlock();
		if (clickedBlock == null || event.getAction() != Action.RIGHT_CLICK_BLOCK) {
			return;
		}
		final ItemStack itemInMainHand = event.getPlayer().getInventory().getItemInMainHand();
		if (!coreBlocks.containsValue(clickedBlock.getType()) || itemInMainHand.getType() != Material.BONE_MEAL) {
			return;
		}

		if (!event.getPlayer().hasPermission("gianttrees.grow")) {
			return;
		}

		// recipes are sorted most specific first: a 5x5 ring wins over the 3x3 ring inside it,
		// and a full ring over a pattern with gaps; the core block tells huge and big rings apart
		// a pattern whose tree file is missing (e.g. jungle_big or spruce_big from an older
		// config: those types have no big tree) is skipped, so a less specific one can still win
		PhysicalCraftingRecipe recipe = null;
		Material[][] matched = null;
		String missingTree = null;
		for (final PhysicalCraftingRecipe candidate : recipes) {
			final Material[][] orientation = candidate.matchingOrientation(blocksAround(clickedBlock, candidate.getSize()));
			if (orientation == null) {
				continue;
			}
			if (!trees.exists(treeFile(candidate))) {
				if (missingTree == null) {
					missingTree = treeFile(candidate);
				}
				continue;
			}
			recipe = candidate;
			matched = orientation;
			break;
		}
		if (recipe == null) {
			event.getPlayer().sendMessage(missingTree == null ? "Unable to match this pattern"
					: "There is no tree for this pattern (" + missingTree + " is missing)");
			return;
		}

		final Tier tier = Tier.of(recipe.getTreeName(), recipe.getSize(), recipe.getWildcards());
		// a cost of 0 (or less) is free; ItemStack rejects an amount below 1
		final int amount = boneMeal.get(tier);
		final ItemStack cost = amount > 0 ? new ItemStack(Material.BONE_MEAL, amount) : null;
		if (cost != null && !event.getPlayer().getInventory().containsAtLeast(cost, amount)) {
			event.getPlayer().sendMessage("You need " + amount + " bone meal to grow this tree");
			return;
		}

		final String treeType = recipe.getTreeName().toUpperCase(Locale.ROOT);
		event.setCancelled(true);
		if (cost != null) {
			event.getPlayer().getInventory().removeItem(cost);
		}
		event.getPlayer().sendMessage("Stand back! Generating " + tier.article + treeType + " tree!");
		clearBlocks(clickedBlock, matched);
		renderer.renderTree(clickedBlock.getLocation(), treeFile(recipe),
				TreeRenderer.positionSeed(clickedBlock.getLocation()), true,
				plugin.getConfig().getBoolean("planting.particles", true));
	}

    /** The tree file a pattern grows: oak_big grows tree.OAK_BIG.xml. */
    private static String treeFile(final PhysicalCraftingRecipe recipe) {
		return "tree." + recipe.getTreeName().toUpperCase(Locale.ROOT) + ".xml";
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
