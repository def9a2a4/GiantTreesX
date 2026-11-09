# Tree preview

A browser tool for previewing GiantTreesX's giant trees in 3D as Minecraft blocks, and for
editing their Arbaro tree configs with live regeneration.

It runs a JavaScript port of the plugin's generator (`src/`), so the blocks you see are the blocks
the plugin places for a given tree file and seed, up to a tiny floating-point tolerance (see
`harness/README.md`).

## Open it

Online: **https://def9a2a4.github.io/GiantTreesX/** is the gallery, and
**https://def9a2a4.github.io/GiantTreesX/viewer/** is the viewer. GitHub Pages serves the repo's
`docs/` folder as is (`docs/.nojekyll` turns off Jekyll):

- `docs/index.html`: the gallery page, built from `docs/gallery/gallery.json`.
- `docs/viewer/`: this tool.
- `docs/trees/`: copies of the plugin's tree files (`src/main/resources/tree.*.xml`),
  `index.json`, the list the viewer loads, and `natural-trees.json`, the biomes each tree spawns in
  (read from `natural.trees` in `src/main/resources/config.yml` by
  `scripts/natural-trees.mjs`). `make docs-trees` refreshes them; CI fails if they are out of date.
- `docs/gallery/`: the gallery's pictures, made by `make gallery`.

Locally, from the repo root:

```sh
make preview      # syncs docs/trees/, serves docs/: gallery at http://localhost:8000/, viewer at /viewer/
make gallery      # re-renders docs/gallery/ (installs Playwright into docs/viewer/node_modules once)
```

There is no build step. `index.html` loads `ui/app.js` as an ES module, the generator runs in a
module Web Worker (`ui/worker.js`), three.js r160 comes from `vendor/` through an import map, and
the tree files are fetched from `docs/trees/`. Any static server works.

## Gallery

`scripts/gallery.mjs` opens the viewer in headless Chromium (capture mode, `#...&capture=1`,
shows only the 3D view) and renders every tree file. The gallery page shows one card per tree
file, i.e. per type and size (`tree.OAK`, `tree.OAK_HUGE` and `tree.OAK_BIG` are three cards; see
`scripts/gallery-trees.mjs`), each with a hero shot (`hero.jpg`), a cut through the middle
(`cut.jpg`) and a view from above (`top.jpg`), and the biomes the tree spawns in (`spawnsIn`, from
`config.yml`'s `natural.trees`; "Planting only" when none). The page filters the cards by category
(trees, fungi) and size, and groups them by type or size. The angles live at the top of the
script. It drives the viewer through `window.__treePreview.shot()` (camera angle,
zoom, view cut, toggles) and waits on `isIdle()`. Every picture on the gallery page links to its
own tree and seed in the viewer. `--types OAK,BIRCH` renders just those types, `--trees` just
those files, and `--out <dir>` writes somewhere other than `docs/gallery/` for trying changes.

`make preview-check` (CI) runs `scripts/gallery-check.mjs`, which fails when a tree file has no
gallery entry, an entry is left over for a tree that is gone, an entry's `spawnsIn` no longer
matches `config.yml`, or an entry's content hash (each entry records a hash of its tree files) no
longer matches the tree files. Re-run `make gallery` after adding, removing or editing tree files
or changing `natural.trees`.

## What it does

- **Tree picker.** Lists every `tree.*.xml` in the plugin's `src/main/resources/`, fetched when
  the page loads, with the biomes it spawns in (`tree.OAK  (Forest)`). The header shows the
  resolved WoodType, the size and the block count.
- **Seed.** The int seed passed to `renderTree`. *Random* picks a new one. The tree and seed are
  kept in the URL hash, so a link reopens the same tree.
- **3D view.** Merged chunk meshes with hidden faces culled, placeholder block textures,
  Minecraft-style face shading and ambient occlusion. The textures are drawn procedurally in
  `ui/textures.js` (bark, log end rings, stripped grain, leaves, roots), nothing copied from
  Minecraft. Log end rings face the way the log runs. Vines are an X of two crossed cards (Minecraft's plant
  model) rather than the in-game panel on the block they hang on; close enough for a preview. Drag to orbit, right-drag to pan, scroll to zoom. The grid
  sits at y = 0, the block the plugin plants on (mangroves are raised 18 blocks, as in the
  plugin). You can toggle leaves, roots, vines and translucent leaves, and colour blocks by stem
  level or by tree/root/junction. Hover a block to see its coordinates, block type, stem level and
  part.
- **Cross-section.** A vertical cut along X or Z (slider sets the position, *Keep the other half*
  flips the side) and a horizontal max-Y cut. The mesh is rebuilt for each cut, so cut faces are
  solid and you can see inside trunks, including hollow ones. *View cut* hides every block
  between the camera and a vertical plane facing it, shown as a faint yellow sheet; the slider
  moves the plane nearer or farther, and it turns with the camera when you stop orbiting.
- **Wood style.** Style (`all_log` / `mixed` / `mixed_stripped`), hollow chance, *Force hollow*
  (a preview switch that is not written to the config), wall thickness and a weighted leaf mix.
  Changing these re-runs only the material pass, not the geometry. *Copy config snippet* gives the
  matching `config.yml` YAML. Settings that differ from the plugin defaults go under
  `wood_types.<WoodType>` (or under `wood:` if you choose *global*). The leaf mix always goes under
  the wood type, because that is the only place the plugin reads it.
- **Param editor.** Every Arbaro param, grouped as General, Trunk (level 0), Levels 1 to 3,
  Leaves, Pruning and Not used by the generator. Each numeric param has a slider and a number
  field, with ranges from Arbaro's `Params.java`, and enums use dropdowns. The tree file and the
  root file have separate tabs. Edited params are highlighted, and ↺ resets one param.
  Params for levels above `Levels` are dimmed, because Arbaro ignores them. Edits regenerate in
  a Web Worker after a short pause. If a newer edit arrives, the worker running the older job is
  stopped.
- **Import/export.** *Import XML*, or drop files on the page. A file named `*.root.xml` goes to
  the root tab. *Download XML* writes the same layout as the bundled files and keeps the license
  header comment. *Reset to bundled* restores the selected tree's file.
- **Stats.** Block counts per block type, wood/leaf/vine and tree/root totals, bounding box,
  height above ground, and timings for generation, the material pass and meshing.
- **Errors.** When Arbaro throws, for example with `Levels = 0`, the page shows the message and
  keeps showing the previous tree. Invalid values are rejected in the editor with Arbaro's own
  validation message.

## Files

- `index.html`, `ui/style.css`: the page.
- `ui/app.js`: UI, three.js scene, param editor, wood style panel.
- `ui/worker.js`: runs `renderTree` and the material pass off the main thread.
- `ui/mesher.js`: voxels to chunk meshes with hidden faces culled (no three.js dependency).
- `ui/trees.js`: finds and fetches the plugin's tree files.
- `ui/textures.js`: procedural placeholder textures (one atlas per tree).
- `scripts/gallery.mjs`: renders `docs/gallery/`; `scripts/gallery-check.mjs`: checks it is up to
  date; `scripts/gallery-trees.mjs`: the distinct trees both use; `scripts/sync-trees.mjs`:
  refreshes `docs/trees/`.
- `package.json`: Playwright, a dev dependency of the gallery script only.
- `src/`: the port of the plugin's generator; `harness/` and `scripts/`: the check that keeps it
  in step with the Java code (see `harness/README.md`).
- `vendor/`: three.js r160 (`three.module.min.js`, `OrbitControls.js`), MIT, see `vendor/README.md`.
