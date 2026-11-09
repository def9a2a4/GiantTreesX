# Tree preview equivalence harness

The browser preview (`docs/viewer/src/`) is a JavaScript port of the plugin's tree
generator: Arbaro (`src/arbaro/java`), `TreeRenderer.generate`, `Draw3d`, `WorldChangeTracker`,
`JungleVinePopulator`, `LeafDecorator` and `WoodStyler` (`src/main/java/.../rendering`). The port has to match the
plugin block for block, up to a tiny floating-point tolerance (see "Java math"). This directory
holds the Java side of the check.

## What is compared

`GeometryHarness.java` runs the plugin's real classes without a server, through the same
`TreeRenderer.generate()` that `TreeRenderer.renderTree()` uses. `scripts/equivalence.mjs` runs the JS port on the
same jobs and compares them. A job is a bundled tree file plus root file, a seed and a reference
point. For each job it checks:

- **Geometry**: every `WorldChange` (position, kind WOOD/LEAVES/VINE, stem level, material, log
  axis, vine face). `BlockData` mutators are applied to a recording proxy, so the axis and face
  the Java code picks are captured without a server.
- **Draw digest** (information only): a hash of every `Draw3d` call (cone, sphere, leaf cluster,
  root junction) and its double arguments. It usually differs because of the math differences
  described below, so it never fails the check.
- **Wood styles**: the real `WoodStyler.apply` run with several hand-built `WoodStyle`s (all
  three modes, hollow 0 / 37.5 / 100, wall thickness 1 to 3, leaf mixes), against
  `woodStyleAssign()` in `src/materials.js`.

## Running it

From the repo root:

```sh
docs/viewer/scripts/check.sh          # quick: every bundled tree, 2 seeds, 7 styles (~30 s)
docs/viewer/scripts/check.sh --full   # every bundled tree, 3 seeds x 2 refs, 7 styles
docs/viewer/scripts/check.sh --trees OAK,JUNGLE --seeds 1,2,3 --no-styles   # passed to equivalence.mjs
```

`check.sh` compiles the plugin if `target/classes` is missing or stale (`mvn -B -q compile`),
builds the harness if needed (`harness/build.sh`), runs `equivalence.mjs`, and exits non-zero
when any job is over the tolerance. It needs node 18+, a JDK 21+ (`JAVA_HOME` or on `PATH`) and
maven.

To run the parts by hand:

```sh
mvn -B -q package                              # repo root
docs/viewer/harness/build.sh
cd docs/viewer
node scripts/equivalence.mjs                   # 3 seeds x 2 refs, all distinct trees, 7 styles
node scripts/equivalence.mjs --seeds 5,6 --ref '0,64,0' --trees MANGROVE --keep   # keeps the Java JSON
```

`build/` is generated and ignored by git.

## Java math (why there is a tolerance)

On x86_64, HotSpot computes `Math.sin`, `cos` and `pow` with Intel LIBM intrinsics rather than
fdlibm, which JS engines and `StrictMath` use. The results differ in the last bit for a few
percent of inputs; aarch64 and AMD CPUs differ again. Very occasionally that rounds a voxel the
other way, typically a handful of blocks in one tree out of dozens of jobs.

The port deliberately uses the JS engine's `Math` functions. Emulating the HotSpot intrinsics
exactly would mean shipping OpenJDK code that is GPLv2-only, and this plugin is GPLv3. So each job
passes when its mismatched blocks (geometry, and each wood style) stay within `--tolerance`, a
fraction of the tree's blocks (default 0.001, i.e. 0.1%). A real porting bug shows up far above
that.

## When Java rendering changes

Keep the Java code and the JS port in step.

| Java change | Update |
|---|---|
| `TreeRenderer.generate` orchestration (order of export, vines, root junction, roots) or the refPoint rules in `renderTree` | `src/render.js` `renderTree()` (and `GeometryHarness.run()` for refPoint rules) |
| `Draw3d` (plotting, noise, orientation), `Orientation` | `src/draw3d.js` |
| `TreeRenderer.export` | `exportTree()` in `src/render.js` |
| `WorldChangeTracker.addChange` overwrite rules, `WorldChange` fields | `VoxelStore.add()` in `src/voxels.js` (and the voxel line format in both harness files if new fields matter) |
| `JungleVinePopulator` | `populateVines()` in `src/render.js`; HashMap iteration order lives in `src/javamap.js` |
| `WoodStyler` / `WoodStyle` | `woodStyleAssign()` and helpers in `src/materials.js`; add a style spec to `DEFAULT_STYLES` in `equivalence.mjs` if there is a new knob (and teach `GeometryHarness.parseStyle` about it) |
| `LeafDecorator` | `decorateLeaves()` in `src/render.js` |
| `TreeType` (new wood types, fallbacks, leaf mixes, decorations, `capLevel`) | `TREE_TYPES` / `treeTypeMaterials()` in `src/materials.js`, plus `BLOCK_COLORS` (and a tile in `ui/textures.js` for new kinds of block). The harness runs against the paper-api the plugin compiles with and reports which `TreeType` blocks it lacks (`absentMaterials`), so wood types newer than that API are checked in their fallback form |
| Arbaro (`src/arbaro/java`) | `src/tree.js`, `src/params.js`, `src/transformation.js`; parameter definitions via `scripts/gen-param-defs.mjs` |
| New math functions in Arbaro | use the JS `Math` equivalent in the port; the tolerance covers last-bit differences |

Then run `scripts/check.sh --full`. If a draw digest differs while the blocks still match, the
port has drifted numerically. Use `--keep` and compare the first differing `Draw3d` call before it
turns into a block difference.

## Files

- `src/com/ryanmichela/trees/rendering/GeometryHarness.java`: the job runner. It sits in the
  plugin's package to reach package-private classes such as `WoodStyler`. Its class comment
  documents the jobs file and the JSON it writes.
- `build.sh`: compiles it against `target/classes` plus the `provided` classpath (paper-api).
