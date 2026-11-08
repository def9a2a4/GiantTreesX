// Exact port of java.util.Random (48-bit LCG) using split 24-bit arithmetic.
// Arbaro's params/Random (uniform/getState/setState) is folded in as well.

const TWO24 = 16777216;
const MASK24 = 0xffffff;
const M_HI = 0x5de;       // 0x5DEECE66D = 0x5DE * 2^24 + 0xECE66D
const M_LO = 0xece66d;
const DOUBLE_UNIT = 1 / 9007199254740992; // 0x1.0p-53
const MASK48 = (1n << 48n) - 1n;
const MULT = 0x5deece66dn;

export class JavaRandom {
  /** @param {number|bigint} seed  Java long seed (number must be an exact integer). */
  constructor(seed = 0) {
    this.hi = 0;
    this.lo = 0;
    this.setSeed(seed);
  }

  setSeed(seed) {
    const s = (BigInt.asUintN(64, BigInt(seed)) ^ MULT) & MASK48;
    this.hi = Number(s >> 24n);
    this.lo = Number(s & 0xffffffn);
  }

  /** Raw 48-bit state as BigInt (for debugging / tests). */
  get state() {
    return (BigInt(this.hi) << 24n) | BigInt(this.lo);
  }

  next(bits) {
    const p = this.lo * M_LO + 0xb;
    const newLo = p % TWO24;
    const carry = Math.floor(p / TWO24);
    const newHi = (this.hi * M_LO + this.lo * M_HI + carry) % TWO24;
    this.hi = newHi;
    this.lo = newLo;
    // (int)(seed >>> (48 - bits))
    if (bits <= 24) {
      return (newHi >>> (24 - bits)) | 0;
    }
    // bits in (24, 32]: combine hi with top (bits-24) bits of lo
    const loBits = bits - 24;
    const v = newHi * (1 << loBits) + (newLo >>> (24 - loBits));
    return v | 0; // to signed 32-bit int
  }

  nextInt(bound) {
    if (bound === undefined) return this.next(32);
    if (bound <= 0) throw new Error('bound must be positive');
    let r = this.next(31);
    const m = bound - 1;
    if ((bound & m) === 0) {
      // power of two: (int)((bound * (long)r) >> 31)
      return Math.floor((bound * r) / 2147483648) | 0;
    }
    for (let u = r; u - (r = u % bound) + m > 2147483647 || u - r + m < 0; u = this.next(31)) {
      // Java: for (int u = r; u - (r = u % bound) + m < 0; u = next(31));  (int overflow check)
    }
    return r;
  }

  /** Java nextLong() as BigInt (signed 64-bit). */
  nextLong() {
    const a = BigInt(this.next(32));
    const b = BigInt(this.next(32));
    return BigInt.asIntN(64, (a << 32n) + b);
  }

  nextDouble() {
    const a = this.next(26);
    const b = this.next(27);
    return (a * 134217728 + b) * DOUBLE_UNIT;
  }

  nextBoolean() {
    return this.next(1) !== 0;
  }

  // ---- Arbaro params/Random extensions ----
  uniform(low, high) {
    return low + this.nextDouble() * (high - low);
  }

  getState() {
    const state = this.nextLong();
    this.setSeed(state);
    return state;
  }

  setState(state) {
    this.setSeed(state);
  }
}
