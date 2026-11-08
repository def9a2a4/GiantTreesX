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
package com.ryanmichela.trees.rendering;

import java.util.LinkedList;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.UnaryOperator;

import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.Leaves;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;
import org.bukkit.util.noise.NoiseGenerator;
import org.bukkit.util.noise.SimplexNoiseGenerator;

public class Draw3d {

  // Leaf noise for TreeType.noisyLeaves (plotNoisyEllipsoid); kept in sync with
  // docs/viewer/src/draw3d.js
  /** Amplitude (blocks) and frequency of the simplex octave making lumps and dents. */
  static final double LEAF_LUMP = 1.1;
  static final double LEAF_LUMP_FREQ = 0.22;
  /** Amplitude (blocks) and frequency of the finer octave roughening the outline. */
  static final double LEAF_FINE = 0.3;
  static final double LEAF_FINE_FREQ = 0.6;
  /** Range (blocks) of the per-block hash jitter: single-block gaps and protrusions. */
  static final double LEAF_JITTER = 0.4;
  /** Clusters thinner than this (blocks, centre to surface) get proportionally weaker noise. */
  static final double LEAF_FULL_RADIUS = 2.0;
  /**
   * Cluster size scaling: a cluster of length (LeafScale / 2) up to LEAF_CLEAN_SIZE has no noise
   * at all (a plain ellipsoid), from LEAF_FULL_SIZE on the full amplitudes above, linear between.
   * So _BIG trees (LeafScale 4-6.5) are nearly clean, _HUGE ones lightly noised.
   */
  static final double LEAF_CLEAN_SIZE = 2.5;
  static final double LEAF_FULL_SIZE = 8.0;
  private static final double LEAF_REACH = LEAF_LUMP + LEAF_FINE + LEAF_JITTER / 2;

  public class Point2D {

    public int p;
    public int q;

    public Point2D(final int p, final int q) {
      this.p = p;
      this.q = q;
    }
  }

  public enum RenderOrientation {
    INVERTED, NORMAL
  }

  private final WorldChangeTracker changeTracker;
  private final NoiseGenerator     noise;
  private final double             noiseIntensity;
  private final Location           refPoint;

  private final RenderOrientation  renderOrientation;

  private final TreeType           treeType;

  public Draw3d(final Location refPoint, final double noiseIntensity,
                final TreeType treeType,
                final WorldChangeTracker changeTracker,
                final RenderOrientation renderOrientation) {
    this.refPoint = refPoint;
    this.noise = new SimplexNoiseGenerator(refPoint.hashCode());
    this.noiseIntensity = noiseIntensity;
    this.changeTracker = changeTracker;
    this.treeType = treeType;
    this.renderOrientation = renderOrientation;
  }

  public void applyChanges(final Plugin plugin) {
    changeTracker.applyChanges(refPoint, plugin);
  }

  public void drawCone(final Vector l1, final double rad1, final Vector l2,
                       final double rad2, final int level) {
    final Orientation orientation = Orientation.orient(l1, l2);
    final List<Vector> centerLine = plotLine3d(l1, l2, orientation);

    // Circle stuff
    final double h = l1.distance(l2);
    final double ht = (-rad1 * h) / (rad2 - rad1);
    for (int i = 0; i < centerLine.size(); i++) {
      final Vector centerPoint = centerLine.get(i);
      final int r = (int) Math.round((rad1 * (ht - i)) / ht);

      List<Point2D> circle2d;
      switch (orientation) {
        case xMajor:
          circle2d = plotCircle(centerPoint.getBlockY(),
                                     centerPoint.getBlockZ(),
                                     centerPoint.getBlockX(), r, level);
          for (final Point2D p : circle2d) {
            addWood(new Vector(
                                      centerPoint.getBlockX(),
                                      (l1.getBlockY() - centerPoint.getBlockY())
                                          + p.p,
                                      (l1.getBlockZ() - centerPoint.getBlockZ())
                                          + p.q), orientation, level);
          }
          break;
        case yMajor:
          circle2d = plotCircle(centerPoint.getBlockX(),
                                     centerPoint.getBlockZ(),
                                     centerPoint.getBlockY(), r, level);
          for (final Point2D p : circle2d) {
            addWood(new Vector(
                                                    (l1.getBlockX() - centerPoint.getBlockX())
                                                        + p.p,
                                                    centerPoint.getBlockY(),
                                                    (l1.getBlockZ() - centerPoint.getBlockZ())
                                                        + p.q), orientation, level);
          }
          break;
        case zMajor:
          circle2d = plotCircle(centerPoint.getBlockX(),
                                     centerPoint.getBlockY(),
                                     centerPoint.getBlockZ(), r, level);
          for (final Point2D p : circle2d) {
            addWood(new Vector(
                                                    (l1.getBlockX() - centerPoint.getBlockX())
                                                        + p.p,
                                                    (l1.getBlockY() - centerPoint.getBlockY())
                                                        + p.q,
                                                    centerPoint.getBlockZ()), orientation, level);
          }
          break;
      }
    }
  }

  public void drawLeafCluster(final Vector pos, final double length,
                              final double width) {
    final List<Vector> points = treeType.noisyLeaves
        ? plotNoisyEllipsoid(pos, length, width, length)
        : plotEllipsoid(pos, length, width, length, 0);
    for (final Vector loc : points) {
      changeTracker.addChange(loc, treeType.leafMaterial,
                                   persist(), WorldChange.Kind.LEAVES, -1, false);
    }
  }

  public void drawRootJunction(final Vector pos, final double r) {
    for (final Vector loc : plotDownwardHemisphere(pos, r)) {
      changeTracker.addChange(loc, treeType.woodMaterial,
              orient(Orientation.yMajor), WorldChange.Kind.WOOD, 0, true);
    }
  }

  public void drawWoodSphere(final Vector pos, final double r,
                             final Orientation orientation, final int level) {
    for (final Vector loc : plotSphere(pos, r, level)) {
      addWood(loc, orientation, level);
    }
  }

  /**
   * Stem blocks; from {@link TreeType#capLevel} on they are leaf (cap) blocks instead, which never
   * replace what is already there (mushroom caps, so no stem pokes out of the cap).
   */
  private void addWood(final Vector loc, final Orientation orientation, final int level) {
    if (level >= treeType.capLevel) {
      changeTracker.addChange(loc, treeType.leafMaterial, persist(), WorldChange.Kind.LEAVES, -1, false);
    } else {
      changeTracker.addChange(loc, treeType.woodMaterial, orient(orientation), WorldChange.Kind.WOOD,
                              level, true);
    }
  }

  public Vector
      toMcVector(final net.sourceforge.arbaro.transformation.Vector arbVec) {
    final boolean invertY = renderOrientation == RenderOrientation.INVERTED;
    return new Vector(arbVec.getX(), invertY ? -arbVec.getZ() : arbVec.getZ(),
                      arbVec.getY());
  }

  private double calculateNoiseOffset(final int x, final int y, final int z,
                                      final int multiplier, final int level) {
    final double levelScale = ((double) (4 - level) / (double) 4);
    return (noise.noise(x * .25, y * .25, z * .25) + 1)
           * noiseIntensity * multiplier * levelScale;
  }

  private UnaryOperator<BlockData> orient(Orientation orientation) {
    return blockData -> {
      if (blockData instanceof Orientable) {
        Orientable orientable = (Orientable) blockData;
        // toMcVector maps Arbaro's up axis onto Minecraft's y, so yMajor is vertical
        switch (orientation) {
          case xMajor: orientable.setAxis(Axis.X); break;
          case yMajor: orientable.setAxis(Axis.Y); break;
          case zMajor: orientable.setAxis(Axis.Z); break;
        }
      }
      return blockData;
    };
  }

  private UnaryOperator<BlockData> persist() {
    return blockData -> {
      if (blockData instanceof Leaves) {
        Leaves leaves = (Leaves) blockData;
        leaves.setPersistent(true);
      }
      return blockData;
    };
  }

  private List<Point2D> plotCircle(final int cx, final int cy, final int z,
                                   final int r, final int level) {
    final List<Point2D> points2d = new LinkedList<>();

    final int rSquare = r * r;
    for (int x = -r - 8; x <= (r + 8); x++) {
      for (int y = -r - 8; y <= (r + 8); y++) {
        final double noiseOffset = calculateNoiseOffset((x + cx),
                                                             (y + cy), (z), 4,
                                                             level);
        if (((x == 0) && (y == 0))
            || (((x * x) + (y * y)) <= (rSquare + (noiseOffset * noiseOffset)))) {
          points2d.add(new Point2D(cx + x, cy + y));
        }
      }
    }

    return points2d;
  }

  /**
   * Noisy half-sphere below the trunk base. Its top (ground) layer is a plain disc of the trunk
   * radius rounded like {@link #drawCone}'s circles, so it never sticks out past the trunk's first
   * circle as a ring at ground level.
   */
  private List<Vector> plotDownwardHemisphere(final Vector pos, final double r) {
    final List<Vector> points = new LinkedList<>();
    final int rCeil = (int) Math.ceil(r) + 4;
    final double r2 = r * r;
    final int rTop = (int) Math.round(r);
    for (int x = -rCeil; x <= rCeil; x++) {
      for (int y = -rCeil; y <= 0; y++) {
        for (int z = -rCeil; z <= rCeil; z++) {
          if (y == 0) {
            if (((x * x) + (z * z)) <= (rTop * rTop)) {
              points.add(new Vector(x, y, z).add(pos));
            }
            continue;
          }
          final double left = (x * x) + (y * y) + (z * z);
          final double noiseOffset = calculateNoiseOffset((x + pos.getBlockX()),
                                                               (y + pos.getBlockY()),
                                                               (z + pos.getBlockZ()),
                                                               2, 0);
          if (left <= (r2 + (noiseOffset * noiseOffset))) {
            points.add(new Vector(x, y, z).add(pos));
          }
        }
      }
    }
    return points;
  }

  private List<Vector> plotEllipsoid(final Vector pos, final double a,
                                     final double b, final double c,
                                     final int level) {
    final List<Vector> points = new LinkedList<>();

    final int halfSize = (int) Math.ceil(Math.max(Math.max(a, b), c)) + 2;

    for (int x = -halfSize; x <= halfSize; x++) {
      for (int y = -halfSize; y <= halfSize; y++) {
        for (int z = -halfSize; z <= halfSize; z++) {
          final double left = ((x * x) / (a * a)) + ((y * y) / (b * b))
                              + ((z * z) / (c * c));
          final double noiseOffset = calculateNoiseOffset((x + pos.getBlockX()),
                                                               (y + pos.getBlockY()),
                                                               (z + pos.getBlockZ()),
                                                               1, level);
          if (left <= (1 + noiseOffset)) {
            points.add(new Vector(x, y, z).add(pos));
          }
        }
      }
    }
    return points;
  }

  /**
   * The ellipsoid of {@link #plotEllipsoid} (level 0) with an uneven surface. A block's distance
   * outside the ellipsoid, in blocks along the ray from the centre, is compared with a displacement
   * made of two simplex octaves (lumps and dents) and a per-block hash jitter (single-block gaps
   * and protrusions). The displacement scales with the cluster's length (none up to
   * {@link #LEAF_CLEAN_SIZE}, full from {@link #LEAF_FULL_SIZE}) and shrinks where the cluster is
   * thinner than {@link #LEAF_FULL_RADIUS}, so small clusters stay clean and don't vanish. Only exactly rounded double
   * operations, so the viewer's port gives the same blocks.
   */
  private List<Vector> plotNoisyEllipsoid(final Vector pos, final double a, final double b,
                                          final double c) {
    final List<Vector> points = new LinkedList<>();
    final int halfSize = (int) Math.ceil(Math.max(Math.max(a, b), c)) + 3;
    final int px = pos.getBlockX();
    final int py = pos.getBlockY();
    final int pz = pos.getBlockZ();
    final int seed = refPoint.hashCode();
    // calculateNoiseOffset(.., 1, 0) <= 2 * Smooth (simplex noise stays within [-1, 1])
    final double tMax = 1 + (2.5 * noiseIntensity);
    final double clusterAmp = Math.min(1, Math.max(0, (a - LEAF_CLEAN_SIZE)
                                                      / (LEAF_FULL_SIZE - LEAF_CLEAN_SIZE)));
    for (int x = -halfSize; x <= halfSize; x++) {
      for (int y = -halfSize; y <= halfSize; y++) {
        for (int z = -halfSize; z <= halfSize; z++) {
          final int bx = x + px;
          final int by = y + py;
          final int bz = z + pz;
          final double left = ((x * x) / (a * a)) + ((y * y) / (b * b)) + ((z * z) / (c * c));
          final int r2 = (x * x) + (y * y) + (z * z);
          // far outside even for the largest Smooth offset: skip the noise lookups
          if ((left > 0) && ((Math.sqrt(r2) * (1 - Math.sqrt(tMax / left))) > LEAF_REACH)) {
            continue;
          }
          final double q = left / (1 + calculateNoiseOffset(bx, by, bz, 1, 0));
          final boolean inside;
          if (q == 0) {
            inside = true;
          } else {
            final double r = Math.sqrt(r2);
            final double rDir = r / Math.sqrt(q); // centre to surface along this ray
            final double out = r - rDir; // blocks outside the surface (negative inside)
            if (out <= -LEAF_REACH) {
              inside = true;
            } else if (out > LEAF_REACH) {
              inside = false;
            } else {
              final double amp = clusterAmp * Math.min(1, rDir / LEAF_FULL_RADIUS);
              final double reach = (amp * (LEAF_LUMP + LEAF_FINE))
                                   + ((clusterAmp * LEAF_JITTER) / 2);
              if (out <= -reach) {
                inside = true;
              } else if (out > reach) {
                inside = false;
              } else {
                final double lump = noise.noise((bx * LEAF_LUMP_FREQ) + 31.5,
                                                (by * LEAF_LUMP_FREQ) + 47.25,
                                                (bz * LEAF_LUMP_FREQ) + 13.75);
                final double fine = noise.noise((bx * LEAF_FINE_FREQ) + 71.5,
                                                (by * LEAF_FINE_FREQ) + 5.25,
                                                (bz * LEAF_FINE_FREQ) + 89.75);
                final double u = (LeafDecorator.hash(seed, bx, by, bz, 7) >>> 8) / 16777216.0;
                inside = out <= (amp * ((LEAF_LUMP * lump) + (LEAF_FINE * fine)))
                                + ((clusterAmp * LEAF_JITTER) * (u - 0.5));
              }
            }
          }
          if (inside) {
            points.add(new Vector(x, y, z).add(pos));
          }
        }
      }
    }
    return points;
  }

  private List<Point2D> plotLine2d(final int x1, final int y1, final int x2,
                                   final int y2) {
    final List<Point2D> points2d = new LinkedList<>();
    // Bresenham's Line Algorithm
    int currentX, currentY;
    int xInc, yInc;
    int dx, dy;
    int twoDx, twoDy;
    int twoDxAccumulatedError;
    int twoDyAccumulatedError;

    dx = x2 - x1;
    dy = y2 - y1;
    twoDx = dx + dx;
    twoDy = dy + dy;
    currentX = x1; // start at (X1,Y1) and move towards (X2,Y2)
    currentY = y1;
    xInc = 1; // X and/or Y are incremented/decremented by 1 only
    yInc = 1;
    if (dx < 0) {
      xInc = -1; // decrement X's
      dx = -dx;
      twoDx = -twoDx;
    }
    if (dy < 0) { // insure Dy >= 0
      yInc = -1;
      dy = -dy;
      twoDy = -twoDy;
    }
    points2d.add(new Point2D(x1, y1));
    if ((dx != 0) || (dy != 0)) { // are other points on the line ?
      if (dy <= dx) { // is the slope <= 1 ?
        twoDxAccumulatedError = 0; // initialize the error
        do {
          currentX += xInc; // consider X's from X1 to X2
          twoDxAccumulatedError += twoDy;
          if (twoDxAccumulatedError > dx) {
            currentY += yInc;
            twoDxAccumulatedError -= twoDx;
          }
          points2d.add(new Point2D(currentX, currentY));
        } while (currentX != x2);
      } else { // then the slope is large, reverse roles of X & Y
        twoDyAccumulatedError = 0; // initialize the error
        do {
          currentY += yInc; // consider Y's from Y1 to Y2
          twoDyAccumulatedError += twoDx;
          if (twoDyAccumulatedError > dy) {
            currentX += xInc;
            twoDyAccumulatedError -= twoDy;
          }
          points2d.add(new Point2D(currentX, currentY));
        } while (currentY != y2);
      }
    }
    return points2d;
  }

  private List<Vector> plotLine3d(final Vector l1, final Vector l2,
                                  final Orientation orientation) {
    final List<Vector> locations = new LinkedList<>();
    if (orientation == Orientation.xMajor) /* x dominant */
    {
      final List<Point2D> xy = plotLine2d(l1.getBlockX(), l1.getBlockY(),
                                               l2.getBlockX(), l2.getBlockZ());
      final List<Point2D> xz = plotLine2d(l1.getBlockX(), l1.getBlockZ(),
                                               l2.getBlockX(), l2.getBlockZ());
      for (int i = 0; i < Math.min(xy.size(), xz.size()); i++) {
        locations.add(new Vector(l1.getBlockX() + i, xy.get(i).q, xz.get(i).q));
      }
    } else if (orientation == Orientation.yMajor) /* y dominant */
    {
      final List<Point2D> yx = plotLine2d(l1.getBlockY(), l1.getBlockX(),
                                               l2.getBlockY(), l2.getBlockX());
      final List<Point2D> yz = plotLine2d(l1.getBlockY(), l1.getBlockZ(),
                                               l2.getBlockY(), l2.getBlockZ());
      for (int i = 0; i < Math.min(yx.size(), yz.size()); i++) {
        locations.add(new Vector(yx.get(i).q, l1.getBlockY() + i, yz.get(i).q));
      }
    } else if (orientation == Orientation.zMajor) /* z dominant */
    {
      final List<Point2D> zx = plotLine2d(l1.getBlockZ(), l1.getBlockX(),
                                               l2.getBlockZ(), l2.getBlockX());
      final List<Point2D> zy = plotLine2d(l1.getBlockZ(), l1.getBlockY(),
                                               l2.getBlockZ(), l2.getBlockY());
      for (int i = 0; i < Math.min(zx.size(), zy.size()); i++) {
        locations.add(new Vector(zx.get(i).q, zy.get(i).q, l1.getBlockZ() + i));
      }
    }

    return locations;
  }

  private List<Vector> plotSphere(final Vector pos, final double r,
                                  final int level) {
    final List<Vector> points = new LinkedList<>();
    final int rCeil = (int) Math.ceil(r) + 4;
    final double r2 = r * r;
    for (int x = -rCeil; x <= rCeil; x++) {
      for (int y = -rCeil; y <= rCeil; y++) {
        for (int z = -rCeil; z <= rCeil; z++) {
          final double left = (x * x) + (y * y) + (z * z);
          final double noiseOffset = calculateNoiseOffset((x + pos.getBlockX()),
                                                               (y + pos.getBlockY()),
                                                               (z + pos.getBlockZ()),
                                                               2, level);
          if (left <= (r2 + (noiseOffset * noiseOffset))) {
            points.add(new Vector(x, y, z).add(pos));
          }
        }
      }
    }
    return points;
  }
}
