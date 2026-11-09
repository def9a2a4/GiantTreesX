# Tree tools

Command-line helpers for tuning the tree files in `src/main/resources/tree/`. They run from any
directory and need only Node (20+); `tree-shots.mjs` also needs Playwright, a dev dependency of the
viewer (`npm install --prefix docs/viewer && npx --prefix docs/viewer playwright install chromium`,
or let `make tree-shots` do it). Every script prints its full usage with `--help`.

All three take trees the same way. A name is looked up in `src/main/resources/tree/` (or `--dir`):
`OAK` means `tree.OAK.xml`, `OAK.root` a root file (only for `tree-params`), and `*` is a wildcard (`'tree.*_HUGE'`; quote it in the shell). A path to an
`.xml` file anywhere also works, with its `.root.xml` next to it if there is one. Lists may be
comma-separated. Seeds are numbers and ranges: `12345,7` or `1..10`.

Generation uses the viewer's JavaScript port of the plugin's generator (`docs/viewer/src/`), which
CI checks block for block against the Java code, so the numbers and images match what the plugin
places.

## tree-stats.mjs: block counts and sizes

Generates trees for a set of seeds (no server or browser) and prints, per seed and as
min/median/max: blocks placed, wood, leaf, vine and root blocks, height, crown width, root depth,
trunk radius at a few heights, and generation time.

```sh
node scripts/tree-stats.mjs OAK OAK_HUGE                      # seeds 12345,1..9
node scripts/tree-stats.mjs --seeds 1..20 --summary 'tree.*_HUGE'
node scripts/tree-stats.mjs -m --style mixed_stripped --hollow -s 12345 DARK_OAK   # material counts
node scripts/tree-stats.mjs --format csv -s 1..50 JUNGLE > jungle.csv              # or --format json
make tree-stats TREES=OAK,OAK_HUGE SEEDS=1..10
```

`--trunk-at 2,6,12` picks the heights of the trunk radius (above the tree's base).

## tree-shots.mjs: screenshots and contact sheets

Renders trees with the viewer in headless Chromium (like `make gallery`) and saves one image per
tree, seed, view and wood style to `.temp/shots/` (`--out`). Tree files are served straight from
`src/main/resources/tree/`, so there is no need to run `make docs-trees` first.

Views: `hero`, `side`, `low`, `top`, `cut` (cut through the trunk), `base` (trunk base and roots,
no leaves), `wood` (no leaves); `--view JSON` adds a custom one from the viewer's `shot()` options
(`azimuth`, `elevation`, `zoom`, `focus`, `focusY`, `viewCut`, `showLeaves`, `showRoots`, plus a
`name`). `--sheet FILE` combines all images into one captioned contact sheet, a row per tree.

```sh
node scripts/tree-shots.mjs OAK OAK_HUGE
node scripts/tree-shots.mjs --seeds 1..4 --views hero,cut --sheet .temp/oak.jpg OAK
node scripts/tree-shots.mjs --style all_log,mixed_stripped --hollow --views base,cut DARK_OAK
node scripts/tree-shots.mjs --sheet .temp/huge.jpg --thumb 200 'tree.*_HUGE'
node scripts/tree-shots.mjs --view '{"name":"close","elevation":20,"zoom":2.5,"focusY":25}' JUNGLE
node scripts/tree-shots.mjs --prefix new_ --sheet .temp/new.jpg path/to/draft/tree.ACACIA.xml
make tree-shots TREES=OAK SEEDS=1..4 VIEWS=hero,cut              # also writes .temp/shots/sheet.jpg
```

A path to a draft file whose name matches a bundled tree (as in the `--prefix` example) replaces that
tree for the run.

## tree-params.mjs: show, compare, edit and derive param files

Edits the XML in place, so comments, quoting and spacing stay as they are. New values are checked
against Arbaro's types and ranges.

```sh
node scripts/tree-params.mjs show OAK.root                 # every param; unset ones show (default)
node scripts/tree-params.mjs diff OAK OAK_HUGE            # only the params that differ
node scripts/tree-params.mjs diff -p Scale,Ratio,1Branches 'tree.*_HUGE'
node scripts/tree-params.mjs set OAK_HUGE Scale=28.0 1Branches=11
node scripts/tree-params.mjs set --add CHERRY_HUGE Levels=3 2Branches=6   # add params the file lacks
node scripts/tree-params.mjs set -n 'tree.*_HUGE' LeafScale=8.0    # dry run
node scripts/tree-params.mjs derive OAK OAK_TALL Scale=70.0 ScaleV=5.0
```

Root files are separate: edit `NAME.root` to change the roots. `derive` writes `tree.NEW.xml` and
`tree.NEW.root.xml` from an existing tree with some params changed. Which trees spawn naturally,
and in which biomes, is set in `natural.trees` in `src/main/resources/config.yml`, not by file
names: add `NEW` to a biome there to have it spawn.

After changing files in `src/main/resources/tree/`, run `make docs-trees` so the website's copies in
`docs/trees/` match (CI checks this), and `make gallery` to re-render the gallery.
