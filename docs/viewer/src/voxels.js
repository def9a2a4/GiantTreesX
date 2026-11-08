// Port of WorldChangeTracker semantics: one entry per block, wood overwrites, leaves/vines don't.
// Entries keep Java HashMap "first insertion" identity (a put() on an existing key keeps the node).

export const KIND_WOOD = 1;
export const KIND_LEAF = 2;
export const KIND_VINE = 3;
export const KIND_NAMES = { 1: 'wood', 2: 'leaf', 3: 'vine' };

export const PART_TREE = 0;
export const PART_ROOT = 1;
export const PART_JUNCTION = 2;
export const PART_NAMES = { 0: 'tree', 1: 'root', 2: 'junction' };

// Orientation enum (as passed to Draw3d.orient): xMajor, yMajor, zMajor; -1 = none
export const ORIENT_NAMES = { '-1': null, 0: 'xMajor', 1: 'yMajor', 2: 'zMajor' };

// Vine facing (JungleVinePopulator): face set to true
export const FACE_NAMES = { 0: 'SOUTH', 1: 'NORTH', 2: 'WEST', 3: 'EAST' };

const OFF = 32768;
export function packKey(x, y, z) {
  return ((x + OFF) * 65536 + (y + OFF)) * 65536 + (z + OFF);
}

export class VoxelStore {
  constructor() {
    this.index = new Map(); // key -> entry index (insertion order == Java node creation order)
    this.cap = 1 << 16;
    this.n = 0;
    this._alloc(this.cap);
  }
  _alloc(cap) {
    const grow = (A, T) => { const b = new T(cap); if (A) b.set(A.subarray(0, this.n)); return b; };
    this.x = grow(this.x, Int32Array);
    this.y = grow(this.y, Int32Array);
    this.z = grow(this.z, Int32Array);
    this.kind = grow(this.kind, Uint8Array);
    this.level = grow(this.level, Int8Array);
    this.orient = grow(this.orient, Int8Array);   // Orientation enum for wood, face for vines
    this.part = grow(this.part, Uint8Array);
    this.wood = grow(this.wood, Uint8Array);      // index into woodTypes[]
    this.cap = cap;
  }
  /**
   * WorldChangeTracker.addChange(location, material, mutator, overwrite)
   * kind/level/orient/part/wood describe the change; overwrite = (kind === wood) in Draw3d.
   */
  add(x, y, z, kind, level, orient, part, wood, overwrite) {
    const key = packKey(x, y, z);
    let i = this.index.get(key);
    if (i !== undefined) {
      if (!overwrite) return;
      // WorldChangeTracker: wood over wood keeps the lower (closer to trunk) stem level,
      // "so a branch starting inside the trunk stays trunk"
      const ex = this.level[i];
      if (this.kind[i] === 1 && kind === 1 && ex >= 0 && ex < level) level = ex;
    } else {
      if (this.n === this.cap) this._alloc(this.cap * 2);
      i = this.n++;
      this.index.set(key, i);
      this.x[i] = x;
      this.y[i] = y;
      this.z[i] = z;
    }
    this.kind[i] = kind;
    this.level[i] = level;
    this.orient[i] = orient;
    this.part[i] = part;
    this.wood[i] = wood;
  }
  has(x, y, z) {
    return this.index.has(packKey(x, y, z));
  }
  get size() {
    return this.n;
  }
}
