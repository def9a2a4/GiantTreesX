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
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * {@code tree-edit <species>}: opens the bundled Arbaro editor (the plugin jar's main class) on a
 * tree file, as a separate desktop process. Only useful on a server with a display.
 */
public class EditTreeCommand implements CommandExecutor {

  private final Plugin plugin;
  /** the plugin jar, whose main class is the Arbaro editor */
  private final File jar;

  public EditTreeCommand(final Plugin plugin, final File jar) {
    this.plugin = plugin;
    this.jar = jar;
  }

  @Override
  public boolean onCommand(final CommandSender sender, final Command command,
                           final String label, final String[] arg) {
    if (sender instanceof Player) {
      sender.sendMessage("You can only edit trees from the console.");
      return true;
    }

    if (arg.length != 1) {
      final File[] treeFiles = this.plugin.getDataFolder()
                                          .listFiles((dir, name) -> name.endsWith(".xml")
                                                                    && !name.endsWith(".root.xml"));
      final List<String> treeNames = new ArrayList<>();
      if (treeFiles != null) {
        for (final File treeFile : treeFiles) {
          treeNames.add(treeFile.getName().substring(0, treeFile.getName().length() - 4));
        }
      }
      treeNames.sort(null);
      sender.sendMessage("Usage: tree-edit <species>. Available trees:");
      for (final String treeName : treeNames) {
        sender.sendMessage(treeName);
      }
      return true;
    }

    if (!hasDisplay()) {
      sender.sendMessage("Cannot start the tree editor: this server has no graphical display. "
                         + "Run it on a desktop instead: java -jar " + this.jar.getName()
                         + " <tree file>");
      return true;
    }

    final File java = new File(System.getProperty("java.home"),
                               "bin" + File.separator + (File.separatorChar == '\\' ? "java.exe" : "java"));
    final File toOpen = new File(this.plugin.getDataFolder(), arg[0] + ".xml");
    final File log = new File(this.plugin.getDataFolder(), "arbaro.log");
    final ProcessBuilder pb = new ProcessBuilder(java.getAbsolutePath(), "-jar",
                                                 this.jar.getAbsolutePath(), toOpen.getAbsolutePath());
    pb.redirectErrorStream(true);
    pb.redirectOutput(log);
    final Process process;
    try {
      process = pb.start();
    } catch (final IOException e) {
      this.plugin.getLogger().log(Level.SEVERE, "Error starting the Arbaro tree editor", e);
      sender.sendMessage("Could not start the tree editor: " + e.getMessage());
      return true;
    }
    sender.sendMessage("Loading " + arg[0] + " in the tree editor...");

    // the editor runs until its window is closed; an early failure (no usable display after all,
    // ...) shows up as a quick non-zero exit, reported here instead of failing silently
    this.plugin.getServer().getScheduler().runTaskAsynchronously(this.plugin, () -> {
      try {
        if (process.waitFor(15, TimeUnit.SECONDS) && process.exitValue() != 0) {
          this.plugin.getLogger().warning("The tree editor exited with status "
                                          + process.exitValue() + "; see " + log.getPath());
        }
      } catch (final InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    });
    return true;
  }

  /**
   * Whether a desktop window can be opened. The server's own JVM is often headless whatever the
   * machine has, so this looks at the environment instead: Windows and macOS have a desktop
   * session for a logged-in user; elsewhere an X11 or Wayland display must be set.
   */
  private static boolean hasDisplay() {
    final String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
    if (os.startsWith("windows") || os.contains("mac")) {
      return true;
    }
    return notBlank(System.getenv("DISPLAY")) || notBlank(System.getenv("WAYLAND_DISPLAY"));
  }

  private static boolean notBlank(final String s) {
    return s != null && !s.isBlank();
  }
}
