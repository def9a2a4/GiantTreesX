# GiantTreesX 4.0.0

The first release of GiantTreesX, a fork of [Capri205's GiantTrees](https://github.com/Capri205/GiantTrees) 3.2 (itself a fork of [Ryan Michela's GiantTrees](https://github.com/rmichela/GiantTrees)). Everything below is compared with GiantTrees 3.2. It runs on current Paper, adds new trees and three tree sizes, and reworks how trees look, spawn and get placed.

**Back up your world before updating.** Giant trees replace a lot of blocks, and there is no undo.

Browse every tree in 3D in the [gallery and viewer](https://def9a2a4.github.io/GiantTreesX/).

## Compatibility

- Paper 1.21.4 through 1.21.11, and 26.1 through 26.3, from one jar. CI tests 1.21.11 and 26.3 on a real server.
- Java 21 or newer. Minecraft 26.x servers need Java 25.
- Spigot and Folia are not supported.

## New trees

- New tree types:
  - pale oak, hung with pale moss
  - swamp oak, with vines
  - azalea, with rooted dirt and hanging roots under it
  - poplar, in autumn colours
  - red and brown mushrooms
  - crimson and warped fungi; crimson ones grow weeping vines
- 18 tree types in all.
- Crimson and warped fungi grow only from saplings and with `/gt grow`, not naturally.
- Poplar needs Minecraft 26.3. On older servers it grows as birch, and its sapling patterns are skipped.
- The existing trees were redone:
  - Acacia, mangrove, jungle, cherry and spruce were reshaped.
  - Mangroves stand on arching roots of mangrove-root blocks, which turn muddy where they go into the ground.
  - Spruce boughs droop.
  - Jungle trees have side branches.
  - Cherry trees show bare branches underneath their canopy.

## Three sizes

Every tree type comes in three sizes:

| Size  | Height             | Grown from                         | Bone meal |
| ----- | ------------------ | ---------------------------------- | --------- |
| giant | 40 to 60 blocks    | 5x5 sapling ring, emerald block    | 64        |
| huge  | 25 to 40 blocks    | 3x3 sapling ring, emerald block    | 32        |
| big   | about 14 to 24     | 3x3 sapling ring, bone block       | 16        |

- Jungle and spruce have no big size: vanilla's 2x2 trees already cover it.
- The old second variants (`ACACIA-2` and the like) are gone.

## How trees look

- **Leaves:**
  - Leaves cover the tops and ends of branches, so no bare wood sticks out of the canopy.
  - Leaf clusters are less blobby, and smaller trees have smoother clusters.
  - Poplars grow their leaf colours in patches instead of speckles.
- **Wood styles**, set by `wood.style`:
  - `mixed` (the default): bark-covered wood on the outside, stripped logs inside the trunk and stripped wood inside branches.
  - `mixed_log`: bark outside, plain logs inside.
  - `all_log`: logs only, the old look.
  - Logs inside the trunk always stand upright.
- **Hollow trunks:** 20% of trees have hollow trunks by default (`hollow_chance`).
- **Per wood type:** any wood type can get its own style and a weighted mix of leaf blocks (`wood_types`).
- **Bug fixes from the original code:**
  - every log stood upright; logs now follow the direction of their branch
  - floating wood blocks
  - mirrored branches
  - flat 5-block discs at the ends of some branches

## Leaves decay naturally

Leaves placed by the plugin now decay like vanilla leaves when the tree's wood is chopped. Before, every leaf was permanent and chopped trees left floating canopies.

Large leaf clusters get hidden wood inside them, so leaves far from the branches stay alive until the tree is cut down.

## Growing from saplings

- Big trees grow from a full 3x3 ring around a bone block, the same ring as a huge tree with a different middle block.
- Particles spread out to the width of the trunk while the tree is on its way.
- You no longer need exactly a full stack of 64 bone meal in your hand. Any bone meal in your hand starts it, the cost comes out of your whole inventory, and the plugin tells you if you don't have enough.
- A bone meal cost of 0 makes that size free.
- Patterns may use `-` for "any block".
- Patterns using a sapling the server doesn't have are skipped, with a note in the log.
- Two patterns that can't be told apart (for example big and huge rings with the same core block) are reported at startup.
- If a protection plugin blocks the click on the core block (a claim, a region), no tree grows. The tree itself isn't checked against claims, so it can reach into a neighbouring one.
- `planting.enabled: false` turns growing from saplings off.
- `planting.sizes` turns single sizes off. With `giant: false`, a 5x5 ring grows the huge tree of its inner 3x3 ring.
- `planting.core` sets the middle block for each size. `planting.particles: false` turns the particles off.

## Natural spawning

- Configured in one place, the `natural:` section of `config.yml`:
  - on or off (`enabled`), and in which worlds
  - which trees grow in which biome
  - how often
  - in what mix of sizes, by default 16 big and 4 huge for every giant
  - by default 4% of new chunks in a tree biome grow a tree, about 8 times as many natural trees as GiantTrees 3.2 (mostly big ones)
  - a biome can set its own chance, tree weights and sizes
- Any biome can get trees, including datapack biomes, by listing it; no code change needed.
- Biome copies of tree files (`biome.*.xml`) are no longer used.
- Azaleas spawn above lush caves, like vanilla.
- Natural trees grow only on soil, never on or in another tree, and in water only in swamps. This works on Minecraft 26.x, which changed which blocks count as dirt.

## Commands

- `/gianttrees`, or `/gt` for short, replaces `tree-create` and `tree-edit`:
  - `/gt help`
  - `/gt grow <type> <size> [x z [world]]`, also from the console; without a position the tree grows at your feet (in caves and the Nether too)
  - `/gt edit`, which now works on Linux and macOS too (`tree-edit` only worked on Windows), and explains when the server has no display
- Arguments tab-complete, and leaving one out shows clickable choices.
- Permissions are unchanged: `gianttrees.create` (default: op) and `gianttrees.grow` (default: everyone).

## Performance and safety

- Trees are placed from the bottom up in small batches, so they visibly grow. `BLOCKS_PER_TICK` and `TICK_DELAY` were in the config before but never read, and a whole tree landed in one tick; now they set the batches.
- Trees never replace chests, spawners or other block entities (`protect_block_entities`), or any block in `protected_blocks` (bedrock, barriers, portals and so on by default).
- The jar no longer bundles a copy of the server's own classes.
- No more "Initializing Legacy Material Support" warning the first time someone grows a tree.
- A tree biome without tree files no longer logs a SEVERE error for every new chunk.
- Trees grown from saplings vary with their position. Before, every tree of one type grown in a world had the same shape.

## Custom trees

- Bundled trees load straight from the jar, so plugin updates bring their latest versions.
- Your own trees, and replacements for bundled ones, go in `plugins/GiantTrees/tree/`.
- `/gt edit` on a bundled tree first copies it into `plugins/GiantTrees/tree/`, and that copy replaces the bundled tree from then on.
- The [web viewer](https://def9a2a4.github.io/GiantTreesX/viewer/) lets you start from any bundled tree, change its parameters, see it as Minecraft blocks, and download the file.

## Other

- For plugin developers: the code moved from `com.ryanmichela.trees` to `io.github.def9a2a4.gianttreesx`.
- Anonymous usage statistics through [bStats](https://bstats.org/plugin/bukkit/GiantTreesX/35220). Turn them off for all plugins in `plugins/bStats/config.yml`.

## Upgrading from GiantTrees

- **New config layout.** Natural spawning settings moved to `natural:` and planting settings to `planting:`.
  - The old settings are no longer read: `naturallyGrowTrees`, `worlds`, `treeGrowthPercentChance`, `planting-patterns`, `core`, `bone-meal-consumed` and the rest. `SIMPLE_LIGHTING` is gone; it did nothing.
  - The plugin warns at startup while they are still in your `config.yml`, and uses the defaults until you move them.
  - The easiest way: delete `config.yml`, restart to get the new one, and copy your changes back in.
  - **If you had natural trees turned off** (`naturallyGrowTrees: false`), set `natural.enabled: false` before starting 4.0.0. Otherwise natural trees start spawning in `world`, at the new 4% default.
- **Old tree files.** `tree.*.xml` and `biome.*.xml` files in the plugin folder are no longer read.
  - The plugin warns at startup. Most of them are just outdated copies of the bundled trees, which have changed; it names the ones that aren't bundled trees at all, which are probably your own.
  - Move only trees you edited or added yourself into `plugins/GiantTrees/tree/`; a file there replaces the bundled tree of the same name. Rename `biome.BIOME-NAME.xml` to `tree.NAME.xml` and list `NAME` under its biome in `natural.trees`.
  - Delete the rest.
- **Commands.** Replace `tree-create` and `tree-edit` with `/gt grow` and `/gt edit` in any scripts.
- **Existing trees.** Trees grown before the update keep their old leaves, which never decay.
- **New trees look different.** Trunks now have bark outside and stripped logs inside, and 20% are hollow. For something closer to the old look, set `wood.style: all_log` and `wood.hollow_chance: 0` (logs still follow their branches).

## Known issues

- Thin crimson and warped stems can look lumpy.
- Some mushroom caps have a one-block bump on top.
- Worlds already loaded when the plugin is enabled (after `/reload`, or a plugin manager loading it late) don't get natural trees until the server restarts.
