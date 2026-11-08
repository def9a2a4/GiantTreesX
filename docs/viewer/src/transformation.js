// Port of net.sourceforge.arbaro.transformation.{Vector,Matrix,Transformation}.
// Arithmetic order is kept literally to reproduce Java's double results bit-for-bit.

export class Vector {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  abs() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  normalize() {
    const abs = this.abs();
    return new Vector(this.x / abs, this.y / abs, this.z / abs);
  }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
  mul(f) {
    return new Vector(this.x * f, this.y * f, this.z * f);
  }
  prod(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  div(f) {
    return this.mul(1 / f);
  }
  add(v) {
    return new Vector(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  sub(v) {
    return this.add(v.mul(-1));
  }
  static atan2(v, u) {
    if (u === 0) {
      if (v >= 0) return 90;
      return -90;
    }
    if (u > 0) return (Math.atan(v / u) * 180) / Math.PI;
    if (v >= 0) return 180 + (Math.atan(v / u) * 180) / Math.PI;
    return (Math.atan(v / u) * 180) / Math.PI - 180;
  }
}
Vector.Z_AXIS = new Vector(0, 0, 1);

export class Matrix {
  constructor(xx, xy, xz, yx, yy, yz, zx, zy, zz) {
    if (xx === undefined) {
      this.d = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    } else {
      this.d = [xx, xy, xz, yx, yy, yz, zx, zy, zz];
    }
  }
  col(c) {
    const d = this.d;
    return new Vector(d[c], d[3 + c], d[6 + c]);
  }
  prod(M) {
    // R[r][c] = row(r).prod(M.col(c))
    const a = this.d, b = M.d;
    const R = new Matrix();
    const r = R.d;
    for (let i = 0; i < 3; i++) {
      const a0 = a[i * 3], a1 = a[i * 3 + 1], a2 = a[i * 3 + 2];
      for (let c = 0; c < 3; c++) {
        r[i * 3 + c] = a0 * b[c] + a1 * b[3 + c] + a2 * b[6 + c];
      }
    }
    return R;
  }
  prodV(v) {
    const a = this.d;
    return new Vector(
      a[0] * v.x + a[1] * v.y + a[2] * v.z,
      a[3] * v.x + a[4] * v.y + a[5] * v.z,
      a[6] * v.x + a[7] * v.y + a[8] * v.z,
    );
  }
}

const DEG = Math.PI;

export class Transformation {
  constructor(m, v) {
    this.matrix = m || new Matrix();
    this.vector = v || new Vector();
  }
  apply(v) {
    return this.matrix.prodV(v).add(this.vector);
  }
  getX() { return this.matrix.col(0); }
  getY() { return this.matrix.col(1); }
  getZ() { return this.matrix.col(2); }
  getT() { return this.vector; }

  rotz(angle) {
    angle = (angle * DEG) / 180;
    const rm = new Matrix(Math.cos(angle), -Math.sin(angle), 0, Math.sin(angle), Math.cos(angle), 0, 0, 0, 1);
    return new Transformation(this.matrix.prod(rm), this.vector);
  }
  roty(angle) {
    angle = (angle * DEG) / 180;
    const rm = new Matrix(Math.cos(angle), 0, -Math.sin(angle), 0, 1, 0, Math.sin(angle), 0, Math.cos(angle));
    return new Transformation(this.matrix.prod(rm), this.vector);
  }
  rotx(angle) {
    angle = (angle * DEG) / 180;
    const rm = new Matrix(1, 0, 0, 0, Math.cos(angle), -Math.sin(angle), 0, Math.sin(angle), Math.cos(angle));
    return new Transformation(this.matrix.prod(rm), this.vector);
  }
  rotxz(delta, rho) {
    delta = (delta * DEG) / 180;
    rho = (rho * DEG) / 180;
    const sir = Math.sin(rho);
    const cor = Math.cos(rho);
    const sid = Math.sin(delta);
    const cod = Math.cos(delta);
    const rm = new Matrix(cor, -sir * cod, sir * sid, sir, cor * cod, -cor * sid, 0, sid, cod);
    return new Transformation(this.matrix.prod(rm), this.vector);
  }
  rotaxisz(delta, rho) {
    delta = (delta * DEG) / 180;
    rho = (rho * DEG) / 180;
    const a = Math.cos(rho);
    const b = Math.sin(rho);
    const si = Math.sin(delta);
    const co = Math.cos(delta);
    const rm = new Matrix(
      co + a * a * (1 - co), b * a * (1 - co), b * si,
      a * b * (1 - co), co + b * b * (1 - co), -a * si,
      -b * si, a * si, co,
    );
    return new Transformation(this.matrix.prod(rm), this.vector);
  }
  translate(v) {
    return new Transformation(this.matrix, this.vector.add(v));
  }
  rotaxis(angle, axis) {
    angle = (angle * DEG) / 180;
    axis = axis.normalize();
    const a = axis.x, b = axis.y, c = axis.z;
    const si = Math.sin(angle);
    const co = Math.cos(angle);
    const rm = new Matrix(
      co + a * a * (1 - co), -c * si + b * a * (1 - co), b * si + c * a * (1 - co),
      c * si + a * b * (1 - co), co + b * b * (1 - co), -a * si + c * b * (1 - co),
      -b * si + a * c * (1 - co), a * si + b * c * (1 - co), co + c * c * (1 - co),
    );
    return new Transformation(rm.prod(this.matrix), this.vector);
  }
}
