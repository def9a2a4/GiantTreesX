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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.logging.Level;
import java.util.regex.Pattern;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.WorldInitEvent;
import org.bukkit.plugin.java.JavaPlugin;

public class TreePlugin extends JavaPlugin {

  private class WorldInitListener implements Listener {

    @EventHandler
    public void onWorldInit(final WorldInitEvent event) {
      if (TreePlugin.this.getConfig().getStringList("worlds").contains(event.getWorld().getName())) {
        TreePlugin.this.getLogger().info("Attaching giant tree populator to world \""
                                         + event.getWorld().getName() + "\"");
        event.getWorld().getPopulators()
             .add(new TreePopulator(TreePlugin.this, TreePlugin.this.naturalTrees));
      }
    }
  }

  private NaturalTrees naturalTrees;

  @Override
  public void onEnable() {
    this.warnAboutBiomeFiles();
    this.getServer().getPluginManager().registerEvents(new PlantTreeEventHandler(this), this);
    if (this.getConfig().getBoolean("naturallyGrowTrees", true)) {
      this.naturalTrees = NaturalTrees.load(this, NaturalTrees.serverBiomes());
      this.getServer().getPluginManager().registerEvents(new WorldInitListener(), this);
    }

    this.getCommand("tree-edit").setExecutor(new EditTreeCommand(this, this.getFile()));
    this.getCommand("tree-create").setExecutor(new CreateTreeCommand(this));
  }

  @Override
  public void onLoad() {
    // writes config.yml only when it is missing (also when just the file was deleted)
    this.saveDefaultConfig();
    this.unpackTreeFiles();
  }

  /**
   * Biome files (biome.FOREST-OAK.xml) from before natural-trees: they are no longer read, so an
   * edited or added one would otherwise stop spawning without a word.
   */
  private void warnAboutBiomeFiles() {
    final String[] old = this.getDataFolder().list(
        (dir, name) -> name.startsWith("biome.") && name.endsWith(".xml") && !name.endsWith(".root.xml"));
    if (old != null && old.length > 0) {
      Arrays.sort(old);
      this.getLogger().warning(old.length + " biome.*.xml files in the plugin folder are no longer"
                               + " used (" + String.join(", ", old) + "). Natural trees are now set"
                               + " in config.yml's natural-trees, by tree name (tree.<NAME>.xml);"
                               + " to keep a custom one, rename it to tree.<NAME>.xml and list it"
                               + " there. The biome files can be deleted.");
    }
  }

  /**
   * Writes every tree file bundled in the plugin jar ({@code tree.*.xml}, roots included) that
   * the data folder does not have yet. Existing files
   * are never overwritten, so edited trees survive upgrades; deleted ones come back.
   */
  private void unpackTreeFiles() {
    final List<String> bundled = new ArrayList<>();
    try (JarFile jar = new JarFile(this.getFile())) {
      final Enumeration<JarEntry> entries = jar.entries();
      while (entries.hasMoreElements()) {
        final JarEntry entry = entries.nextElement();
        if (!entry.isDirectory() && TREE_FILE.matcher(entry.getName()).matches()) {
          bundled.add(entry.getName());
        }
      }
    } catch (final IOException e) {
      this.getLogger().log(Level.SEVERE, "Could not list the tree files in the plugin jar", e);
      return;
    }
    Collections.sort(bundled);
    for (final String name : bundled) {
      // check first: saveResource warns when the file exists and replace is false
      if (!new File(this.getDataFolder(), name).exists()) {
        this.saveResource(name, false);
      }
    }
  }

  /** Tree files at the root of the jar: tree.X.xml and tree.X.root.xml. */
  private static final Pattern TREE_FILE = Pattern.compile("tree\\.[^/]+\\.xml");

}
