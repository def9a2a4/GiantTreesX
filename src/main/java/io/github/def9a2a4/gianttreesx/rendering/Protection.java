package io.github.def9a2a4.gianttreesx.rendering;

import java.util.EnumSet;
import java.util.Set;

import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.TileState;
import org.bukkit.configuration.ConfigurationSection;

/** The protect_block_entities and protected_blocks settings: blocks trees never replace. */
public final class Protection {
  private final boolean blockEntities;
  private final Set<Material> blocks = EnumSet.noneOf(Material.class);

  public Protection(final ConfigurationSection config) {
    this.blockEntities = config.getBoolean("protect_block_entities", true);
    for (final String name : config.getStringList("protected_blocks")) {
      final Material material = Material.matchMaterial(name);
      if (material != null) {
        this.blocks.add(material);
      }
    }
  }

  public boolean isProtected(final Block block) {
    return this.blocks.contains(block.getType())
           || (this.blockEntities && block.getState(false) instanceof TileState);
  }
}
