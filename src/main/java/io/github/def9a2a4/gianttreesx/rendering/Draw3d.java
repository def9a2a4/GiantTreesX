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
package io.github.def9a2a4.gianttreesx.rendering;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.UnaryOperator;

import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.Leaves;
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

  // coverBranches; kept in sync with docs/viewer/src/draw3d.js
  /** Branch wood within this many blocks (Chebyshev) of leaves gets leaves on its top and sides. */
  static final int COVER_REACH_BRANCH = 3;
  /** Trunk wood within this many blocks of leaves gets leaves on its top. */
  static final int COVER_REACH_TRUNK = 1;
  /** A branch end with no leaves within TIP_REACH blocks gets a leaf cluster TIP_SCALE times the
   *  size of the tree's own. */
  static final int TIP_REACH = 2;
  static final double TIP_SCALE = 0.7;
  /**
   * Bare undersides (cherry, {@link #bareUndersides}): limb (level 1) wood more than BARE_TIP_KEEP
   * blocks from every limb end, in a 2^BARE_CELL_SHIFT-block cell picked BARE_PERCENT times in
   * 100, keeps the BARE_DEPTH blocks below it free of leaves, so some limbs show under the canopy.
   */
  static final int BARE_TIP_KEEP = 3;
  static final int BARE_DEPTH = 8;
  static final int BARE_CELL_SHIFT = 2;
  static final int BARE_PERCENT = 55;
  /** Columns (x, z offsets) carved below a bare limb block: its own and its four neighbours'. */
  private static final int[][] BARE_COLUMNS = {{0, 0}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}};
  /** Up, then the four horizontal sides. */
  private static final int[][] COVER_SIDES = {{0, 1, 0}, {1, 0, 0}, {-1, 0, 0}, {0, 0, 1}, {0, 0, -1}};
  private static final int[][] FACES = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};

  private record Point2D(int p, int q) {}

  public enum RenderOrientation {
    INVERTED, NORMAL
  }

  private final WorldChangeTracker changeTracker;
  private final NoiseGenerator     noise;
  private final double             noiseIntensity;
  private final Location           refPoint;

  private final RenderOrientation  renderOrientation;

  private final TreeType           treeType;

  /** Trunk and branch wood drawn (not roots), in drawing order; see {@link #coverBranches}. */
  private final Set<WorldChangeKey> branchWood = new LinkedHashSet<>();
  /** Branch ends, see {@link #markStemEnd}. */
  private final List<Vector>        stemEnds = new ArrayList<>();
  /** Ends of the level 1 branches (limbs), see {@link #bareBlocks}. */
  private final List<Vector>        limbEnds = new ArrayList<>();
  /** Blocks kept free of leaves below mid-branch wood (cherry); null until the first leaf
   *  cluster, see {@link #bareBlocks}. */
  private Set<WorldChangeKey>       bare;
  /** Size of the last leaf cluster drawn. */
  private double                    leafLength;
  private double                    leafWidth;

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

  public void drawCone(final Vector l1, final double rad1, final Vector l2,
                       final double rad2, final int level) {
    final Orientation orientation = Orientation.orient(l1, l2);
    final List<Vector> centerLine = plotLine3d(l1, l2, orientation);

    // Circle stuff
    final double h = l1.distance(l2);
    final double ht = (-rad1 * h) / (rad2 - rad1);
    for (int i = 0; i < centerLine.size(); i++) {
      final Vector centerPoint = centerLine.get(i);
      // the centre line can have more blocks than the cone is long (it ends past l2's block
      // boundary): clamp there instead of extrapolating the taper, which for a cone shorter than a
      // block (Taper 1-2 ends) gave huge negative radii, drawn as wide discs
      final int r = (int) Math.round((rad1 * (ht - Math.min(i, h))) / ht);

      List<Point2D> circle2d;
      switch (orientation) {
        case xMajor:
          circle2d = plotCircle(centerPoint.getBlockY(),
                                     centerPoint.getBlockZ(),
                                     centerPoint.getBlockX(), r, level);
          for (final Point2D p : circle2d) {
            addWood(new Vector(centerPoint.getBlockX(), p.p, p.q), orientation, level);
          }
          break;
        case yMajor:
          circle2d = plotCircle(centerPoint.getBlockX(),
                                     centerPoint.getBlockZ(),
                                     centerPoint.getBlockY(), r, level);
          for (final Point2D p : circle2d) {
            addWood(new Vector(p.p, centerPoint.getBlockY(), p.q), orientation, level);
          }
          break;
        case zMajor:
          circle2d = plotCircle(centerPoint.getBlockX(),
                                     centerPoint.getBlockY(),
                                     centerPoint.getBlockZ(), r, level);
          for (final Point2D p : circle2d) {
            addWood(new Vector(p.p, p.q, centerPoint.getBlockZ()), orientation, level);
          }
          break;
      }
    }
  }

  public void drawLeafCluster(final Vector pos, final double length,
                              final double width) {
    this.leafLength = length;
    this.leafWidth = width;
    final List<Vector> points = treeType.noisyLeaves
        ? plotNoisyEllipsoid(pos, length, width, length)
        : plotEllipsoid(pos, length, width, length);
    final Set<WorldChangeKey> skip = bareBlocks();
    for (final Vector loc : points) {
      if (!skip.isEmpty()
          && skip.contains(new WorldChangeKey(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ()))) {
        continue;
      }
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
      if (renderOrientation == RenderOrientation.NORMAL) {
        branchWood.add(new WorldChangeKey(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ()));
      }
    }
  }

  /** A stem's last point; branch ends (level 1 up) get covered by {@link #coverBranches}. */
  public void markStemEnd(final Vector pos, final int level) {
    if (level >= 1 && level < treeType.capLevel && renderOrientation == RenderOrientation.NORMAL) {
      stemEnds.add(pos);
      if (level == 1) {
        limbEnds.add(pos);
      }
    }
  }

  /** Cherry trees show some branch wood under their canopy, like vanilla's. */
  private boolean bareUndersides() {
    return treeType.leafMaterial == Material.CHERRY_LEAVES
           && renderOrientation == RenderOrientation.NORMAL;
  }

  /**
   * The blocks leaves stay out of (computed once, at the first leaf cluster, when all stems are
   * drawn): for {@link #bareUndersides} types, the BARE_DEPTH blocks below each limb block (level
   * 1) more than BARE_TIP_KEEP blocks from every limb end, down to the next wood, where the
   * block's cell of 2^BARE_CELL_SHIFT blocks is picked (BARE_PERCENT in 100). Tops and branch ends
   * keep their leaves. Empty for other types.
   */
  private Set<WorldChangeKey> bareBlocks() {
    if (bare != null) {
      return bare;
    }
    bare = new HashSet<>();
    if (!bareUndersides()) {
      return bare;
    }
    final int seed = refPoint.hashCode();
    final int keep2 = BARE_TIP_KEEP * BARE_TIP_KEEP;
    for (final WorldChangeKey key : branchWood) {
      final WorldChange change = changeTracker.getChange(key);
      if (change.kind != WorldChange.Kind.WOOD || change.level != 1) {
        continue;
      }
      final int x = key.x();
      final int y = key.y();
      final int z = key.z();
      final int h = LeafDecorator.hash(seed, x >> BARE_CELL_SHIFT, y >> BARE_CELL_SHIFT,
                                       z >> BARE_CELL_SHIFT, 11);
      if (((h >>> 8) % 100) >= BARE_PERCENT) {
        continue;
      }
      boolean nearEnd = false;
      for (final Vector end : limbEnds) {
        final int dx = x - end.getBlockX();
        final int dy = y - end.getBlockY();
        final int dz = z - end.getBlockZ();
        if (((dx * dx) + (dy * dy) + (dz * dz)) <= keep2) {
          nearEnd = true;
          break;
        }
      }
      if (nearEnd) {
        continue;
      }
      // the column below the block and below its four horizontal neighbours, each down to the
      // next wood, so the bare limb shows from the side as well as from straight below
      for (final int[] side : BARE_COLUMNS) {
        for (int d = 1; d <= BARE_DEPTH; d++) {
          final WorldChangeKey below = new WorldChangeKey(x + side[0], y - d, z + side[1]);
          final WorldChange c = changeTracker.getChange(below);
          if (c != null && c.kind == WorldChange.Kind.WOOD) {
            break;
          }
          bare.add(below);
        }
      }
    }
    return bare;
  }

  /** Decides how many of {@link #COVER_SIDES} to cover around a wood block. */
  private interface CoverSides {
    int count(int x, int y, int z, int level);
  }

  /**
   * After the leaves: a branch should have leaves atop it and at its ends.
   * <ol>
   * <li>Each branch end ({@link #markStemEnd}) with no leaves within {@link #TIP_REACH} gets a
   * leaf cluster.</li>
   * <li>Branch wood (not roots) within {@link #COVER_REACH_BRANCH} of leaves gets leaves in the
   * empty blocks above and beside it; trunk wood within {@link #COVER_REACH_TRUNK} only above it
   * (where it ends in the crown). Bare limbs well below the canopy stay bare.</li>
   * <li>Wood still showing amid leaves (two or more leaf faces) gets leaves above and beside
   * it.</li>
   * </ol>
   * Off for plain-leaved types (mushrooms, fungi), except that a mushroom's stem top gets a cap
   * block over it where it reaches the cap's top, so no stem shows through the cap.
   */
  public void coverBranches() {
    if (renderOrientation != RenderOrientation.NORMAL) {
      return;
    }
    if (!treeType.noisyLeaves) {
      if (treeType.capLevel != Integer.MAX_VALUE) {
        coverPass((x, y, z, level) -> level == 0 && leafWithin(x, y, z, COVER_REACH_TRUNK) ? 1 : 0);
      }
      return;
    }
    final double tipLength = leafLength * TIP_SCALE;
    final double tipWidth = leafWidth * TIP_SCALE;
    if (tipLength > 0) {
      for (final Vector end : stemEnds) {
        if (!leafWithin(end.getBlockX(), end.getBlockY(), end.getBlockZ(), TIP_REACH)) {
          drawLeafCluster(end, tipLength, tipWidth);
        }
      }
    }
    // near the canopy: the trunk only on top (where it ends in the crown), branches on top and sides
    coverPass((x, y, z, level) -> {
      if (level == 0) {
        return leafWithin(x, y, z, COVER_REACH_TRUNK) ? 1 : 0;
      }
      return leafWithin(x, y, z, COVER_REACH_BRANCH) ? COVER_SIDES.length : 0;
    });
    // wood the first pass left showing amid leaves (two or more leaf faces): top and sides
    coverPass((x, y, z, level) -> leafFaces(x, y, z) >= 2 ? COVER_SIDES.length : 0);
  }

  /** Leaves in the empty blocks of the first sides.count(..) of COVER_SIDES around each trunk and
   *  branch block, decided for all blocks first. */
  private void coverPass(final CoverSides sides) {
    final Set<WorldChangeKey> cover = new LinkedHashSet<>();
    for (final WorldChangeKey key : branchWood) {
      final WorldChange change = changeTracker.getChange(key);
      if (change.kind != WorldChange.Kind.WOOD) {
        continue;
      }
      final int n = sides.count(key.x(), key.y(), key.z(), change.level);
      for (int k = 0; k < n; k++) {
        final WorldChangeKey side = new WorldChangeKey(key.x() + COVER_SIDES[k][0],
                                                       key.y() + COVER_SIDES[k][1],
                                                       key.z() + COVER_SIDES[k][2]);
        if (changeTracker.getChange(side) == null && !bareBlocks().contains(side)) {
          cover.add(side);
        }
      }
    }
    for (final WorldChangeKey key : cover) {
      changeTracker.addChange(key.toVector(), treeType.leafMaterial, persist(),
                              WorldChange.Kind.LEAVES, -1, false);
    }
  }

  /** Leaf blocks among a block's six face neighbours. */
  private int leafFaces(final int x, final int y, final int z) {
    int n = 0;
    for (final int[] f : FACES) {
      if (isLeaf(x + f[0], y + f[1], z + f[2])) {
        n++;
      }
    }
    return n;
  }

  /** Whether a leaf block lies within reach (Chebyshev distance) of a block. */
  private boolean leafWithin(final int x, final int y, final int z, final int reach) {
    for (int dx = -reach; dx <= reach; dx++) {
      for (int dy = -reach; dy <= reach; dy++) {
        for (int dz = -reach; dz <= reach; dz++) {
          if (isLeaf(x + dx, y + dy, z + dz)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private boolean isLeaf(final int x, final int y, final int z) {
    final WorldChange c = changeTracker.getChange(new WorldChangeKey(x, y, z));
    return c != null && c.kind == WorldChange.Kind.LEAVES;
  }

  /**
   * leafDroop shear of a leaf cluster at pos: a block x, z off the cluster's centre is tested at
   * height y + drop[0] * x + drop[1] * z, so the cluster sinks {@link TreeType#leafDroop} blocks per
   * block away from the trunk (the y axis); drop[2] = blocks the y range grows by. All 0 without
   * droop.
   */
  private double[] droop(final Vector pos, final int halfSize) {
    final double len = Math.sqrt((pos.getX() * pos.getX()) + (pos.getZ() * pos.getZ()));
    if (treeType.leafDroop <= 0 || len == 0) {
      return new double[] {0, 0, 0};
    }
    return new double[] {(treeType.leafDroop * pos.getX()) / len,
                         (treeType.leafDroop * pos.getZ()) / len,
                         Math.ceil(treeType.leafDroop * halfSize)};
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
    final List<Point2D> points2d = new ArrayList<>();

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
    final List<Vector> points = new ArrayList<>();
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
                                     final double b, final double c) {
    final List<Vector> points = new ArrayList<>();

    final int halfSize = (int) Math.ceil(Math.max(Math.max(a, b), c)) + 2;
    final double[] drop = droop(pos, halfSize);
    final int ext = (int) drop[2];

    for (int x = -halfSize; x <= halfSize; x++) {
      for (int y = -halfSize - ext; y <= (halfSize + ext); y++) {
        for (int z = -halfSize; z <= halfSize; z++) {
          // the shape is tested at the sheared height yy (leafDroop), the noise at the block
          final double yy = y + (drop[0] * x) + (drop[1] * z);
          final double left = ((x * x) / (a * a)) + ((yy * yy) / (b * b))
                              + ((z * z) / (c * c));
          final double noiseOffset = calculateNoiseOffset((x + pos.getBlockX()),
                                                               (y + pos.getBlockY()),
                                                               (z + pos.getBlockZ()),
                                                               1, 0);
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
    final List<Vector> points = new ArrayList<>();
    final int halfSize = (int) Math.ceil(Math.max(Math.max(a, b), c)) + 3;
    final int px = pos.getBlockX();
    final int py = pos.getBlockY();
    final int pz = pos.getBlockZ();
    final int seed = refPoint.hashCode();
    // calculateNoiseOffset(.., 1, 0) <= 2 * Smooth (simplex noise stays within [-1, 1])
    final double tMax = 1 + (2.5 * noiseIntensity);
    final double clusterAmp = Math.min(1, Math.max(0, (a - LEAF_CLEAN_SIZE)
                                                      / (LEAF_FULL_SIZE - LEAF_CLEAN_SIZE)));
    final double[] drop = droop(pos, halfSize);
    final int ext = (int) drop[2];
    for (int x = -halfSize; x <= halfSize; x++) {
      for (int y = -halfSize - ext; y <= (halfSize + ext); y++) {
        for (int z = -halfSize; z <= halfSize; z++) {
          final int bx = x + px;
          final int by = y + py;
          final int bz = z + pz;
          // the shape is tested at the sheared height yy (leafDroop), the noise at the block
          final double yy = y + (drop[0] * x) + (drop[1] * z);
          final double left = ((x * x) / (a * a)) + ((yy * yy) / (b * b)) + ((z * z) / (c * c));
          final double r2 = (x * x) + (yy * yy) + (z * z);
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
    final List<Point2D> points2d = new ArrayList<>();
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
    final List<Vector> locations = new ArrayList<>();
    if (orientation == Orientation.xMajor) /* x dominant */
    {
      final List<Point2D> xy = plotLine2d(l1.getBlockX(), l1.getBlockY(),
                                               l2.getBlockX(), l2.getBlockY());
      final List<Point2D> xz = plotLine2d(l1.getBlockX(), l1.getBlockZ(),
                                               l2.getBlockX(), l2.getBlockZ());
      for (int i = 0; i < Math.min(xy.size(), xz.size()); i++) {
        locations.add(new Vector(xy.get(i).p, xy.get(i).q, xz.get(i).q));
      }
    } else if (orientation == Orientation.yMajor) /* y dominant */
    {
      final List<Point2D> yx = plotLine2d(l1.getBlockY(), l1.getBlockX(),
                                               l2.getBlockY(), l2.getBlockX());
      final List<Point2D> yz = plotLine2d(l1.getBlockY(), l1.getBlockZ(),
                                               l2.getBlockY(), l2.getBlockZ());
      for (int i = 0; i < Math.min(yx.size(), yz.size()); i++) {
        locations.add(new Vector(yx.get(i).q, yx.get(i).p, yz.get(i).q));
      }
    } else /* z dominant */
    {
      final List<Point2D> zx = plotLine2d(l1.getBlockZ(), l1.getBlockX(),
                                               l2.getBlockZ(), l2.getBlockX());
      final List<Point2D> zy = plotLine2d(l1.getBlockZ(), l1.getBlockY(),
                                               l2.getBlockZ(), l2.getBlockY());
      for (int i = 0; i < Math.min(zx.size(), zy.size()); i++) {
        locations.add(new Vector(zx.get(i).q, zy.get(i).q, zx.get(i).p));
      }
    }

    return locations;
  }

  private List<Vector> plotSphere(final Vector pos, final double r,
                                  final int level) {
    final List<Vector> points = new ArrayList<>();
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
