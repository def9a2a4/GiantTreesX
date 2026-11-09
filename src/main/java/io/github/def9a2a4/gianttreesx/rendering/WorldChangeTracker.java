package io.github.def9a2a4.gianttreesx.rendering;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.util.Vector;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

/**
 * Copyright 2014 Ryan Michela
 */
public class WorldChangeTracker {
  private Map<WorldChangeKey, WorldChange> changes = new HashMap<WorldChangeKey, WorldChange>(1000);

  public void addChange(final Vector location, final Material material,
                        final UnaryOperator<BlockData> blockDataMutator,
                        final WorldChange.Kind kind, final int level,
                        final boolean overwrite) {
    this.addChange(new WorldChange(location, material, blockDataMutator, kind, level), overwrite);
  }

  public void addChange(final WorldChange worldChange, final boolean overwrite) {
    final WorldChangeKey key = new WorldChangeKey(
            worldChange.location.getBlockX(),
            worldChange.location.getBlockY(),
            worldChange.location.getBlockZ());
    final WorldChange existing = this.changes.get(key);
    if (existing != null) {
      if (overwrite) {
        WorldChange replacement = worldChange;
        if (existing.kind == WorldChange.Kind.WOOD && worldChange.kind == WorldChange.Kind.WOOD
            && existing.level >= 0 && existing.level < worldChange.level) {
          // a branch starting inside the trunk stays trunk, so styling (hollows) treats it as such
          replacement = new WorldChange(worldChange.location, worldChange.material,
                                        worldChange.blockDataMutator, worldChange.kind,
                                        existing.level);
        }
        this.changes.put(key, replacement);
      }
    } else {
      this.changes.put(key, worldChange);
    }
  }

  public WorldChange getChange(final WorldChangeKey key) {
    return this.changes.get(key);
  }

  public Collection<WorldChange> getChanges() {
    return this.changes.values();
  }

  /**
   * Places the changes into the world, lowest first so the tree visibly grows upward, spread over
   * several ticks ({@code BLOCKS_PER_TICK} every {@code TICK_DELAY} ticks). Must be called on the
   * main thread.
   */
  public void applyChanges(final Location refPoint, final Plugin plugin) {
    final ConfigurationSection config = plugin.getConfig();
    final int blocksPerTick = Math.max(1, config.getInt("BLOCKS_PER_TICK", 1500));
    final long tickDelay = Math.max(1, config.getInt("TICK_DELAY", 1));
    final Protection protection = new Protection(config);

    final boolean verbose = config.getBoolean("verbose-logging", false);
    final World world = refPoint.getWorld();
    final List<WorldChange> ordered = new ArrayList<>(changes.values());
    ordered.sort(Comparator.comparingInt((WorldChange c) -> c.location.getBlockY())
                           .thenComparingInt(c -> c.location.getBlockX())
                           .thenComparingInt(c -> c.location.getBlockZ()));
    final Iterator<WorldChange> pending = ordered.iterator();

    new BukkitRunnable() {
      private int skipped;

      @Override
      public void run() {
        for (int placed = 0; placed < blocksPerTick && pending.hasNext(); placed++) {
          final WorldChange change = pending.next();
          final Location loc = refPoint.clone().add(change.location);
          if (loc.getBlockY() < world.getMinHeight() || loc.getBlockY() >= world.getMaxHeight()) {
            skipped++;
            continue;
          }
          final Block block = loc.getBlock();
          if (protection.isProtected(block)) {
            skipped++;
            continue;
          }
          final BlockData data = change.blockDataMutator.apply(change.material.createBlockData());
          block.setBlockData(data, false);
        }
        if (!pending.hasNext()) {
          this.cancel();
          if (verbose) {
            plugin.getLogger().info("Placed tree at " + refPoint.getBlockX() + " "
                                    + refPoint.getBlockY() + " " + refPoint.getBlockZ() + ": "
                                    + (ordered.size() - skipped) + " blocks, " + skipped + " skipped");
          }
        }
      }
    }.runTaskTimer(plugin, 0, tickDelay);
  }
}
