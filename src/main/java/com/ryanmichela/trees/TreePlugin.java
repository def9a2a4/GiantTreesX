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
import java.io.IOException;
import java.util.ArrayList;
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
      for (final String worldName : TreePlugin.this.getConfig()
                                                   .getStringList("worlds")) {
        if (worldName.equals(event.getWorld().getName())) {
          TreePlugin.this.getLogger()
                         .info("Attaching giant tree populator to world \""
                                   + event.getWorld().getName() + "\"");
          event.getWorld().getPopulators()
               .add(new TreePopulator(TreePlugin.this));
          return;
        }
      }
    }
  }

  @Override
  public void onEnable() {
    try {
      this.getServer().getPluginManager()
          .registerEvents(new PlantTreeEventHandler(this), this);
      // attach to worlds automatically when onlyUseWorldManagers is false
      if (this.getConfig().getBoolean("naturallyGrowTrees", true)) {
        this.getServer().getPluginManager()
            .registerEvents(new WorldInitListener(), this);
      }
    } catch (final Exception e) {
      this.getLogger().severe("Failed to initialize plugin: " + e.getMessage());
    }

    this.getCommand("tree-edit").setExecutor(new EditTreeCommand(this));
    this.getCommand("tree-create").setExecutor(new CreateTreeCommand(this));
  }

  @Override
  public void onLoad() {
    // writes config.yml only when it is missing (also when just the file was deleted)
    this.saveDefaultConfig();
    this.unpackTreeFiles();
  }

  /**
   * Writes every tree and biome file bundled in the plugin jar ({@code tree.*.xml},
   * {@code biome.*.xml}, roots included) that the data folder does not have yet. Existing files
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

  /** Tree files at the root of the jar: tree.X.xml, biome.X.xml and their .root.xml files. */
  private static final Pattern TREE_FILE = Pattern.compile("(tree|biome)\\.[^/]+\\.xml");

}
