// Port of org.bukkit.util.noise.{PerlinNoiseGenerator,SimplexNoiseGenerator} (3D noise only)
// and org.bukkit.Location.hashCode().
import { JavaRandom } from './jrandom.js';
import { doubleHash, floatToIntBits } from './jmath.js';

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const GX = new Int8Array(GRAD3.map((g) => g[0]));
const GY = new Int8Array(GRAD3.map((g) => g[1]));
const GZ = new Int8Array(GRAD3.map((g) => g[2]));
const F3 = 0.3333333333333333;
const G3 = 0.16666666666666666;

/** NoiseGenerator.floor: x >= 0 ? (int)x : (int)x - 1  (note: floor(-1.0) == -2) */
function nfloor(x) {
  return x >= 0 ? x | 0 : (x | 0) - 1;
}

export class SimplexNoiseGenerator {
  /** @param {number|bigint} seed Java long */
  constructor(seed) {
    const rand = new JavaRandom(seed);
    // PerlinNoiseGenerator(Random)
    this.offsetX = rand.nextDouble() * 256;
    this.offsetY = rand.nextDouble() * 256;
    this.offsetZ = rand.nextDouble() * 256;
    const perm = (this.perm = new Int32Array(512));
    for (let i = 0; i < 256; i++) perm[i] = rand.nextInt(256);
    for (let i = 0; i < 256; i++) {
      const pos = rand.nextInt(256 - i) + i;
      const old = perm[i];
      perm[i] = perm[pos];
      perm[pos] = old;
      perm[i + 256] = perm[i];
    }
    // SimplexNoiseGenerator(Random)
    this.offsetW = rand.nextDouble() * 256;
  }

  noise(xin, yin, zin) {
    xin += this.offsetX;
    yin += this.offsetY;
    zin += this.offsetZ;
    const perm = this.perm;
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = nfloor(xin + s);
    const j = nfloor(yin + s);
    const k = nfloor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t, Y0 = j - t, Z0 = k - t;
    const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + F3, y2 = y0 - j2 + F3, z2 = z0 - k2 + F3; // 2.0*G3 folded to F3 by javac
    const x3 = x0 - 1.0 + 0.5, y3 = y0 - 1.0 + 0.5, z3 = z0 - 1.0 + 0.5; // 3.0*G3 folded to 0.5
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const gi0 = perm[ii + perm[jj + perm[kk]]] % 12;
    const gi1 = perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12;
    const gi2 = perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12;
    const gi3 = perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0.0;
    else { t0 *= t0; n0 = t0 * t0 * (GX[gi0] * x0 + GY[gi0] * y0 + GZ[gi0] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0.0;
    else { t1 *= t1; n1 = t1 * t1 * (GX[gi1] * x1 + GY[gi1] * y1 + GZ[gi1] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0.0;
    else { t2 *= t2; n2 = t2 * t2 * (GX[gi2] * x2 + GY[gi2] * y2 + GZ[gi2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0.0;
    else { t3 *= t3; n3 = t3 * t3 * (GX[gi3] * x3 + GY[gi3] * y3 + GZ[gi3] * z3); }
    return 32.0 * (n0 + n1 + n2 + n3);
  }
}

/** org.bukkit.Location.hashCode() with the given world hash (0 for a null world). */
export function locationHashCode(x, y, z, pitch = 0, yaw = 0, worldHash = 0) {
  let hash = 3;
  hash = (Math.imul(19, hash) + (worldHash | 0)) | 0;
  hash = (Math.imul(19, hash) + doubleHash(x)) | 0;
  hash = (Math.imul(19, hash) + doubleHash(y)) | 0;
  hash = (Math.imul(19, hash) + doubleHash(z)) | 0;
  hash = (Math.imul(19, hash) + floatToIntBits(pitch)) | 0;
  hash = (Math.imul(19, hash) + floatToIntBits(yaw)) | 0;
  return hash;
}
