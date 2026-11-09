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

import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Random;
import java.util.function.UnaryOperator;
import java.util.logging.Level;
import java.util.logging.Logger;

import io.github.def9a2a4.gianttreesx.AzaleaRoots;

import net.sourceforge.arbaro.params.AbstractParam;
import net.sourceforge.arbaro.tree.DefaultStemTraversal;
import net.sourceforge.arbaro.tree.DefaultTreeTraversal;
import net.sourceforge.arbaro.tree.Leaf;
import net.sourceforge.arbaro.tree.Segment;
import net.sourceforge.arbaro.tree.Stem;
import net.sourceforge.arbaro.tree.Subsegment;
import net.sourceforge.arbaro.tree.TraversalException;
import net.sourceforge.arbaro.tree.Tree;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Waterlogged;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;

public class TreeRenderer {

  /** Builds the Draw3d for a tree or its root system (the viewer harness records its calls). */
  interface Draw3dFactory {
    Draw3d create(double smooth, TreeType type, Draw3d.RenderOrientation orientation);
  }

  /** What {@link #generate} drew: the tree, its type, and its root system's type (null for none). */
  record Generated(Tree tree, TreeType treeType, TreeType rootType) {}

  private final Plugin plugin;

  public TreeRenderer(final Plugin plugin) {
    this.plugin = plugin;
  }

  /**
   * A seed for a tree grown at {@code location}: the world seed mixed with the position, so trees
   * grown in one world don't all share one shape.
   */
  public static int positionSeed(final Location location) {
    return new Random(location.getWorld().getSeed()
                      ^ ((long) location.getBlockX() * 341873128712L)
                      ^ ((long) location.getBlockZ() * 132897987541L)).nextInt();
  }

  /** Grows tree file X.xml at the point, with its root system X.root.xml if there is one. */
  public void renderTree(final Location requestedRefPoint, final File treeFile, final int seed,
                         final boolean withDelay) {
    final String name = treeFile.getName();
    final File rootFile = new File(treeFile.getParentFile(),
                                   name.substring(0, name.length() - ".xml".length()) + ".root.xml");
    if (!plugin.isEnabled()) {
      return;
    }
    // our own copy: the async task must not read a Location the caller may still change, nor
    // change the caller's (the mangrove offset below used to move it)
    final Location refPoint = requestedRefPoint.clone();
    // mangrove trees stand on exposed stilt roots: raise the refpoint by the tier's root height
    refPoint.add(0, mangroveRaise(treeFile.getName()), 0);
    final Logger logger = plugin.getLogger();

    plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
      try {
        if (plugin.getConfig().getBoolean("verbose-logging", false)) {
          logger.info("Rendering tree " + treeFile.getName()
                      + (rootFile.exists() ? " (root " + rootFile.getName() + ")" : ""));
        }
        final WorldChangeTracker tracker = new WorldChangeTracker();
        final Generated generated = generate(treeFile, rootFile, seed, tracker, logger,
            (smooth, type, orientation) -> new Draw3d(refPoint, smooth, type, tracker, orientation));
        final String woodType = generated.tree().params.WoodType;
        WoodStyler.apply(tracker, WoodStyle.fromConfig(plugin.getConfig(), woodType,
                                                       generated.treeType().leafMix,
                                                       generated.treeType().patchLeaves, logger), seed);
        LeafDecay.apply(tracker);
        if (!plugin.isEnabled()) {
          return;
        }
        final long generationDelay = withDelay ? plugin.getConfig().getInt("generation-delay", 0) * 20 : 0;
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
          try {
            settleRoots(tracker, refPoint, generated.rootType());
            tracker.applyChanges(refPoint, plugin);
            // azalea root system; the batched placement above starts next tick and its blocks win
            if (AzaleaRoots.appliesTo(woodType)) {
              AzaleaRoots.place(plugin, refPoint);
            }
          } catch (final Exception e) {
            logger.log(Level.SEVERE, "Error rendering tree " + treeFile.getName(), e);
          }
        }, generationDelay);
      } catch (final Exception e) {
        logger.log(Level.SEVERE, "Error rendering tree " + treeFile.getName(), e);
      }
    });
  }

  /**
   * Draws a tree file, and its root system when rootFile exists, into tracker: wood, leaves and
   * decorations, not yet styled ({@link WoodStyler}). The viewer's GeometryHarness runs this too.
   */
  static Generated generate(final File treeFile, final File rootFile, final int seed,
                            final WorldChangeTracker tracker, final Logger logger,
                            final Draw3dFactory draw3d) throws Exception {
    AbstractParam.loading = true; // silences Arbaro's parameter warnings
    try {
      final Tree tree = loadTree(treeFile, seed);
      tree.make();
      final TreeType treeType = new TreeType(tree.params.WoodType, logger);
      final Draw3d d3d = draw3d.create(tree.params.Smooth, treeType, Draw3d.RenderOrientation.NORMAL);
      export(tree, d3d);
      if (treeType.decoration == TreeType.Decoration.TRUNK_VINES) {
        JungleVinePopulator.populate(tracker, new Random(seed));
      }
      final Stem trunk = (Stem) tree.trunks.get(0);
      d3d.drawRootJunction(d3d.toMcVector(((Segment) trunk.stemSegments().nextElement()).posFrom()),
                           trunk.baseRadius);
      TreeType rootType = null;
      if (rootFile != null && rootFile.exists()) {
        final Tree root = loadTree(rootFile, seed);
        // no leaves on roots, and the same scale as the tree
        root.params.Leaves = -1;
        root.params.scale_tree = tree.params.scale_tree;
        root.make();
        rootType = new TreeType(root.params.WoodType, logger);
        export(root, draw3d.create(root.params.Smooth, rootType, Draw3d.RenderOrientation.INVERTED));
      }
      LeafDecorator.populate(tracker, treeType, seed);
      return new Generated(tree, treeType, rootType);
    } finally {
      AbstractParam.loading = false;
    }
  }

  /**
   * Draws an Arbaro tree: each stem as cones between its subsegments (with a sphere where two are
   * more than a block apart), then the leaves. Kept in sync with exportTree in
   * docs/viewer/src/render.js.
   */
  private static void export(final Tree tree, final Draw3d d3d) throws TraversalException {
    tree.traverseTree(new DefaultTreeTraversal() {
      @Override
      public boolean enterStem(final Stem stem) throws TraversalException {
        stem.traverseStem(new DefaultStemTraversal() {
          @Override
          public boolean enterSegment(final Segment s) {
            for (int i = 0; i < s.subsegments.size() - 1; i++) {
              final Subsegment ss1 = (Subsegment) s.subsegments.elementAt(i);
              final Subsegment ss2 = (Subsegment) s.subsegments.elementAt(i + 1);
              final Vector l1 = d3d.toMcVector(ss1.pos);
              final Vector l2 = d3d.toMcVector(ss2.pos);
              d3d.drawCone(l1, ss1.rad, l2, ss2.rad, s.lpar.level);
              if (l1.distance(l2) > 1) {
                d3d.drawWoodSphere(l2, ss2.rad, Orientation.orient(l1, l2), s.lpar.level);
              }
            }
            return true;
          }
        });
        // the stem's end, for Draw3d.coverBranches
        Segment last = null;
        for (final Enumeration<?> e = stem.stemSegments(); e.hasMoreElements();) {
          last = (Segment) e.nextElement();
        }
        if (last != null) {
          final Subsegment end = (Subsegment) last.subsegments.lastElement();
          d3d.markStemEnd(d3d.toMcVector(end.pos), last.lpar.level);
        }
        return true;
      }
    });
    if (tree.params.Leaves > 0) {
      tree.traverseTree(new DefaultTreeTraversal() {
        @Override
        public boolean visitLeaf(final Leaf leaf) {
          d3d.drawLeafCluster(d3d.toMcVector(leaf.transf.vector()), leaf.par.LeafScale / 2,
                              (leaf.par.LeafScaleX * leaf.par.LeafScale) / 2);
          return true;
        }
      });
      // leaves atop and at the ends of the branches
      d3d.coverBranches();
    }
  }

  /**
   * Blocks a tree file is raised above the ground so its stilt roots show: files whose name
   * contains MANGROVE, by tier (18 for the giant, 10 for {@code _HUGE}, 7 for {@code _BIG});
   * 0 for every other file. Kept in sync with mangroveRaise in docs/viewer/src/render.js.
   */
  static int mangroveRaise(final String fileName) {
    if (!fileName.contains("MANGROVE")) {
      return 0;
    }
    final String name = fileName.endsWith(".xml")
        ? fileName.substring(0, fileName.length() - 4) : fileName;
    if (name.endsWith("_BIG")) {
      return 7;
    }
    if (name.endsWith("_HUGE")) {
      return 10;
    }
    return 18;
  }

  /**
   * Fits a root system to the ground it is placed on (main thread, just before placing): root
   * blocks that go into solid ground become the root type's {@link TreeType#groundWoodMaterial}
   * (mangrove roots in mud become muddy mangrove roots) and root blocks placed in water are
   * waterlogged. Done here rather than when drawing because only the world knows where the
   * ground is: the viewer approximates it with flat ground at the planting height.
   */
  static void settleRoots(final WorldChangeTracker tracker, final Location refPoint,
                          final TreeType rootType) {
    final World world = refPoint.getWorld();
    if (rootType == null || world == null) {
      return;
    }
    final Material roots = rootType.woodMaterial;
    final Material ground = rootType.groundWoodMaterial;
    final List<WorldChange> waterlogged = new ArrayList<>();
    for (final WorldChange change : tracker.getChanges()) {
      if (change.kind != WorldChange.Kind.WOOD || change.material != roots) {
        continue;
      }
      final Location loc = refPoint.clone().add(change.location);
      if (loc.getBlockY() < world.getMinHeight() || loc.getBlockY() >= world.getMaxHeight()) {
        continue;
      }
      final Block block = loc.getBlock();
      final Material there = block.getType();
      if (ground != null && isGround(there, roots)) {
        change.material = ground;
      } else if (there == Material.WATER) {
        final UnaryOperator<BlockData> mutator = change.blockDataMutator;
        waterlogged.add(new WorldChange(change.location, change.material, data -> {
          final BlockData d = mutator.apply(data);
          if (d instanceof Waterlogged) {
            ((Waterlogged) d).setWaterlogged(true);
          }
          return d;
        }, change.kind, change.level));
      }
    }
    for (final WorldChange change : waterlogged) {
      tracker.addChange(change, true);
    }
  }

  /** Solid ground a root grows into: not air, fluids, plants, leaves, logs or other roots. */
  private static boolean isGround(final Material type, final Material roots) {
    return type.isSolid() && type != roots && !Tag.LEAVES.isTagged(type)
           && !Tag.LOGS.isTagged(type);
  }

  private static Tree loadTree(final File file, final int seed) throws Exception {
    final Tree tree = new Tree();
    tree.setOutputType(Tree.CONES);
    try (FileInputStream in = new FileInputStream(file)) {
      tree.readFromXML(in);
    }
    tree.params.Seed = seed;
    tree.params.verbose = false;
    return tree;
  }
}
