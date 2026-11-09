package io.github.def9a2a4.gianttreesx;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeMap;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TextComponent;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import io.github.def9a2a4.gianttreesx.rendering.TreeFiles;
import io.github.def9a2a4.gianttreesx.rendering.TreeRenderer;

/**
 * {@code /gianttrees} (alias {@code /gt}): {@code help}, {@code grow <type> <size> [x z [world]]}
 * and {@code edit <type> <size> [root]}. Leaving out the type or the size shows a breadcrumb line
 * ({@code GiantTreesX › grow › oak}) and clickable choices for the next argument, so a player can
 * click their way to a tree.
 *
 * <p>Colours as in DefCoreLib's CommandHelp: gold header, white command, gray description; red for
 * errors, yellow for usage, green for success.
 */
public class TreeCommand implements TabExecutor {

  static final String GITHUB = "https://github.com/def9a2a4/GiantTreesX";
  static final String DISCORD = "https://def9a2a4.github.io/discord.html";
  static final String GALLERY = "https://def9a2a4.github.io/GiantTreesX/";

  /** A tree size: its name in commands and the suffix of its tree files. */
  enum Size {
    GIANT(""), HUGE("_HUGE"), BIG("_BIG");

    final String suffix;

    Size(final String suffix) {
      this.suffix = suffix;
    }

    String key() {
      return this.name().toLowerCase(Locale.ROOT);
    }

    static Size parse(final String s) {
      for (final Size size : values()) {
        if (size.key().equalsIgnoreCase(s)) {
          return size;
        }
      }
      return null;
    }
  }

  private final Plugin plugin;
  /** the plugin jar, whose main class is the Arbaro editor */
  private final File jar;
  private final TreeFiles trees;
  private final TreeRenderer renderer;

  public TreeCommand(final Plugin plugin, final File jar, final TreeFiles trees) {
    this.plugin = plugin;
    this.jar = jar;
    this.trees = trees;
    this.renderer = new TreeRenderer(plugin, trees);
  }

  @Override
  public boolean onCommand(final CommandSender sender, final Command command, final String label,
                           final String[] args) {
    final String sub = args.length == 0 ? "help" : args[0].toLowerCase(Locale.ROOT);
    switch (sub) {
      case "help", "?" -> this.help(sender, label);
      case "grow" -> this.grow(sender, label, args);
      case "edit" -> this.edit(sender, label, args);
      default -> {
        sender.sendMessage(Component.text("Unknown subcommand: " + args[0], NamedTextColor.RED));
        this.help(sender, label);
      }
    }
    return true;
  }

  // ── help ──────────────────────────────────────────────────────────────

  private void help(final CommandSender sender, final String label) {
    sender.sendMessage(Component.text("=== GiantTreesX ===", NamedTextColor.GOLD));
    sender.sendMessage(Component.text("Enormous trees, grown from saplings with bone meal, by command, or in new chunks.",
                                      NamedTextColor.GRAY));
    sender.sendMessage(Component.text("Commands:", NamedTextColor.GOLD));
    if (sender.hasPermission("gianttrees.create")) {
      sender.sendMessage(command("/" + label + " grow <type> <size> [x z [world]]",
                                 "/" + label + " grow", " - grow a tree (leave out the type to pick one)"));
    }
    if (!(sender instanceof Player)) {
      sender.sendMessage(command("/" + label + " edit <type> <size> [root]", null,
                                 " - open a tree file in the Arbaro desktop editor"));
    }
    sender.sendMessage(command("/" + label + " help", "/" + label + " help", " - this list"));
    sender.sendMessage(link("Gallery: ", GALLERY));
    sender.sendMessage(link("GitHub: ", GITHUB));
    sender.sendMessage(link("Discord: ", DISCORD));
  }

  // ── grow ──────────────────────────────────────────────────────────────

  private void grow(final CommandSender sender, final String label, final String[] args) {
    if (!sender.hasPermission("gianttrees.create")) {
      sender.sendMessage(Component.text("You don't have permission to grow trees with /" + label + ".",
                                        NamedTextColor.RED));
      return;
    }
    final TreeMap<String, List<Size>> types = this.types();
    if (args.length < 2) {
      this.pickType(sender, label, "grow", types);
      return;
    }
    final String type = args[1].toLowerCase(Locale.ROOT);
    if (!types.containsKey(type)) {
      sender.sendMessage(Component.text("No tree type " + args[1] + ".", NamedTextColor.RED));
      this.pickType(sender, label, "grow", types);
      return;
    }
    if (args.length < 3) {
      this.pickSize(sender, label, "grow", type, types.get(type));
      return;
    }
    final Size size = Size.parse(args[2]);
    if (size == null || !types.get(type).contains(size)) {
      sender.sendMessage(Component.text((size == null ? "No size " + args[2] : type + " has no " + size.key()
                                         + " tree") + ".", NamedTextColor.RED));
      this.pickSize(sender, label, "grow", type, types.get(type));
      return;
    }

    final Location target = this.target(sender, label, args);
    if (target == null) {
      return;
    }
    final String treeFile = treeFile(type, size, false);
    final World world = target.getWorld();
    // a player standing on solid ground grows it at their feet (in the Nether, in a cave);
    // otherwise, and for x z, the top of the column, below any water
    final Block feet = args.length == 3 ? target.getBlock().getRelative(BlockFace.DOWN) : null;
    final Block baseBlock;
    if (feet != null && feet.getType().isSolid()) {
      baseBlock = feet;
    } else {
      final TreeGround ground = TreeGround.at(world, target.getBlockX(), target.getBlockZ());
      baseBlock = ground.block();
      if (ground.underFluid()) {
        sender.sendMessage(Component.text("Growing under water, on "
                                          + baseBlock.getType().name().toLowerCase(Locale.ROOT), NamedTextColor.YELLOW));
      }
    }
    // asked for explicitly, so the tree grows anyway
    if (!TreeGround.isSoil(baseBlock.getType())) {
      sender.sendMessage(Component.text("No soil here: growing on "
                                        + baseBlock.getType().name().toLowerCase(Locale.ROOT), NamedTextColor.YELLOW));
    }
    final Location base = baseBlock.getLocation();
    sender.sendMessage(Component.text("Growing " + treeFile.replace(".xml", "") + " at "
                                      + world.getName() + " " + base.getBlockX() + " " + base.getBlockY()
                                      + " " + base.getBlockZ() + ". Stand back!", NamedTextColor.GREEN));
    this.renderer.renderTree(base, treeFile, TreeRenderer.positionSeed(base), true);
  }

  /** Where to grow: args[3..5] = x z [world], else where the player stands. Null (and says why) if none. */
  private Location target(final CommandSender sender, final String label, final String[] args) {
    final Player player = sender instanceof Player p ? p : null;
    if (args.length == 3) {
      if (player == null) {
        sender.sendMessage(Component.text("From the console, give a position: /" + label + " grow "
                                          + args[1] + " " + args[2] + " <x> <z> <world>", NamedTextColor.YELLOW));
        return null;
      }
      return player.getLocation();
    }
    if (args.length < 5 || args.length > 6) {
      sender.sendMessage(Component.text("Usage: /" + label + " grow <type> <size> [x z [world]]",
                                        NamedTextColor.YELLOW));
      return null;
    }
    final World world = args.length == 6 ? Bukkit.getWorld(args[5])
        : player != null ? player.getWorld() : null;
    if (world == null) {
      sender.sendMessage(Component.text(args.length == 6 ? "No world named " + args[5]
                                        : "From the console, name the world too", NamedTextColor.RED));
      return null;
    }
    try {
      return new Location(world, Integer.parseInt(args[3]), 0, Integer.parseInt(args[4]));
    } catch (final NumberFormatException e) {
      sender.sendMessage(Component.text("x and z must be whole numbers", NamedTextColor.RED));
      return null;
    }
  }

  // ── edit ──────────────────────────────────────────────────────────────

  private void edit(final CommandSender sender, final String label, final String[] args) {
    if (sender instanceof Player) {
      sender.sendMessage(Component.text("Trees can only be edited from the console, or in the web viewer: ",
                                        NamedTextColor.RED).append(url(GALLERY + "viewer/")));
      return;
    }
    final TreeMap<String, List<Size>> types = this.types();
    final String type = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : null;
    final Size size = args.length > 2 ? Size.parse(args[2]) : null;
    if (type == null || !types.containsKey(type) || size == null || !types.get(type).contains(size)) {
      sender.sendMessage(Component.text("Usage: /" + label + " edit <type> <size> [root]", NamedTextColor.YELLOW));
      sender.sendMessage(Component.text("Trees: " + String.join(", ", types.keySet()), NamedTextColor.GRAY));
      return;
    }
    if (!hasDisplay()) {
      sender.sendMessage(Component.text("This server has no graphical display. Edit trees in the web viewer ("
                                        + GALLERY + "viewer/), or run the editor on a desktop: java -jar "
                                        + this.jar.getName() + " <tree file>", NamedTextColor.RED));
      return;
    }
    final String name = treeFile(type, size, args.length > 3 && args[3].equalsIgnoreCase("root"));
    // a bundled tree is copied into tree/ first: the editor saves the server's own copy there
    final File toOpen = this.trees.userFile(name);
    if (!toOpen.isFile()) {
      final URL source = this.trees.find(name);
      if (source == null) {
        sender.sendMessage(Component.text("No tree file " + name + " (a tree without roots has no .root file)",
                                          NamedTextColor.RED));
        return;
      }
      try (InputStream in = TreeFiles.open(source)) {
        Files.createDirectories(toOpen.toPath().getParent());
        Files.copy(in, toOpen.toPath());
      } catch (final IOException e) {
        sender.sendMessage(Component.text("Could not copy " + name + " into " + toOpen.getParent() + ": "
                                          + e.getMessage(), NamedTextColor.RED));
        return;
      }
      sender.sendMessage(Component.text("Copied the bundled " + name + " to " + toOpen.getPath()
                                        + "; it replaces the bundled one from now on", NamedTextColor.YELLOW));
    }
    final File java = new File(System.getProperty("java.home"),
                               "bin" + File.separator + (File.separatorChar == '\\' ? "java.exe" : "java"));
    final File log = new File(this.plugin.getDataFolder(), "arbaro.log");
    final ProcessBuilder pb = new ProcessBuilder(java.getAbsolutePath(), "-jar",
                                                 this.jar.getAbsolutePath(), toOpen.getAbsolutePath());
    pb.redirectErrorStream(true);
    pb.redirectOutput(log);
    final Process process;
    try {
      process = pb.start();
    } catch (final IOException e) {
      this.plugin.getLogger().log(Level.SEVERE, "Error starting the Arbaro tree editor", e);
      sender.sendMessage(Component.text("Could not start the tree editor: " + e.getMessage(), NamedTextColor.RED));
      return;
    }
    sender.sendMessage(Component.text("Opening " + toOpen.getName() + " in the tree editor...", NamedTextColor.GREEN));

    // the editor runs until its window is closed; an early failure (no usable display after all,
    // ...) shows up as a quick non-zero exit, reported here instead of failing silently
    this.plugin.getServer().getScheduler().runTaskAsynchronously(this.plugin, () -> {
      try {
        if (process.waitFor(15, TimeUnit.SECONDS) && process.exitValue() != 0) {
          this.plugin.getLogger().warning("The tree editor exited with status "
                                          + process.exitValue() + "; see " + log.getPath());
        }
      } catch (final InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    });
  }

  /**
   * Whether a desktop window can be opened. The server's own JVM is often headless whatever the
   * machine has, so this looks at the environment instead: Windows and macOS have a desktop
   * session for a logged-in user; elsewhere an X11 or Wayland display must be set.
   */
  private static boolean hasDisplay() {
    final String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
    if (os.startsWith("windows") || os.contains("mac")) {
      return true;
    }
    return notBlank(System.getenv("DISPLAY")) || notBlank(System.getenv("WAYLAND_DISPLAY"));
  }

  private static boolean notBlank(final String s) {
    return s != null && !s.isBlank();
  }

  // ── tab completion ────────────────────────────────────────────────────

  @Override
  public List<String> onTabComplete(final CommandSender sender, final Command command, final String label,
                                    final String[] args) {
    final List<String> subs = new ArrayList<>(List.of("help"));
    if (sender.hasPermission("gianttrees.create")) {
      subs.add("grow");
    }
    if (!(sender instanceof Player)) {
      subs.add("edit");
    }
    if (args.length == 1) {
      return filter(subs, args[0]);
    }
    final String sub = args[0].toLowerCase(Locale.ROOT);
    if (!subs.contains(sub) || sub.equals("help")) {
      return List.of();
    }
    final TreeMap<String, List<Size>> types = this.types();
    if (args.length == 2) {
      return filter(types.keySet(), args[1]);
    }
    final List<Size> sizes = types.get(args[1].toLowerCase(Locale.ROOT));
    if (args.length == 3) {
      return sizes == null ? List.of() : filter(sizes.stream().map(Size::key).toList(), args[2]);
    }
    if (sub.equals("edit")) {
      return args.length == 4 ? filter(List.of("root"), args[3]) : List.of();
    }
    final Location at = sender instanceof Player p ? p.getLocation() : null;
    return switch (args.length) {
      case 4 -> at == null ? List.of() : filter(List.of(String.valueOf(at.getBlockX())), args[3]);
      case 5 -> at == null ? List.of() : filter(List.of(String.valueOf(at.getBlockZ())), args[4]);
      case 6 -> filter(Bukkit.getWorlds().stream().map(World::getName).toList(), args[5]);
      default -> List.of();
    };
  }

  private static List<String> filter(final Iterable<String> options, final String prefix) {
    final String p = prefix.toLowerCase(Locale.ROOT);
    final List<String> out = new ArrayList<>();
    for (final String o : options) {
      if (o.toLowerCase(Locale.ROOT).startsWith(p)) {
        out.add(o);
      }
    }
    return out;
  }

  // ── trees ─────────────────────────────────────────────────────────────

  /**
   * The tree types, bundled and the server's own, and the sizes each has: tree.OAK_HUGE.xml is
   * type oak, size huge. Read on every use, so new tree files show up without a restart.
   */
  private TreeMap<String, List<Size>> types() {
    final TreeMap<String, List<Size>> types = new TreeMap<>();
    for (final String file : this.trees.treeNames()) {
      String name = file.substring("tree.".length(), file.length() - ".xml".length());
      Size size = Size.GIANT;
      for (final Size s : Size.values()) {
        if (!s.suffix.isEmpty() && name.endsWith(s.suffix)) {
          size = s;
          name = name.substring(0, name.length() - s.suffix.length());
          break;
        }
      }
      types.computeIfAbsent(name.toLowerCase(Locale.ROOT), k -> new ArrayList<>()).add(size);
    }
    types.values().forEach(sizes -> sizes.sort(null));
    return types;
  }

  private static String treeFile(final String type, final Size size, final boolean root) {
    return "tree." + type.toUpperCase(Locale.ROOT) + size.suffix + (root ? ".root" : "") + ".xml";
  }

  // ── breadcrumbs and buttons ───────────────────────────────────────────

  /** "GiantTreesX › grow": every tree type as a button that moves on to its sizes. */
  private void pickType(final CommandSender sender, final String label, final String sub,
                        final TreeMap<String, List<Size>> types) {
    sender.sendMessage(crumbs(label, sub, null).append(Component.text("  pick a tree:", NamedTextColor.GRAY)));
    TextComponent.Builder line = Component.text();
    for (final String type : types.keySet()) {
      line.append(button(type, "/" + label + " " + sub + " " + type,
                         "Sizes: " + String.join(", ", types.get(type).stream().map(Size::key).toList())))
          .append(Component.space());
    }
    sender.sendMessage(line.build());
  }

  /** "GiantTreesX › grow › oak": every size as a button; sizes the type lacks are struck out. */
  private void pickSize(final CommandSender sender, final String label, final String sub, final String type,
                        final List<Size> sizes) {
    sender.sendMessage(crumbs(label, sub, type).append(Component.text("  pick a size:", NamedTextColor.GRAY)));
    TextComponent.Builder line = Component.text();
    for (final Size size : Size.values()) {
      if (sizes.contains(size)) {
        line.append(button(size.key(), "/" + label + " " + sub + " " + type + " " + size.key(),
                           "Grow a " + size.key() + " " + type + " where you stand"));
      } else {
        line.append(Component.text(size.key(), NamedTextColor.DARK_GRAY, TextDecoration.STRIKETHROUGH)
                             .hoverEvent(HoverEvent.showText(Component.text(type + " has no " + size.key()
                                                                            + " tree"))));
      }
      line.append(Component.space());
    }
    sender.sendMessage(line.build());
  }

  /** The breadcrumb line: each step but the last is clickable and goes back to it. */
  private static Component crumbs(final String label, final String sub, final String type) {
    final Component sep = Component.text(" › ", NamedTextColor.DARK_GRAY);
    TextComponent.Builder line = Component.text()
        .append(crumb("GiantTreesX", "/" + label + " help"))
        .append(sep);
    if (type == null) {
      line.append(Component.text(sub, NamedTextColor.GOLD));
    } else {
      line.append(crumb(sub, "/" + label + " " + sub)).append(sep).append(Component.text(type, NamedTextColor.GOLD));
    }
    return line.build();
  }

  private static Component crumb(final String text, final String command) {
    return Component.text(text, NamedTextColor.YELLOW)
                    .clickEvent(ClickEvent.runCommand(command))
                    .hoverEvent(HoverEvent.showText(Component.text("Back to " + command)));
  }

  private static Component button(final String text, final String command, final String hover) {
    return Component.text("[" + text + "]", NamedTextColor.GREEN)
                    .clickEvent(ClickEvent.runCommand(command))
                    .hoverEvent(HoverEvent.showText(Component.text(hover)));
  }

  /** A help line: the command (clickable when {@code run} is set) and its description. */
  private static Component command(final String usage, final String run, final String description) {
    Component cmd = Component.text(usage, NamedTextColor.WHITE);
    if (run != null) {
      cmd = cmd.clickEvent(ClickEvent.runCommand(run))
               .hoverEvent(HoverEvent.showText(Component.text("Click to run " + run)));
    }
    return cmd.append(Component.text(description, NamedTextColor.GRAY));
  }

  private static Component link(final String label, final String url) {
    return Component.text(label, NamedTextColor.GRAY).append(url(url));
  }

  private static Component url(final String url) {
    return Component.text(url, NamedTextColor.AQUA, TextDecoration.UNDERLINED).clickEvent(ClickEvent.openUrl(url));
  }
}
