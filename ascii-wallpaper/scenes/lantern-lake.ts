/*
 * lantern lake: sky lanterns rising over a still mountain lake at night. A
 * festival on the far shore lets them go by the hundred: they climb from
 * behind the trees, lean on a slow breeze and burn out high over the water.
 * Nearer ones sail up past us, and a figure standing in a boat, a lamp on its
 * bow, holds one up, lets it go, and lights the next.
 *
 * Shaded in colour per cell on a square grid, then drawn as a halftone: every
 * cell is a dot whose size is its brightness, in its own colour.
 * A lantern's size, speed and drift all come from its distance, so the far
 * ones crawl up as sparks and the near ones sail past large. Each one starts
 * a new flight, somewhere new, only where it can't be seen: behind the trees
 * or below the frame.
 *
 * Drawn on a 320x180 grid for a 16:9 screen. The picture is laid out in
 * design units of the original 200x100 grid, Z output cells each, with Y0
 * design rows of sky added above it and a little more lake below.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "lantern lake",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#04060d",
} satisfies Meta;

const W = 320, H = 180; // output cells
const Z = 1.6; // output cells to a design unit
const Y0 = 8.5; // design rows of sky above the original frame
const YB = H / Z - Y0; // the design row at the bottom edge
// design coordinates of an output cell's centre, and output coordinates of a design point
const dX = (x: number) => (x + 0.5) / Z, dY = (r: number) => (r + 0.5) / Z - Y0;
const oX = (x: number) => x * Z, oY = (y: number) => (y + Y0) * Z;
const WL = 64; // the waterline, in design rows
const WLO = oY(WL); // and in output rows (a whole number)
const SRC = 100; // the middle of the festival on the far shore
// The boat is drawn in output cells. Its middle and its waterline, far enough
// out that the lantern held over its head sits against the dark trees' reflection
const BX = oX(108.5), BW = oY(90);
const SC = 1.4 * Z; // the boat's scale
const FX = BX - 3 * SC; // where the figure stands in it
// The figure lets a lantern go this far into every cycle and lights the
// next one at LIT, so it holds one up most of the time.
const CYCLE = 20, LET_GO = 3, LIT = 6;
const HELD = 5 * SC; // the boat's lanterns, in cells tall

const AIR = 0, FAR = 1, BACK = 2, PEAK = 3, TREE = 4;

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number): number {
  let s = 0, n = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    s += amp * noise(x * f, y * f);
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

// distance from a point to a segment
function seg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const k = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  const ex = ax + dx * k - px, ey = ay + dy * k - py;
  return Math.sqrt(ex * ex + ey * ey);
}

// Ranges as tent peaks [x, height, slope], roughened: the high peaks either
// side, the nearer shoulders in front of them, and a distant range between.
const PEAKS: [number, number, number][] = [[22, 42, 1.2], [-4, 33, 0.9], [172, 33, 1.05], [215, 22, 0.6]];
const SHOULDERS: [number, number, number][] = [[50, 25, 1], [64, 12, 0.75], [150, 17, 0.95], [196, 21, 0.75]];
const DISTANT: [number, number, number][] = [[98, 17, 0.42], [122, 14, 0.5], [82, 12, 0.45], [140, 11, 0.5]];

function range(x: number, peaks: [number, number, number][], seed: number, rough: number): [number, number] {
  let m = -99, px = 0;
  for (const [cx, h, s] of peaks) {
    const v = h - Math.abs(x - cx) * s;
    if (v > m) (m = v), (px = cx);
  }
  const j = rough * (fbm(x * 0.09, seed, 3) - 0.5) + rough * 0.45 * (noise(x * 0.45, seed + 5) - 0.5);
  return [m + j * Math.min(1, Math.max(0, m) / 6), px];
}

// A sky lantern's outline, in units of its height from its top: wider at the
// shoulders than at the open bottom, the shoulders rounded.
function inside(u: number, v: number): boolean {
  if (v < 0 || v > 1) return false;
  let hw = 0.34 - 0.08 * v;
  if (v < 0.14) hw *= Math.sqrt(1 - 0.6 * ((0.14 - v) / 0.14) ** 2);
  return u <= hw && u >= -hw;
}

interface Flight {
  i: number;
  s: number; // size, in cells tall
  v: number; // rise, cells a second
  life: number; // seconds from one start to the next
  off: number;
  wd: number; // lean on the breeze, cells across for each row climbed
  sw: number;
  sf: number;
  ph: number;
  f1: number;
  f2: number;
  out: boolean; // sails off the top rather than burning out
  wide: boolean; // starts anywhere along the shore, not just at the festival
}

export default function lanternLake(): Frame {
  const N = W * H, S = WLO * W;

  // --- the land and the sky, built once ----------------------------------------
  const mat = new Uint8Array(S);
  const sR = new Float32Array(S), sG = new Float32Array(S), sB = new Float32Array(S);
  // the air between us and each cell: the sky's own light, and the haze it
  // lays over whatever stands further off
  const aR = new Float32Array(S), aG = new Float32Array(S), aB = new Float32Array(S);
  const take = new Float32Array(S); // how much of the festival's warm light each cell takes
  const backTop = new Float32Array(W), backX = new Float32Array(W);
  const frontTop = new Float32Array(W), frontX = new Float32Array(W), farTop = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const xc = dX(x);
    const [hb, pb] = range(xc, PEAKS, 3.1, 4);
    const [hf, pf] = range(xc, SHOULDERS, 7.7, 3);
    const [hd] = range(xc, DISTANT, 11.3, 2.2);
    backTop[x] = WL - Math.max(hb, 0), backX[x] = pb;
    frontTop[x] = WL - Math.max(hf, 0), frontX[x] = pf;
    farTop[x] = WL - Math.max(hd, 0);
  }
  // The festival's light: a warm dome in the air over the middle of the far
  // shore, leaning the way the breeze carries the lanterns.
  const dome = (x: number, y: number) => {
    const up = Math.max(0, WL - 6 - y); // from the tops of the trees
    const dx = (x - SRC - 0.3 * up) / (44 + up);
    return Math.exp(-dx * dx) * (0.6 * Math.exp(-up / 14) + 0.4 * Math.exp(-up / 40));
  };
  // The night sky: a deep blue overhead, paler and greyer down to the
  // horizon, where a faint warm band holds the light of the shore. The
  // festival's light scattered in the air is added on top, amber low down
  // and thinning to a dusky rose as it climbs into the blue.
  for (let r = 0; r < WLO; r++) {
    const y = dY(r);
    const v = clamp((y + Y0) / (WL + Y0)), lo = v * v * v;
    const band = 0.05 * Math.exp(-(WL - y) / 6);
    for (let x = 0; x < W; x++) {
      const k = r * W + x, xc = dX(x);
      const hz = 0.9 + 0.2 * fbm((xc - 0.5) * 0.04, (y - 0.5) * 0.07, 3);
      // the glow falls off faster than the dome itself, so the blue holds
      // above it rather than greying
      const w = dome(xc, y), wl = w * Math.sqrt(w), w3 = w * w * w;
      aR[k] = (0.022 + 0.09 * lo) * hz + band + 0.42 * wl + 0.3 * w3;
      aG[k] = (0.038 + 0.1 * lo) * hz + 0.7 * band + 0.18 * wl + 0.27 * w3;
      aB[k] = (0.105 + 0.105 * lo) * hz + 0.42 * band + 0.06 * wl + 0.12 * w3;
    }
  }
  // A mountainside: the faces turned toward the festival take a little of its
  // light, the ridge between them wandering as it comes down from the peak,
  // and ribs and gullies run down it. Sets how lit the face is and how much
  // of the festival's warmth it takes, and returns the ribs' height, for the
  // snow to lie between. Takes the cell's centre in design units.
  let lit = 0, warmth = 0;
  const slope = (xc: number, y: number, top: number, px: number) => {
    const depth = y - top;
    const inward = px < SRC ? 1 : -1;
    const ridge = px + (depth + 1) * 0.6 * (noise(y * 0.1, px) - 0.5);
    const face = smooth(-4, 4, (xc - ridge) * inward);
    const u = xc - 0.5 + depth * 0.45 * Math.sign(xc - px || 1);
    const rib = (q: number) => fbm(q * 0.13, px * 0.37, 3);
    const grad = (rib(u + 1) - rib(u - 1)) * 7 * inward;
    lit = clamp(0.3 + 0.5 * face + grad * 0.5);
    warmth = lit * Math.exp(-(((xc - SRC) / 70) ** 2)) * (0.4 + 0.6 * smooth(top + 2, WL, y)) * 0.9;
    return rib(u);
  };
  for (let r = 0; r < WLO; r++) {
    for (let x = 0; x < W; x++) {
      const y = dY(r);
      mat[r * W + x] = y >= frontTop[x] ? PEAK : y >= backTop[x] ? BACK : y >= farTop[x] ? FAR : AIR;
    }
  }

  // The far shore's trees: a low band of scrub along the water with spruce
  // standing out of it, shorter in the clearing where the festival is.
  const scrub = (x: number) => WL - 2.4 - 1.4 * fbm(x * 0.15, 5.5, 3);
  const scrubTop = new Float32Array(W);
  for (let x = 0; x < W; x++) scrubTop[x] = scrub(dX(x));
  for (let r = 0; r < WLO; r++) for (let x = 0; x < W; x++) if (dY(r) >= scrubTop[x]) mat[r * W + x] = TREE;
  const spruce = (tx: number, th: number, tw: number, tb: number) => {
    const x0 = Math.max(0, Math.floor(oX(tx - tw - 1))), x1 = Math.min(W - 1, Math.ceil(oX(tx + tw + 1)));
    for (let r = Math.max(0, Math.floor(oY(tb - th))); r < WLO; r++) {
      const y = dY(r), d = y - (tb - th);
      if (d < 0 || y >= tb + 0.5) continue;
      const tier = (d + th * 0.3) / 1.6;
      const w = (d / th) * tw * (0.7 + 0.45 * (tier - Math.floor(tier))) + 0.22;
      for (let x = x0; x <= x1; x++) if (Math.abs(dX(x) - tx) <= w) mat[r * W + x] = TREE;
    }
  };
  for (let x = -2; x < W + 2; ) {
    const h = hash(Math.floor(x * 7), 21);
    const clearing = smooth(22, 0, Math.abs(x - SRC));
    const th = (2.6 + 4.4 * hash(Math.floor(x * 3), 5) ** 1.2) * (1 - 0.3 * clearing);
    spruce(x + hash(Math.floor(x), 2), th, 1 + 0.8 * hash(Math.floor(x), 4), scrub(x) + 1);
    x += 1.2 + 1.8 * h;
  }

  // Each cell lit, then veiled by the air in front of it: the further a layer
  // stands, the more it fades into the colour of the sky behind it.
  const floorS = new Float32Array(S);
  for (let r = 0; r < WLO; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x, m = mat[k];
      const y = dY(r), xc = dX(x), xs = xc - 0.5;
      const tex = 0.7 + 0.6 * fbm(xs * 0.35, y * 0.35, 2), fine = 0.85 + 0.3 * noise(xs * 1.4, y * 1.4);
      let cr = 0, cg = 0, cb = 0, T = 0;
      if (m === AIR) {
        take[k] = dome(xc, y);
        floorS[k] = 0.05 + 0.04 * clamp((y + Y0) / (WL + Y0));
      } else if (m === PEAK) {
        // the near shoulders, dark with forest, their faces warmed
        slope(xc, y, frontTop[x], frontX[x]);
        const s = (0.45 + 0.8 * lit) * tex * fine;
        cr = 0.014 * s + 0.11 * warmth, cg = 0.019 * s + 0.055 * warmth, cb = 0.026 * s + 0.024 * warmth;
        T = 0.8;
        floorS[k] = 0.035;
      } else if (m === BACK) {
        // the high peaks: bare rock, and snow lying in the gullies down from
        // the summits, pale in the starlight and warmed on the faces toward
        // the festival
        const rb = slope(xc, y, backTop[x], backX[x]);
        const rock = (0.4 + 0.9 * lit) * tex * fine;
        const snow = smooth(-1.2, 1.2, WL - y - 25 + 16 * (0.5 - rb) + 7 * (fbm(xs * 0.5, y * 0.5, 2) - 0.5) - 5 * (1 - lit));
        const sn = (0.45 + 0.75 * lit) * (0.9 + 0.2 * fine);
        cr = mix(0.03 * rock, 0.19 * sn, snow) + warmth * (0.1 + 0.3 * snow);
        cg = mix(0.036 * rock, 0.22 * sn, snow) + warmth * (0.052 + 0.18 * snow);
        cb = mix(0.05 * rock, 0.29 * sn, snow) + warmth * (0.024 + 0.1 * snow);
        T = 0.66;
        floorS[k] = 0.04;
      } else if (m === FAR) {
        // a distant range behind the festival, lit from in front by it and
        // dark up on the ridge
        const w = dome(xc, y);
        const s = (0.7 + 0.6 * fbm(xs * 0.2, y * 0.3, 3)) * fine;
        const lo = smooth(farTop[x], farTop[x] + 4, y);
        cr = 0.02 * s + 0.5 * w * lo * s, cg = 0.024 * s + 0.24 * w * lo * s, cb = 0.034 * s + 0.09 * w * lo * s;
        T = 0.45;
        floorS[k] = 0.04;
      } else {
        // the trees: all but black, their tops backlit by the festival behind
        // them, fading over the first three rows
        const h = hash(x * 13 + r, 5);
        cr = 0.006 + 0.005 * h, cg = 0.009 + 0.006 * h, cb = 0.012 + 0.007 * h;
        const edge = r === 0 || mat[k - W] !== TREE ? 1 : r > 1 && mat[k - 2 * W] !== TREE ? 0.55 : r > 2 && mat[k - 3 * W] !== TREE ? 0.22 : 0;
        const g = edge * dome(xc, y) * 0.45;
        cr += g, cg += g * 0.48, cb += g * 0.16;
        take[k] = edge * 0.5;
        T = 0.9;
        floorS[k] = 0.02;
      }
      sR[k] = cr * T + aR[k] * (1 - T), sG[k] = cg * T + aG[k] * (1 - T), sB[k] = cb * T + aB[k] * (1 - T);
    }
  }

  // people on the shore with lanterns still in their hands:
  // [output column, output row, phase, design column of its centre]
  const shoreLights: [number, number, number, number][] = [];
  for (let i = 0, x = SRC - 24; i < 8; i++) {
    const xd = Math.round(x) + 0.5, yd = WL - 0.5 - (hash(i, 62) > 0.6 ? 1 : 0);
    const c = Math.floor(oX(xd));
    shoreLights.push([c, Math.floor(oY(yd)), hash(i, 63) * 6.28, dX(c)]);
    x += 2 + 9 * hash(i, 61) ** 2;
  }

  // stars, single cells: a few bright ones and many faint, of different
  // colours, dimmed toward the horizon by the thicker air and lost where the
  // festival lights the sky. [cell, phase, rate, brightness, r, g, b]
  const stars: number[][] = [];
  for (let k = 0; k < S; k++) {
    if (mat[k] !== AIR) continue;
    const h = hash(k % W, Math.floor(k / W) + 101);
    if (h < 0.975) continue;
    const bright = h > 0.9925 ? 0.35 + ((h - 0.9925) / 0.0075) * 0.75 : 0.07 + ((h - 0.975) / 0.0175) * 0.12;
    const v = clamp((dY((k / W) | 0) + Y0) / (WL + Y0));
    const b = bright * (1 - 0.75 * v * v) * clamp(1 - take[k] * 3);
    if (b < 0.04) continue;
    const c = hash(k, 5); // blue-white, white, or a warm yellow
    const cr = c < 0.35 ? 0.78 : c < 0.8 ? 0.95 : 1, cg = c < 0.35 ? 0.86 : c < 0.8 ? 0.95 : 0.88, cbl = c < 0.35 ? 1 : c < 0.8 ? 1 : 0.7;
    stars.push([k, hash(k, 3) * 6.28, 0.8 + hash(k, 4) * 2.5, b, cr, cg, cbl]);
  }
  // a print's grain: each dot a touch brighter or dimmer than its neighbours
  const grain = new Float32Array(N);
  for (let k = 0; k < N; k++) grain[k] = 0.95 + 0.1 * hash(k, 77);

  // --- the lanterns -----------------------------------------------------------
  // Let go on the far shore. Each climbs from below the scrub, so its start is
  // hidden, and either burns out or sails off the top before it starts again.
  const shore: Flight[] = [];
  for (let i = 0; i < 240; i++) {
    const near = i >= 196;
    const s = near ? 1.5 + 1.7 * hash(i, 11) ** 1.5 : 0.45 + 0.9 * hash(i, 11) ** 1.4;
    const v = 0.3 + 0.62 * s;
    const out = near && hash(i, 12) < 0.7;
    // the ones that sail off climb on through the added sky
    const climb = out ? WL + Y0 + 3 * s + 4 : 12 + (46 + 0.6 * Y0) * hash(i, 13) ** 0.8;
    shore.push({
      i, s, v, life: (climb + s + 1) / v, off: hash(i, 14), wd: 0.12 + 0.3 * hash(i, 15),
      sw: 0.25 * s + 0.2, sf: 0.3 + 0.5 * hash(i, 16), ph: hash(i, 17) * 6.28, f1: 2 + 3 * hash(i, 18), f2: 5 + 4 * hash(i, 19),
      out, wide: near || hash(i, 20) < 0.08,
    });
  }
  shore.sort((a, b) => a.s - b.s);
  const startX = (f: Flight, lap: number) => {
    const n = f.i * 7 + lap * 131;
    if (f.wide) return 12 + 176 * hash(n, 23);
    return SRC - 6 + 30 * (hash(n, 23) + hash(n, 24) + hash(n, 25) - 1.5);
  };
  // The breeze leans the plume over to the right, more the higher it gets.
  const lean = (f: Flight, climb: number) => climb * f.wd + climb * climb * 0.004;

  // Let go near us, below the frame: they rise past large and fast.
  // [size, where it is across and down at the start, in design units]; the
  // last few are still below the frame, on their way up
  const NEAR: [number, number, number][] = [
    [12.5, 34, 30], [8.5, 178, 14], [6.5, 66, 74], [5.2, 154, 46], [4.4, 18, 86], [4.6, 136, 4],
    [9.5, 190, 116], [10.5, 150, 160], [5.8, 80, 128], [7, 28, 190], [4.2, 172, 150],
  ];
  const close = NEAR.map(([s, x, y], i) => {
    const v = 0.35 + 0.42 * s;
    const path = H / Z + 5 * s; // from below the frame to above it, glow and all
    const life = (path / v) * (1.08 + 0.3 * hash(i, 41));
    return { i, s, v, x, path, life, off: (YB + 2.5 * s - y) / v / life, wd: s * 0.05, sw: 0.35 * s, sf: 0.2 + 0.2 * hash(i, 42), ph: hash(i, 43) * 6.28 };
  });

  // --- the boat and the figure in it --------------------------------------------
  // Drawn in boat units, SC output cells each, measured across from the
  // figure (or the boat's middle) and up from the waterline.
  // [shoulder, elbow, hand] for each pose, one arm; the other mirrors it
  const ARMS = {
    up: [[1.3, 9.4], [3, 11.5], [2, 14.1]],
    down: [[1.3, 9.4], [2, 6.6], [1.9, 4.4]],
    chest: [[1.3, 9.4], [2.4, 7.2], [1.2, 6]],
  };
  // a long low hull, its ends sweeping up, the bow (on the right) higher
  const gunwale = (dx: number) => 2.4 + (dx > 0 ? 3 : 1.8) * smooth(4, 12.5, Math.abs(dx)) ** 2;
  const hull = (dx: number, up: number) => up <= gunwale(dx) && up > -0.6 && Math.abs(dx) <= 12.5 - Math.max(0, 1.8 - up) * 2.4;
  const body = (dx: number, up: number, arms: number[][]) => {
    if ((dx * dx) / 1.3 + (up - 11.2) ** 2 / 1.5 < 1) return true; // the head
    if (up <= 9.8 && up > 1 && Math.abs(dx) <= 1.35 + 0.5 * smooth(9.8, 2, up)) return true; // a long coat
    const ax = Math.abs(dx);
    return seg(ax, up, arms[0][0], arms[0][1], arms[1][0], arms[1][1]) < 0.66 || seg(ax, up, arms[1][0], arms[1][1], arms[2][0], arms[2][1]) < 0.58;
  };
  // The boat and the figure, drawn into a box of cells round the boat each
  // frame (1 boat, 2 figure) with the arms partway between two poses, so they
  // move rather than snap from one to the next.
  const BOX = [Math.floor(BX - 13 * SC), Math.floor(BW - 16 * SC), Math.ceil(27 * SC), Math.ceil(16 * SC) + 3]; // x, row, cols, rows
  const hulls = new Uint8Array(BOX[2] * BOX[3]), shape = new Uint8Array(BOX[2] * BOX[3]);
  for (let j = 0; j < BOX[3]; j++) {
    for (let i = 0; i < BOX[2]; i++) if (hull((BOX[0] + i + 0.5 - BX) / SC, (BW - (BOX[1] + j + 0.5)) / SC)) hulls[j * BOX[2] + i] = 1;
  }
  const arms = ARMS.up.map((p) => [...p]);
  const pose = (a: number[][], b: number[][], k: number) => {
    for (let i = 0; i < 3; i++) (arms[i][0] = mix(a[i][0], b[i][0], k)), (arms[i][1] = mix(a[i][1], b[i][1], k));
    for (let j = 0; j < BOX[3]; j++) {
      for (let i = 0; i < BOX[2]; i++) {
        const q = j * BOX[2] + i;
        shape[q] = hulls[q] || (body((BOX[0] + i + 0.5 - FX) / SC, (BW - (BOX[1] + j + 0.5)) / SC, arms) ? 2 : 0);
      }
    }
  };
  // a small lamp on the bow, always lit, so the boat never goes dark between
  // one lantern and the next
  const BOWX = BX + 11.2 * SC, BOWY = BW - (gunwale(11.2) + 1.2) * SC;

  // --- per frame ----------------------------------------------------------------
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const FL = new Float32Array(N);

  const paint = (k: number, pr: number, pg: number, pb: number, a: number) => {
    R[k] += (pr - R[k]) * a, G[k] += (pg - G[k]) * a, B[k] += (pb - B[k]) * a;
    if (FL[k] < 0.12 * a) FL[k] = 0.12 * a;
  };
  // Draws a lantern h output cells tall centred on (cx, cy), in output cells,
  // at brightness I and opacity a, above row `limit`, leaving out the cells
  // `hide` marks.
  const lantern = (cx: number, cy: number, h: number, I: number, a: number, limit: number, hide: Uint8Array | null) => {
    if (h < 1.4) {
      // a spark: less than a cell, so it gives a dot as small as its light,
      // shared between the two rows it straddles so it glides up rather than
      // jumping, and deeper orange the further off it is
      const x = Math.floor(cx), fy = cy - 0.5, r0 = Math.floor(fy), wy = fy - r0;
      if (x < 0 || x >= W) return;
      const q = I * (0.5 + 0.5 * (h / 1.4));
      for (let r = r0; r <= r0 + 1; r++) {
        const w = r === r0 ? 1 - wy : wy;
        if (r < 0 || r >= limit || w < 0.02) continue;
        const k = r * W + x;
        if (hide && hide[k]) continue;
        paint(k, q, q * (0.36 + 0.3 * q), q * (0.08 + 0.15 * q * q), a * w);
      }
      return;
    }
    if (h < 2.6) {
      // two cells tall, the paper above and the burner's glow below, spread
      // over the rows it straddles so it slides up rather than jumping
      const x = Math.floor(cx), top = cy - 1, r0 = Math.floor(top);
      if (x < 0 || x >= W) return;
      for (let r = r0; r <= r0 + 2; r++) {
        if (r < 0 || r >= limit) continue;
        const k = r * W + x;
        if (hide && hide[k]) continue;
        const up = Math.max(0, Math.min(r + 1, top + 1) - Math.max(r, top)); // overlap with the paper
        const dn = Math.max(0, Math.min(r + 1, top + 2) - Math.max(r, top + 1)); // and with the glow
        if (up + dn < 0.02) continue;
        const q = I * (0.8 * up + 1.1 * dn) / (up + dn);
        paint(k, q, q * (0.34 + 0.36 * q), q * (0.06 + 0.2 * q * q), a * (up + dn));
      }
      return;
    }
    const top = cy - h / 2;
    const x0 = Math.max(0, Math.floor(cx - 0.36 * h)), x1 = Math.min(W - 1, Math.floor(cx + 0.36 * h));
    const r0 = Math.max(0, Math.floor(top)), r1 = Math.min(limit - 1, Math.floor(top + h));
    for (let r = r0; r <= r1; r++) {
      for (let x = x0; x <= x1; x++) {
        const k = r * W + x;
        if (hide && hide[k]) continue;
        let cov = 0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) if (inside((x + (sx + 0.5) / 3 - cx) / h, (r + (sy + 0.5) / 3 - top) / h)) cov++;
        if (!cov) continue;
        const u = (x + 0.5 - cx) / h, v = clamp((r + 0.5 - top) / h);
        const xn = Math.min(1, Math.abs(u) / (0.34 - 0.08 * v));
        // Lit through: past full brightness, so the body is solid, its colour
        // deep orange up under the crown and pale gold over the burner. On the
        // near ones the seams between the paper's panels show, a shade darker.
        const seam = h > 7 ? 0.9 + 0.1 * Math.cos(xn * 6.283) : 1;
        const q = I * (1 - 0.3 * xn * xn) * (0.72 + 0.5 * v) * seam;
        const fl = Math.exp(-((u / 0.13) ** 2) - ((v - 0.9) / 0.1) ** 2) * I;
        paint(k, q + fl * 0.3, q * (0.3 + 0.42 * q) + fl * 0.6, q * (0.04 + 0.2 * q * q) + fl * 0.5, (cov / 9) * a);
      }
    }
  };
  // the warm air round a lantern, in output cells
  const halo = (cx: number, cy: number, h: number, g: number, limit: number) => {
    const e = 0.4 * Z + 0.32 * h;
    const reach = Math.ceil(e * 4);
    const r0 = Math.max(0, Math.floor(cy - reach)), r1 = Math.min(limit - 1, Math.floor(cy + reach));
    const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(W - 1, Math.floor(cx + reach));
    for (let r = r0; r <= r1; r++) {
      const dy = r + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - 0.3 * h);
        const q = g * (Math.exp(-d / e) + 0.25 * Math.exp(-d / (e * 2.5)));
        const k = r * W + x;
        R[k] += q, G[k] += q * 0.5, B[k] += q * 0.17;
      }
    }
  };
  const hide = new Uint8Array(S);
  for (let k = 0; k < S; k++) hide[k] = mat[k] === TREE ? 1 : 0;
  // the festival's light laid on the water as a broad road, widening toward
  // us: per output row, in design units
  const roadX = new Float32Array(H), roadW = new Float32Array(H), roadA = new Float32Array(H);
  for (let r = WLO; r < H; r++) {
    const dw = dY(r) - WL;
    roadX[r] = SRC + 4 + dw * 0.12;
    roadW[r] = 6 + dw * 0.75;
    // near the shore the mirror carries the festival's light; the road takes
    // over further out
    roadA[r] = 0.9 * smooth(3, 16, dw) * Math.exp(-dw / 60);
  }
  // rows of the water whose ripples break the reflection into strips
  const gap = new Uint8Array(H);
  for (let r = WLO; r < H; r++) gap[r] = hash(r, 404) < 0.3 ? 1 : 0;
  // one row of the lake's ripple fields, every fourth cell
  const CW = (W >> 2) + 1;
  const nWave = new Float32Array(CW), nStreak = new Float32Array(CW), nDash = new Float32Array(CW), nSheen = new Float32Array(CW);
  const across = (a: Float32Array, x: number) => {
    const i = x >> 2;
    return a[i] + (a[i + 1] - a[i]) * (x & 3) * 0.25;
  };

  return (t, out) => {
    const breathe = 0.06 * Math.sin(t * 0.5) + 0.04 * Math.sin(t * 1.7 + 1);

    // --- the sky and the land -------------------------------------------------------
    for (let k = 0; k < S; k++) {
      const g = 1 + take[k] * breathe;
      R[k] = sR[k] * g, G[k] = sG[k] * g, B[k] = sB[k] * g;
      FL[k] = floorS[k];
    }

    // lanterns from the far shore, the furthest first: flown in design units,
    // drawn in output cells
    for (const f of shore) {
      const u = t / f.life + f.off;
      const lap = Math.floor(u);
      const a = (u - lap) * f.life;
      const cx = startX(f, lap) + lean(f, f.v * a) + f.sw * (Math.sin(a * f.sf + f.ph) - Math.sin(f.ph));
      const cy = WL + f.s * 0.5 + 0.6 - f.v * a;
      if (cy < -Y0 - 2 * f.s - 2) continue;
      let I = (0.7 + 0.45 * Math.min(1, f.s)) * (0.88 + 0.08 * Math.sin(t * f.f1 + f.ph) + 0.04 * Math.sin(t * f.f2));
      let alpha = 1;
      if (!f.out) {
        // burning out: it gutters, reddens and goes
        const end = smooth(f.life - 4, f.life, a);
        I *= 1 - 0.55 * end * (0.6 + 0.4 * Math.sin(a * 11 + f.ph));
        alpha = 1 - end;
      }
      if (alpha <= 0.01) continue;
      const px = oX(cx), py = oY(cy), ps = f.s * Z;
      if (f.s >= 1.4) halo(px, py, ps, 0.07 * I * alpha * smooth(0, 2, a), WLO);
      lantern(px, py, ps, I, alpha, WLO, hide);
    }
    // each a lamp held up over a dimmer figure
    for (const [x, r, ph] of shoreLights) {
      const k = r * W + x;
      const q = 0.9 + 0.15 * Math.sin(t * 3.1 + ph) + 0.1 * Math.sin(t * 7.3 + ph * 2);
      R[k] = q, G[k] = q * 0.62, B[k] = q * 0.24, FL[k] = 0.2;
      const b = k + W, p = 0.3 * q;
      R[b] += p, G[b] += p * 0.55, B[b] += p * 0.2;
    }
    // stars twinkle, wherever nothing brighter is in front of them
    for (const [k, ph, rate, b, sr, sg, sb] of stars) {
      if (Math.max(R[k], G[k], B[k]) > 0.35) continue;
      const s = b * (0.72 + 0.28 * Math.sin(t * rate + ph));
      R[k] += s * sr, G[k] += s * sg, B[k] += s * sb;
    }

    // --- the lake: the sky upside down, stretched and broken by slow ripples ----
    // Far off it is almost a mirror; toward us it reflects less and shows more
    // of its own dark water, and the ripples grow and break the image up.
    for (let r = WLO; r < H; r++) {
      const y = dY(r), rr = y - 0.5; // in design units
      // the broad ripple fields change slowly across a row, so they are
      // sampled every fourth cell and filled in between
      for (let i = 0; i < CW; i++) {
        const xd = dX(4 * i) - 0.5;
        nWave[i] = noise(xd * 0.04 + t * 0.05, rr * 0.55 - t * 0.35);
        nStreak[i] = noise(xd * 0.035 + t * 0.04, rr * 0.75 - t * 0.3);
        nDash[i] = noise(xd * 0.11 + t * 0.1, rr * 0.9 - t * 0.55);
        nSheen[i] = noise(xd * 0.07 + t * 0.03, rr * 1.1 - t * 0.25);
      }
      const dw = y - WL;
      const deep = mix(0.95, 0.42, Math.pow(dw / (YB - WL), 0.8));
      const ry = WLO - 1 - (r - WLO);
      const r0 = Math.max(0, ry) * W, r1 = Math.max(0, ry - 1) * W, r2 = Math.max(0, ry - 2) * W;
      const fade = smooth(YB + 4, YB - 7, y);
      const rx = roadX[r], rw = roadW[r], ra = roadA[r];
      const amp = Z * (0.45 + dw * 0.075);
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const xd = dX(x) - 0.5;
        const wave = across(nWave, x);
        const sx = x + amp * Math.sin(rr * 1.3 + t * 1.6 + wave * 4);
        let ix = Math.floor(sx);
        const fx = sx - ix;
        ix = Math.max(0, Math.min(W - 2, ix));
        const a0 = r0 + ix, a1 = r1 + ix, a2 = r2 + ix;
        const sky = mat[a0] !== TREE;
        // long level streaks where the ripples face us, darker troughs between,
        // and here and there a row of ripples showing the dark overhead
        const streak = smooth(0.25, 0.75, across(nStreak, x));
        let kr = (0.7 + 0.3 * streak) * (0.88 + 0.24 * wave) * deep;
        if (gap[r]) kr *= 1 - 0.55 * smooth(0.5, 0.3, wave);
        const gx = 1 - fx;
        let cr = ((R[a0] * gx + R[a0 + 1] * fx) * 0.5 + (R[a1] * gx + R[a1 + 1] * fx) * 0.3 + (R[a2] * gx + R[a2 + 1] * fx) * 0.2) * kr + 0.004;
        let cg = ((G[a0] * gx + G[a0 + 1] * fx) * 0.5 + (G[a1] * gx + G[a1 + 1] * fx) * 0.3 + (G[a2] * gx + G[a2 + 1] * fx) * 0.2) * kr + 0.008;
        let cb = ((B[a0] * gx + B[a0 + 1] * fx) * 0.5 + (B[a1] * gx + B[a1 + 1] * fx) * 0.3 + (B[a2] * gx + B[a2 + 1] * fx) * 0.2) * kr + 0.016;
        // the festival's road: a glow on the water, broken into short level
        // dashes where the ripples catch it, glinting on the sharpest of them
        let g = 0, glint = 0;
        const qx = (xd + 0.5 - rx) / rw;
        if (qx > -2.2 && qx < 2.2) {
          // the faces of the ripples tilted toward the festival carry its
          // light; the troughs between show the dark sky overhead
          const dash = smooth(0.4, 0.75, across(nDash, x));
          const on = ra * Math.exp(-qx * qx);
          g = on * (0.06 + 0.94 * dash) * (gap[r] ? 0.6 : 1);
          glint = on * smooth(0.8, 0.95, noise(xd * 0.9 + t * 0.6, rr * 2.3 - t * 2.2)) * dash;
        }
        // the shore lights laid on the water
        if (dw < 10) {
          for (let i = 0; i < shoreLights.length; i++) {
            const d = xd + 0.5 - shoreLights[i][3];
            if (d > 3 || d < -3) continue;
            g += Math.exp(-d * d * 1.5) * Math.exp(-dw / 4) * smooth(0.35, 0.7, noise(xd * 0.6 + shoreLights[i][2], y * 1.3 - t * 1.4)) * 0.8;
          }
        }
        // where the warm light lies thick on the water it covers the blue
        if (g > 0) {
          const keep = 1 - Math.min(0.85, g * 3);
          cr = cr * keep + g, cg = cg * keep + g * 0.54, cb = cb * keep + g * 0.2;
        }
        cr += glint * 1.2, cg += glint * 0.9, cb += glint * 0.5;
        // elsewhere the crests of the ripples catch the pale sky low over the far shore
        if (g < 0.2) {
          const sheen = smooth(0.6, 0.88, across(nSheen, x)) * 0.07 * (1 - g * 5) * deep;
          cr += sheen * 0.55, cg += sheen * 0.68, cb += sheen;
        }
        R[k] = cr * fade, G[k] = cg * fade, B[k] = cb * fade;
        FL[k] = (sky ? 0.05 * deep : 0.025) * fade;
      }
    }

    // --- the boat ------------------------------------------------------------------
    const tc = ((t % CYCLE) + CYCLE) % CYCLE;
    const bob = (at: number) => 0.3 * Z * Math.sin(at * 1.3);
    const holdY = BW - 14.1 * SC - HELD / 2;
    // each of the boat's lanterns flickers in its own time, the same in the
    // hands and after it is let go: m is the cycle it is let go in
    const flick = (m: number) => 1.1 + 0.05 * Math.sin(t * 4.7 + m * 2.1) + 0.03 * Math.sin(t * 11.3 + m * 5.3);
    const n = Math.floor(t / CYCLE);
    const mine = flick(tc < LET_GO ? n : n + 1);
    // the lantern in the figure's hands, if there is one, and how lit it is
    let hy = 0, hs = HELD, ha = 0;
    if (tc < LET_GO || tc >= LIT + 5) (hy = holdY + bob(t)), (ha = 1);
    else if (tc >= LIT) {
      // lit at the chest, filling with light, then lifted over the head
      ha = smooth(LIT, LIT + 2.5, tc);
      hs = HELD * (0.75 + 0.25 * smooth(LIT, LIT + 3, tc));
      hy = mix(BW - 8.6 * SC, holdY + bob(t), smooth(LIT + 3.5, LIT + 5, tc));
    }
    // the arms: held up a moment after the let-go, lowered, brought up to the
    // chest to light the next, and lifted with it over the head
    if (tc < LET_GO + 2) pose(ARMS.up, ARMS.down, smooth(LET_GO + 1, LET_GO + 2, tc));
    else if (tc < LIT + 1) pose(ARMS.down, ARMS.chest, smooth(LIT - 0.6, LIT, tc));
    else pose(ARMS.chest, ARMS.up, smooth(LIT + 3.5, LIT + 5, tc));
    // the lanterns already let go: this cycle's and the two before
    const flights: [number, number, number][] = [];
    for (let m = n; m >= n - 2; m--) {
      const tr = m * CYCLE + LET_GO, age = t - tr;
      if (age < 0) continue;
      const y = holdY + bob(tr) - 2.8 * Z * (age - 1.5 * (1 - Math.exp(-age / 1.5)));
      if (y < -3 * HELD) continue;
      flights.push([FX + Z * (0.3 * age + 1.2 * Math.sin(age * 0.35)), y, flick(m)]);
    }

    // their light: a glow in the air round each, and on the water a pool
    // round the boat and a broken road toward us, fading as a lantern rises
    // [x, the bottom of the lantern, how much of it reaches the water and the
    // boat, how big its pool is], in output cells
    const lights: [number, number, number, number][] = [];
    const lamp = 1.2 + 0.04 * Math.sin(t * 5.3) + 0.03 * Math.sin(t * 12.7);
    lights.push([BOWX, BOWY + Z, 0.4 * lamp, 0.4]);
    halo(BOWX, BOWY, 2 * Z, 0.07 * lamp, H);
    if (ha > 0) lights.push([FX, hy + hs / 2, ha * mine, 1]);
    for (const [x, y, l] of flights) {
      halo(x, y, HELD, 0.2 * l, H);
      lights.push([x, y + HELD / 2, l * Math.exp(-Math.max(0, holdY - y) / (8 * Z)), 1]);
    }
    if (ha > 0) halo(FX, hy, HELD, 0.2 * ha * mine, H);
    // Water barely scatters light, so a lantern lays little more than a faint
    // pool round the boat; what carries is its reflection, a broken column
    // of glints running toward us.
    for (const [lx, , q, sz] of lights) {
      if (q < 0.003) continue;
      for (let r = Math.floor(BW - 9 * SC); r < H; r++) {
        const y = r + 0.5, dw = y - BW, yd = y / Z - Y0;
        for (let x = Math.max(0, Math.floor(lx - 34 * Z * sz)); x < Math.min(W, lx + 34 * Z * sz); x++) {
          const k = r * W + x;
          const dx = x + 0.5 - lx;
          // the water behind the boat is further off, so its pool is squashed
          let g = Math.exp(-Math.sqrt((dx / (16 * SC * 0.8 * sz)) ** 2 + (dw / ((dw < 0 ? 2.6 : 3.6) * SC * sz)) ** 2)) * 0.2;
          if (dw > -Z) {
            const w = (1.4 * Z + 0.2 * Math.max(0, dw)) * (0.5 + 0.5 * sz);
            const col = Math.exp(-((dx / w) ** 2)) * Math.exp(-Math.max(0, dw) / (16 * Z * sz));
            if (col * q > 0.004) {
              const xd = (x + 0.5) / Z;
              g += col * smooth(0.4, 0.72, noise(xd * 0.45 + 2.7, yd * 1.2 - t * 1.3)) * 1.1;
              g += col * smooth(0.8, 0.96, noise(xd * 1.1 + t * 0.5, yd * 2.6 - t * 2.4)) * 1.4;
            }
          }
          g *= q;
          const keep = 1 - Math.min(0.85, g * 3);
          R[k] = R[k] * keep + g, G[k] = G[k] * keep + g * 0.6, B[k] = B[k] * keep + g * 0.25;
        }
      }
    }
    // the boat's own reflection, a dark shape wavering under it that blocks
    // the light on the water
    for (let r = Math.ceil(BW); r < Math.min(H, BW + 5 * SC); r++) {
      const j = Math.floor(2 * BW - r - 0.5) - BOX[1];
      if (j < 0 || j >= BOX[3]) continue;
      const shift = Math.round(0.6 * Math.sin(r * 1.7 + t * 2.1));
      const dim = 0.25 + 0.5 * smooth(BW, BW + 5 * SC, r);
      for (let i = 0; i < BOX[2]; i++) {
        const si = i - shift, x = BOX[0] + i;
        if (si < 0 || si >= BOX[2] || x < 0 || x >= W || hulls[j * BOX[2] + si] === 0) continue;
        const k = r * W + x;
        R[k] *= dim, G[k] *= dim, B[k] *= dim;
      }
    }
    // the boat and the figure, dark against it, their edges lit from above
    for (let j = 0; j < BOX[3]; j++) {
      for (let i = 0; i < BOX[2]; i++) {
        const m = shape[j * BOX[2] + i];
        if (!m) continue;
        const x = BOX[0] + i, r = BOX[1] + j;
        if (x < 0 || x >= W || r >= H) continue;
        const k = r * W + x;
        // the sides of the figure, a thin rim against the road behind
        let g = m === 2 && (i === 0 || i === BOX[2] - 1 || !shape[j * BOX[2] + i - 1] || !shape[j * BOX[2] + i + 1]) ? 0.12 : 0;
        const top = j === 0 || !shape[(j - 1) * BOX[2] + i];
        // the hull's planks, a shade apart
        const plank = m === 1 ? 0.8 + 0.4 * hash(Math.floor((r - BW) / (0.9 * SC)), 9) : 1;
        for (const [lx, ly, lq] of lights) {
          if (lq < 0.003) continue;
          const dx = lx - (x + 0.5), dy = ly - (r + 0.5);
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (m === 2) {
            // the neighbour toward the light: if it is open, this cell is an edge facing it
            const ni = i + Math.round(dx / d), nj = j + Math.round(dy / d);
            const open = ni < 0 || nj < 0 || ni >= BOX[2] || nj >= BOX[3] || !shape[nj * BOX[2] + ni];
            g += lq * (open ? 0.95 : 0.05) * Math.exp(-d / (6 * SC));
          } else {
            // the gunwale catches the light along its length, the planks
            // below it a little, fading down the side
            const below = (BW - (r + 0.5)) / SC;
            g += lq * (top ? 0.8 * Math.exp(-Math.abs(dx) / (11 * SC)) : 0.05 * smooth(-0.5, 3, below) * Math.exp(-d / (8 * SC)));
          }
        }
        R[k] = (0.014 + g) * plank, G[k] = (0.01 + g * 0.55) * plank, B[k] = (0.012 + g * 0.22) * plank;
        FL[k] = 0;
      }
    }
    lantern(BOWX, BOWY, 2 * Z, lamp, 1, H, null);
    for (const [x, y, q] of flights) lantern(x, y, HELD, q, 1, H, null);
    if (ha > 0) lantern(FX, hy, hs, ha * mine, Math.min(1, ha * 1.4), H, null);

    // --- lanterns rising past us, flown in design units ---------------------------------
    for (const c of close) {
      const u = t / c.life + c.off;
      const lap = Math.floor(u);
      const a = (u - lap) * c.life;
      // before its first flight it is still waiting below the frame
      if (lap < 0 || a * c.v > c.path) continue;
      let x0 = c.x;
      if (lap) {
        x0 = 6 + 188 * hash(c.i * 17 + lap, 44);
        if (x0 > 84 && x0 < 132) x0 = x0 < 108 ? x0 - 32 : x0 + 32; // clear of the boat
      }
      const cx = x0 + c.wd * a + c.sw * (Math.sin(a * c.sf + c.ph) - Math.sin(c.ph));
      const cy = YB + 2.5 * c.s - c.v * a;
      const I = 1.15 + 0.05 * Math.sin(t * 3.3 + c.ph) + 0.03 * Math.sin(t * 8.1 + c.i);
      halo(oX(cx), oY(cy), c.s * Z, 0.13 * I, H);
      lantern(oX(cx), oY(cy), c.s * Z, I, 1, H, null);
    }

    // --- dots ---------------------------------------------------------------------------
    for (let k = 0; k < N; k++) {
      const q = grain[k];
      dot(out, k, R[k] * q, G[k] * q, B[k] * q, FL[k]);
    }
  };
}
