# GiantTrees

![Screenshot](doc/herotree.png)

_This plugin now only uses official Bukkit APIs, so it should be future proof. Recently tested with Spigot 1.15._

Giant Trees is a plugin for adding procedurally generated giant trees to your Spigot world. Giant trees are generated in 
three ways:

* Grow trees in creative/survival mode by planting saplings and fertilizing with bone meal
* Summon trees with a command
* Generate trees naturally when new forested biomes spawn

Giant Trees is based on the tree generation algorithm described in Creation and Rendering of Realistic Trees by 
Jason Weber and Joseph Penn as implemented by Wolfram Diestel in Arbaro.

* http://sourceforge.net/projects/arbaro/
* http://ftp.cs.duke.edu/courses/fall02/cps124/resources/p119-weber.pdf

**Tree gallery and viewer:** see every tree in 3D as blocks, cut into them and edit tree files
in your browser at https://def9a2a4.github.io/GiantTreesX/

## Version 4.0
Runs on Paper 1.21.x and 26.1 through 26.3 (one jar).

* **Wood styles.** The new `wood` config section picks how trunks and branches are built:
  `all_log` (the old look), `mixed` (wood blocks with bark on all sides outside, logs in the
  core; the default) or `mixed_stripped` (stripped logs in the core). `hollow_chance` gives some
  trunks a hollow interior. `wood_types` overrides any of this per wood type and can set a
  weighted mix of leaf blocks.
* **Less lag.** Trees are placed in batches of `BLOCKS_PER_TICK` every `TICK_DELAY` ticks, from
  the bottom up, instead of all at once.
* **Safer.** Trees no longer replace chests, spawners or other block entities, or the blocks in
  `protected_blocks`.
* **Growing** a tree only needs the configured `bone-meal-consumed` amount in your inventory,
  not exactly 64 in hand. Grown and `/gt` trees no longer all share one shape per world.
* `tree-create <species> <world> <x> <z>` works from the console.
* **Three tree sizes.** Tree types come as a giant, a huge and a big tree (jungle and spruce
  have no big tree: vanilla's 2x2 trees fill that size), all of which work with `tree-create`
  and spawn naturally:

  | Size  | Tree file              | Height      | Trunk radius | Sapling pattern                  | Bone meal                      |
  |-------|------------------------|-------------|--------------|----------------------------------|--------------------------------|
  | giant | `tree.<NAME>.xml`      | 40 to 60    | up to 6      | 5x5 ring                         | `bone-meal-consumed` (64)      |
  | huge  | `tree.<NAME>_HUGE.xml` | 25 to 40    | up to 4      | full 3x3 ring                    | `bone-meal-consumed-huge` (32) |
  | big   | `tree.<NAME>_BIG.xml`  | about 14-24 | 2 to 3       | 3x3 plus: saplings N, E, S and W | `bone-meal-consumed-big` (16)  |

  The plus shape's corners don't matter: a `-` in a pattern matches any block (and is left
  alone when the tree grows). The most specific pattern that fits wins: a 5x5 ring before the
  3x3 ring inside it, a full 3x3 ring before a plus. Mixed patterns (mesapuzzle, cottonwood,
  swamp oak, azalea) have mixed 3x3 rings and pluses too; see `config.yml`.
* **Natural trees are set in `config.yml`**, not by copies of tree files. `natural-trees` lists
  the trees of each biome (`FOREST: [OAK, COTTONWOOD]`); a name grows every size of that tree.
  `natural-tree-sizes` sets how often each size is picked (by default 4 big and 2 huge trees for
  every giant), and a biome can set its own chance, tree weights and sizes:
  ```yaml
  natural-trees:
    PLAINS:
      chance: 0.2                 # percent per chunk, instead of treeGrowthPercentChance
      trees: {OAK: 3, BIRCH: 1}   # 3 oaks for every birch
      sizes: {giant: 0}           # no giant trees here
  ```
  Biome variants share an entry unless they have their own (`FOREST` also covers
  `FLOWER_FOREST`; the list is in `config.yml`). To add a custom tree, put `tree.<NAME>.xml` (and
  `tree.<NAME>.root.xml`) in the plugin folder, name in capitals, and list `<NAME>` under a biome;
  it also works with `tree-create`. To tune a tree for one biome only, give it its own file
  (`tree.OAK_PLAINS.xml`) and list that. New tree files spawn without a restart; config changes
  need one. Unknown tree and biome names are logged at startup. Natural trees grow only on
  soil, never on or in another tree, and in water only in swamps.
* **Azalea trees grow above lush caves**, like vanilla: `LUSH_CAVES` trees spawn on
  soil in any biome, but only where there is a lush cave somewhere below. An azalea tree (natural,
  grown or `tree-create`) gets vanilla's root system: a column of rooted dirt under its trunk,
  down toward the cave (at most 20 blocks, through stone and soil only), with hanging roots where
  it comes out of the cave ceiling.
* **New trees.** Pale oak with hanging pale moss (pale garden), a weeping swamp oak hung with
  vines (swamp), red and brown giant mushrooms (mushroom fields), autumn-coloured poplars with
  a mix of yellow, orange and red leaves (dappled forest, Minecraft 26.3+), azalea (over lush
  caves), and huge crimson and warped fungi (planting and `tree-create` only). Each has a planting pattern;
  see `config.yml` for the sapling letters. On servers older than 26.3 poplar patterns are
  skipped and a poplar tree file grows as a birch.
* **Organic leaf clusters.** Leaf clusters have lumpy, uneven outsides with small gaps and
  protrusions instead of smooth spheres and discs (mushroom and fungus caps keep their smooth
  domes). Huge crimson fungi grow weeping vines hanging from under the cap.

Existing configs keep working: missing settings fall back to the defaults above (a config
without `natural-trees` grows the bundled trees). An older
`planting-patterns` section has neither the 3x3 patterns nor the new trees' patterns; copy them
from the bundled `config.yml` to grow those from saplings.

**Upgrading: `biome.*.xml` files are no longer read.** Natural trees come from `natural-trees`
in `config.yml` and the `tree.*.xml` files. The plugin never deletes files, and warns at
startup while `biome.*.xml` files are still in its folder: delete them. If you edited or added
one, rename it to `tree.<NAME>.xml` (and its `.root.xml`) and list `<NAME>` under its biome in
`natural-trees`. `natural-tree-weights` is gone too (`natural-tree-sizes` and per-biome
weights replace it); an old one is ignored with a warning.

Upgrading from an earlier 4.0 build with small trees: the `*_SMALL` trees are now `*_HUGE`, and the
`-2` variants (`ACACIA-2`, `BIRCH-2`, `DARK_OAK-2`) are gone. Remove the old `tree.*_SMALL*` and
`tree.*-2*` files from the plugin folder and rename `*_small` planting patterns to `*_huge`. An old
`bone-meal-consumed-small` still sets the huge cost.

### Development
`make server` builds the plugin and runs a local Paper test server in `test-server/` (gitignored;
`MINECRAFT_VERSION=1.21.11` for another version). `make server-test` runs the integration test
that CI runs on every push.

`make preview` serves the website in `docs/` (the gallery and the viewer, published by GitHub
Pages) and `make gallery` re-renders the gallery; see `docs/viewer/README.md`.

`scripts/` has command-line tools for tuning tree files: block counts and sizes over many seeds,
screenshots and contact sheets, and showing, diffing and editing params; see `scripts/README.md`.

## IMPORTANT NOTES for version 3.2
Version 3.2 added custom biome trees as `biome.<biome>-<name>.xml` files. Since 4.0 these files
are no longer read: list trees under their biome in `natural-trees` in `config.yml` instead (see
above).

Feel free to send in your trees for inclusion in the plugin!

## IMPORTANT NOTES for version 3.1
The 3.1 version uses a new configuration file format. You cannot use the old configuration file with this version.
If you do the plugin will detect an incorrect configuration and disable the tree generation. You must wipe out
the old GiantTrees folder in the plugins folder and let it create a new config and then you can put back any
settings you changed. The 3.1 version and the new config file format allows for custom trees beyond the standard
saplings and now gives you the option of changing patterns for the base tree set too. For example, the new mesapuzzle
tree has a pattern that is made from both Acacia and Oak saplings. Each tree in the game has it's own recipe now and
doesn't use the 'S' sapling generic pattern. Core block is indicated by an 'X'. Check the config file for details.

You now need to right click the core block and not the saplings in order to generate the tree.

The pattern matching routine has also been changed to be simpler and I think, more flexible for future updates.
It uses a series of 90 degree rotations of the recipes in an attempt to match a sapling pattern laid out in the 5x5
grid. This means you can put put a complex pattern but not have to worry about compass orientation. It currently
doesn't flip the pattern, but that might be something to add later.

Do not use the reload command on your server. Restart the server for changes to take effect.
If you encounter lag, try reducing the number of blocks updated per tick in the config. Dark Oak is really laggy!
Ensure you have at least 2GB of memory allocated to the server.

Report any issues on the github repository.

## Planting Giant Trees

To plant a giant tree in creative/survival mode, perform the following steps:

1. Flatten a 5x5 area of dirt or grass
1. Place the core block as defined in the config (default EMERALD_BLOCK) in the center
1. Surround the core block with two rings of saplings according to the pattern for the tree you want
   (one full ring for a huge tree, or just the four saplings north, east, south and west of it for a
   big one)
1. Right click the core block with bone meal (64 for a giant tree, 32 for a huge one, 16 for a big one)
1. Stand back (default of 3 seconds to get out of the way)


![Screenshot](doc/planting.png)

## Commands
To create a giant tree with a command, use the /tree-create or /gt command, followed by the name of the tree. Tree names 
are found in the plugin's data directory. For example, to summon a giant acacia tree, use the command

```
/gt tree.ACACIA
```

To edit the model for an existing tree, or create a new tree model, use the /tree-edit command. This command can only 
be used from the server console, and opens the editor as a desktop window, so the server needs a graphical display.
On a headless server, copy the plugin jar and the tree file to a desktop and run `java -jar GiantTrees-<version>.jar tree.ACACIA.xml`.

```
/tree-edit tree.ACACIA
```

## Naturally Growing Trees

By default, Giant Trees will grow naturally in newly generated chunks in the default overworld (the world called 
"world"). To add giant trees to more worlds, increase the frequency of tree growth, or disable natural tree growth
altogether, edit the plugin's config.yml.

## Making Your Own Giant Tree Species

You can make your own species of giant tree. Start by using the /tree-edit command from the server console, giving it
the name of the tree you want to edit or create. (For new trees, ignore the file not found error). As an alternative,
you can double-click the Giant Trees plugin .jar file to start the visual tree editor.

![Screenshot](doc/arbaro.png)

Design your tree using the visual tree editor. When you are done, click save and exit the visual editor. To add roots to
your tree, create another tree with the same name as your tree, with .root added to the end. For example, 
`/tree-edit tree.ACACIA.root`. Root trees are rendered upside down in the world and scaled to match their tree.

## Permissions

* `gianttrees.create` (default OP) - Allows the creation of a giant tree using the tree-create command.
* `gianttrees.grow` (default true) - Allows a player to grow a giant tree by fertilizing a grid of saplings.

## Installation

1. Make sure you have Apache Maven installed.
1. Clone this repo.
1. Run `mvn package` in the plugin directory.
1. Copy the Giant Trees jar file from the `target` directory to your server's `plugins` directory.
1. Restart your server.

or the simple way:

1. Download the jar file from the latest release in the github repository
1. Move the jar file to the plugins folder
1. Restart your server.
