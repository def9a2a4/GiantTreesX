// Port of com.ryanmichela.trees.rendering.Draw3d + Orientation (geometry only).
import { blockFloor, roundToInt } from './jmath.js';
import { SimplexNoiseGenerator } from './noise.js';
import { KIND_WOOD, KIND_LEAF, PART_JUNCTION } from './voxels.js';

export const X_MAJOR = 0, Y_MAJOR = 1, Z_MAJOR = 2;

/** Orientation.orient(l1, l2) on Bukkit vectors */
export function orient(l1, l2) {
  const dx = Math.abs(l2.x - l1.x);
  const dy = Math.abs(l2.y - l1.y);
  const dz = Math.abs(l2.z - l1.z);
  if (dx >= Math.max(dy, dz)) return X_MAJOR;
  if (dy >= Math.max(dx, dz)) return Y_MAJOR;
  if (dz >= Math.max(dx, dy)) return Z_MAJOR;
  return Y_MAJOR;
}

/** Bresenham as in Draw3d.plotLine2d; returns flat [p0,q0,p1,q1,...] */
function plotLine2d(x1, y1, x2, y2) {
  const pts = [];
  let currentX, currentY, xInc, yInc, dx, dy, twoDx, twoDy, acc;
  dx = (x2 - x1) | 0;
  dy = (y2 - y1) | 0;
  twoDx = (dx + dx) | 0;
  twoDy = (dy + dy) | 0;
  currentX = x1;
  currentY = y1;
  xInc = 1;
  yInc = 1;
  if (dx < 0) { xInc = -1; dx = -dx; twoDx = -twoDx; }
  if (dy < 0) { yInc = -1; dy = -dy; twoDy = -twoDy; }
  pts.push(x1, y1);
  if (dx !== 0 || dy !== 0) {
    if (dy <= dx) {
      acc = 0;
      do {
        currentX = (currentX + xInc) | 0;
        acc = (acc + twoDy) | 0;
        if (acc > dx) { currentY = (currentY + yInc) | 0; acc = (acc - twoDx) | 0; }
        pts.push(currentX, currentY);
      } while (currentX !== x2);
    } else {
      acc = 0;
      do {
        currentY = (currentY + yInc) | 0;
        acc = (acc + twoDx) | 0;
        if (acc > dy) { currentX = (currentX + xInc) | 0; acc = (acc - twoDy) | 0; }
        pts.push(currentX, currentY);
      } while (currentY !== y2);
    }
  }
  return pts;
}

export class Draw3d {
  /**
   * @param {{x:number,y:number,z:number,hash:number}} refPoint  hash = Location.hashCode()
   * @param {number} noiseIntensity  tree Smooth param
   * @param {number} woodIndex  index of the wood type in the store's woodTypes table
   * @param {import('./voxels.js').VoxelStore} store
   * @param {boolean} inverted  RenderOrientation.INVERTED
   * @param {number} part  PART_TREE / PART_ROOT
   * @param {SimplexNoiseGenerator} [noise]  shared generator (same seed -> same generator)
   */
  constructor(refPoint, noiseIntensity, woodIndex, store, inverted, part, noise) {
    this.refPoint = refPoint;
    this.noise = noise || new SimplexNoiseGenerator(refPoint.hash);
    this.noiseIntensity = noiseIntensity;
    this.store = store;
    this.wood = woodIndex;
    this.inverted = inverted;
    this.part = part;
    this.cache = new Map();
  }

  toMcVector(v) {
    return { x: v.x, y: this.inverted ? -v.z : v.z, z: v.y };
  }

  /** raw simplex noise at block coords, memoized (pure function of integer coords) */
  rawNoise(x, y, z) {
    const key = ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);
    let v = this.cache.get(key);
    if (v === undefined) {
      v = this.noise.noise(x * 0.25, y * 0.25, z * 0.25);
      this.cache.set(key, v);
    }
    return v;
  }

  calculateNoiseOffset(x, y, z, multiplier, level) {
    const levelScale = (4 - level) / 4;
    return (this.rawNoise(x, y, z) + 1) * this.noiseIntensity * multiplier * levelScale;
  }

  addWood(x, y, z, orientation, level, part = this.part) {
    this.store.add(x, y, z, KIND_WOOD, level, orientation, part, this.wood, true);
  }

  drawCone(l1, rad1, l2, rad2, level) {
    const orientation = orient(l1, l2);
    const line = this.plotLine3d(l1, l2, orientation);
    const dx = l1.x - l2.x, dy = l1.y - l2.y, dz = l1.z - l2.z;
    const h = Math.sqrt(dx * dx + dy * dy + dz * dz); // Vector.distance (square() == x*x)
    const ht = (-rad1 * h) / (rad2 - rad1);
    const l1bx = blockFloor(l1.x), l1by = blockFloor(l1.y), l1bz = blockFloor(l1.z);
    const n = line.length / 3;
    for (let i = 0; i < n; i++) {
      const cx = line[i * 3], cy = line[i * 3 + 1], cz = line[i * 3 + 2];
      const r = roundToInt((rad1 * (ht - i)) / ht);
      let pts;
      switch (orientation) {
        case X_MAJOR:
          pts = this.plotCircle(cy, cz, cx, r, level);
          for (let p = 0; p < pts.length; p += 2) {
            this.addWood(cx, (l1by - cy + pts[p]) | 0, (l1bz - cz + pts[p + 1]) | 0, orientation, level);
          }
          break;
        case Y_MAJOR:
          pts = this.plotCircle(cx, cz, cy, r, level);
          for (let p = 0; p < pts.length; p += 2) {
            this.addWood((l1bx - cx + pts[p]) | 0, cy, (l1bz - cz + pts[p + 1]) | 0, orientation, level);
          }
          break;
        case Z_MAJOR:
          pts = this.plotCircle(cx, cy, cz, r, level);
          for (let p = 0; p < pts.length; p += 2) {
            this.addWood((l1bx - cx + pts[p]) | 0, (l1by - cy + pts[p + 1]) | 0, cz, orientation, level);
          }
          break;
      }
    }
  }

  drawLeafCluster(pos, length, width) {
    // plotEllipsoid(pos, length, width, length, 0)
    const a = length, b = width, c = length;
    const halfSize = (Math.ceil(Math.max(Math.max(a, b), c)) | 0) + 2;
    const px = blockFloor(pos.x), py = blockFloor(pos.y), pz = blockFloor(pos.z);
    const aa = a * a, bb = b * b, cc = c * c;
    const store = this.store;
    for (let x = -halfSize; x <= halfSize; x++) {
      for (let y = -halfSize; y <= halfSize; y++) {
        for (let z = -halfSize; z <= halfSize; z++) {
          const left = (x * x) / aa + (y * y) / bb + (z * z) / cc;
          const noiseOffset = this.calculateNoiseOffset(x + px, y + py, z + pz, 1, 0);
          if (left <= 1 + noiseOffset) {
            // new Vector(x,y,z).add(pos) -> block coords via floor
            store.add(blockFloor(x + pos.x), blockFloor(y + pos.y), blockFloor(z + pos.z), KIND_LEAF, -1, -1, this.part, this.wood, false);
          }
        }
      }
    }
  }

  drawRootJunction(pos, r) {
    // plotDownwardHemisphere(pos, r)
    const rCeil = (Math.ceil(r) | 0) + 4;
    const r2 = r * r;
    const px = blockFloor(pos.x), py = blockFloor(pos.y), pz = blockFloor(pos.z);
    for (let x = -rCeil; x <= rCeil; x++) {
      for (let y = -rCeil; y <= 0; y++) {
        for (let z = -rCeil; z <= rCeil; z++) {
          const left = x * x + y * y + z * z;
          const no = this.calculateNoiseOffset(x + px, y + py, z + pz, 2, 0);
          if (left <= r2 + no * no) {
            this.addWood(blockFloor(x + pos.x), blockFloor(y + pos.y), blockFloor(z + pos.z), Y_MAJOR, 0, PART_JUNCTION);
          }
        }
      }
    }
  }

  drawWoodSphere(pos, r, orientation, level) {
    // plotSphere(pos, r, level)
    const rCeil = (Math.ceil(r) | 0) + 4;
    const r2 = r * r;
    const px = blockFloor(pos.x), py = blockFloor(pos.y), pz = blockFloor(pos.z);
    for (let x = -rCeil; x <= rCeil; x++) {
      for (let y = -rCeil; y <= rCeil; y++) {
        for (let z = -rCeil; z <= rCeil; z++) {
          const left = x * x + y * y + z * z;
          const no = this.calculateNoiseOffset(x + px, y + py, z + pz, 2, level);
          if (left <= r2 + no * no) {
            this.addWood(blockFloor(x + pos.x), blockFloor(y + pos.y), blockFloor(z + pos.z), orientation, level);
          }
        }
      }
    }
  }

  /** returns flat [px,py, ...] absolute circle points like Draw3d.plotCircle */
  plotCircle(cx, cy, z, r, level) {
    const pts = [];
    const rSquare = Math.imul(r, r);
    const lo = (-r - 8) | 0, hi = (r + 8) | 0;
    for (let x = lo; x <= hi; x++) {
      for (let y = lo; y <= hi; y++) {
        const no = this.calculateNoiseOffset(x + cx, y + cy, z, 4, level);
        if ((x === 0 && y === 0) || x * x + y * y <= rSquare + no * no) {
          pts.push(cx + x, cy + y);
        }
      }
    }
    return pts;
  }

  /** returns flat [x,y,z,...] integer centre line like Draw3d.plotLine3d */
  plotLine3d(l1, l2, orientation) {
    const out = [];
    const l1x = blockFloor(l1.x), l1y = blockFloor(l1.y), l1z = blockFloor(l1.z);
    const l2x = blockFloor(l2.x), l2y = blockFloor(l2.y), l2z = blockFloor(l2.z);
    if (orientation === X_MAJOR) {
      // NB: Java passes l2.getBlockZ() as the y end point here (upstream bug, replicated)
      const xy = plotLine2d(l1x, l1y, l2x, l2z);
      const xz = plotLine2d(l1x, l1z, l2x, l2z);
      const n = Math.min(xy.length, xz.length) / 2;
      for (let i = 0; i < n; i++) out.push(l1x + i, xy[i * 2 + 1], xz[i * 2 + 1]);
    } else if (orientation === Y_MAJOR) {
      const yx = plotLine2d(l1y, l1x, l2y, l2x);
      const yz = plotLine2d(l1y, l1z, l2y, l2z);
      const n = Math.min(yx.length, yz.length) / 2;
      for (let i = 0; i < n; i++) out.push(yx[i * 2 + 1], l1y + i, yz[i * 2 + 1]);
    } else if (orientation === Z_MAJOR) {
      const zx = plotLine2d(l1z, l1x, l2z, l2x);
      const zy = plotLine2d(l1z, l1y, l2z, l2y);
      const n = Math.min(zx.length, zy.length) / 2;
      for (let i = 0; i < n; i++) out.push(zx[i * 2 + 1], zy[i * 2 + 1], l1z + i);
    }
    return out;
  }
}
