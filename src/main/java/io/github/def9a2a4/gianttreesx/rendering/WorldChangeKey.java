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

import org.bukkit.util.Vector;

public record WorldChangeKey(int x, int y, int z) {

  // the record's default hash spreads differently: HashMap iteration order (which the viewer's
  // src/javamap.js reproduces) depends on this exact formula
  @Override
  public int hashCode() {
    return (31 * ((31 * x) + y)) + z;
  }

  public Vector toVector() {
    return new Vector(x, y, z);
  }
}
