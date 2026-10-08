/*
 * ocean sunset: golden hour at sea. The sun rests on the horizon beyond a dark
 * pine headland, heaped cloud overhead lit from below, a glitter path running
 * across the water toward us, and long swells rolling in, their crests
 * catching the light.
 *
 * Shaded in true colour per cell on a square grid, then drawn as a halftone:
 * dot size is brightness. The land and clear sky are built once, the clouds
 * are wrapping fields that drift, and the sea is shaded each frame. A small
 * sloop sits dark against the glow just left of the sun.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "ocean sunset",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#0b0817",
} satisfies Meta;

// The picture is designed on a 200-wide grid and sampled finer: an output
// cell (ox, oy) sits at design x = (ox + .5) / S, y = (oy + .5) / S - Y0, so
// the 16:9 frame shows Y0 more design rows of sky above and some sea below.
const W = 320, H = 180;
const S = W / 200, Y0 = 6.5;
const HZ = 56; // the horizon, in design rows
const HR = Math.round((HZ + Y0) * S); // output rows of sky above it
const SUN = [134, HZ - 4.5];
const SR = 8.5; // the sun's radius
const BOAT = 112; // the sloop's mast
// wind chop on the swell: [dir x, dir z, wavenumber, slope, speed, offset]
const CHOP = [
  [-0.45, 0.89, 22, 0.07, 2.1, 0.4],
  [0.5, 0.87, 37, 0.06, 2.9, 2.1],
  [-0.15, 0.99, 61, 0.05, 3.7, 4.4],
  [0.3, 0.95, 97, 0.04, 4.6, 1.3],
];
// pines on the headland: [x, height, half width at the foot]
const PINES = [[2.5, 10, 2.6], [8, 13, 3], [13, 18, 3.6], [18.5, 11, 2.8], [24, 20, 3.8], [30, 12, 2.9], [35, 8, 2.3], [39.5, 5, 1.8]];
const RAYP = 24; // lattice cells of ray noise once round the sun

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

// The sky's gradient away from the sun, top to horizon, as [stop, r, g, b]:
// deep twilight blue overhead, through dusty mauve and rose, to a hazy peach
// at the horizon. Toward the sun it is warmed to gold as it is built.
const STOPS = [
  [-0.15, 0.02, 0.032, 0.1],
  [0, 0.032, 0.05, 0.15],
  [0.22, 0.07, 0.085, 0.22],
  [0.42, 0.16, 0.13, 0.27],
  [0.6, 0.34, 0.2, 0.31],
  [0.76, 0.58, 0.3, 0.33],
  [0.9, 0.78, 0.42, 0.36],
  [1, 0.86, 0.52, 0.4],
];
function gradient(v: number, out: number[]): void {
  let i = 1;
  while (i < STOPS.length - 1 && v > STOPS[i][0]) i++;
  const a = STOPS[i - 1], b = STOPS[i];
  const k = clamp((v - a[0]) / (b[0] - a[0]));
  out[0] = mix(a[1], b[1], k), out[1] = mix(a[2], b[2], k), out[2] = mix(a[3], b[3], k);
}

// The headland: its skyline row at x, and the row where its foot meets the sea.
const ridge = (x: number) =>
  HZ + 2.5 - 11 * Math.pow(smooth(54, 32, x), 0.7) - 2.4 * Math.exp(-(((x - 19) / 9) ** 2)) - 2 * fbm(x * 0.21, 3.3, 3, 0);
const shore = (x: number) => HZ + 1.5 + 5 * smooth(54, 4, x);
// a sea stack off the point
const stack = (x: number) => (x > 52 && x < 58 ? HZ - 3.5 - 1.6 * fbm(x * 0.6, 8.1, 2, 0) + 2.5 * ((x - 55) / 3) ** 4 : 1e9);

export default function oceanSunset(): Frame {
  const N = W * H;
  // design coordinates of each output column and row
  const XD = new Float32Array(W), YD = new Float32Array(H);
  for (let x = 0; x < W; x++) XD[x] = (x + 0.5) / S;
  for (let r = 0; r < H; r++) YD[r] = (r + 0.5) / S - Y0;
  // the output cell holding a design point
  const colAt = (x: number) => Math.floor(x * S);
  const rowAt = (y: number) => Math.floor((y + Y0) * S);
  // a faint print grain: each cell a touch lighter or darker, for good
  const grain = new Float32Array(N);
  for (let k = 0; k < N; k++) grain[k] = 0.95 + 0.1 * hash(k, 77);

  // --- the clear sky, built once ------------------------------------------
  const sky = new Float32Array(HR * W * 3);
  // crepuscular rays: each sky cell's bearing round the sun, and how much
  // of the rays it shows
  const rayU = new Float32Array(HR * W), rayW = new Float32Array(HR * W);
  const g = [0, 0, 0];
  for (let r = 0; r < HR; r++) {
    const y = YD[r];
    const v = y / HZ;
    for (let x = 0; x < W; x++) {
      const xc = XD[x];
      const dx = xc - SUN[0], dy = (y - SUN[1]) * 1.6;
      const d = Math.sqrt(dx * dx + dy * dy);
      const near = Math.exp(-Math.abs(dx) / 62);
      // above the old frame's top the gradient runs on into deeper blue
      gradient(v > 0 ? Math.pow(v, 1 + 0.15 * (1 - near)) : v, g);
      // toward the sun the low sky burns gold instead of rose
      const warm = Math.exp(-Math.abs(dx) / 42) * smooth(0.35, 1, v) * 0.9;
      const lum = mix(0.5, 1.08, smooth(0.35, 1, v));
      g[0] = mix(g[0], lum, warm), g[1] = mix(g[1], mix(0.42, 0.7, v) * lum, warm), g[2] = mix(g[2], mix(0.3, 0.33, v) * lum, warm);
      // and away from it the horizon dims and greys under the earth's shadow
      const fall = mix(1, 0.78 + 0.22 * near, smooth(0.55, 1, v));
      // forward scattering round the sun: a wide warm halo and a hot core
      const halo = Math.exp(-d / 48) * 0.17, core = Math.exp(-d / 13) * 0.24 + Math.exp(-d / 5) * 0.3;
      // high haze in long thin bands, plainer up high where the air is clear
      const haze = 1 + mix(0.06, 0.2, clamp(v)) * (fbm(xc * 0.03, y * 0.12, 3, 0) - 0.5) * 2;
      const vig = (1 - 0.08 * Math.pow(Math.abs(xc - 100) / 100, 2)) * haze * fall;
      const k = (r * W + x) * 3;
      sky[k] = g[0] * vig + halo + core;
      sky[k + 1] = g[1] * vig + halo * 0.72 + core * 0.86;
      sky[k + 2] = g[2] * vig + halo * 0.42 + core * 0.62;
      const kr = r * W + x;
      rayU[kr] = (Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) * RAYP;
      rayW[kr] = 0.5 * smooth(SR + 2, SR + 14, d) * Math.exp(-d / 55) * smooth(HZ - 1, HZ - 7, y);
    }
  }
  // the hazy horizon just above the sea, per column, for the far water
  const HZR = new Float32Array(W), HZG = new Float32Array(W), HZB = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const k = ((HR - 2) * W + x) * 3;
    HZR[x] = sky[k], HZG[x] = sky[k + 1], HZB[x] = sky[k + 2];
  }

  // --- the headland and its pines, built once ------------------------------
  // Backlit by the sun, they are lit mostly by the cool sky, with warm light
  // only on the edges and faces that turn toward the sun, and they sink into
  // the horizon haze toward their feet.
  const LANDW = 60; // design columns
  const LW = Math.ceil(LANDW * S), LH = Math.ceil((HZ + 10 + Y0) * S); // output extent
  const land = new Uint8Array(N); // 1 rock, 2 pine, 3 sloop
  const LR = new Float32Array(N), LG = new Float32Array(N), LB = new Float32Array(N);
  // the rock's seaward edge on each row (design x), for the light on the cliff face
  const edge = new Float32Array(LH).fill(-1);
  for (let r = 0; r < LH; r++) {
    const y = YD[r];
    for (let x = 0; x < LW; x++) if (y >= ridge(XD[x]) && y < shore(XD[x])) edge[r] = XD[x];
  }
  for (let r = 0; r < LH; r++) {
    const y = YD[r];
    for (let x = 0; x < LW; x++) {
      const k = r * W + x, xc = XD[x];
      const t0 = ridge(xc), st = stack(xc), ft = shore(xc);
      let cr!: number, cg!: number, cb!: number, mist = 0;
      if ((y >= t0 && y < ft) || (y >= st && y < HZ + 1.2)) {
        land[k] = 1;
        const isStack = !(y >= t0 && y < ft);
        const top = isStack ? st : t0;
        // dark slate rock in rough strata, cracked finer within
        const s = (0.55 + 0.9 * fbm(xc * 0.22, y * 0.7, 3, 0)) * (0.8 + 0.4 * fbm(xc * 1.3 + 5, y * 2.2, 2, 0));
        // wet and shadowed where it meets the water
        const occ = isStack ? mix(0.6, 1, smooth(HZ + 1.2, HZ - 1, y)) : mix(0.55, 1, smooth(ft, ft - 2.5, y));
        cr = 0.05 * s * occ, cg = 0.046 * s * occ, cb = 0.068 * s * occ;
        // the sun is low and to the right: slopes that drop toward it catch it
        const facing = clamp(0.4 + (isStack ? 0.5 : (ridge(xc + 1.2) - ridge(xc - 1.2)) * 0.45));
        const rim = smooth(top + 1.6, top + 0.2, y) * facing;
        // the cliff face, warm where it turns to the sun, broken by crags
        const crag = smooth(0.35, 0.75, fbm(xc * 0.4 + 3, y * 0.5, 3, 0));
        const face = isStack ? smooth(53.5, 57.5, xc) * 0.7 : edge[r] > 30 ? Math.exp(-(edge[r] - xc) / 4) * smooth(HZ + 5, HZ - 4, y) : 0;
        const lit = clamp(Math.max(rim * 0.85, face * (0.3 + 0.7 * crag) * 0.8));
        cr = mix(cr, 0.98, lit), cg = mix(cg, 0.46, lit * 0.95), cb = mix(cb, 0.26, lit * 0.9);
        // haze over the rock, though the sunlit faces burn through it
        mist = (isStack ? 0.26 : 0.05 + 0.13 * smooth(HZ - 8, HZ + 3, y)) * (1 - 0.6 * lit);
      }
      for (const [tx, th, tw] of PINES) {
        const tb = ridge(tx);
        const dy = y - (tb - th);
        // a conifer: a spire that widens in tiers of branches
        const tier = (dy + th * 0.3) / 2.4;
        const tf = tier - Math.floor(tier);
        const half = (dy / th) * tw * (0.5 + 0.75 * tf) + 0.3;
        const ex = xc - tx;
        if (dy >= 0 && y < tb + 1.5 && Math.abs(ex) <= half) {
          land[k] = 2;
          // needles in clumps, the tips of each tier catching a little sky
          const s = (0.6 + 0.5 * hash(x * 13 + r, 5)) * (0.75 + 0.5 * tf) * (0.8 + 0.4 * noise(xc * 1.5, y * 1.5, 0));
          cr = 0.026 * s, cg = 0.036 * s, cb = 0.044 * s;
          // the right flank faces the sun
          const e = ex > 0 && ex > half - 0.8 ? (0.25 + 0.3 * smooth(th, 0, dy)) * (0.6 + 0.4 * tf) : 0;
          cr = mix(cr, 0.9, e), cg = mix(cg, 0.4, e), cb = mix(cb, 0.22, e);
          mist = 0.04;
        }
      }
      if (land[k]) {
        LR[k] = mix(cr, HZR[x], mist), LG[k] = mix(cg, HZG[x], mist), LB[k] = mix(cb, HZB[x], mist);
      }
    }
  }
  // a small sloop out on the water, dark against the glow left of the sun
  for (let r = rowAt(HZ - 10); r <= rowAt(HZ + 4); r++) {
    const y = YD[r];
    for (let x = colAt(BOAT - 7); x <= colAt(BOAT + 7); x++) {
      const k = r * W + x, ex = XD[x] - BOAT;
      const hull = y >= HZ + 1 && y < HZ + 3 && Math.abs(ex - 0.3) < 4.6 - (y - HZ - 1) * 1.3;
      const mast = Math.abs(ex) < 0.32 && y >= HZ - 9.2 && y < HZ + 1;
      const main = ex > 0 && y >= HZ - 8.5 && y < HZ + 0.5 && ex < 0.5 + (y - (HZ - 8.5)) * 0.42;
      const jib = ex < 0 && y >= HZ - 7 && y < HZ + 0.5 && -ex < (y - (HZ - 7)) * 0.36;
      if (hull || mast || main || jib) {
        land[k] = 3;
        // the sails are thin enough to glow a little with the sun behind
        // them; the whole boat is far enough off to sit in a little haze
        const glow = main ? 0.1 + 0.2 * smooth(0, 3.5, ex) : jib ? 0.04 : 0;
        LR[k] = mix(0.035 + glow, HZR[x], 0.16);
        LG[k] = mix(0.028 + glow * 0.5, HZG[x], 0.16);
        LB[k] = mix(0.04 + glow * 0.26, HZB[x], 0.16);
      }
    }
  }

  // --- the cloud deck: a sheet of heaped cloud seen from below, laid out on
  // its own plane so it shrinks and flattens toward the horizon -------------
  const U = 640, V = 128;
  const deck = new Float32Array(U * V), deckLit = new Float32Array(U * V);
  const deckAt = (u: number, v: number) => {
    const q = fbm(u * 0.0125, v * 0.06, 2, 8);
    const patch = fbm(u * 0.00625, v * 0.03 + 7, 2, 4);
    return fbm(u * 0.040625 + q * 1.6, v * 0.3, 5, 26) + 0.25 * (patch - 0.5);
  };
  for (let v = 0; v < V; v++) {
    for (let u = 0; u < U; u++) {
      const d = deckAt(u, v);
      deck[v * U + u] = d;
      // the side of each heap that faces the horizon, and the sun, is lit
      deckLit[v * U + u] = clamp(0.5 + (d - deckAt(u, v + 2.5)) * 9);
    }
  }
  // thinning toward the zenith, ragged rather than a ruled line
  const thinTop = new Float32Array(W * HR);
  for (let r = 0; r < HR; r++) for (let x = 0; x < W; x++) thinTop[r * W + x] = fbm(XD[x] * 0.05 + 11, YD[r] * 0.15, 2, 0);

  // --- low bars over the horizon: a wrapping field that drifts, kept at the
  // output's own resolution (column i is design x = i / S) ------------------
  const CW = 720, CWO = Math.round(CW * S);
  const LOTOP = HZ - 22; // nothing higher than this
  const loCover = new Float32Array(CWO * HR), loLit = new Float32Array(CWO * HR);
  const lower = (x: number, y: number) => {
    // long thin bars low over the horizon
    const b = fbm(x / 40, y * 0.3, 4, CW / 40);
    const gaps = fbm(x / 120, 5, 2, CW / 120);
    return b + 0.01 + 0.5 * (gaps - 0.5) - 0.35 * smooth(HZ - 14, HZ - 20, y) - 0.25 * smooth(HZ - 4, HZ - 1, y);
  };
  for (let r = 0; r < HR; r++) {
    const y = YD[r];
    if (y < LOTOP) continue;
    for (let i = 0; i < CWO; i++) {
      const x = i / S;
      const k = r * CWO + i;
      const dl = lower(x, y);
      loCover[k] = smooth(0.56, 0.68, dl);
      loLit[k] = clamp(0.5 + (dl - lower(x, y + 1.2)) * 6);
    }
  }

  // this frame's sky, finished, for the sea to mirror, and a blurred copy
  // for the rougher water close in
  const SKR = new Float32Array(HR * W), SKG = new Float32Array(HR * W), SKB = new Float32Array(HR * W);
  const BKR = new Float32Array(HR * W), BKG = new Float32Array(HR * W), BKB = new Float32Array(HR * W);
  const tmp = new Float32Array(HR * W);
  const BL = 3; // blur radius, cells
  const blur = (src: Float32Array, dst: Float32Array) => {
    // a box across, then a box down, clamped at the edges
    for (let r = 0; r < HR; r++) {
      const o = r * W;
      let s = 0;
      for (let i = -BL; i <= BL; i++) s += src[o + Math.max(0, Math.min(W - 1, i))];
      for (let x = 0; x < W; x++) {
        tmp[o + x] = s;
        s += src[o + Math.min(W - 1, x + BL + 1)] - src[o + Math.max(0, x - BL)];
      }
    }
    const n = 1 / ((2 * BL + 1) * (2 * BL + 1));
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -BL; i <= BL; i++) s += tmp[Math.max(0, Math.min(HR - 1, i)) * W + x];
      for (let r = 0; r < HR; r++) {
        dst[r * W + x] = s * n;
        s += tmp[Math.min(HR - 1, r + BL + 1) * W + x] - tmp[Math.max(0, r - BL) * W + x];
      }
    }
  };
  const STARS = rowAt(22);
  const HD = YD[H - 1] + 0.5 / S; // the frame's bottom, in design rows

  return (t, px) => {
    const dUp = t * 0.9, dLo = t * 1.7;
    const rayT = t * 0.035;
    for (let r = 0; r < HR; r++) {
      const y = YD[r];
      const dy = y - SUN[1];
      const v = y / HZ;
      // the cloud deck, found on its plane: far rows are far away
      const D = 58 / (HZ - y + 2.5);
      // a band of heaped cloud mid-sky: clear above and clear in the low glow
      const far = smooth(4.8, 2.7, D) * smooth(1.08, 1.7, D);
      const sv = (D - 0.9) * 10, iv = Math.floor(sv), fv = sv - iv;
      const low = v * v;
      // far cloud sinks into the haze over the horizon
      const aerial = 0.4 * smooth(2.2, 4.6, D);
      const loRow = r * CWO;
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const s = k * 3;
        let cr = sky[s], cg = sky[s + 1], cb = sky[s + 2];
        // rays fanning up from the sun, slowly shifting
        const rw = rayW[k];
        if (rw > 0.01) {
          const u = rayU[k];
          const n = 0.65 * noise(u, rayT, RAYP) + 0.35 * noise(u * 2, rayT * 1.7 + 9, RAYP * 2);
          const m = 1 + rw * (n - 0.5) * 2;
          cr *= m, cg *= m, cb *= m;
        }
        const dx = XD[x] - SUN[0];
        let disc = 0, pr = 0, pg = 0, pb = 0;
        const ds = Math.sqrt(dx * dx + (dy / 0.9) ** 2);
        if (ds < SR + 0.6) {
          // the disc, a little flattened, white-hot at the core and darkening
          // to orange at the limb, redder still along its lower edge
          const e = ds / SR;
          const mu = Math.sqrt(1 - Math.min(1, e * e));
          const sink = clamp(0.5 + dy / (2 * SR));
          disc = smooth(SR + 0.35, SR - 0.35, ds);
          pr = cr, pg = cg, pb = cb;
          cr = mix(cr, 1.0, disc);
          cg = mix(cg, 0.66 + 0.31 * mu - 0.08 * sink, disc);
          cb = mix(cb, 0.32 + 0.52 * mu - 0.12 * sink, disc);
        }
        const near = Math.exp(-Math.sqrt(dx * dx + dy * dy * 2.5) / 45);
        let cloud = 0;
        if (far > 0) {
          const su = dx * D + dUp + 64200;
          let iu = Math.floor(su);
          const fu = su - iu;
          iu %= U;
          const iu1 = (iu + 1) % U, a0 = iv * U, a1 = a0 + U;
          const d0 = deck[a0 + iu] + (deck[a0 + iu1] - deck[a0 + iu]) * fu;
          const d1 = deck[a1 + iu] + (deck[a1 + iu1] - deck[a1 + iu]) * fu;
          const dd = d0 + (d1 - d0) * fv - 0.22 * (1 - far) * thinTop[k];
          const c = smooth(0.55, 0.7, dd) * Math.sqrt(far);
          if (c > 0.01) {
            cloud = c;
            const l0 = deckLit[a0 + iu] + (deckLit[a0 + iu1] - deckLit[a0 + iu]) * fu;
            const l1 = deckLit[a1 + iu] + (deckLit[a1 + iu1] - deckLit[a1 + iu]) * fu;
            const l = l0 + (l1 - l0) * fv;
            // undersides glow gold toward the sun and rose away from it, and
            // more the lower they sit; thick cores stay a dusky slate
            const az = Math.exp(-Math.abs(dx) / 60);
            const thin = 1 - smooth(0.6, 0.78, dd);
            const under = Math.pow(smooth(0.4, 0.92, l), 1.5);
            // the flanks of each heap that turn toward the sun catch it too
            const gu = mix(deck[a0 + iu1] - deck[a0 + iu], deck[a1 + iu1] - deck[a1 + iu], fv);
            const side = clamp(0.5 + (dx < 0 ? -gu : gu) * 7);
            const b = clamp((0.1 + 0.9 * under) * (0.42 + 0.3 * low + 0.34 * az) * (0.55 + 0.9 * side) + 0.25 * thin * az * low);
            const warm = clamp(az * (0.15 + 1.1 * low));
            // the shaded body takes its tint from the sky around it
            const shr = cr * 0.42 + 0.05, shg = cg * 0.42 + 0.04, shb = cb * 0.46 + 0.065;
            const core = 1 - 0.45 * smooth(0.66, 0.86, dd);
            let kr = mix(shr, mix(0.86, 1.0, warm), b) * core;
            let kg = mix(shg, mix(0.44, 0.74, warm), b) * core;
            let kb = mix(shb, mix(0.5, 0.44, warm), b) * core;
            // a silver lining where the thin edges are shot through with sun
            const lining = 4 * c * (1 - c) * thin * az * (0.25 + 0.75 * low) * 0.45;
            kr += lining, kg += lining * 0.8, kb += lining * 0.6;
            kr = mix(kr, cr, aerial), kg = mix(kg, cg, aerial), kb = mix(kb, cb, aerial);
            cr = mix(cr, kr, c), cg = mix(cg, kg, c), cb = mix(cb, kb, c);
          }
        }
        // the low bars, dark against the glow with burning edges
        if (y >= LOTOP) {
          const sx = (XD[x] + dLo) * S, ix = Math.floor(sx), fx = sx - ix;
          const i0 = loRow + (ix % CWO), i1 = loRow + ((ix + 1) % CWO);
          // thinned over the sun and kept off the sky behind the headland
          const c = (loCover[i0] + (loCover[i1] - loCover[i0]) * fx) * (1 - 0.75 * Math.exp(-((dx / 13) ** 2))) * (1 - 0.85 * smooth(76, 50, XD[x]));
          if (c > 0.01) {
            cloud = Math.max(cloud, c);
            const l = loLit[i0] + (loLit[i1] - loLit[i0]) * fx;
            const rim = Math.pow(l, 2) * (0.3 + 0.9 * near);
            const a = Math.min(1, c * 1.2) * 0.9;
            // slate-mauve bodies, half lost in the haze behind them
            const br = mix(cr, 0.2, 0.62), bg = mix(cg, 0.1, 0.62), bb = mix(cb, 0.16, 0.62);
            cr = mix(cr, mix(br, 1.0, rim), a);
            cg = mix(cg, mix(bg, mix(0.42, 0.68, near), rim), a);
            cb = mix(cb, mix(bb, mix(0.38, 0.36, near), rim), a);
          }
        }
        // the first stars, high up where the sky has gone to deep blue: one
        // output cell each, so they stay fine points, some warm, some cool
        if (r < STARS && cloud < 0.05 && hash(x, r * 5 + 3) > 0.9966) {
          const h = hash(r, x);
          const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + h * 1.6) + hash(x, r) * 6.28);
          const st = tw * smooth(22, 4, y) * 0.8;
          const hue = hash(x + 9, r);
          cr = Math.max(cr, st * mix(0.8, 1, hue)), cg = Math.max(cg, st * 0.9), cb = Math.max(cb, st * mix(1, 0.78, hue));
        }
        // the sea is too rough to mirror the disc whole: under it, it gives
        // back the glow round the disc, and the column adds the glitter
        SKR[k] = mix(cr, pr, disc), SKG[k] = mix(cg, pg, disc), SKB[k] = mix(cb, pb, disc);
        if (land[k]) dot(px, k, LR[k], LG[k], LB[k], 0.02);
        else {
          const gr = grain[k];
          dot(px, k, cr * gr, cg * gr, cb * gr, 0.05);
        }
      }
    }
    blur(SKR, BKR), blur(SKG, BKG), blur(SKB, BKB);

    for (let r = HR; r < H; r++) {
      const y = YD[r];
      // the sea: each cell is a facet of water that mirrors whatever part
      // of the sky its tilt points it at
      const dz = y - HZ;
      const Z = 36 / dz; // distance out
      const rows = 36 / (dz * dz); // how much sea one row spans
      const swellAmt = smooth(8, 26, dz);
      const hot = Math.exp(-dz / 9);
      const pw = 3 + dz * 0.8; // the glitter path, wider as it comes toward us
      const fx = (0.9 / (1 + dz * 0.06)) * 0.35, fy = 1.6 / (1 + dz * 0.05);
      // Fresnel: a mirror at the grazing angles far out, and close in we
      // mostly look down into dark water
      const fres = 0.16 + 0.7 * Math.exp(-dz / 9);
      // rougher water close in breaks the reflections up and smears them
      const smear = smooth(2, 20, dz);
      // haze lying over the far water
      const mist = 0.5 * Math.exp(-dz / 2.4);
      const depth = smooth(HZ, 100, y);
      const fade = smooth(HD + 6, HD - 4, y);
      const swell = 0.11 * clamp(1.4 / (13 * rows));
      const colW = 1.0 + dz * 0.22, colFall = Math.exp(-dz / 5) * smooth(0, 3, dz);
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        if (land[k]) {
          dot(px, k, LR[k], LG[k], LB[k], 0.02);
          continue;
        }
        const xc = XD[x];
        const dx = xc - SUN[0];
        const X = (xc - 100) / dz;
        // the long swell rolls toward us; shorter chop rides on it
        const p = 13 * (Z + 0.05 * X) + 2.2 * fbm(X * 0.35 + 3, Z * 0.4, 2, 0) + t * 0.8;
        const wv = Math.sin(p), slope = Math.cos(p);
        let sz = swell * slope, sxl = 0.015 * slope;
        for (let i = 0; i < CHOP.length; i++) {
          const [kx, kz, kk, a, w, f] = CHOP[i];
          const ph = kk * (kx * X + kz * Z) - w * t + f;
          const c = Math.cos(ph) * a * clamp(1.6 / (kk * rows));
          sz += c * kz, sxl += c * kx;
        }
        // (far out, the facets we see are the ones tipped toward us, and they
        // mirror sky a little higher than the horizon)
        let ry = rowAt(Math.round(HZ - 1 - dz * 0.85 - 3 * Math.exp(-dz / 10) - 70 * sz) + 0.5);
        ry = ry < 0 ? 0 : ry > HR - 1 ? HR - 1 : ry;
        let rx = colAt(xc - 60 * sxl);
        rx = rx < 0 ? 0 : rx > W - 1 ? W - 1 : rx;
        const q = ry * W + rx;
        // broken into long horizontal ripples, each giving back a little more
        // or less of the sky, over a dark slate-blue body of water
        const rip = noise(xc * fx * 1.4 + 13 - t * 0.15, y * fy * 1.1 + t * 0.25, 0);
        const rf = fres * (0.55 + 1.0 * rip * rip);
        const body = 1 - fres;
        // a touch cooler than the sky it mirrors: the ripples tipped toward
        // us mix in some of the bluer sky overhead
        let cr = mix(SKR[q], BKR[q], smear) * rf * 0.8 + body * (0.014 + 0.006 * depth);
        let cg = mix(SKG[q], BKG[q], smear) * rf * 0.88 + body * (0.024 + 0.008 * depth);
        let cb = mix(SKB[q], BKB[q], smear) * rf * 1.1 + body * (0.05 + 0.014 * depth);
        // ripple facets that catch the sun: short dashes far out, longer
        // close in, each turning toward the sun and away again
        const n = 0.55 * noise(xc * fx + t * 0.3, y * fy * 1.3 - t * 0.4, 0) + 0.45 * noise(xc * fx * 1.7 - t * 0.4, y * fy * 2 + t * 0.3 + 40, 0);
        const wave = Math.floor(p / (2 * Math.PI));
        const crest = swellAmt > 0 ? Math.pow(0.5 + 0.5 * wv, 7) * swellAmt * smooth(0.4, 0.65, noise(X * 2.5 + 7, wave * 3.7, 0)) : 0;
        const path = Math.exp(-((dx / pw) ** 2));
        const soft = Math.exp(-((dx / (pw * 1.6)) ** 2));
        // the near face of a swell is in shadow
        if (slope > 0) {
          const d = 1 - 0.7 * swellAmt * slope;
          cr *= d, cg *= d, cb *= d;
        }
        const th = 0.84 - 0.3 * path * (0.45 + 0.55 * hot);
        const glint = smooth(th, th + 0.08, n) * (0.25 + 0.75 * path) * soft;
        const white = path * path * smooth(th + 0.04, th + 0.2, n);
        // a warm sheen under the sun, then the glints themselves: gold-white
        // in the heart of the path, orange out at its edges
        const sheen = soft * (0.35 + hot);
        cr += 0.2 * sheen + glint * 1.1;
        cg += 0.11 * sheen + glint * (0.56 + 0.3 * hot + 0.35 * white);
        cb += 0.045 * sheen + glint * (0.22 + 0.25 * hot + 0.45 * white);
        // single facets flashing for a moment as they turn to the sun
        if (path > 0.08) {
          const h = hash(x * 7 + 1, r * 3 + 11);
          if (h > 0.6) {
            const f = Math.pow(Math.max(0, Math.sin(t * (2.5 + 5 * h) + hash(x, r + 900) * 6.28)), 30) * path * (0.4 + 0.6 * hot) * smooth(0.3, 0.6, n);
            cr += f * 1.1, cg += f * 0.95, cb += f * 0.7;
          }
        }
        // the crests catch it: gold in the path, rose out to the sides
        const catchL = crest * (0.15 + 0.85 * soft) * (0.6 + 0.6 * n);
        cr += catchL * 0.95, cg += catchL * mix(0.34, 0.7, soft), cb += catchL * mix(0.42, 0.3, soft);
        // the sun's own column: a gap under the disc, then broken dashes
        const colX = Math.exp(-((dx / colW) ** 2)) * colFall;
        if (colX > 1e-3) {
          const dash = smooth(0.4, 0.7, noise(xc * 0.18 + t * 0.25, y * 0.9 - t * 0.5, 0));
          const col = colX * (0.6 + 0.4 * n) * dash;
          cr += col, cg += col * 0.82, cb += col * 0.5;
        }
        // the headland upside down in the water, broken by ripples
        if (dz < 26 && xc < LANDW + 4) {
          const xs = xc + 1.3 * Math.sin(y * 1.1 + t * 1.2 + xc * 0.05);
          const ix = Math.max(0, Math.min(LW - 1, colAt(xs)));
          const ft = shore(XD[ix]);
          if (y > ft) {
            const my = rowAt(2 * ft - y);
            if (my >= 0 && my < LH) {
              const m = my * W + ix;
              if (land[m]) {
                const a = 0.8 * smooth(ft + 24, ft + 4, y);
                cr = mix(cr, LR[m] * 0.7 + 0.012, a), cg = mix(cg, LG[m] * 0.7 + 0.016, a), cb = mix(cb, LB[m] * 0.75 + 0.026, a);
              }
            }
            // a line of surf where rock meets water, pale in the dusk light
            const foam = smooth(ft + 1.2, ft + 0.2, y) * smooth(0.45, 0.8, noise(xc * 0.5 - t * 0.4, t * 0.3, 0));
            cr += 0.5 * foam, cg += 0.36 * foam, cb += 0.36 * foam;
          }
        }
        // and the sloop's, shorter and more broken
        if (dz > 2.5 && dz < 14 && xc > BOAT - 8 && xc < BOAT + 8) {
          const ix = colAt(xc + 0.9 * Math.sin(y * 1.3 + t * 1.6));
          const m = rowAt(2 * (HZ + 3) - y) * W + ix;
          if (land[m] === 3) {
            const a = 0.7 * smooth(HZ + 14, HZ + 4, y) * (0.6 + 0.4 * rip);
            cr = mix(cr, 0.03, a), cg = mix(cg, 0.026, a), cb = mix(cb, 0.04, a);
          }
        }
        // the far water fades into the haze, a shade darker than the sky so
        // the horizon still holds as a line for the sun to sit on
        cr = mix(cr, HZR[x] * 0.56, mist), cg = mix(cg, HZG[x] * 0.56, mist), cb = mix(cb, HZB[x] * 0.62 + 0.015, mist);
        if (dz < 1) cr *= 0.72, cg *= 0.72, cb *= 0.72;
        const gr = grain[k];
        dot(px, k, cr * gr, cg * gr, cb * gr, 0.14, fade);
      }
    }
  };
}
