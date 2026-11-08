// Port of net.sourceforge.arbaro.tree.{Tree,Stem,Segment,Subsegment,Leaf} - generation only.
// Expression order follows the Java source literally so doubles match bit-for-bit.
import { Transformation, Vector } from './transformation.js';
import { Params } from './params.js';
import { d2i } from './jmath.js';

const MIN_STEM_LEN = 0.0005;
const MIN_STEM_RADIUS = MIN_STEM_LEN / 10;

export class Tree {
  /** @param {import('./params.js').ParamDB} db */
  constructor(db) {
    this.params = new Params(db);
    this.trunks = [];
    this.trunk_rotangle = 0;
  }

  make() {
    const params = this.params;
    params.prepare();
    const transf = new Transformation();
    const lpar = params.levelParams[0];
    for (let i = 0; i < lpar.nBranches; i++) {
      let trf = this.trunkDirection(transf, lpar);
      const angle = lpar.var(360);
      const dist = lpar.var(lpar.nBranchDist);
      trf = trf.translate(new Vector(dist * Math.sin(angle), dist * Math.cos(angle), 0));
      const trunk = new Stem(this, null, 0, trf, 0);
      this.trunks.push(trunk);
      trunk.index = 0;
      trunk.make();
    }
  }

  trunkDirection(trf, lpar) {
    let rotangle;
    if (lpar.nRotate >= 0) {
      this.trunk_rotangle = (this.trunk_rotangle + lpar.nRotate + lpar.var(lpar.nRotateV) + 360) % 360;
      rotangle = this.trunk_rotangle;
    } else {
      if (Math.abs(this.trunk_rotangle) !== 1) this.trunk_rotangle = 1;
      this.trunk_rotangle = -this.trunk_rotangle;
      rotangle = this.trunk_rotangle * (180 + lpar.nRotate + lpar.var(lpar.nRotateV));
    }
    const downangle = lpar.nDownAngle + lpar.var(lpar.nDownAngleV);
    return trf.rotxz(downangle, rotangle);
  }

  /** TreeTraversal: visitor with enterTree/enterStem/leaveStem/visitLeaf/leaveTree (all optional, default true). */
  traverseTree(t) {
    if (t.enterTree ? t.enterTree(this) : true) {
      for (const s of this.trunks) if (!s.traverseTree(t)) break;
    }
    return t.leaveTree ? t.leaveTree(this) : true;
  }
}

export class Stem {
  constructor(tree, growsOutOf, stlev, trf, offs) {
    this.tree = tree;
    this.stemlevel = stlev;
    this.transf = trf;
    this.offset = offs;
    this.parent = null;
    this.clonedFrom = null;
    if (growsOutOf != null) {
      if (growsOutOf.stemlevel < this.stemlevel) this.parent = growsOutOf;
      else {
        this.clonedFrom = growsOutOf;
        this.parent = growsOutOf.parent;
      }
    }
    const par = (this.par = tree.params);
    this.lpar = par.levelParams[Math.min(this.stemlevel, 3)];
    this.segments = [];
    this.clones = null;
    this.substems = null;
    this.leaves = null;
    if (this.lpar.nSegSplits > 0 || par._0BaseSplits > 0) this.clones = [];
    if (this.stemlevel < par.Levels - 1) this.substems = [];
    if (this.stemlevel === par.Levels - 1 && par.Leaves !== 0) this.leaves = [];
    this.length = 0;
    this.segmentLength = 0;
    this.segmentCount = 0;
    this.baseRadius = 0;
    this.lengthChildMax = 0;
    this.substemsPerSegment = 0;
    this.substemRotangle = 0;
    this.leavesPerSegment = 0;
    this.splitCorrection = 0;
    this.index = 0;
    this.cloneIndex = [];
    this.pruneTest = false;
  }

  clone(trf, start_segm) {
    const clone = new Stem(this.tree, this, this.stemlevel, trf, this.offset);
    clone.segmentLength = this.segmentLength;
    clone.segmentCount = this.segmentCount;
    clone.length = this.length;
    clone.baseRadius = this.baseRadius;
    clone.splitCorrection = this.splitCorrection;
    clone.pruneTest = this.pruneTest;
    clone.index = this.index;
    clone.cloneIndex.push(...this.cloneIndex);
    clone.cloneIndex.push(this.clones.length);
    if (!this.pruneTest) {
      clone.lengthChildMax = this.lengthChildMax;
      clone.substemsPerSegment = this.substemsPerSegment;
      clone.substemRotangle = this.substemRotangle + 180;
      clone.leavesPerSegment = this.leavesPerSegment;
    }
    return clone;
  }

  make() {
    const lpar = this.lpar, par = this.par;
    this.segmentCount = lpar.nCurveRes;
    this.length = this.stemLength();
    this.segmentLength = this.length / lpar.nCurveRes;
    this.baseRadius = this.stemBaseRadius();
    // (stemlevel==0 minMaxTest omitted: bounding box bookkeeping only)
    if (this.stemlevel > 0 && par.PruneRatio > 0) this.pruning();
    if (this.length > MIN_STEM_LEN && this.baseRadius > MIN_STEM_RADIUS) {
      this.prepareSubstemParams();
      this.makeSegments(0, this.segmentCount);
    }
  }

  pruning() {
    const lpar = this.lpar, par = this.par;
    lpar.saveState();
    const splitcorr = this.splitCorrection;
    const origlen = this.length;
    this.pruneTest = true;
    let segm = this.makeSegments(0, this.segmentCount);
    while (segm >= 0 && this.length > 0.001 * par.scale_tree) {
      lpar.restoreState();
      this.splitCorrection = splitcorr;
      if (this.clones != null) this.clones.length = 0;
      this.segments.length = 0;
      const minlen = this.length / 2;
      const maxlen = this.length - origlen / 15;
      this.length = Math.min(Math.max(this.segmentLength * segm, minlen), maxlen);
      this.segmentLength = this.length / lpar.nCurveRes;
      this.baseRadius = this.stemBaseRadius();
      if (this.length > MIN_STEM_LEN) segm = this.makeSegments(0, this.segmentCount);
    }
    this.length = origlen - (origlen - this.length) * par.PruneRatio;
    lpar.restoreState();
    this.splitCorrection = splitcorr;
    if (this.clones != null) this.clones.length = 0;
    this.segments.length = 0;
    this.pruneTest = false;
  }

  stemLength() {
    const lpar = this.lpar, par = this.par;
    if (this.stemlevel === 0) {
      return (lpar.nLength + lpar.var(lpar.nLengthV)) * par.scale_tree;
    } else if (this.stemlevel === 1) {
      const parlen = this.parent.length;
      const baselen = par.BaseSize * par.scale_tree;
      const ratio = (parlen - this.offset) / (parlen - baselen);
      return parlen * this.parent.lengthChildMax * par.getShapeRatio(ratio);
    } else {
      return this.parent.lengthChildMax * (this.parent.length - 0.6 * this.offset);
    }
  }

  makeSegments(start_seg, end_seg) {
    const lpar = this.lpar, par = this.par;
    let trf = this.transf;
    for (let s = start_seg; s < end_seg; s++) {
      trf = this.newDirection(trf, s);
      const rad1 = this.stemRadius(s * this.segmentLength);
      const rad2 = this.stemRadius((s + 1) * this.segmentLength);
      const segment = new Segment(this, s, trf, rad1, rad2);
      segment.make();
      this.segments.push(segment);
      if (!this.pruneTest && lpar.level < par.Levels - 1) this.makeSubstems(segment);
      if (!this.pruneTest && lpar.level === par.Levels - 1 && par.Leaves !== 0) this.makeLeaves(segment);
      trf = trf.translate(trf.getZ().mul(this.segmentLength));
      if (this.pruneTest && !this.isInsideEnvelope(trf.getT())) return s;
      if (s < end_seg - 1) {
        const segm = this.makeClones(trf, s);
        if (segm >= 0) return segm;
      }
    }
    return -1;
  }

  isInsideEnvelope(vector) {
    const par = this.par;
    const r = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
    const ratio = (par.scale_tree - vector.z) / (par.scale_tree * (1 - par.BaseSize));
    return r / par.scale_tree < par.PruneWidth * par.getShapeRatio(ratio, 8);
  }

  newDirection(trf, nsegm) {
    const lpar = this.lpar, par = this.par;
    if (nsegm === 0) return trf;
    let delta;
    if (lpar.nCurveBack === 0) {
      delta = lpar.nCurve / lpar.nCurveRes;
    } else {
      // (lpar.nCurveRes+1)/2 is Java int division
      if (nsegm < Math.trunc((lpar.nCurveRes + 1) / 2)) delta = (lpar.nCurve * 2) / lpar.nCurveRes;
      else delta = (lpar.nCurveBack * 2) / lpar.nCurveRes;
    }
    delta += this.splitCorrection;
    trf = trf.rotx(delta);
    if (lpar.nCurveV > 0) {
      delta = lpar.var(lpar.nCurveV) / lpar.nCurveRes;
      const rho = 180 + lpar.var(180);
      trf = trf.rotaxisz(delta, rho);
    }
    if (par.AttractionUp !== 0 && this.stemlevel >= 2) {
      const declination = Math.acos(trf.getZ().z);
      const curve_up = (par.AttractionUp * Math.abs(declination * Math.sin(declination))) / lpar.nCurveRes;
      const z = trf.getZ();
      trf = trf.rotaxis((-curve_up * 180) / Math.PI, new Vector(-z.y, z.x, 0));
    }
    return trf;
  }

  stemBaseRadius() {
    const par = this.par;
    if (this.stemlevel === 0) {
      return this.length * par.Ratio;
    } else {
      const max_radius = this.parent.stemRadius(this.offset);
      const radius = this.parent.baseRadius * Math.pow(this.length / this.parent.length, par.RatioPower);
      return Math.min(radius, max_radius);
    }
  }

  stemRadius(h) {
    const lpar = this.lpar, par = this.par;
    const angle = 0;
    const Z = Math.min(h / this.length, 1.0);
    const taper = lpar.nTaper;
    let unit_taper = 0;
    if (taper <= 1) unit_taper = taper;
    else if (taper <= 2) unit_taper = 2 - taper;
    let radius = this.baseRadius * (1 - unit_taper * Z);
    let depth;
    if (taper > 1) {
      const Z2 = (1 - Z) * this.length;
      if (taper < 2 || Z2 < radius) depth = 1;
      else depth = taper - 2;
      let Z3;
      if (taper < 2) Z3 = Z2;
      else Z3 = Math.abs(Z2 - 2 * radius * d2i(Z2 / 2 / radius + 0.5));
      if (taper > 2 || Z3 < radius) {
        radius = (1 - depth) * radius + depth * Math.sqrt(radius * radius - (Z3 - radius) * (Z3 - radius));
      }
    }
    if (this.stemlevel === 0) {
      if (par.Flare !== 0) {
        const y = Math.max(0, 1 - 8 * Z);
        const flare = 1 + (par.Flare * (Math.pow(100, y) - 1)) / 100.0;
        radius = radius * flare;
      }
      if (par.Lobes > 0 && angle !== 0) {
        radius = radius * (1.0 + par.LobeDepth * Math.sin((par.Lobes * angle * Math.PI) / 180));
      }
      radius = radius * par._0Scale;
    }
    return radius;
  }

  prepareSubstemParams() {
    const par = this.par, lpar = this.lpar;
    const lpar_1 = par.levelParams[Math.min(this.stemlevel + 1, 3)];
    this.lengthChildMax = lpar_1.nLength + lpar_1.var(lpar_1.nLengthV);
    const stems_max = lpar_1.nBranches;
    let substem_cnt;
    // (float)segmentCount is exact for any realistic int; float->double promotion keeps the value
    const segCountF = Math.fround(this.segmentCount);
    if (this.stemlevel === 0) {
      substem_cnt = stems_max;
      this.substemsPerSegment = substem_cnt / segCountF / (1 - par.BaseSize);
    } else if (par.preview) {
      substem_cnt = stems_max;
      this.substemsPerSegment = substem_cnt / segCountF;
    } else if (this.stemlevel === 1) {
      substem_cnt = d2i(stems_max * (0.2 + (0.8 * this.length) / this.parent.length / this.parent.lengthChildMax));
      this.substemsPerSegment = substem_cnt / segCountF;
    } else {
      substem_cnt = d2i(stems_max * (1.0 - (0.5 * this.offset) / this.parent.length));
      this.substemsPerSegment = substem_cnt / segCountF;
    }
    this.substemRotangle = 0;
    if (lpar.level === par.Levels - 1) {
      this.leavesPerSegment = this.leavesPerBranch() / this.segmentCount;
    }
  }

  leavesPerBranch() {
    const par = this.par;
    if (par.Leaves === 0) return 0;
    if (this.stemlevel === 0) return 0; // "WARNING: trunk cannot have leaves"
    return Math.abs(par.Leaves) * par.getShapeRatio(this.offset / this.parent.length, par.LeafDistrib) * par.LeafQuality;
  }

  makeSubstems(segment) {
    const par = this.par, lpar = this.lpar;
    const lpar_1 = par.levelParams[Math.min(this.stemlevel + 1, 3)];
    let subst_per_segm, offs;
    if (this.stemlevel > 0) {
      subst_per_segm = this.substemsPerSegment;
      if (segment.index === 0) offs = this.parent.stemRadius(this.offset) / this.segmentLength;
      else offs = 0;
    } else if (segment.index * this.segmentLength > par.BaseSize * this.length) {
      subst_per_segm = this.substemsPerSegment;
      offs = 0;
    } else if ((segment.index + 1) * this.segmentLength <= par.BaseSize * this.length) {
      return;
    } else {
      offs = (par.BaseSize * this.length - segment.index * this.segmentLength) / this.segmentLength;
      subst_per_segm = this.substemsPerSegment * (1 - offs);
    }
    const substems_eff = d2i(subst_per_segm + lpar.substemErrorValue + 0.5);
    lpar.substemErrorValue -= substems_eff - subst_per_segm;
    if (substems_eff <= 0) return;
    const dist = ((1.0 - offs) / substems_eff) * lpar_1.nBranchDist;
    const distv = dist * 0.25;
    for (let s = 0; s < substems_eff; s++) {
      let where = offs + dist / 2 + s * dist + lpar_1.var(distv);
      if (where > 1) where = 1 / where;
      const offset = (segment.index + where) * this.segmentLength;
      let trf = this.substemDirection(segment.transf, offset);
      trf = segment.substemPosition(trf, where);
      const substem = new Stem(this.tree, this, this.stemlevel + 1, trf, offset);
      substem.index = this.substems.length;
      substem.make();
      this.substems.push(substem);
    }
  }

  substemDirection(trf, offset) {
    const par = this.par;
    const lpar_1 = par.levelParams[Math.min(this.stemlevel + 1, 3)];
    let rotangle;
    if (lpar_1.nRotate >= 0) {
      this.substemRotangle = (this.substemRotangle + lpar_1.nRotate + lpar_1.var(lpar_1.nRotateV) + 360) % 360;
      rotangle = this.substemRotangle;
    } else {
      if (Math.abs(this.substemRotangle) !== 1) this.substemRotangle = 1;
      this.substemRotangle = -this.substemRotangle;
      rotangle = this.substemRotangle * (180 + lpar_1.nRotate + lpar_1.var(lpar_1.nRotateV));
    }
    let downangle;
    if (lpar_1.nDownAngleV >= 0) {
      downangle = lpar_1.nDownAngle + lpar_1.var(lpar_1.nDownAngleV);
    } else {
      const len = this.stemlevel === 0 ? this.length * (1 - par.BaseSize) : this.length;
      downangle = lpar_1.nDownAngle + lpar_1.nDownAngleV * (1 - 2 * par.getShapeRatio((this.length - offset) / len, 0));
    }
    return trf.rotxz(downangle, rotangle);
  }

  makeLeaves(segment) {
    const par = this.par, lpar = this.lpar;
    if (par.Leaves > 0) {
      const leaves_eff = d2i(this.leavesPerSegment + par.leavesErrorValue + 0.5);
      par.leavesErrorValue -= leaves_eff - this.leavesPerSegment;
      if (leaves_eff <= 0) return;
      let offs;
      if (segment.index === 0) offs = this.parent.stemRadius(this.offset) / this.segmentLength;
      else offs = 0;
      const dist = (1.0 - offs) / leaves_eff;
      for (let s = 0; s < leaves_eff; s++) {
        const where = offs + dist / 2 + s * dist + lpar.var(dist / 2);
        const loffs = (segment.index + where) * this.segmentLength;
        let trf = this.substemDirection(segment.transf, loffs);
        trf = trf.translate(segment.transf.getZ().mul(where * this.segmentLength));
        const leaf = new Leaf(par, trf);
        leaf.make();
        this.leaves.push(leaf);
      }
    } else if (par.Leaves < 0 && segment.index === this.segmentCount - 1) {
      const lpar_1 = par.levelParams[Math.min(this.stemlevel + 1, 3)];
      const cnt = d2i(this.leavesPerBranch() + 0.5);
      const trf = segment.transf.translate(segment.transf.getZ().mul(this.segmentLength));
      const distangle = lpar_1.nRotate / cnt;
      const varangle = lpar_1.nRotateV / cnt;
      const downangle = lpar_1.nDownAngle;
      const vardown = lpar_1.nDownAngleV;
      let offsetangle = 0;
      if (cnt % 2 === 1) {
        const leaf = new Leaf(par, trf);
        leaf.make();
        this.leaves.push(leaf);
        offsetangle = distangle;
      } else {
        offsetangle = distangle / 2;
      }
      const half = Math.trunc(cnt / 2);
      for (let s = 0; s < half; s++) {
        for (let rot = 1; rot >= -1; rot -= 2) {
          let transf1 = trf.roty(rot * (offsetangle + s * distangle + lpar_1.var(varangle)));
          transf1 = transf1.rotx(downangle + lpar_1.var(vardown));
          const leaf = new Leaf(par, transf1);
          leaf.make();
          this.leaves.push(leaf);
        }
      }
    }
  }

  makeClones(trf, nseg) {
    const par = this.par, lpar = this.lpar;
    let seg_splits_eff;
    if (this.stemlevel === 0 && nseg === 0 && par._0BaseSplits > 0) {
      seg_splits_eff = par._0BaseSplits;
    } else {
      const seg_splits = lpar.nSegSplits;
      seg_splits_eff = d2i(seg_splits + lpar.splitErrorValue + 0.5);
      lpar.splitErrorValue -= seg_splits_eff - seg_splits;
    }
    if (seg_splits_eff < 1) return -1;
    const s_angle = Math.trunc(360 / (seg_splits_eff + 1)); // Java int division
    for (let i = 0; i < seg_splits_eff; i++) {
      const clone = this.clone(trf, nseg + 1);
      clone.transf = clone.split(trf, s_angle * (1 + i), nseg, seg_splits_eff);
      const segm = clone.makeSegments(nseg + 1, clone.segmentCount);
      if (segm >= 0) return segm;
      this.clones.push(clone);
    }
    // Java: "trf = split(...)" only reassigns the local parameter - the caller's trf is unchanged,
    // but split() still consumes randoms and adjusts splitCorrection/substemsPerSegment.
    this.split(trf, 0, nseg, seg_splits_eff);
    return -1;
  }

  split(trf, s_angle, nseg, nsplits) {
    const par = this.par, lpar = this.lpar;
    const remaining_seg = this.segmentCount - nseg - 1;
    const declination = (Math.acos(trf.getZ().z) * 180) / Math.PI;
    const split_angle = Math.max(0, lpar.nSplitAngle + lpar.var(lpar.nSplitAngleV) - declination);
    trf = trf.rotx(split_angle);
    this.splitCorrection -= split_angle / remaining_seg;
    let split_diverge;
    if (s_angle > 0) {
      if (par._0BaseSplits > 0 && this.stemlevel === 0 && nseg === 0) {
        split_diverge = s_angle + lpar.var(lpar.nSplitAngleV);
      } else {
        split_diverge = 20 + 0.75 * (30 + Math.abs(declination - 90)) * Math.pow((lpar.var(1) + 1) / 2.0, 2);
        if (lpar.var(1) >= 0) split_diverge = -split_diverge;
      }
      trf = trf.rotaxis(split_diverge, Vector.Z_AXIS);
    } else split_diverge = 0;
    if (!this.pruneTest) {
      this.substemsPerSegment /= Math.fround(nsplits + 1);
    }
    return trf;
  }

  traverseTree(t) {
    if (t.enterStem ? t.enterStem(this) : true) {
      if (this.leaves != null) {
        for (const l of this.leaves) if (!(t.visitLeaf ? t.visitLeaf(l) : true)) break;
      }
      if (this.substems != null) {
        for (const s of this.substems) if (!s.traverseTree(t)) break;
      }
      if (this.clones != null) {
        for (const s of this.clones) if (!s.traverseTree(t)) break;
      }
    }
    return t.leaveStem ? t.leaveStem(this) : true;
  }

  /** StemTraversal over segments (enterStem/enterSegment/visitSubsegment/leaveSegment/leaveStem). */
  traverseStem(t) {
    if ((t.enterStem ? t.enterStem(this) : true) && this.segments != null) {
      for (const seg of this.segments) if (!seg.traverseStem(t)) break;
    }
    return t.leaveStem ? t.leaveStem(this) : true;
  }
}

export class Subsegment {
  constructor(p, r, h) {
    this.pos = p;
    this.rad = r;
    this.height = h;
  }
}

export class Segment {
  constructor(stm, inx, trf, r1, r2) {
    this.index = inx;
    this.transf = trf;
    this.rad1 = r1;
    this.rad2 = r2;
    this.stem = stm;
    this.par = stm.par;
    this.lpar = stm.lpar;
    this.length = stm.segmentLength;
    this.subsegments = [];
  }

  make() {
    const lpar = this.lpar, par = this.par;
    if (lpar.nCurveV < 0) this.makeHelix(10);
    else if (lpar.nTaper > 1 && lpar.nTaper <= 2 && this.isLastStemSegment()) this.makeSphericalEnd(10);
    else if (lpar.nTaper > 2) this.makeSubsegments(20);
    else if (lpar.level === 0 && par.Flare !== 0 && this.index === 0) this.makeFlare(10);
    else this.makeSubsegments(1);
    // (minMaxTest omitted)
  }

  makeSubsegments(cnt) {
    const dir = this.posTo().sub(this.posFrom());
    for (let i = 0; i < cnt + 1; i++) {
      const pos = (i * this.length) / cnt;
      const rad = this.stem.stemRadius(this.index * this.length + pos);
      this.subsegments.push(new Subsegment(this.posFrom().add(dir.mul(pos / this.length)), rad, pos));
    }
  }

  makeSphericalEnd(cnt) {
    const dir = this.posTo().sub(this.posFrom());
    for (let i = 0; i < cnt; i++) {
      const pos = this.length - this.length / Math.pow(2, i);
      const rad = this.stem.stemRadius(this.index * this.length + pos);
      this.subsegments.push(new Subsegment(this.posFrom().add(dir.mul(pos / this.length)), rad, pos));
    }
    this.subsegments.push(new Subsegment(this.posTo(), this.rad2, this.length));
  }

  makeFlare(cnt) {
    const dir = this.posTo().sub(this.posFrom());
    this.subsegments.push(new Subsegment(this.posFrom(), this.rad1, 0));
    for (let i = cnt - 1; i >= 0; i--) {
      const pos = this.length / Math.pow(2, i);
      const rad = this.stem.stemRadius(this.index * this.length + pos);
      this.subsegments.push(new Subsegment(this.posFrom().add(dir.mul(pos / this.length)), rad, pos));
    }
  }

  makeHelix(cnt) {
    const lpar = this.lpar;
    const angle = (Math.abs(lpar.nCurveV) / 180) * Math.PI;
    const rad = (Math.sqrt(1.0 / (Math.cos(angle) * Math.cos(angle)) - 1) * this.length) / Math.PI / 2.0;
    for (let i = 0; i < cnt + 1; i++) {
      const pos = new Vector(
        rad * Math.cos((2 * Math.PI * i) / cnt) - rad,
        rad * Math.sin((2 * Math.PI * i) / cnt),
        (i * this.length) / cnt,
      );
      const srad = this.stem.stemRadius(this.index * this.length + (i * this.length) / cnt);
      this.subsegments.push(new Subsegment(this.transf.apply(pos), srad, (i * this.length) / cnt));
    }
  }

  substemPosition(trf, where) {
    if (this.lpar.nCurveV >= 0) {
      return trf.translate(this.transf.getZ().mul(where * this.length));
    } else {
      const n = this.subsegments.length - 1;
      const i = d2i(where * n);
      const p1 = this.subsegments[i].pos;
      const p2 = this.subsegments[i + 1].pos;
      const pos = p1.add(p2.sub(p1).mul(where - Math.trunc(i / n))); // i/(size-1): Java int division
      return trf.translate(pos.sub(this.posFrom()));
    }
  }

  posFrom() {
    return this.transf.getT();
  }
  posTo() {
    return this.transf.getT().add(this.transf.getZ().mul(this.length));
  }
  isLastStemSegment() {
    return this.index === this.lpar.nCurveRes - 1;
  }

  traverseStem(t) {
    if (t.enterSegment ? t.enterSegment(this) : true) {
      for (const ss of this.subsegments) if (!(t.visitSubsegment ? t.visitSubsegment(ss) : true)) break;
    }
    return t.leaveSegment ? t.leaveSegment(this) : true;
  }
}

export class Leaf {
  constructor(params, trf) {
    this.par = params;
    this.transf = trf;
  }
  setLeafOrientation() {
    const par = this.par;
    if (par.LeafBend === 0) return;
    const pos = this.transf.getT();
    let norm = this.transf.getY();
    const tpos = Vector.atan2(pos.y, pos.x);
    const tbend = tpos - Vector.atan2(norm.y, norm.x);
    let bend_angle = par.LeafBend * tbend;
    this.transf = this.transf.rotaxis(bend_angle, Vector.Z_AXIS);
    norm = this.transf.getY();
    const fbend = Vector.atan2(Math.sqrt(norm.x * norm.x + norm.y * norm.y), norm.z);
    bend_angle = par.LeafBend * fbend;
    this.transf = this.transf.rotx(bend_angle);
  }
  make() {
    this.setLeafOrientation();
  }
}
