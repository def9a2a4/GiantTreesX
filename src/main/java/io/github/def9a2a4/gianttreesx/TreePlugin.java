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
import java.io.IOException;
import java.util.Arrays;
import java.util.List;

import org.bstats.bukkit.Metrics;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.WorldInitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import io.github.def9a2a4.gianttreesx.rendering.TreeFiles;

public class TreePlugin extends JavaPlugin {

  private class WorldInitListener implements Listener {

    @EventHandler
    public void onWorldInit(final WorldInitEvent event) {
      if (TreePlugin.this.getConfig().getStringList("natural.worlds").contains(event.getWorld().getName())) {
        TreePlugin.this.getLogger().info("Attaching giant tree populator to world \""
                                         + event.getWorld().getName() + "\"");
        event.getWorld().getPopulators()
             .add(new TreePopulator(TreePlugin.this, TreePlugin.this.naturalTrees, TreePlugin.this.trees));
      }
    }
  }

  private NaturalTrees naturalTrees;
  private TreeFiles trees;

  @Override
  public void onEnable() {
    new Metrics(this, 35220);
    try {
      this.trees = new TreeFiles(new File(this.getDataFolder(), "tree"), this.getFile(), this.getClassLoader());
    } catch (final IOException e) {
      throw new IllegalStateException("Could not list the tree files in the plugin jar", e);
    }
    // an empty tree/ folder shows where added trees go; the bundled ones stay in the jar
    this.trees.userDir().mkdirs();
    this.warnAboutOldTreeFiles();
    this.warnAboutOldSettings();
    if (this.getConfig().getBoolean("planting.enabled")) {
      this.getServer().getPluginManager().registerEvents(new PlantTreeEventHandler(this, this.trees), this);
    }
    if (this.getConfig().getBoolean("natural.enabled")) {
      this.naturalTrees = NaturalTrees.load(this, this.trees, NaturalTrees.serverBiomes());
      this.getServer().getPluginManager().registerEvents(new WorldInitListener(), this);
    }

    this.getCommand("gianttrees").setExecutor(new TreeCommand(this, this.getFile(), this.trees));
  }

  @Override
  public void onLoad() {
    // writes config.yml only when it is missing (also when just the file was deleted)
    this.saveDefaultConfig();
  }

  /**
   * Tree files older versions unpacked into the plugin folder (tree.*.xml, biome.*.xml): no longer
   * read, so an edited or added one would otherwise stop working without a word. Most are just
   * outdated copies of bundled trees (which have changed since), so only those with no bundled
   * tree of that name, which must be custom, are named.
   */
  private void warnAboutOldTreeFiles() {
    final String[] old = this.getDataFolder().list(
        (dir, name) -> (name.startsWith("tree.") || name.startsWith("biome.")) && name.endsWith(".xml"));
    if (old == null || old.length == 0) {
      return;
    }
    Arrays.sort(old);
    final List<String> custom = Arrays.stream(old).filter(name -> this.trees.bundled(name) == null).toList();
    this.getLogger().warning(old.length + " tree files in " + this.getDataFolder() + " were left by an older"
                             + " version and are no longer read: the bundled trees now come from the plugin"
                             + " jar, and those files are probably outdated copies of them. If you edited or"
                             + " added a tree yourself, move it into the tree/ subfolder (a biome.BIOME-NAME.xml"
                             + " becomes tree.NAME.xml, listed under its biome in natural.trees); a file there"
                             + " replaces the bundled tree of the same name. Delete the rest."
                             + (custom.isEmpty() ? "" : " Not bundled, so probably your own: " + String.join(", ", custom)));
  }

  /** Top-level settings from before the natural: and planting: sections, no longer read. */
  private static final List<String> OLD_SETTINGS = List.of(
      "naturallyGrowTrees", "worlds", "treeGrowthPercentChance", "natural-tree-sizes",
      "natural-tree-weights", "natural-trees", "planting-patterns", "core", "bone-meal-consumed",
      "bone-meal-consumed-huge", "bone-meal-consumed-big", "bone-meal-consumed-small");

  /** A config.yml from an older version would otherwise fall back to the defaults without a word. */
  private void warnAboutOldSettings() {
    final List<String> old = OLD_SETTINGS.stream()
        .filter(key -> this.getConfig().get(key, null) != null).toList();
    if (!old.isEmpty()) {
      this.getLogger().warning("config.yml has settings from an older version that are no longer"
                               + " read: " + String.join(", ", old) + ". They moved into the"
                               + " natural: and planting: sections; see the bundled config.yml"
                               + " (the defaults apply until then).");
    }
  }


}
