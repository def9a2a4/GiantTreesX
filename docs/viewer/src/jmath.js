// Java numeric semantics helpers.

/** Java (int) cast of a double: truncation toward zero, NaN -> 0, saturating. */
export function d2i(x) {
  if (x !== x) return 0;
  if (x >= 2147483647) return 2147483647;
  if (x <= -2147483648) return -2147483648;
  return Math.trunc(x) | 0;
}

/** Java Math.round(double) followed by (int) cast of the long result. */
export function roundToInt(x) {
  if (x !== x) return 0;
  // JS Math.round == Java Math.round (floor(x + 1/2) computed exactly) for finite values.
  const r = Math.round(x);
  if (r >= 9.223372036854776e18) return -1; // (int)Long.MAX_VALUE
  if (r <= -9.223372036854776e18) return 0;  // (int)Long.MIN_VALUE
  if (r >= -2147483648 && r <= 2147483647) return r | 0;
  return Number(BigInt.asIntN(32, BigInt(r)));
}

/** org.bukkit.util.NumberConversions.floor (used by Location/Vector getBlockX). */
export function blockFloor(x) {
  const i = d2i(x);
  if (i === x) return i;
  // i - (int)(doubleToRawLongBits(x) >>> 63)
  return (x < 0 || Object.is(x, -0) ? i - 1 : i) | 0;
}

/** Java int multiplication / addition with overflow. */
export const imul = Math.imul;
export function iadd(a, b) {
  return (a + b) | 0;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const f32 = new Float32Array(1);
const u32f = new Uint32Array(f32.buffer);

/** (int)(bits ^ (bits >>> 32)) for Double.doubleToLongBits(x). */
export function doubleHash(x) {
  if (x !== x) x = NaN; // canonical NaN
  f64[0] = x;
  let lo = u32[0], hi = u32[1];
  if (x !== x) { lo = 0; hi = 0x7ff80000; }
  return (lo ^ hi) | 0;
}

export function floatToIntBits(x) {
  f32[0] = x;
  if (f32[0] !== f32[0]) return 0x7fc00000;
  return u32f[0] | 0;
}
