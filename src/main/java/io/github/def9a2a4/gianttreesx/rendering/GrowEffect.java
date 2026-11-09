package io.github.def9a2a4.gianttreesx.rendering;

import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitRunnable;

/**
 * Particles shown while a tree grown from saplings is on its way: a ring on the ground that
 * spreads from the core block out to the tree's trunk radius, finishing as the tree appears.
 */
final class GrowEffect {

  /** Ticks between rings. */
  private static final int PERIOD = 2;
  /** The shortest the effect runs, in ticks, even with no generation delay. */
  private static final int MIN_DURATION = 20;
  /** Particles per block of ring circumference. */
  private static final double DENSITY = 1.5;

  private GrowEffect() {
  }

  /**
   * The trunk's radius in blocks, from the area of its cross-section a couple of blocks above the
   * planting point (clear of the root flare), or 1 when there is no trunk there.
   */
  static double trunkRadius(final WorldChangeTracker tracker) {
    int area = 0;
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind == WorldChange.Kind.WOOD && change.level == 0
          && change.location.getBlockY() == 2) {
        area++;
      }
    }
    return area == 0 ? 1 : Math.sqrt(area / Math.PI);
  }

  /** Plays the effect around the block at {@code ground} for {@code ticks} (at least 1 second). */
  static void play(final Plugin plugin, final Location ground, final double radius, final long ticks) {
    final World world = ground.getWorld();
    if (world == null) {
      return;
    }
    final double cx = ground.getBlockX() + 0.5;
    final double cy = ground.getBlockY() + 0.2;
    final double cz = ground.getBlockZ() + 0.5;
    final long duration = Math.max(MIN_DURATION, ticks);
    new BukkitRunnable() {
      private long elapsed;

      @Override
      public void run() {
        final double r = 0.5 + Math.max(0, radius - 0.5) * Math.min(1, (double) elapsed / duration);
        final int points = Math.max(6, (int) Math.ceil(2 * Math.PI * r * DENSITY));
        for (int i = 0; i < points; i++) {
          final double a = 2 * Math.PI * i / points;
          world.spawnParticle(Particle.HAPPY_VILLAGER, cx + r * Math.cos(a), cy, cz + r * Math.sin(a),
                              1, 0.05, 0.05, 0.05, 0);
        }
        // a few rising at the core, where the tree will come up
        world.spawnParticle(Particle.HAPPY_VILLAGER, cx, cy + 0.5, cz, 3, 0.3, 0.4, 0.3, 0);
        elapsed += PERIOD;
        if (elapsed > duration) {
          cancel();
        }
      }
    }.runTaskTimer(plugin, 0, PERIOD);
  }
}
