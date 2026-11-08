package com.ryanmichela.trees.rendering;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.io.BufferedOutputStream;
import java.io.FileOutputStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

import net.sourceforge.arbaro.params.AbstractParam;
import net.sourceforge.arbaro.tree.Segment;
import net.sourceforge.arbaro.tree.Stem;
import net.sourceforge.arbaro.tree.Tree;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.HangingMoss;
import org.bukkit.block.data.type.Leaves;
import org.bukkit.util.Vector;

/**
 * Equivalence harness for docs/viewer: runs the plugin's real tree generation code
 * (Arbaro + Draw3d + exporters + JungleVinePopulator + LeafDecorator + WoodStyler) without a
 * server and dumps
 * every WorldChange as JSON.
 *
 * It mirrors the orchestration in TreeRenderer.renderTree() (which itself is not callable
 * without a running plugin scheduler). Keep the two in sync: if TreeRenderer's orchestration
 * changes, update run() below and docs/viewer/src/render.js.
 *
 * BlockData mutators are applied to a recording java.lang.reflect.Proxy instead of real block
 * data, so the Axis/BlockFace the Java code picks is captured without a server. Every Draw3d
 * call (cone, sphere, leaf cluster, root junction) is folded into a digest of its exact double
 * arguments, which catches last-bit differences in the Arbaro port long before they move a block.
 *
 * Usage: GeometryHarness <jobs-file> <out-dir>
 *   jobs-file lines: id|treeFile|rootFile-or-dash|seed|refX|refY|refZ[|styles]
 *     styles: ';'-separated WoodStyle specs mode/hollowChance/wallThickness/leaves, where leaves
 *     is '-' or MATERIAL:weight+MATERIAL:weight (e.g. mixed_stripped/100/2/OAK_LEAVES:3+AZALEA_LEAVES:1)
 *   writes <out-dir>/<id>.json :
 *   {"id":..,"seed":..,"refHash":..,"scaleTree":..,"drawCalls":..,"drawDigest":..,
 *    "absentMaterials":[TreeType block names this API version lacks],
 *    "voxels":["x,y,z,KIND,level,MATERIAL,axis,face",...],  (face: TIP or - for HANGING)
 *    "matNames":[...],"styles":[{"spec":..,"mats":[index into matNames per voxel]}]}
 *   voxel order = tracker.getChanges() iteration order (the styled passes keep that order).
 */
public final class GeometryHarness {

  private GeometryHarness() {
  }

  /** Records what a BlockData mutator does. */
  static final class Recorder implements java.lang.reflect.InvocationHandler {
    String axis = "-";
    String face = "-";
    BlockData proxy;

    @Override
    public Object invoke(final Object p, final java.lang.reflect.Method m, final Object[] args) {
      switch (m.getName()) {
        case "setAxis":
          axis = String.valueOf(args[0]);
          return null;
        case "setFace":
          if (Boolean.TRUE.equals(args[1])) {
            face = String.valueOf(args[0]);
          }
          return null;
        case "setTip":
          face = Boolean.TRUE.equals(args[0]) ? "TIP" : "-";
          return null;
        case "hashCode":
          return System.identityHashCode(p);
        case "equals":
          return p == args[0];
        case "toString":
          return "Recorder";
        default:
          final Class<?> rt = m.getReturnType();
          if (rt == boolean.class) return false;
          if (rt == int.class) return 0;
          return null;
      }
    }
  }

  static Recorder record(final java.util.function.UnaryOperator<BlockData> mutator) {
    final Recorder r = new Recorder();
    r.proxy = (BlockData) Proxy.newProxyInstance(GeometryHarness.class.getClassLoader(),
        new Class<?>[] {Orientable.class, MultipleFacing.class, Leaves.class, HangingMoss.class}, r);
    mutator.apply(r.proxy);
    return r;
  }

  private static Tree loadTree(final File treeFile, final int seed) throws Exception {
    final Tree tree = new Tree();
    tree.setOutputType(Tree.CONES);
    try (FileInputStream in = new FileInputStream(treeFile)) {
      tree.readFromXML(in);
    }
    tree.params.Seed = seed;
    tree.params.stopLevel = -1;
    tree.params.verbose = false;
    return tree;
  }

  /** Order-sensitive digest of Draw3d call arguments (bit patterns), shared with equivalence.mjs. */
  static final class Digest {
    int h = 17;
    int calls;

    void mix(final int v) {
      h = (h * 1000003) ^ v;
    }

    void mix(final double d) {
      final long b = Double.doubleToRawLongBits(d);
      mix((int) b);
      mix((int) (b >>> 32));
    }

    void mix(final Vector v) {
      mix(v.getX());
      mix(v.getY());
      mix(v.getZ());
    }
  }

  /** Draw3d that records its calls into a Digest before drawing. */
  static Draw3d recordingDraw3d(final Location refPoint, final double smooth, final TreeType type,
                                final WorldChangeTracker tracker,
                                final Draw3d.RenderOrientation orientation, final Digest dg) {
    return new Draw3d(refPoint, smooth, type, tracker, orientation) {
      @Override
      public void drawCone(final Vector l1, final double rad1, final Vector l2, final double rad2,
                           final int level) {
        dg.calls++;
        dg.mix(1);
        dg.mix(l1);
        dg.mix(rad1);
        dg.mix(l2);
        dg.mix(rad2);
        dg.mix(level);
        super.drawCone(l1, rad1, l2, rad2, level);
      }

      @Override
      public void drawWoodSphere(final Vector pos, final double r, final Orientation o,
                                 final int level) {
        dg.calls++;
        dg.mix(2);
        dg.mix(pos);
        dg.mix(r);
        dg.mix(o.ordinal());
        dg.mix(level);
        super.drawWoodSphere(pos, r, o, level);
      }

      @Override
      public void drawLeafCluster(final Vector pos, final double length, final double width) {
        dg.calls++;
        dg.mix(3);
        dg.mix(pos);
        dg.mix(length);
        dg.mix(width);
        super.drawLeafCluster(pos, length, width);
      }

      @Override
      public void drawRootJunction(final Vector pos, final double r) {
        dg.calls++;
        dg.mix(4);
        dg.mix(pos);
        dg.mix(r);
        super.drawRootJunction(pos, r);
      }
    };
  }

  /**
   * Parses mode/hollowChance/wallThickness/leaves (see class comment). '-' leaves means the wood
   * type's own leaves, as WoodStyle.fromConfig resolves them (its default mix, if any).
   */
  static WoodStyle parseStyle(final String spec, final String woodType) {
    final String[] p = spec.split("/");
    final Map<Material, Integer> leaves = new LinkedHashMap<>();
    if (!"-".equals(p[3])) {
      for (final String kv : p[3].split("\\+")) {
        final String[] e = kv.split(":");
        leaves.put(Material.valueOf(e[0]), Integer.parseInt(e[1]));
      }
    } else {
      leaves.putAll(new TreeType(woodType).leafMix);
    }
    return new WoodStyle(WoodStyle.Mode.valueOf(p[0].toUpperCase(Locale.ROOT)),
        Double.parseDouble(p[1]), Integer.parseInt(p[2]), leaves);
  }

  /** Mirrors TreeRenderer.renderTree() up to (not including) WoodStyler / applyChanges. */
  static WorldChangeTracker run(final File treeFile, final File rootFile, final int seed,
                                final Location refPoint, final double[] scaleOut,
                                final String[] woodTypeOut, final Digest dg) throws Exception {
    AbstractParam.loading = true;
    final WorldChangeTracker changeTracker = new WorldChangeTracker();
    final Tree tree = loadTree(treeFile, seed);
    refPoint.add(0, TreeRenderer.mangroveRaise(treeFile.getName()), 0);
    tree.make();
    final TreeType treeType = new TreeType(tree.params.WoodType);
    final Draw3d d3d = recordingDraw3d(refPoint, tree.params.Smooth, treeType, changeTracker,
        Draw3d.RenderOrientation.NORMAL, dg);
    new MinecraftExporter(tree, d3d).write();
    if (treeType.decoration == TreeType.Decoration.TRUNK_VINES) {
      JungleVinePopulator.populate(changeTracker, new Random(seed));
    }
    d3d.drawRootJunction(d3d.toMcVector(((Segment) ((Stem) tree.trunks.get(0)).stemSegments()
        .nextElement()).posFrom()), ((Stem) tree.trunks.get(0)).baseRadius);
    if (rootFile != null && rootFile.exists()) {
      final Tree root = loadTree(rootFile, seed);
      root.params.Leaves = -1;
      root.params.scale_tree = tree.params.scale_tree;
      root.make();
      final TreeType rootType = new TreeType(root.params.WoodType);
      final Draw3d d3dInverted = recordingDraw3d(refPoint, root.params.Smooth, rootType,
          changeTracker, Draw3d.RenderOrientation.INVERTED, dg);
      new MinecraftExporter(root, d3dInverted).write();
    }
    AbstractParam.loading = false;
    LeafDecorator.populate(changeTracker, treeType, seed);
    scaleOut[0] = tree.params.scale_tree;
    woodTypeOut[0] = tree.params.WoodType;
    return changeTracker;
  }

  private static String jsonStr(final String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  public static void main(final String[] args) throws Exception {
    if (args.length != 2) {
      System.err.println("usage: GeometryHarness <jobs-file> <out-dir>");
      System.exit(2);
    }
    final File outDir = new File(args[1]);
    outDir.mkdirs();
    try (BufferedReader br = new BufferedReader(new InputStreamReader(
        new FileInputStream(args[0]), StandardCharsets.UTF_8))) {
      String line;
      while ((line = br.readLine()) != null) {
        line = line.trim();
        if (line.isEmpty() || line.startsWith("#")) continue;
        final String[] f = line.split("\\|");
        final String id = f[0];
        final File treeFile = new File(f[1]);
        final File rootFile = "-".equals(f[2]) ? null : new File(f[2]);
        final int seed = Integer.parseInt(f[3]);
        final Location ref = new Location(null, Double.parseDouble(f[4]),
            Double.parseDouble(f[5]), Double.parseDouble(f[6]));
        final String[] styleSpecs = f.length > 7 && !"-".equals(f[7]) ? f[7].split(";") : new String[0];
        final long t0 = System.nanoTime();
        final double[] scale = new double[1];
        final Digest dg = new Digest();
        String error = null;
        WorldChangeTracker tracker = null;
        final List<WorldChange> order = new ArrayList<>();
        final List<String> matNames = new ArrayList<>();
        final List<int[]> styled = new ArrayList<>();
        try {
          final String[] woodType = new String[1];
          tracker = run(treeFile, rootFile, seed, ref, scale, woodType, dg);
          order.addAll(tracker.getChanges());
          // WoodStyler mutates WorldChange.material in place: snapshot and restore per style
          final Map<WorldChange, Material> original = new IdentityHashMap<>();
          for (final WorldChange c : order) {
            original.put(c, c.material);
          }
          for (final String spec : styleSpecs) {
            WoodStyler.apply(tracker, parseStyle(spec, woodType[0]), seed);
            final int[] mats = new int[order.size()];
            for (int i = 0; i < mats.length; i++) {
              final String name = order.get(i).material.name();
              int idx = matNames.indexOf(name);
              if (idx < 0) {
                matNames.add(name);
                idx = matNames.size() - 1;
              }
              mats[i] = idx;
            }
            styled.add(mats);
            for (final WorldChange c : order) {
              c.material = original.get(c);
            }
          }
        } catch (final Throwable t) {
          error = t.toString();
        }
        final long ms = (System.nanoTime() - t0) / 1_000_000;
        try (PrintStream out = new PrintStream(new BufferedOutputStream(
            new FileOutputStream(new File(outDir, id + ".json"))), false, StandardCharsets.UTF_8)) {
          out.print("{\"id\":" + jsonStr(id) + ",\"seed\":" + seed + ",\"refHash\":" + ref.hashCode()
              + ",\"scaleTree\":" + scale[0] + ",\"ms\":" + ms
              + ",\"drawCalls\":" + dg.calls + ",\"drawDigest\":" + dg.h);
          // TreeType blocks this API version lacks (the JS port needs them to pick the same fallbacks)
          out.print(",\"absentMaterials\":[");
          boolean firstAbsent = true;
          for (final String name : TreeType.candidateMaterialNames()) {
            if (Material.getMaterial(name) == null) {
              out.print((firstAbsent ? "" : ",") + jsonStr(name));
              firstAbsent = false;
            }
          }
          out.print("]");
          if (error != null) {
            out.print(",\"error\":" + jsonStr(error));
          }
          out.print(",\"voxels\":[");
          if (tracker != null) {
            boolean first = true;
            for (final WorldChange c : order) {
              final Recorder r = record(c.blockDataMutator);
              if (!first) out.print(',');
              first = false;
              out.print('"');
              out.print(c.location.getBlockX());
              out.print(',');
              out.print(c.location.getBlockY());
              out.print(',');
              out.print(c.location.getBlockZ());
              out.print(',');
              out.print(c.kind.name());
              out.print(',');
              out.print(c.level);
              out.print(',');
              out.print(c.material.name());
              out.print(',');
              out.print(r.axis);
              out.print(',');
              out.print(r.face);
              out.print('"');
            }
          }
          out.print("],\"matNames\":[");
          for (int i = 0; i < matNames.size(); i++) {
            out.print((i > 0 ? "," : "") + jsonStr(matNames.get(i)));
          }
          out.print("],\"styles\":[");
          for (int s = 0; s < styled.size(); s++) {
            out.print((s > 0 ? "," : "") + "{\"spec\":" + jsonStr(styleSpecs[s]) + ",\"mats\":[");
            final int[] mats = styled.get(s);
            for (int i = 0; i < mats.length; i++) {
              if (i > 0) out.print(',');
              out.print(mats[i]);
            }
            out.print("]}");
          }
          out.print("]}");
        }
        System.err.println(id + ": " + (error != null ? "ERROR " + error
            : order.size() + " blocks, " + styled.size() + " styles") + " in " + ms + " ms");
      }
    }
  }
}
