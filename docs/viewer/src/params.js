// Port of net.sourceforge.arbaro.params.{Params,LevelParams} (generation-relevant parts)
// plus a tiny XML reader/writer for Arbaro param files.
import { PARAM_DEFS, ENUMS } from './param-defs.js';
import { JavaRandom } from './jrandom.js';

export { PARAM_DEFS, ENUMS };
export const PARAM_BY_NAME = new Map(PARAM_DEFS.map((d) => [d.name, d]));

export const CONICAL = 0, SPHERICAL = 1, HEMISPHERICAL = 2, CYLINDRICAL = 3, TAPERED_CYLINDRICAL = 4,
  FLAME = 5, INVERSE_CONICAL = 6, TEND_FLAME = 7, ENVELOPE = 8;

export class ParamError extends Error {}

/** Java Double.parseDouble (decimal subset). */
export function parseJavaDouble(s) {
  const t = String(s).trim();
  const m = /^([+-]?(?:NaN|Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))[fFdD]?$/.exec(t);
  if (!m) return null;
  return Number(m[1]);
}
/** Java Integer.parseInt. */
export function parseJavaInt(s) {
  const t = String(s);
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  if (n < -2147483648 || n > 2147483647) return null;
  return n;
}

/** Validate a raw string value for a param exactly like AbstractParam.setValue. Returns parsed value or throws. */
export function validateParam(name, value) {
  const def = PARAM_BY_NAME.get(name);
  if (!def) throw new ParamError(`Unknown parameter ${name}!`);
  if (def.type === 'string') return String(value);
  if (def.type === 'float') {
    const d = parseJavaDouble(value);
    if (d === null) throw new ParamError(`Error setting value of ${name}. "${value}" isn't a valid number.`);
    if (d < def.min) throw new ParamError(`Value of ${name} should be greater then or equal to ${def.min}`);
    if (d > def.max) throw new ParamError(`Value of ${name} should be less then or equal to ${def.max}`);
    return d;
  }
  const i = parseJavaInt(value);
  if (i === null) throw new ParamError(`Error setting value of ${name}. "${value}" isn't a valid integer.`);
  if (i < def.min) throw new ParamError(`Value of ${name} should be greater or equal to ${def.min}`);
  if (i > def.max) throw new ParamError(`Value of ${name} should be greater or equal to ${def.max}`);
  return i;
}

function decodeEntities(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e) => {
    switch (e) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

/**
 * Parse an Arbaro XML param file into an ordered list of [name, value] string pairs
 * (the "Species" entry comes from <species name=...>). Order is document order.
 */
export function parseParamXml(xml) {
  const s = String(xml).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const out = [];
  const tagRe = /<\s*(species|param)\b([^>]*?)\/?>/g;
  let m;
  while ((m = tagRe.exec(s))) {
    const attrs = {};
    const attrRe = /([A-Za-z_:][-\w:.]*)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
    let a;
    while ((a = attrRe.exec(m[2]))) attrs[a[1]] = decodeEntities(a[2] !== undefined ? a[2] : a[3]);
    if (m[1] === 'species') out.push(['Species', attrs.name ?? null]);
    else out.push([attrs.name ?? null, attrs.value ?? null]);
  }
  if (!/<\s*arbaro\b/.test(s)) throw new ParamError('Not an Arbaro XML file (no <arbaro> element).');
  return out;
}

/** Holds raw param values like Arbaro's paramDB (unset params -> defaults on read). */
export class ParamDB {
  constructor() {
    this.values = new Map(); // name -> parsed value
  }
  set(name, value) {
    this.values.set(name, validateParam(name, value));
  }
  has(name) {
    return this.values.has(name);
  }
  get(name) {
    if (this.values.has(name)) return this.values.get(name);
    const def = PARAM_BY_NAME.get(name);
    if (!def) throw new ParamError(`bug: param ${name} not found!`);
    return def.deflt;
  }
  clone() {
    const c = new ParamDB();
    c.values = new Map(this.values);
    return c;
  }
  /** Load from XML; collects errors like XMLTreeFileHandler and throws at the end. */
  static fromXml(xml) {
    const db = new ParamDB();
    let errors = '';
    for (const [name, value] of parseParamXml(xml)) {
      try {
        if (name === null) throw new ParamError('Unknown parameter null!');
        // StringParam.setValue(null) would NPE later; treat as error
        if (value === null) throw new ParamError(`Error setting value of ${name}. "null" isn't a valid value.`);
        db.set(name, value);
      } catch (e) {
        errors += e.message + '\n';
      }
    }
    if (errors) throw new ParamError(errors);
    return db;
  }
}

export class LevelParams {
  constructor(l, db) {
    this.level = l;
    this.db = db;
    this.nTaper = 0; this.nCurveRes = 0; this.nCurve = 0; this.nCurveV = 0; this.nCurveBack = 0;
    this.nLength = 0; this.nLengthV = 0; this.nSegSplits = 0; this.nSplitAngle = 0; this.nSplitAngleV = 0;
    this.nBranches = 0; this.nBranchDist = 0; this.nDownAngle = 0; this.nDownAngleV = 0;
    this.nRotate = 0; this.nRotateV = 0; this.mesh_points = 0;
    this.splitErrorValue = 0;
    this.substemErrorValue = 0;
    this.random = null;
    this.randstate = null;
    this.spliterrval = NaN;
  }
  initRandom(seed) {
    this.random = new JavaRandom(seed);
    return this.random.nextLong();
  }
  var(variation) {
    return this.random.uniform(-variation, variation);
  }
  saveState() {
    this.randstate = this.random.getState();
    this.spliterrval = this.splitErrorValue;
  }
  restoreState() {
    if (Number.isNaN(this.spliterrval)) throw new Error('BUG: there is no state saved, cannot restore.');
    this.random.setState(this.randstate);
    this.splitErrorValue = this.spliterrval;
  }
  p(name) {
    return this.db.get('' + this.level + name.substring(1));
  }
  fromDB(leafLevelOnly) {
    if (!leafLevelOnly) {
      this.nTaper = this.p('nTaper');
      this.nCurveRes = this.p('nCurveRes');
      this.nCurve = this.p('nCurve');
      this.nCurveV = this.p('nCurveV');
      this.nCurveBack = this.p('nCurveBack');
      this.nLength = this.p('nLength');
      this.nLengthV = this.p('nLengthV');
      this.nSegSplits = this.p('nSegSplits');
      this.nSplitAngle = this.p('nSplitAngle');
      this.nSplitAngleV = this.p('nSplitAngleV');
      this.nBranches = this.p('nBranches');
    }
    this.nBranchDist = this.p('nBranchDist');
    this.nDownAngle = this.p('nDownAngle');
    this.nDownAngleV = this.p('nDownAngleV');
    this.nRotate = this.p('nRotate');
    this.nRotateV = this.p('nRotateV');
  }
}

export class Params {
  /** @param {ParamDB} db */
  constructor(db) {
    this.db = db || new ParamDB();
    this.leavesErrorValue = 0;
    this.levelParams = [0, 1, 2, 3].map((l) => new LevelParams(l, this.db));
    this.random = null;
    this.debug = false;
    this.verbose = false;
    this.preview = false;
    this.ignoreVParams = false;
    this.stopLevel = -1;
    this.Species = 'default';
    this.WoodType = 'Oak';
    this.LeafQuality = 1;
    this.Smooth = 0.5;
    this.Seed = 13;
    this.Levels = 0; this.Ratio = 0; this.RatioPower = 0; this.Shape = 0; this.BaseSize = 0; this.Flare = 0;
    this.Lobes = 0; this.LobeDepth = 0; this.Leaves = 0; this.LeafShape = ''; this.LeafScale = 0; this.LeafScaleX = 0;
    this.LeafStemLen = 0; this.LeafBend = 0; this.LeafDistrib = 0; this.Scale = 0; this.ScaleV = 0;
    this._0Scale = 0; this._0ScaleV = 0; this.AttractionUp = 0; this.PruneRatio = 0; this.PrunePowerLow = 0;
    this.PrunePowerHigh = 0; this.PruneWidth = 0; this.PruneWidthPeak = 0; this._0BaseSplits = 0;
    this.scale_tree = 0;
    this.smooth_mesh_level = 0;
    this.mesh_quality = 0;
  }

  fromDB() {
    const g = (n) => this.db.get(n);
    this.LeafQuality = g('LeafQuality');
    this.Smooth = g('Smooth');
    this.Levels = g('Levels');
    this.Ratio = g('Ratio');
    this.RatioPower = g('RatioPower');
    this.Shape = g('Shape');
    this.BaseSize = g('BaseSize');
    this.Flare = g('Flare');
    this.Lobes = g('Lobes');
    this.LobeDepth = g('LobeDepth');
    this.Leaves = this.Leaves !== -1 ? g('Leaves') : 0; // GiantTrees: -1 turns leaves off (roots)
    this.LeafShape = g('LeafShape');
    this.LeafScale = g('LeafScale');
    this.LeafScaleX = g('LeafScaleX');
    this.LeafStemLen = g('LeafStemLen');
    this.LeafDistrib = g('LeafDistrib');
    this.LeafBend = g('LeafBend');
    this.Scale = g('Scale');
    this.ScaleV = g('ScaleV');
    this._0Scale = g('0Scale');
    this._0ScaleV = g('0ScaleV');
    this.AttractionUp = g('AttractionUp');
    this.PruneRatio = g('PruneRatio');
    this.PrunePowerLow = g('PrunePowerLow');
    this.PrunePowerHigh = g('PrunePowerHigh');
    this.PruneWidth = g('PruneWidth');
    this.PruneWidthPeak = g('PruneWidthPeak');
    this._0BaseSplits = g('0BaseSplits');
    this.Species = g('Species');
    this.WoodType = g('WoodType');
    for (let i = 0; i <= Math.min(this.Levels, 3); i++) {
      this.levelParams[i].fromDB(i === this.Levels);
    }
  }

  prepare() {
    if (this.debug) this.verbose = false;
    this.fromDB();
    if (this.ignoreVParams) {
      this.ScaleV = 0;
      for (let i = 1; i < 4; i++) {
        const lp = this.levelParams[i];
        lp.nCurveV = 0; lp.nLengthV = 0; lp.nSplitAngleV = 0; lp.nRotateV = 0;
        if (lp.nDownAngle > 0) lp.nDownAngle = 0;
      }
    }
    for (let l = 0; l < Math.min(this.Levels, 4); l++) {
      const lp = this.levelParams[l];
      if (lp.nSegSplits > 0 && lp.nSplitAngle === 0) throw new ParamError('nSplitAngle may not be 0.');
    }
    let l = this.levelParams[0].initRandom(this.Seed);
    for (let i = 1; i < 4; i++) l = this.levelParams[i].initRandom(l);
    this.random = new JavaRandom(this.Seed);
    // mesh settings (unused for CONES, kept for completeness)
    this.smooth_mesh_level = this.Smooth <= 0.2 ? -1 : Math.trunc(this.Levels * this.Smooth);
    this.mesh_quality = this.Smooth;
    if (this.stopLevel >= 0 && this.stopLevel <= this.Levels) {
      this.Levels = this.stopLevel;
      this.Leaves = 0;
    }
    if (this.scale_tree === 0) {
      this.scale_tree = this.Scale + this.levelParams[0].random.uniform(-this.ScaleV, this.ScaleV);
    }
  }

  getShapeRatio(ratio, shape = this.Shape) {
    switch (shape) {
      case CONICAL: return ratio;
      case SPHERICAL: return 0.2 + 0.8 * Math.sin(Math.PI * ratio);
      case HEMISPHERICAL: return 0.2 + 0.8 * Math.sin(0.5 * Math.PI * ratio);
      case CYLINDRICAL: return 1.0;
      case TAPERED_CYLINDRICAL: return 0.5 + 0.5 * ratio;
      case FLAME: return ratio <= 0.7 ? ratio / 0.7 : (1 - ratio) / 0.3;
      case INVERSE_CONICAL: return 1 - 0.8 * ratio;
      case TEND_FLAME: return ratio <= 0.7 ? 0.5 + (0.5 * ratio) / 0.7 : 0.5 + (0.5 * (1 - ratio)) / 0.3;
      case ENVELOPE:
        if (ratio < 0 || ratio > 1) return 0;
        else if (ratio < 1 - this.PruneWidthPeak) return Math.pow(ratio / (1 - this.PruneWidthPeak), this.PrunePowerHigh);
        else return Math.pow((1 - ratio) / (1 - this.PruneWidthPeak), this.PrunePowerLow);
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// XML writer: same layout as the bundled files (Params.toXML order).

const GENERAL_ORDER = ['WoodType', 'Shape', 'Levels', 'Scale', 'ScaleV', 'BaseSize', 'Ratio', 'RatioPower', 'Flare',
  'Lobes', 'LobeDepth', 'Smooth', 'Leaves', 'LeafShape', 'LeafScale', 'LeafScaleX', 'LeafQuality', 'LeafStemLen',
  'LeafDistrib', 'LeafBend', 'AttractionUp', 'PruneRatio', 'PrunePowerLow', 'PrunePowerHigh', 'PruneWidth',
  'PruneWidthPeak', '0Scale', '0ScaleV', '0BaseSplits'];
const LEVEL_ORDER = ['nDownAngle', 'nDownAngleV', 'nRotate', 'nRotateV', 'nBranches', 'nBranchDist', 'nLength',
  'nLengthV', 'nTaper', 'nSegSplits', 'nSplitAngle', 'nSplitAngleV', 'nCurveRes', 'nCurve', 'nCurveBack', 'nCurveV'];

/** Java Double.toString-ish formatting for typical param values. */
export function javaDoubleString(d) {
  if (Number.isNaN(d)) return 'NaN';
  if (d === Infinity) return 'Infinity';
  if (d === -Infinity) return '-Infinity';
  const a = Math.abs(d);
  if (a !== 0 && (a < 1e-3 || a >= 1e7)) {
    // Java uses computerized scientific notation: 1.0E-4
    let [mant, exp] = d.toExponential().split('e');
    if (!mant.includes('.')) mant += '.0';
    return `${mant}E${Number(exp)}`;
  }
  const s = String(d);
  return s.includes('.') ? s : s + '.0';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;');
}

/** Serialize a ParamDB in the bundled-file layout. `header` is an optional comment block (e.g. license). */
export function paramDbToXml(db, header = '') {
  const fmt = (name) => {
    const def = PARAM_BY_NAME.get(name);
    const v = db.get(name);
    return def.type === 'float' ? javaDoubleString(v) : String(v);
  };
  const lines = [];
  lines.push("<?xml version='1.0' ?>");
  if (header) lines.push(header.trimEnd());
  lines.push('<arbaro>');
  lines.push(`  <species name='${esc(db.get('Species'))}'>`);
  lines.push('    <!-- general params -->');
  for (const n of GENERAL_ORDER) lines.push(`    <param name='${n}' value='${esc(fmt(n))}' />`);
  const levels = db.get('Levels');
  for (let i = 0; i <= Math.min(levels, 3); i++) {
    lines.push(`    <!-- level ${i} -->`);
    const leafOnly = i === levels;
    for (const base of LEVEL_ORDER) {
      if (leafOnly && !['nDownAngle', 'nDownAngleV', 'nRotate', 'nRotateV'].includes(base)) continue;
      const n = '' + i + base.substring(1);
      lines.push(`    <param name='${n}' value='${esc(fmt(n))}' />`);
    }
  }
  lines.push('  </species>');
  lines.push('</arbaro>');
  return lines.join('\n') + '\n';
}

/** Extract the leading comment block (license header) of an XML file, if any. */
export function xmlHeaderComment(xml) {
  const m = /^\s*(?:<\?[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->)/.exec(xml);
  return m ? m[1] : '';
}
