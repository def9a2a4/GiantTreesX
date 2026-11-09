package io.github.def9a2a4.gianttreesx.rendering;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.Enumeration;
import java.util.Set;
import java.util.TreeSet;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.regex.Pattern;

/**
 * Where tree files (tree.OAK.xml, tree.OAK.root.xml) come from: the plugin folder's tree/
 * subfolder first, so a server can add trees or replace bundled ones, then the jar's tree/ folder
 * (src/main/resources/tree). Nothing is unpacked; the user folder is read on every lookup, so new
 * files work without a restart.
 */
public final class TreeFiles {

  /** A tree file name: tree.X.xml or tree.X.root.xml. */
  private static final Pattern TREE_FILE = Pattern.compile("tree\\.[^/]+\\.xml");
  /** The jar folder the bundled tree files are in. */
  private static final String JAR_DIR = "tree/";

  private final File userDir;
  private final ClassLoader loader;
  /** names of the tree files bundled in the jar */
  private final Set<String> bundled = new TreeSet<>();

  /**
   * @param userDir the folder for added and replaced trees (plugins/GiantTrees/tree)
   * @param jar     the plugin jar, listed once for its bundled tree files
   * @param loader  the plugin's class loader, which reads them
   */
  public TreeFiles(final File userDir, final File jar, final ClassLoader loader) throws IOException {
    this.userDir = userDir;
    this.loader = loader;
    try (JarFile jarFile = new JarFile(jar)) {
      final Enumeration<JarEntry> entries = jarFile.entries();
      while (entries.hasMoreElements()) {
        final String path = entries.nextElement().getName();
        if (path.startsWith(JAR_DIR) && TREE_FILE.matcher(path.substring(JAR_DIR.length())).matches()) {
          this.bundled.add(path.substring(JAR_DIR.length()));
        }
      }
    }
  }

  /** The tree file called {@code name} (tree.OAK.xml): the server's own, else the bundled one, else null. */
  public URL find(final String name) {
    final File own = new File(this.userDir, name);
    if (own.isFile()) {
      try {
        return own.toURI().toURL();
      } catch (final MalformedURLException e) {
        throw new IllegalStateException(e);
      }
    }
    return this.bundled(name);
  }

  /** The bundled tree file called {@code name}, or null. */
  public URL bundled(final String name) {
    return this.bundled.contains(name) ? this.loader.getResource(JAR_DIR + name) : null;
  }

  public boolean exists(final String name) {
    return this.find(name) != null;
  }

  /** Where the server's own copy of {@code name} goes (it may not exist). */
  public File userFile(final String name) {
    return new File(this.userDir, name);
  }

  public File userDir() {
    return this.userDir;
  }

  /** Every tree file name (tree.X.xml, roots left out), bundled and the server's own. */
  public Set<String> treeNames() {
    final Set<String> names = new TreeSet<>();
    for (final String name : this.bundled) {
      if (!name.endsWith(".root.xml")) {
        names.add(name);
      }
    }
    final String[] own = this.userDir.list((dir, name) -> TREE_FILE.matcher(name).matches()
                                                          && !name.endsWith(".root.xml"));
    if (own != null) {
      names.addAll(Set.of(own));
    }
    return names;
  }
}
