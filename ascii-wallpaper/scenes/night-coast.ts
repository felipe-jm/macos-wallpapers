/*
 * night coast: a lighthouse on a wooded headland under moonlit clouds. The
 * beam turns every eight seconds, the clouds drift, and the sea carries the
 * moon's road and the lamp's reflection.
 *
 * Each frame is shaded in colour cell by cell on a square grid, then drawn as
 * a halftone: every cell is a dot whose size is its brightness, in its own colour.
 *
 * The moon stands in the sky we look into, so the headland, the trees and the
 * tower are lit from behind: dark faces, cool rims where they meet the sky,
 * and the warm light of the lamp and the cottage windows close by. The sea is
 * a field of small waves seen in perspective: each cell reflects the scene
 * above it through its own wave slope (more mirror-like toward the horizon),
 * and glints where a facet happens to tilt the moon or the lamp toward us.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "night coast",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#080b12",
} satisfies Meta;

// The scene is designed on a 200-cell-wide grid and sampled at S output cells
// per design cell; Y0 design rows of sky are added above, the rest of the 16:9
// frame becomes more sea below.
const W = 320, H = 180;
const S = W / 200;
const Y0 = 8;
const YB = H / S - Y0; // the bottom edge, in design rows
const HORIZON = 60;
const MOON = [150, 19];
const LAMP_X = 30;

// The camera: one design cell spans RAD radians, the view centred on column
// CX, the eye one unit above the sea.
const RAD = (0.4 * Math.PI) / 180;
const CX = 100;

const AIR = 0, LAND = 1, TREE = 2, TOWER = 3, LANTERN = 4, CAP = 5, WALL = 6, PANE = 7, ROOF = 8, ISLE = 9;

// Light, in linear-ish units: cool moonlight (as the night eye sees it), the
// dim blue of the open sky, the warm white lamp, the orange of a lit room.
const MOONLIGHT = [0.6, 0.66, 0.8];
const SKYLIGHT = [0.13, 0.14, 0.165];
const LAMP = [1, 0.86, 0.64];
const HEARTH = [1, 0.6, 0.28];
const ZENITH = [0.014, 0.024, 0.062];
const LOW_SKY = [0.11, 0.13, 0.18];
const DEEP = [0.01, 0.018, 0.028];

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise, wrapping every `period` lattice cells in x when period > 0.
function noise(x: number, y: number, period: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  let x0 = xi, x1 = xi + 1;
  if (period) {
    x0 = ((xi % period) + period) % period;
    x1 = (x0 + 1) % period;
  }
  const a = hash(x0, yi), b = hash(x1, yi), c = hash(x0, yi + 1), d = hash(x1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number, period: number): number {
  let s = 0, n = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    s += amp * noise(x * f, y * f, period * f);
    n += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / n;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const k = clamp((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

// The waves: sine trains running in toward the shore, from ripples to swell.
// Each has a direction, wavenumber, slope amplitude, deep-water speed and phase.
const NW = 9;
const WDX = new Float64Array(NW), WDZ = new Float64Array(NW), WK = new Float64Array(NW);
const WSL = new Float64Array(NW), WOM = new Float64Array(NW), WPH = new Float64Array(NW);
for (let i = 0; i < NW; i++) {
  const th = (hash(i, 71) - 0.5) * 2.1;
  const lambda = 0.16 * Math.pow(1.6, i);
  WDX[i] = Math.sin(th);
  WDZ[i] = Math.cos(th);
  WK[i] = (2 * Math.PI) / lambda;
  WSL[i] = (0.065 - 0.004 * i) * (0.8 + 0.4 * hash(i, 72));
  WOM[i] = Math.sqrt(0.98 * WK[i]);
  WPH[i] = hash(i, 73) * 6.283;
}

export default function nightCoast(): Frame {
  const N = W * H;

  // --- the land, built once -----------------------------------------------
  const top = (x: number) => HORIZON - 15 * smooth(86, 50, x) * (1 - 0.12 * smooth(24, 0, x)) - 1.6 * fbm(x * 0.15, 3.7, 3, 0);
  // design coordinates of an output cell: x is the cell's left edge (as on the
  // original integer grid), y its centre
  const DX = new Float32Array(W), DY = new Float32Array(H);
  for (let o = 0; o < W; o++) DX[o] = (o + 0.5) / S - 0.5;
  for (let o = 0; o < H; o++) DY[o] = (o + 0.5) / S - Y0;
  const SKY_ROWS = Math.ceil((HORIZON + Y0) * S);
  const mat = new Uint8Array(N);
  const shade = new Float32Array(N);
  const aux = new Float32Array(N);
  const base = top(LAMP_X);
  const towerTop = base - 15;
  const lampY = towerTop - 4;
  // conifers: [x, height, half-width, tone, tiers of branches]
  const trees: [number, number, number, number, number][] = [];
  for (let x = 1; x < 76; x += 2.6 + hash(x * 7, 1) * 2.6) {
    if (x > 22 && x < 49) continue; // the clearing for the tower and the cottage
    const th = (4 + hash(x, 3) * 7) * smooth(78, 56, x);
    trees.push([x + hash(x, 2) * 1.2, th, 2 + hash(x, 4) * 1.6, 0.75 + 0.5 * hash(x, 6), 2 + Math.floor(th / 2.6)]);
  }
  const cottage = top(41);
  for (let r = 0; r < H; r++) {
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox;
      const x = DX[ox], y = DY[r];
      const t0 = top(x);
      const isle = HORIZON - 4.5 * Math.max(0, 1 - ((x - 180) / 26) ** 2) - 1.4 * fbm(x * 0.2, 9, 2, 0);
      if (y >= t0 && y < HORIZON + 4 && x < 90) {
        mat[k] = LAND;
      } else if (x > 148 && y >= isle && y < HORIZON) {
        mat[k] = ISLE;
      }
      for (let i = 0; i < trees.length; i++) {
        const [tx, th, tw, tone, tiers] = trees[i];
        if (th < 1) continue;
        const tb = top(tx);
        const dy = y - (tb - th);
        if (dy < 0 || y >= tb + 2) continue;
        // branches flare at the foot of each tier, the outline ragged with needles
        const f = ((dy * tiers) / th) % 1;
        const hw = (dy / th) * tw * (0.72 + 0.45 * f) + 0.3 + (hash(ox * 7 + i, r * 13) - 0.5) * 0.5;
        if (Math.abs(x + 0.5 - tx) <= hw) {
          mat[k] = TREE;
          shade[k] = tone * (0.6 + 0.8 * hash(ox * 13 + r, 5));
          aux[k] = x + 0.5 - tx;
        }
      }
      // the tower: tapered, white, rounded
      const dx = x + 0.5 - LAMP_X;
      if (y >= towerTop && y < base + 2) {
        const hw = 3 - 1.1 * smooth(base, towerTop, y);
        if (Math.abs(dx) <= hw) {
          mat[k] = TOWER;
          shade[k] = dx / hw;
          // a small stair window, faintly lit
          if (y >= towerTop + 5 && y < towerTop + 6.8 && Math.abs(dx + 0.3) < 0.45) (mat[k] = PANE), (shade[k] = 0.3);
        }
      }
      if (y >= towerTop - 1 && y < towerTop + 1 && Math.abs(dx) <= 3.6) (mat[k] = CAP), (shade[k] = dx / 3.6);
      if (y >= towerTop - 7 && y < towerTop - 1 && Math.abs(dx) <= 2) (mat[k] = LANTERN), (shade[k] = dx);
      if (y >= towerTop - 10 && y < towerTop - 7 && Math.abs(dx) <= 2.8 - (towerTop - 7 - y) * 0.8) (mat[k] = CAP), (shade[k] = dx / 2.8);
      // the keeper's cottage, lit inside
      if (x >= 36 && x < 48 && y >= cottage - 5 && y < cottage + 1) {
        mat[k] = WALL;
        if ((Math.abs(x - 39) < 0.65 || Math.abs(x - 44) < 0.65) && y >= cottage - 4 && y < cottage - 1.5) {
          mat[k] = PANE;
          shade[k] = x < 41 ? 1 : 0.82;
        }
      }
      if (y >= cottage - 10 && y < cottage - 5 && Math.abs(x + 0.5 - 42) <= 7.5 - (cottage - 5 - y) * 1.2) mat[k] = ROOF;
    }
  }

  // --- surfaces, lit once: sky, moon and windows; the lamp's share apart ----
  const isSky = (o: number, rr: number) => (o >= 0 && o < W && rr >= 0 && rr < H && DY[rr] < HORIZON && mat[rr * W + o] === AIR ? 1 : 0);
  const sR = new Float32Array(N), sG = new Float32Array(N), sB = new Float32Array(N);
  const lR = new Float32Array(N), lG = new Float32Array(N), lB = new Float32Array(N);
  const lampF = new Float32Array(N); // how near the lamp, for surfaces and foam
  const lampD = new Float32Array(N); // distance from the lamp, for its glow
  const grain = new Float32Array(N);
  const firstSea = new Int32Array(W).fill(H);
  const shoreY = new Float32Array(W); // the line the near shore reflects about
  for (let ox = 0; ox < W; ox++) shoreY[ox] = HORIZON + 4 * smooth(95, 85, DX[ox]);
  for (let r = 0; r < H; r++) {
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox;
      const x = DX[ox], y = DY[r];
      const m = mat[k];
      const ldx = x + 0.5 - LAMP_X, ldy = y - lampY;
      lampD[k] = Math.sqrt(ldx * ldx + ldy * ldy);
      lampF[k] = Math.exp(-lampD[k] / 9);
      grain[k] = 1 + 0.08 * (hash(ox * 3 + 1, r * 5 + 2) - 0.5);
      if (y >= HORIZON && (m === AIR || m === LAND) && firstSea[ox] === H && !(m === LAND && y < HORIZON + 4)) firstSea[ox] = r;
      // a rim of moonlight where an edge faces the sky toward the moon
      const rim = Math.min(1, 0.5 * isSky(ox + 1, r - 1) + 0.3 * isSky(ox + 1, r) + 0.4 * isSky(ox, r - 1) + 0.3 * isSky(ox + 2, r - 2) + 0.15 * isSky(ox + 2, r - 1));
      let ar = 0, ag = 0, ab = 0; // albedo
      let ir = 0, ig = 0, ib = 0; // light falling on it
      let lw = 0; // its share of lamplight
      let sheen = 0; // moonlight glancing off an edge, its colour more the moon's than the surface's
      if (m === LAND) {
        const t0 = top(x), depth = y - t0;
        const slope = clamp((top(x + 0.6) - top(x - 0.6)) * 1.2);
        const n1 = fbm(x * 0.3, y * 0.5, 4, 0), n2 = fbm(x * 1.2 + 7.3, y * 1.8 + 1.1, 2, 0);
        // scrub on the brow, bare banded rock down the face, wet and dark at the water
        const grass = smooth(0.42, 0.62, n1 + 0.28 * smooth(6, 0, depth) - 0.35 * smooth(HORIZON - 4, HORIZON + 2, y));
        const strata = 0.85 + 0.15 * Math.sin(y * 2.3 + n1 * 7);
        const tex = 0.5 + 1.0 * n2;
        const wet = 1 - 0.6 * smooth(HORIZON + 1.2, HORIZON + 3.8, y);
        ar = mix(0.4 * strata, 0.2, grass) * tex * wet;
        ag = mix(0.4 * strata, 0.22, grass) * tex * wet;
        ab = mix(0.41 * strata, 0.18, grass) * tex * wet;
        const brow = smooth(2.4, 0, depth);
        const moonF = brow * (0.3 + 0.7 * slope) + 0.35 * slope * smooth(12, 0, depth);
        sheen = rim * 0.08;
        const amb = (0.45 + 0.55 * smooth(8, 0, depth)) * 3.6;
        ir = SKYLIGHT[0] * amb + MOONLIGHT[0] * moonF;
        ig = SKYLIGHT[1] * amb + MOONLIGHT[1] * moonF;
        ib = SKYLIGHT[2] * amb + MOONLIGHT[2] * moonF;
        // window light thrown on the ground before the cottage
        if (y > cottage - 1 && x > 33 && x < 50) {
          const sp = (Math.exp(-Math.abs(x - 39) / 2) + 0.8 * Math.exp(-Math.abs(x - 44) / 2)) * Math.exp(-(y - cottage + 1) / 1.6) * 0.5;
          ir += HEARTH[0] * sp, ig += HEARTH[1] * sp, ib += HEARTH[2] * sp;
        }
        lw = 1.1 * lampF[k] * smooth(4, 0, depth);
      } else if (m === TREE) {
        const a = 0.075 * shade[k];
        (ar = a * 0.85), (ag = a * 1.05), (ab = a * 0.95);
        const side = aux[k] > 0 ? 1 : 0;
        const amb = 1.3;
        const moonF = 0.25 * side;
        sheen = rim * 0.2 * (0.6 + 0.4 * hash(ox, r * 3));
        ir = SKYLIGHT[0] * amb + MOONLIGHT[0] * moonF;
        ig = SKYLIGHT[1] * amb + MOONLIGHT[1] * moonF;
        ib = SKYLIGHT[2] * amb + MOONLIGHT[2] * moonF;
        // the side turned to the lamp
        const tx = x + 0.5 - aux[k];
        lw = 1.8 * lampF[k] * ((aux[k] > 0) === (tx < LAMP_X) ? 1 : 0.3);
      } else if (m === TOWER) {
        // a whitewashed cylinder: the moon behind it and to the right lights
        // only its right flank; the open sky fills the rest, the ground darkens its foot
        const n = Math.max(-1, Math.min(1, shade[k]));
        const lit = clamp((Math.cos(2.3 - Math.asin(n)) + 0.35) / 1.35);
        const ao = 0.55 + 0.45 * smooth(base + 1.5, base - 2.5, y);
        const tex = 0.9 + 0.2 * fbm(x * 1.4, y * 0.3, 2, 0);
        (ar = 0.9 * tex), (ag = 0.88 * tex), (ab = 0.82 * tex);
        const amb = 3.2 * (1 - 0.35 * n * n) * ao;
        const moonF = lit * 1.1 * ao;
        ir = SKYLIGHT[0] * amb + MOONLIGHT[0] * moonF;
        ig = SKYLIGHT[1] * amb + MOONLIGHT[1] * moonF;
        ib = SKYLIGHT[2] * amb + MOONLIGHT[2] * moonF;
        lw = 0.35 * smooth(towerTop + 4, towerTop + 1, y);
      } else if (m === CAP) {
        // the iron gallery and the lantern's roof, red-brown paint, lit by the lamp
        (ar = 0.2), (ag = 0.12), (ab = 0.1);
        const n = shade[k];
        const amb = 1.5;
        const moonF = rim * 0.9 + 0.5 * clamp(n);
        ir = SKYLIGHT[0] * amb + MOONLIGHT[0] * moonF;
        ig = SKYLIGHT[1] * amb + MOONLIGHT[1] * moonF;
        ib = SKYLIGHT[2] * amb + MOONLIGHT[2] * moonF;
        lw = 0.45;
      } else if (m === WALL) {
        const tex = 0.9 + 0.2 * fbm(x * 1.5, y * 1.5, 2, 0);
        (ar = 0.78 * tex), (ag = 0.76 * tex), (ab = 0.72 * tex);
        const eave = 0.5 + 0.5 * smooth(cottage - 5, cottage - 3.8, y);
        const foot = 0.7 + 0.3 * smooth(cottage + 1, cottage - 0.6, y);
        const amb = 2.8 * eave * foot * (0.85 + 0.15 * (x - 36) / 12);
        ir = SKYLIGHT[0] * amb, ig = SKYLIGHT[1] * amb, ib = SKYLIGHT[2] * amb;
        // the windows' glow on the wall round them
        const sp = (Math.exp(-Math.abs(x - 39) / 0.9) + 0.82 * Math.exp(-Math.abs(x - 44) / 0.9)) * smooth(cottage + 0.5, cottage - 1.5, y) * smooth(cottage - 5, cottage - 4, y) * 0.22;
        ir += HEARTH[0] * sp, ig += HEARTH[1] * sp, ib += HEARTH[2] * sp;
        lw = 0.9 * lampF[k];
      } else if (m === ROOF) {
        // terracotta in courses, caught by the moon along the ridge
        const tex = (0.85 + 0.15 * (r & 1)) * (0.8 + 0.4 * fbm(x * 1.2, y * 0.8, 2, 0));
        (ar = 0.36 * tex), (ag = 0.2 * tex), (ab = 0.16 * tex);
        const amb = 1.6;
        const moonF = 0.22 + rim * 1.1;
        ir = SKYLIGHT[0] * amb + MOONLIGHT[0] * moonF;
        ig = SKYLIGHT[1] * amb + MOONLIGHT[1] * moonF;
        ib = SKYLIGHT[2] * amb + MOONLIGHT[2] * moonF;
        lw = 1.0 * lampF[k];
      } else if (m === ISLE) {
        // far off: a dark wooded line, faded by the air toward the horizon's haze
        const tex = 0.8 + 0.4 * fbm(x * 0.7, y * 1.1, 3, 0);
        const veil = 0.16 + 0.35 * smooth(HORIZON - 3.5, HORIZON, y);
        sR[k] = mix(0.02 * tex, LOW_SKY[0], veil) + 0.025 * rim;
        sG[k] = mix(0.028 * tex, LOW_SKY[1], veil) + 0.03 * rim;
        sB[k] = mix(0.048 * tex, LOW_SKY[2], veil) + 0.036 * rim;
        continue;
      } else {
        continue;
      }
      sR[k] = ar * ir + sheen * MOONLIGHT[0], sG[k] = ag * ig + sheen * MOONLIGHT[1], sB[k] = ab * ib + sheen * MOONLIGHT[2];
      lR[k] = ar * LAMP[0] * lw, lG[k] = ag * LAMP[1] * lw, lB[k] = ab * LAMP[2] * lw;
    }
  }

  // --- the sky's own light: navy overhead, paler and greyer at the horizon,
  // and the moon's aureole; with a faint unevenness so it is never one flat tone
  const skR = new Float32Array(SKY_ROWS * W), skG = new Float32Array(SKY_ROWS * W), skB = new Float32Array(SKY_ROWS * W);
  const starB = new Float32Array(SKY_ROWS * W), starT = new Uint8Array(SKY_ROWS * W);
  for (let r = 0; r < SKY_ROWS; r++) {
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox;
      const x = DX[ox], y = DY[r];
      const v = clamp((y + Y0) / (HORIZON + Y0));
      const g = v * v * (0.35 + 0.65 * v);
      const veil = 0.88 + 0.24 * fbm(x * 0.05, (y - 0.5) * 0.08, 3, 0);
      const dmx = x + 0.5 - MOON[0], dmy = y - MOON[1];
      const dm = Math.sqrt(dmx * dmx + dmy * dmy);
      const e1 = Math.exp(-dm / 2.8) * 0.5, e2 = Math.exp(-dm / 10) * 0.13, e3 = Math.exp(-dm / 32) * 0.06;
      skR[k] = mix(ZENITH[0], LOW_SKY[0], g) * veil + 0.95 * e1 + 0.78 * e2 + 0.55 * e3;
      skG[k] = mix(ZENITH[1], LOW_SKY[1], g) * veil + 0.95 * e1 + 0.85 * e2 + 0.68 * e3;
      skB[k] = mix(ZENITH[2], LOW_SKY[2], g) * veil + 0.92 * e1 + 0.95 * e2 + 0.95 * e3;
      // stars: most faint, a few bright, blue-white to orange
      if (hash(ox, r * 3 + 11) > 0.984) {
        const u = hash(ox * 5 + 1, r * 7 + 3);
        starB[k] = 0.04 + 0.9 * Math.pow(u, 5);
        const tc = hash(ox + 9, r + 13);
        starT[k] = tc < 0.3 ? 0 : tc < 0.82 ? 1 : 2;
      }
    }
  }
  const STAR = [
    [0.78, 0.86, 1],
    [0.95, 0.95, 1],
    [1, 0.85, 0.66],
  ];

  // --- the clouds: heaps of noise that wrap, so they can drift forever ----
  // Built at output resolution: CW design cells wide, wrapping every CWO cells.
  const CW = 640;
  const CWO = CW * S;
  const NC = CWO * SKY_ROWS;
  const dens = new Float32Array(NC);
  const density = (x: number, y: number) => {
    const q = fbm(x * 0.008, y * 0.02, 3, CW * 0.008);
    const d = fbm(x * 0.018 + q * 2.4, y * 0.036 + q * 1.1, 5, CW * 0.018);
    // heaped mid-sky, thinner overhead, wisps at the horizon
    return d + 0.05 * smooth(8, 22, y) - 0.04 * smooth(10, 0, y) - 0.16 * smooth(36, HORIZON - 4, y);
  };
  for (let r = 0; r < SKY_ROWS; r++) for (let ox = 0; ox < CWO; ox++) dens[r * CWO + ox] = density(ox / S, DY[r]);
  const cover = new Float32Array(NC); // how much of the sky behind it hides
  const trans = new Float32Array(NC); // how much light gets down to it from above
  const gradX = new Float32Array(NC), gradY = new Float32Array(NC);
  const at = (rr: number, o: number) => (rr < 0 ? 0 : dens[Math.min(rr, SKY_ROWS - 1) * CWO + ((o + CWO) % CWO)]);
  for (let r = 0; r < SKY_ROWS; r++) {
    for (let ox = 0; ox < CWO; ox++) {
      const i = r * CWO + ox;
      cover[i] = smooth(0.52, 0.65, dens[i]);
      let od = 0;
      for (let s = 1; s <= 5; s++) od += Math.max(0, at(r - 3 * s, ox + s) - 0.52);
      trans[i] = Math.exp(-od * 4.5);
      gradX[i] = at(r, ox + 2) - at(r, ox - 2);
      gradY[i] = at(r + 2, ox) - at(r - 2, ox);
    }
  }
  const gap = (dm: number) => 0.15 + 0.85 * smooth(7, 24, dm); // the break round the moon

  // --- the sea, per row: distance, and which waves the cells can resolve ----
  const SEA0 = Math.ceil((HORIZON + Y0) * S - 0.5);
  const rowZ = new Float64Array(H), rowTan = new Float64Array(H), rowLZ = new Float64Array(H);
  const rowS2 = new Float64Array(H), rowU = new Float64Array(H);
  const att = new Float64Array(H * NW);
  for (let r = SEA0; r < H; r++) {
    const a = (DY[r] - HORIZON + 0.35) * RAD;
    const ta = Math.tan(a), Z = 1 / ta;
    rowTan[r] = ta;
    rowZ[r] = Z;
    rowLZ[r] = Math.log(Z) * 1.6;
    const dZ = (RAD * (1 + Z * Z)) / S, dX = (Z * RAD) / S;
    let lost = 0, kept = 0;
    for (let i = 0; i < NW; i++) {
      // a wave finer than the cells can show is folded into the unresolved roughness
      const P = Math.max(WK[i] * Math.abs(WDZ[i]) * dZ, WK[i] * Math.abs(WDX[i]) * dX);
      const f = smooth(1.8, 0.7, P);
      att[r * NW + i] = f * WSL[i];
      lost += (1 - f * f) * WSL[i] * WSL[i] * 0.3;
      kept += f * f * WSL[i] * WSL[i] * 0.5;
    }
    rowS2[r] = 0.0006 + lost;
    rowU[r] = lost / (lost + kept + 1e-9);
  }
  // sources the water glints with: direction (tan az, tan el, 1), normalised
  const unit = (ax: number, el: number) => {
    const a = Math.tan(ax), e = Math.tan(el), l = Math.sqrt(a * a + e * e + 1);
    return [a / l, e / l, 1 / l];
  };
  const MD = unit((MOON[0] - CX) * RAD, (HORIZON - MOON[1]) * RAD);
  const LD = unit((LAMP_X - CX) * RAD, (HORIZON + 4 - lampY) * RAD);
  const moonRow = Math.floor((MOON[1] + Y0) * S), moonCol = Math.floor(MOON[0] * S - 0.5);

  // what the water sees: the colour of everything above it, without moon or stars
  const refl = new Float32Array(N * 3);

  return (t, px) => {
    const beam = (t / 8) * Math.PI * 2 - 0.75; // starts out over the sea
    const cb = Math.cos(beam), sb = Math.sin(beam);
    const flash = Math.pow(Math.max(0, sb), 14) * 2.2; // pointed at us
    const lampL = 1 + 0.6 * flash;
    const drift = t * 1.4 * S;
    const driftI = Math.floor(drift), driftF = drift - driftI;
    // how much cloud lies over the moon, which dims its road on the water
    const moonCover = cover[moonRow * CWO + ((moonCol + driftI) % CWO)] * gap(0);
    const moonVis = 1 - 0.85 * moonCover;
    const blink = smooth(0.4, 0.7, Math.sin(t * 2.2));

    for (let r = 0; r < H; r++) {
      const y = DY[r];
      for (let ox = 0; ox < W; ox++) {
        const k = r * W + ox;
        const x = DX[ox];
        const m = mat[k];
        let cr = 0, cg = 0, cbl = 0, floor = 0.1, fade = 1, cloud = 0;
        let er = 0, eg = 0, eb = 0; // light the water doesn't mirror: moon and stars
        const dmx = x + 0.5 - MOON[0], dmy = y - MOON[1];
        const dm = Math.sqrt(dmx * dmx + dmy * dmy);

        if (y < HORIZON && m === AIR) {
          const gk = grain[k];
          cr = skR[k] * gk, cg = skG[k] * gk, cbl = skB[k] * gk;
          floor = 0.12;
          const o = ox + driftI;
          const i0 = r * CWO + (o % CWO), i1 = r * CWO + ((o + 1) % CWO);
          const c = (cover[i0] + (cover[i1] - cover[i0]) * driftF) * gap(dm);
          cloud = c;
          if (c > 0.004) {
            // volumetric: light from above thins through the cloud, the sides
            // facing the moon are lit, its thin edges glow silver near the moon
            const tr = trans[i0] + (trans[i1] - trans[i0]) * driftF;
            const gx = gradX[i0] + (gradX[i1] - gradX[i0]) * driftF;
            const gy = gradY[i0] + (gradY[i1] - gradY[i0]) * driftF;
            const inv = 1 / Math.max(dm, 1e-3);
            const facing = clamp(0.5 + (gx * dmx + gy * dmy) * inv * 30);
            const near = Math.exp(-dm / 20);
            const lit = tr * (0.25 + 0.75 * facing);
            const bright = (0.12 + 0.88 * lit) * (0.45 + 1.5 * near);
            const silver = c * (1 - c) * 4 * near * near * 2 * (0.4 + 0.6 * facing);
            let kr = 0.02 + MOONLIGHT[0] * 0.8 * bright + 0.95 * silver;
            let kg = 0.025 + MOONLIGHT[1] * 0.8 * bright + 0.95 * silver;
            let kb = 0.042 + MOONLIGHT[2] * 0.8 * bright + 1.0 * silver;
            // low cloud is far off and hazy
            const lo = 0.6 * smooth(30, HORIZON, y);
            kr = mix(kr, LOW_SKY[0] * 1.05, lo), kg = mix(kg, LOW_SKY[1] * 1.05, lo), kb = mix(kb, LOW_SKY[2] * 1.05, lo);
            const a = Math.min(1, c * 1.05);
            cr = mix(cr, kr, a), cg = mix(cg, kg, a), cbl = mix(cbl, kb, a);
          }
          if (dm < 6) {
            // the moon: grey seas on a bright face, a little darker at the limb,
            // dimmed where cloud crosses it
            const sea = smooth(0.48, 0.62, fbm(x * 0.45 + 3, y * 0.45 + 1, 3, 0));
            const face = (1 - 0.32 * sea) * (1 - 0.14 * (dm / 5.5) ** 2);
            const a = (1 - c * 0.85) * smooth(5.7, 4.9, dm);
            er = (1.0 * face - cr) * a, eg = (0.97 * face - cg) * a, eb = (0.9 * face - cbl) * a;
          } else {
            const st = starB[k];
            if (st > 0) {
              const vis = (1 - c) * (1 - c) * smooth(HORIZON - 1, HORIZON - 20, y) * (1 - Math.exp(-dm / 9));
              const tw = 0.7 + 0.3 * Math.sin(t * (1.5 + hash(ox, r) * 3) + hash(r, ox) * 6.28) * (0.4 + 0.6 * smooth(10, HORIZON, y));
              const s = st * tw * vis;
              const sc = STAR[starT[k]];
              er = s * sc[0], eg = s * sc[1], eb = s * sc[2];
            }
          }
        } else if (y >= HORIZON && (m === AIR || m === LAND) && !(m === LAND && y < HORIZON + 4)) {
          // sea: the slope of the waves under this cell
          const Z = rowZ[r], ta = rowTan[r];
          const ax = (x + 0.5 - CX) * RAD;
          const X = Z * ax;
          const patch = 0.55 + 0.9 * noise(x * 0.035 + t * 0.03, rowLZ[r] - t * 0.04, 0); // calmer and rougher stretches
          let sx = 0, sz = 0;
          const ai = r * NW;
          for (let i = 0; i < NW; i++) {
            const a = att[ai + i];
            if (a < 1e-3) continue;
            const c = a * Math.cos(WK[i] * (WDX[i] * X + WDZ[i] * Z) + WOM[i] * t + WPH[i]);
            sx += WDX[i] * c;
            sz += WDZ[i] * c;
          }
          sx *= patch, sz *= patch;
          const s2 = rowS2[r] * patch * patch + 0.0003;
          const nl = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
          const nx = -sx * nl, ny = nl, nz = -sz * nl;
          const vl = 1 / Math.sqrt(ax * ax + ta * ta + 1);
          const vx = ax * vl, vy = -ta * vl, vz = vl;
          const vn = vx * nx + vy * ny + vz * nz;
          const cosT = Math.max(0, -vn);
          const q5 = 1 - cosT, F = 0.02 + 0.98 * q5 * q5 * q5 * q5 * q5;
          // the mirrored ray, looked up in what was drawn above the water
          const rx = vx - 2 * vn * nx, ry = vy - 2 * vn * ny, rz = vz - 2 * vn * nz;
          const ys = 2 * shoreY[ox] - HORIZON - Math.atan2(ry, Math.sqrt(rx * rx + rz * rz)) / RAD;
          const xs = CX - 0.5 + rx / rz / RAD;
          let ro = Math.floor((ys + Y0) * S);
          const lim = Math.min(r, firstSea[ox]) - 1;
          ro = ro < 0 ? 0 : ro > lim ? lim : ro;
          let co = Math.round((xs + 0.5) * S - 0.5);
          co = co < 0 ? 0 : co >= W ? W - 1 : co;
          const q = (ro * W + co) * 3;
          cr = F * refl[q] + (1 - F) * DEEP[0];
          cg = F * refl[q + 1] + (1 - F) * DEEP[1];
          cbl = F * refl[q + 2] + (1 - F) * DEEP[2];
          // glints: facets tilted just so toward the moon or the lamp; where
          // the waves are finer than a cell they shimmer in and out
          const sp0 = noise(ox * 0.9, r * 1.9 + t * 3.1, 0) * noise(ox * 0.9 + 31.7, r * 1.9 - t * 2.7, 0) * 4;
          const sparkle = 1 + rowU[r] * (sp0 * sp0 * 0.9 - 1);
          {
            const hx = MD[0] - vx, hy = MD[1] - vy, hz = MD[2] - vz;
            const ex = sx + hx / hy, ez = sz + hz / hy;
            const e = (ex * ex + ez * ez) / (2 * s2);
            if (e < 14) {
              const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
              const qh = 1 - (hx * MD[0] + hy * MD[1] + hz * MD[2]) / hl;
              const g = moonVis * (0.02 + 0.98 * qh * qh * qh * qh * qh) * Math.exp(-e) * (0.0055 / s2) * sparkle * (1 + 0.1 / (ta + 0.02));
              cr += g, cg += g * 0.97, cbl += g * 0.9;
            }
          }
          {
            const hx = LD[0] - vx, hy = LD[1] - vy, hz = LD[2] - vz;
            const ex = sx + hx / hy, ez = sz + hz / hy;
            const e = (ex * ex + ez * ez) / (2 * s2);
            if (e < 14) {
              const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
              const qh = 1 - (hx * LD[0] + hy * LD[1] + hz * LD[2]) / hl;
              const g = lampL * 0.6 * (0.02 + 0.98 * qh * qh * qh * qh * qh) * Math.exp(-e) * (0.004 / s2) * sparkle * (1 + 0.1 / (ta + 0.02));
              cr += g * LAMP[0], cg += g * LAMP[1], cbl += g * LAMP[2];
            }
          }
          // surf where the headland meets the water, washing in and out
          if (x < 94 && y < HORIZON + 10) {
            const ds = x < 90 ? y - (HORIZON + 4) : Math.hypot(x - 90, Math.max(0, y - (HORIZON + 4)));
            const surge = 0.5 + 0.5 * Math.sin(t * 0.9 - x * 0.07 + 5 * noise(x * 0.12, 3, 0));
            const reach = (0.5 + 2.5 * surge) * (0.6 + 0.8 * noise(x * 0.3, 7 + t * 0.1, 0));
            const lace = 0.6 * noise(x * 0.55 - t * 0.35, y * 1.4 + t * 0.2, 0) + 0.4 * noise(x * 1.3 + t * 0.2, y * 2.6, 0);
            const foam = smooth(reach, reach * 0.2, ds) * smooth(0.5, 0.8, lace + 0.1 * smooth(reach, 0, ds));
            if (foam > 0) {
              const lf = lampF[k] * lampL * 0.9;
              const a = foam * 0.8;
              cr = mix(cr, 0.2 + LAMP[0] * lf * 0.6, a);
              cg = mix(cg, 0.215 + LAMP[1] * lf * 0.6, a);
              cbl = mix(cbl, 0.24 + LAMP[2] * lf * 0.6, a);
            }
          }
          // a thin mist lying on the far water
          const mist = Math.exp(-(y - HORIZON) / 1.4) * 0.5;
          cr = mix(cr, LOW_SKY[0], mist), cg = mix(cg, LOW_SKY[1], mist), cbl = mix(cbl, LOW_SKY[2], mist);
          floor = 0.12;
          fade = smooth(YB, YB - 26, y); // the bottom rows thin out into the ground
        } else if (m === LANTERN) {
          // the lamp behind the glazing bars
          const dx = shade[k];
          const g = (0.8 + 0.2 * Math.min(1, flash)) * (1 + 0.4 * Math.exp(-dx * dx * 2));
          const bar = Math.abs(Math.abs(dx) - 1.2) < 0.3 ? 0.6 + 0.4 * Math.min(1, flash) : 1;
          (cr = g * bar), (cg = 0.86 * g * bar), (cbl = 0.6 * g * bar);
        } else if (m === PANE) {
          // a lit room: an oil lamp or a fire, flickering a little
          const g = shade[k] * (0.82 + 0.1 * Math.sin(t * 3.1 + x) + 0.06 * Math.sin(t * 7.3 + 2 * x));
          (cr = g * HEARTH[0]), (cg = g * (HEARTH[1] + 0.06)), (cbl = g * HEARTH[2]);
          if (shade[k] < 0.5) (cr += 0.03), (cg += 0.035), (cbl += 0.05);
        } else {
          const gk = grain[k];
          cr = (sR[k] + lR[k] * lampL) * gk;
          cg = (sG[k] + lG[k] * lampL) * gk;
          cbl = (sB[k] + lB[k] * lampL) * gk;
          floor = m === ISLE ? 0.1 : 0.08;
        }

        // The beam: a soft cone of lit haze from the lamp to one side,
        // shortened as it turns toward or away from us, catching the clouds
        // it passes, and a glow that flares when it faces us.
        if (m !== TOWER && m !== CAP && m !== LANTERN) {
          const bx = x + 0.5 - LAMP_X, by = y - lampY;
          if (bx * cb > 0) {
            const along = Math.abs(bx) / (Math.abs(cb) * 115 + 1);
            if (along < 1) {
              const spread = 1.3 + Math.abs(bx) * 0.1;
              let b = Math.pow(1 - along, 1.8) * Math.exp(-((by / spread) ** 2)) * 0.75;
              if (b > 0.004) {
                b *= (0.75 + 0.5 * noise(bx * 0.06 - t * 0.2, by * 0.3 + t * 0.05, 0)) * (1 + 1.4 * cloud);
                cr += b, cg += b * 0.93, cbl += b * 0.8;
              }
            }
          }
          const dl = lampD[k];
          // the lamp's glare: a hot white core, a warm halo, a faint wide bloom in the haze
          const core = Math.exp(-dl / 2.2) * (0.5 + 0.9 * flash);
          const glow = Math.exp(-dl / 6) * 0.12 * (1 + 1.5 * flash) + Math.exp(-dl / 22) * 0.04 * (1 + flash);
          cr += core + glow * LAMP[0], cg += core * 0.95 + glow * LAMP[1], cbl += core * 0.82 + glow * LAMP[2];
          // the buoy light out on the island's point, blinking red
          const bdx = x + 0.5 - 184.5, bdy = y - 55.5;
          if (bdx * bdx + bdy * bdy < 9) {
            const bl = blink * (Math.exp(-(bdx * bdx + bdy * bdy) / 0.25) * 1.1 + Math.exp(-Math.sqrt(bdx * bdx + bdy * bdy) / 0.9) * 0.18);
            cr += bl, cg += bl * 0.22, cbl += bl * 0.14;
          }
        }

        const q = k * 3;
        refl[q] = cr, refl[q + 1] = cg, refl[q + 2] = cbl;
        dot(px, k, cr + er, cg + eg, cbl + eb, floor, fade);
      }
    }
  };
}
