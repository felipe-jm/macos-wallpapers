/*
 * varanasi ghats: dusk on the ganga. Stepped ghats run along the bank and
 * away toward the afterglow, temple spires black against an indigo to amber
 * sky. Priests raise the aarti lamps on the steps, diyas drift downstream on
 * the dark water, and a boatman rows slowly across the bright reach.
 *
 * Shaded in colour cell by cell, then drawn as a halftone: every cell is a dot
 * whose size is its brightness, in its own colour.
 *
 * Positions and sizes below are in design cells; every buffer is per output cell.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "varanasi ghats",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#0b0812",
} satisfies Meta;

// The scene is designed on a 200 x 100 grid of square cells and sampled finer:
// each output cell is 1/S of a design cell, and the 16:9 frame shows Y0 design
// rows of extra sky above the design's top and a little more river below.
const OW = 320, OH = 180;
const S = OW / 200;
const Y0 = 8;
const HB = OH / S - Y0; // the design row at the bottom of the frame
const HZ = 60; // the far bank
const END = 150; // where the ghats meet the far bank
const GLOW = [156, HZ - 1.5]; // the afterglow, sitting on the far bank
const STARS = 0.9955; // a star where a sky cell's hash exceeds this
const LAMPS = 0.75; // step-lamp density per output cell, relative to the design grid
const FLAME = [1, 0.62, 0.22];
const WASH = [1, 0.5, 0.2];

const SKY = 0, WATER = 1, BANK = 2, STEPS = 3, BLD = 4, SPIRE = 5, UMB = 6, FIG = 7, PLAT = 8;

// heat, then colour: deep blue overhead, slate, dusky mauve, dusty rose,
// salmon, orange, amber and the pale gold of the glow itself
const RAMP: [number, number, number, number][] = [
  [0.0, 0.02, 0.028, 0.085],
  [0.12, 0.035, 0.048, 0.135],
  [0.24, 0.075, 0.08, 0.2],
  [0.36, 0.15, 0.12, 0.245],
  [0.46, 0.27, 0.17, 0.27],
  [0.55, 0.42, 0.23, 0.27],
  [0.64, 0.58, 0.3, 0.25],
  [0.73, 0.74, 0.4, 0.22],
  [0.82, 0.88, 0.53, 0.25],
  [0.9, 0.97, 0.68, 0.34],
  [0.96, 1.0, 0.82, 0.52],
  [1.0, 1.0, 0.93, 0.74],
];

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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

// The heat ramp, tabulated.
const RL = 256;
const RT = new Float32Array((RL + 1) * 3);
for (let i = 0; i <= RL; i++) {
  const h = i / RL;
  let j = 0;
  while (j < RAMP.length - 2 && h > RAMP[j + 1][0]) j++;
  const [h0, r0, g0, b0] = RAMP[j], [h1, r1, g1, b1] = RAMP[j + 1];
  const k = clamp((h - h0) / (h1 - h0));
  RT[i * 3] = mix(r0, r1, k), RT[i * 3 + 1] = mix(g0, g1, k), RT[i * 3 + 2] = mix(b0, b1, k);
}
const rampAt = (h: number) => ((h < 0 ? 0 : h > 1 ? 1 : h) * RL + 0.5) | 0;

// The waterline along the ghats, near at the left and running away to the right.
const wlF = (x: number) => (x < END ? HZ + 0.5 + 20 * Math.pow(1 - x / END, 1.6) : HZ + 0.5);
const scF = (x: number) => 0.45 + 1.75 * Math.pow(Math.max(0, 1 - x / END), 1.3);
const stepTopF = (x: number) => wlF(x) - 9.5 * scF(x) * (0.3 + 0.7 * smooth(END, END - 16, x));

// The dusk sky's heat: low overhead, rising toward the horizon, hottest at the glow.
function skyHeat(x: number, y: number): number {
  const v = clamp(y / HZ);
  const dx = Math.abs(x - GLOW[0]), dy = Math.abs(GLOW[1] - y);
  // a wide warm band along the horizon, and a small hot core on the bank
  const wide = 0.46 * Math.exp(-dx / 55 - dy / 23);
  const core = 0.24 * Math.exp(-Math.sqrt((dx / 13) ** 2 + (dy / 4.5) ** 2));
  return 0.06 + 0.42 * v * v + wide + core;
}

export default function varanasiGhats(): Frame {
  const N = OW * OH;
  // design coordinates of each output column's and row's centre
  const DX = new Float32Array(OW), DY = new Float32Array(OH);
  for (let x = 0; x < OW; x++) DX[x] = (x + 0.5) / S;
  for (let r = 0; r < OH; r++) DY[r] = (r + 0.5) / S - Y0;
  // the output columns / rows whose centres fall in [a, b) in design units, clipped
  const col0 = (a: number) => Math.max(0, Math.ceil(a * S - 0.5));
  const col1 = (b: number) => Math.min(OW, Math.ceil(b * S - 0.5));
  const row0 = (a: number) => Math.max(0, Math.ceil((a + Y0) * S - 0.5));
  const row1 = (b: number) => Math.min(OH, Math.ceil((b + Y0) * S - 0.5));

  // the sky just above the horizon in each column: the colour of the haze and
  // mist that the distance lays over everything
  const hzR = new Float32Array(OW), hzG = new Float32Array(OW), hzB = new Float32Array(OW);
  for (let x = 0; x < OW; x++) {
    const i = rampAt(skyHeat(DX[x], HZ - 3)) * 3;
    (hzR[x] = RT[i]), (hzG[x] = RT[i + 1]), (hzB[x] = RT[i + 2]);
  }

  // --- the bank -------------------------------------------------------------
  // Buildings along the ghats: [x0, x1, height above the steps in scale units, seed]
  const blds: [number, number, number, number][] = [];
  for (let x = -6; x < END - 10; ) {
    const s = scF(Math.max(0, x));
    const w = (8 + 10 * hash(x | 0, 3)) * s;
    const low = (x > 110 ? 0.8 : 1) * (0.45 + 0.55 * smooth(END - 8, END - 34, x));
    blds.push([x, x + w, (7 + 9 * hash(x | 0, 4)) * low, hash(x | 0, 5)]);
    x += w;
  }
  // Temple spires: [centre x, height in rows, half width at the base]
  const spires: [number, number, number][] = [[118, 33, 5.2], [64, 19, 4], [31, 15, 3.6], [139, 8, 1.6], [90, 11, 2.4], [129, 10, 2]];
  // Aarti stations on the near ghat, unevenly spaced: [x, streak width, streak length]
  const aarti: [number, number, number][] = [[11, 1.15, 1.25], [24, 0.8, 0.85], [39, 1.25, 1.1], [54, 0.75, 0.75]];
  // Umbrellas on the far steps
  const umbs = [70, 83, 98, 109];

  const mat = new Uint8Array(N);
  const sR = new Float32Array(N), sG = new Float32Array(N), sB = new Float32Array(N);
  const flo = new Float32Array(N);
  const alb = new Float32Array(N); // how much the lamps' wash lights each cell
  const warm = new Float32Array(N);
  const winR = new Float32Array(N), winG = new Float32Array(N), winB = new Float32Array(N);

  const roofOf = (x: number) => {
    for (const [x0, x1, h] of blds) if (x >= x0 && x < x1) return stepTopF(x) - h * scF(x);
    return stepTopF(x);
  };

  for (let r = 0; r < OH; r++) {
    for (let x = 0; x < OW; x++) {
      const k = r * OW + x;
      const xc = DX[x], y = DY[r];
      const wl = wlF(xc);
      if (y >= wl) {
        mat[k] = WATER;
        alb[k] = 0.25;
        continue;
      }
      let m: number = SKY, cr = 0, cg = 0, cb = 0, fl = 0.06, al = 0;
      const s = scF(xc);

      // the far bank: an embankment and clumps of trees against the glow
      const clump = smooth(0.42, 0.72, fbm(xc * 0.11, 3, 3, 0)) * smooth(160, 172, xc);
      const bankTop = HZ - 2.2 - 0.6 * fbm(xc * 0.4, 7, 2, 0) - 4 * clump;
      if (xc >= END - 4 && y >= bankTop) (m = BANK), (cr = 0.05), (cg = 0.045), (cb = 0.06), (fl = 0.04);

      if (xc < END) {
        const st = stepTopF(xc);
        // buildings and their rooftop pavilions
        let roof = st, bi = -1;
        for (let i = 0; i < blds.length; i++) if (xc >= blds[i][0] && xc < blds[i][1]) (roof = st - blds[i][2] * s), (bi = i);
        let top = roof;
        if (bi >= 0) {
          const [x0, x1, , hb] = blds[bi];
          const mid = (x0 + x1) / 2, half = (x1 - x0) / 2;
          if (hb > 0.45) {
            // a chhatri: a small dome on four posts
            const cx = hb > 0.75 ? x0 + half * 0.4 : mid;
            const dx = Math.abs(xc - cx) / (1.6 * s);
            if (dx < 1) top = Math.min(top, roof - 1.4 * s - 1.5 * s * Math.sqrt(1 - dx * dx));
            if (dx < 1.1 && dx > 0.7) top = Math.min(top, roof - 1.4 * s);
          }
          if (Math.abs(xc - x0) < 0.6 * s || Math.abs(xc - x1) < 0.6 * s) top = Math.min(top, roof - 0.6 * s); // parapet ends
        }
        if (y >= top && y < st) {
          m = BLD;
          // sandstone with its back to the glow, lit only by the cool sky, and
          // darker low down where the steps and the next houses shade it
          cr = 0.07, cg = 0.058, cb = 0.072;
          const fy = (y - top) / Math.max(1, st - top);
          const ao = 1.12 - 0.45 * fy * fy;
          cr *= ao, cg *= ao, cb *= ao * 1.04;
          al = 0.3;
          // rows of arched openings, a fair number lit on the near ghats
          if (bi >= 0 && s > 0.6) {
            const fx = (xc - blds[bi][0]) / (2.4 * s), fz = (st - y) / (3 * s);
            const ix = Math.floor(fx), iz = Math.floor(fz);
            if (fx - ix > 0.35 && fx - ix < 0.7 && fz - iz > 0.25 && fz - iz < 0.75 && iz >= 1 && st - y < blds[bi][2] * s - 1.5 * s) {
              const h1 = hash(bi * 31 + ix, iz * 7);
              if (h1 < (s > 1.2 ? 0.28 : 0.2)) {
                // oil lamps, tungsten and the odd cold tube, each its own brightness
                const b = 0.3 + 0.6 * hash(bi * 13 + ix, iz * 5), w = hash(bi * 17 + ix, iz * 3);
                const lr = h1 < 0.025 ? 0.55 : 1, lg = h1 < 0.025 ? 0.68 : 0.42 + 0.3 * w, lb = h1 < 0.025 ? 0.72 : 0.1 + 0.3 * w * w;
                // brighter toward the sill, where the lamp stands
                const g = b * (0.8 + 0.4 * (fz - iz - 0.25));
                (winR[k] = lr * g), (winG[k] = lg * g), (winB[k] = lb * g);
                (cr = 0.02 + winR[k]), (cg = 0.015 + winG[k]), (cb = 0.012 + winB[k]);
              } else (cr *= 0.45), (cg *= 0.45), (cb *= 0.5), (al = 0.15);
            }
          }
          fl = 0.09;
        }
        if (y >= st) {
          // the steps: treads catch the dusk sky, risers fall in shadow
          m = STEPS;
          const sp = 1.6 * s;
          const near = (wl - y) / (wl - st);
          if (sp * S < 2.2) {
            // too far to count the steps: a faint alternating tread
            const odd = Math.floor((wl - y) * S) & 1;
            (cr = 0.15), (cg = 0.125), (cb = 0.155);
            if (odd) (cr *= 0.55), (cg *= 0.55), (cb *= 0.6);
            al = odd ? 0.4 : 0.75;
          } else {
            // treads face the open sky, risers fall into shadow, darkest
            // where they meet the tread below
            const ph = ((wl - y) / sp) % 1;
            if (ph < 0.6) (cr = 0.17 + 0.04 * (1 - near)), (cg = 0.14 + 0.02 * (1 - near)), (cb = 0.16), (al = 1);
            else {
              const a = 0.6 + 0.4 * ((ph - 0.6) / 0.4);
              (cr = 0.045 * a), (cg = 0.036 * a), (cb = 0.048 * a), (al = 0.3);
            }
          }
          // the wet bottom steps darker
          if (wl - y < 1.2 * s) (cr *= 0.6), (cg *= 0.6), (cb *= 0.75), (al *= 0.6);
          fl = 0.1;
        }
      }

      // spires
      for (const [sx, sh, sw] of spires) {
        const base = roofOf(sx) + 1;
        const h = base - y;
        if (h < -1 || h > sh + 2.5) continue;
        const dx = Math.abs(xc - sx);
        const f = h / sh;
        // the curved shikhara, an amalaka disc and the kalash on top
        let hw = f <= 1 ? sw * Math.pow(Math.max(0, 1 - Math.pow(f, 1.8)), 0.6) : 0;
        if (f > 0.92 && f < 1.02) hw = Math.max(hw, sw * 0.32);
        if (f >= 1.02 && h < sh + 2.2) hw = Math.max(hw, 0.35 + 0.2 * Math.sin(((h - sh) / 2.2) * Math.PI));
        if (h >= -1 && h < 0.5) hw = sw * 1.15;
        if (dx <= hw) {
          m = SPIRE;
          // courses of stone, each a little darker under the one above
          const band = 0.82 + 0.18 * ((h / 1.6) % 1);
          cr = 0.068 * band, cg = 0.054 * band, cb = 0.068 * band;
          fl = 0.08, al = 0.35;
        }
      }

      // the big umbrellas on the far steps
      for (const ux of umbs) {
        const s2 = scF(ux), wl2 = wlF(ux);
        const cy = wl2 - (wl2 - stepTopF(ux)) * 0.55;
        const dx = (xc - ux) / (3 * s2), dy = (cy - y) / (1.4 * s2);
        if (dy > 0 && dy < 1 && Math.abs(dx) < Math.sqrt(1 - dy * dy)) (m = UMB), (cr = 0.05 + 0.03 * dy), (cg = 0.04 + 0.02 * dy), (cb = 0.05 + 0.025 * dy), (al = 0.4);
        if (dy <= 0 && dy > -0.25 && Math.abs(dx) < 1) (m = UMB), (cr = 0.03), (cg = 0.024), (cb = 0.03), (al = 0.2);
        if (Math.abs(xc - ux) < 0.35 && y > cy && y < cy + 2.2 * s2) (m = UMB), (cr = 0.03), (cg = 0.025), (cb = 0.03), (al = 0.1);
      }

      // the priests on their platforms, dark against the lit steps
      for (const [ax] of aarti) {
        const s2 = scF(ax), u = 1.3 * s2, base = wlF(ax) - 2.6 * s2;
        const dx = (xc - ax) / u;
        const fy = (base - y) / u;
        // a dhoti, a broad-shouldered torso, a neck and the head
        const bw = fy < 0 ? -1 : fy < 2.2 ? 0.66 - 0.04 * fy : fy < 4.1 ? 0.58 + 0.32 * smooth(2.2, 3.7, fy) : fy < 4.5 ? 0.28 : -1;
        const head = Math.hypot(dx * 1.05, fy - 5.05) < 0.62;
        if (Math.abs(dx) < bw || head) (m = FIG), (cr = 0.035), (cg = 0.022), (cb = 0.035), (fl = 0.02), (al = 0.04);
        if (y >= base && y < base + 0.7 * s2 && Math.abs(xc - ax) < 2.3 * u) (m = PLAT), (cr = 0.12), (cg = 0.07), (cb = 0.06), (fl = 0.04), (al = 0.8);
      }

      if (m === SKY) {
        const dx = xc - 0.5, dy = y - 0.5;
        const veil = 0.92 + 0.16 * fbm(dx * 0.05, dy * 0.1, 3, 0);
        const hh = skyHeat(xc, y) + 0.05 * (fbm(dx * 0.07 + 11, dy * 0.16, 2, 0) - 0.5) + 0.1 * (fbm(dx * 0.025 + 3, dy * 0.09 + 5, 3, 0) - 0.5);
        warm[k] = smooth(0.3, 0.9, hh);
        const i = rampAt(hh) * 3;
        const grain = 0.98 + 0.04 * hash(x * 5 + 3, r * 11 + 1);
        cr = RT[i] * veil * grain, cg = RT[i + 1] * veil * grain, cb = RT[i + 2] * veil * grain;
        fl = 0.1;
      }
      mat[k] = m;
      sR[k] = cr, sG[k] = cg, sB[k] = cb, flo[k] = fl, alb[k] = al;
    }
  }

  // rim light: silhouette edges facing the glow, and their tops, take the sky's colour
  const rimR = new Float32Array(N), rimG = new Float32Array(N), rimB = new Float32Array(N);
  for (let r = 1; r < OH - 1; r++) {
    for (let x = 3; x < OW - 3; x++) {
      const k = r * OW + x;
      const m = mat[k];
      if (m === SKY || m === WATER) continue;
      // the edge facing the glow takes its orange light, the top the sky's colour
      const toward = DX[x] < GLOW[0] ? 1 : -1;
      const strong = 0.75 * Math.exp(-Math.abs(DX[x] - GLOW[0]) / 42);
      let a = 0;
      if (mat[k + toward] === SKY) a = strong;
      else if (mat[k + 2 * toward] === SKY) a = strong * 0.65;
      else if (mat[k + 3 * toward] === SKY) a = strong * 0.25;
      if (a > 0) (rimR[k] = 0.85 * a), (rimG[k] = 0.45 * a), (rimB[k] = 0.26 * a);
      if (mat[k - OW] === SKY) (rimR[k] += sR[k - OW] * 0.3), (rimG[k] += sG[k - OW] * 0.3), (rimB[k] += sB[k - OW] * 0.3);
    }
  }
  for (let k = 0; k < N; k++) (sR[k] += rimR[k]), (sG[k] += rimG[k]), (sB[k] += rimB[k]);

  // light from the lit windows spills a little onto the walls round them
  const blur = (src: Float32Array, dst: Float32Array, step: number, len: number, lines: number, stride: number) => {
    for (let l = 0; l < lines; l++) {
      const o = l * stride;
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let d = -2; d <= 2; d++) {
          const j = i + d;
          if (j >= 0 && j < len) s += src[o + j * step];
        }
        dst[o + i * step] = s / 5;
      }
    }
  };
  const tmp = new Float32Array(N), spill = new Float32Array(N);
  for (const [w, c] of [[winR, sR], [winG, sG], [winB, sB]] as const) {
    blur(w, tmp, 1, OW, OH, OW);
    blur(tmp, spill, OW, OH, OW, 1);
    for (let k = 0; k < N; k++) if ((mat[k] === BLD || mat[k] === SPIRE) && !w[k]) c[k] += spill[k] * 0.45;
  }

  // weathered stone, then the haze of distance and the mist low on the water:
  // far things fade toward the colour of the sky at the horizon behind them
  for (let r = 0; r < OH; r++) {
    const y = DY[r];
    for (let x = 0; x < OW; x++) {
      const k = r * OW + x, m = mat[k];
      if (m === SKY || m === WATER) continue;
      const xc = DX[x], s = scF(xc), wl = wlF(xc);
      const tex = 0.8 + 0.32 * fbm(xc * 0.35, y * 0.5, 3, 0) + 0.12 * (hash(x * 7 + 1, r * 13) - 0.5);
      const dep = m === BANK ? 1 : clamp((2.2 - s) / 1.75);
      const mist = Math.exp(-Math.max(0, wl - y) / (1.2 + 2.5 * s)) * (0.5 + 0.5 * fbm(xc * 0.08 + 5, y * 0.4, 2, 0));
      const h = Math.min(0.45, 0.04 + 0.32 * Math.pow(dep, 1.4) + 0.28 * mist * (0.3 + 0.7 * dep));
      sR[k] = mix(sR[k] * tex, hzR[x] * 0.38, h);
      sG[k] = mix(sG[k] * tex, hzG[x] * 0.38, h);
      sB[k] = mix(sB[k] * tex, hzB[x] * 0.38, h);
    }
  }

  // small diyas lining the steps near the aarti, twinkling
  const stepLamps: [number, number][] = [];
  for (let x = col0(2); x < col1(118); x++) {
    const xc = DX[x], s = scF(xc), wl = wlF(xc);
    for (let r = row0(stepTopF(xc)); r < row1(wl - 1); r++) {
      const k = r * OW + x;
      if (mat[k] !== STEPS) continue;
      const near = Math.exp(-(((xc - 33.5) / 36) ** 2));
      if (hash(x * 3 + 7, r * 5) < (0.035 * near + 0.006) * LAMPS && ((wl - DY[r]) / (1.6 * s)) % 1 < 0.3) stepLamps.push([k, hash(x, r) * 40]);
    }
  }

  // electric lamps along the far ghats, each with its thin road on the water
  const sref = new Float32Array(N);
  for (let x = 58; x < END - 3; ) {
    const s = scF(x);
    const ly = stepTopF(x) - 0.4 * s + (wlF(x) - stepTopF(x)) * 0.55 * hash(x | 0, 78) ** 2;
    const halo = 1 + 3.2 * s, R = Math.ceil(halo * 3);
    // sodium orange or a warmer white, dimmed by the haze of distance
    const na = hash(x | 0, 79) < 0.55, dim = 1 - 0.35 * clamp((2.2 - s) / 1.75);
    const lg = na ? 0.62 : 0.8, lb = na ? 0.26 : 0.55;
    for (let r = row0(ly - R); r < row1(ly + R); r++) {
      for (let xx = col0(x - R); xx < col1(x + R); xx++) {
        const k = r * OW + xx;
        if (mat[k] === WATER || mat[k] === SKY) continue;
        const dx = DX[xx] - x, dy = DY[r] - ly;
        const d = Math.sqrt(dx * dx + dy * dy);
        // the lamp, and the pool of light it throws on the stone round it
        const v = (Math.exp(-((d / 0.6) ** 2)) * 1.3 + Math.exp(-d / 1.4) * 0.12) * dim;
        const p = Math.exp(-d / halo) * 0.3 * alb[k] * dim;
        sR[k] += v + p * WASH[0], sG[k] += v * lg + p * WASH[1] * lg * 1.4, sB[k] += v * lb + p * WASH[2] * lb * 2.5;
      }
    }
    const wl = wlF(x), width = 0.35 + 0.35 * s, len = 9 * s;
    for (let r = row0(wl - 0.5); r < OH; r++) {
      const a = Math.exp(-(DY[r] - wl) / len) * 0.5 * dim;
      if (a < 0.01) break;
      for (let xx = col0(x - 3); xx < col1(x + 3); xx++) sref[r * OW + xx] += a * Math.exp(-(((DX[xx] - x) / width) ** 2));
    }
    x += (5 + 10 * hash(x | 0, 77)) * Math.max(0.8, s);
  }

  // --- the reflection: the bank and sky mirrored at the waterline -----------
  const refl = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const mirK = new Int32Array(N).fill(-1); // the lit cell each water cell mirrors
  const mirS = new Int32Array(N).fill(-1); // or the sky cell, for the clouds' reflection
  const fres = new Float32Array(N);
  for (let r = 0; r < OH; r++) {
    for (let x = 0; x < OW; x++) {
      const k = r * OW + x;
      if (mat[k] !== WATER) continue;
      const wl = wlF(DX[x]), d = DY[r] - wl;
      let ar = 0, ag = 0, ab = 0;
      for (let o = 0; o < 2; o++) {
        const ym = wl - d * 0.85 - 0.4 - o * 0.8;
        let cr: number, cg: number, cb: number;
        const qr = Math.floor((ym + Y0) * S);
        const q = qr < 0 ? -1 : qr * OW + x;
        // the sky near the mirror angle; the rough water drags the glow's light far down toward us
        const st = mix(0.75, 0.36, Math.exp(-(((DX[x] - GLOW[0]) / 25) ** 2)));
        const i = rampAt(skyHeat(DX[x], Math.max(0, wl - d * st - 1 - o * 0.6))) * 3;
        if (q < 0 || mat[q] === WATER || mat[q] === SKY) {
          (cr = RT[i]), (cg = RT[i + 1]), (cb = RT[i + 2]);
          if (o === 0 && q >= 0 && mat[q] === SKY) mirS[k] = q;
        } else {
          // tilted ripples under the bank still catch a little sky
          (cr = sR[q] + RT[i] * 0.22), (cg = sG[q] + RT[i + 1] * 0.22), (cb = sB[q] + RT[i + 2] * 0.22);
          if (o === 0) mirK[k] = q;
        }
        ar += cr, ag += cg, ab += cb;
      }
      // Fresnel: a mirror at grazing angles out by the far bank, darker and
      // more see-through as the water comes toward us
      const a = 0.14 + 0.76 * Math.exp(-(DY[r] - HZ) / 9);
      fres[k] = a;
      refl[0][k] = (ar / 2) * a, refl[1][k] = (ag / 2) * a, refl[2][k] = (ab / 2) * a;
    }
  }

  // --- clouds: long dusk streaks, dark on top and lit from below --------------
  // sampled per output cell: CW columns span a period of 800 design cells, and
  // the rows run from the top of the frame down to HZ - 6
  const CW = 800 * S, CH = row1(HZ - 6);
  const cover = new Float32Array(CW * CH);
  const clit = new Float32Array(CW * CH);
  // stretched, warped noise, gathered into three loose bands
  const density = (x: number, y: number) => {
    const q = fbm(x * 0.005, y * 0.03, 3, 4);
    const d = fbm(x * 0.0125 + q * 1.8, y * 0.09 + q * 0.9, 5, 10);
    const env = 0.03 * Math.exp(-(((y - 13) / 4) ** 2)) + 0.1 * Math.exp(-(((y - 29) / 5.5) ** 2));
    // and one thin, broken streak low down, to cross the glow
    const c = 46.5 + 3 * (fbm(x * 0.01, 9.5, 2, 8) - 0.5);
    const th = 1 + 0.9 * fbm(x * 0.05, 3.5, 2, 40);
    const streak = Math.exp(-(((y - c) / th) ** 2)) * smooth(0.42, 0.6, fbm(x * 0.0125, 21.5, 3, 10)) * (0.75 + 0.5 * fbm(x * 0.05, y * 0.3, 3, 40));
    return Math.max(d + env - 0.08, 0.36 + 0.3 * streak);
  };
  for (let r = 0; r < CH; r++) {
    for (let i = 0; i < CW; i++) {
      const x = i / S, y = DY[r];
      const d = density(x, y);
      cover[r * CW + i] = smooth(0.47, 0.62, d);
      // the undersides catch the light from below the horizon, the tops go dark
      clit[r * CW + i] = clamp(0.4 + (d - density(x, y + 2)) * 5.5 + (density(x, y - 2.5) - d) * 1.5);
    }
  }

  // --- the floating diyas ------------------------------------------------------
  const diyas: [number, number, number, number][] = [];
  for (let i = 0; i < 38; i++) {
    const q = hash(i, 61);
    const y = HZ + 5 + (HB - HZ - 6) * Math.pow(q, 1.3);
    diyas.push([hash(i, 62) * 260 - 30, y, hash(i, 63) * 50, 0.6 + 0.6 * hash(i, 64)]);
  }

  const dyn = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const dref = new Float32Array(N); // warm light to be reflected
  const arm = new Uint8Array(N); // the priests' raised arms, this frame
  // this frame's sky over the cloud rows, and how much cloud: the water mirrors them
  const cc = new Float32Array(N), ccR = new Float32Array(N), ccG = new Float32Array(N), ccB = new Float32Array(N);
  const addGlow = (fx: number, fy: number, core: number, halo: number, amp: number) => {
    const R = Math.ceil(halo * 3.2);
    for (let r = row0(fy - R); r < row1(fy + R); r++) {
      for (let x = col0(fx - R); x < col1(fx + R); x++) {
        const k = r * OW + x;
        const dx = DX[x] - fx, dy = (DY[r] - fy) * 0.85;
        const d = Math.sqrt(dx * dx + dy * dy);
        // a white-hot heart inside an orange halo; the priests are not lit
        const am = mat[k] === FIG ? amp * 0.15 : amp;
        const c = Math.exp(-((d / core) ** 2)) * 1.6 * am, v = Math.exp(-d / halo) * 0.35 * am;
        dyn[0][k] += c + v * FLAME[0], dyn[1][k] += c * 0.86 + v * FLAME[1], dyn[2][k] += c * 0.55 + v * FLAME[2];
      }
    }
  };
  // the lamps' wide warm wash on the stone, by how much each surface takes it
  const addWash = (fx: number, fy: number, halo: number, amp: number) => {
    const R = Math.ceil(halo * 2.6);
    for (let r = row0(fy - R); r < row1(fy + R); r++) {
      for (let x = col0(fx - R); x < col1(fx + R); x++) {
        const k = r * OW + x;
        const a = alb[k];
        if (!a) continue;
        const dx = DX[x] - fx, dy = DY[r] - fy;
        const v = Math.exp(-Math.sqrt(dx * dx + dy * dy) / halo) * amp * a;
        dyn[0][k] += v * WASH[0], dyn[1][k] += v * WASH[1], dyn[2][k] += v * WASH[2];
      }
    }
  };
  const addStreak = (fx: number, wl: number, width: number, len: number, amp: number) => {
    for (let r = row0(wl - 0.5); r < OH; r++) {
      const dy = DY[r] - wl;
      const a = Math.exp(-dy / len) * amp * smooth(-0.5, 1, dy);
      if (a < 0.01) break;
      for (let x = col0(fx - 3 * width - 1); x < col1(fx + 3 * width + 1); x++) {
        const k = r * OW + x;
        if (mat[k] === WATER) dref[k] += a * Math.exp(-(((DX[x] - fx) / width) ** 2));
      }
    }
  };

  // the boat crossing the bright reach
  const BS = 0.85;
  const boatAt = (lx: number, ly: number) => {
    // local coordinates: lx along the boat, ly up from the waterline
    const L = 9;
    if (Math.abs(lx) < L && ly > -0.6 && ly < 1.2 + 1.4 * Math.pow(Math.abs(lx) / L, 3)) return 1;
    if (lx > 4.6 && lx < 5.8 && ly > 0 && ly < 6.6) return 1; // the boatman
    if (Math.abs(lx - 5.2) < 0.7 && Math.abs(ly - 7.2) < 0.7) return 1;
    const ox = lx - 5.6, oy = ly - 5.4; // his oar, raked back into the water
    const along = ox * 0.42 - oy * 0.91;
    if (along > 0 && along < 8 && Math.abs(ox * 0.91 + oy * 0.42) < 0.32) return 1;
    if (lx > -4 && lx < -0.5 && ly > 0 && ly < 2.6 - 0.25 * Math.abs(lx + 2.2)) return 1; // a passenger
    return 0;
  };

  return (t, px) => {
    for (let c = 0; c < 3; c++) dyn[c].fill(0);
    dref.fill(0);

    // aarti: each lamp is raised and turned in slow circles
    arm.fill(0);
    aarti.forEach(([ax, sw, sl], i) => {
      const s = scF(ax), u = 1.3 * s, base = wlF(ax) - 2.6 * s;
      const ph = t * 1.1 + i * 1.3;
      const fx = ax + 0.9 * u + Math.cos(ph) * 1.1 * u, fy = base - 7.2 * u + Math.sin(ph) * 0.6 * u;
      // the arm from the shoulder to the lamp
      const sx0 = ax + 0.62 * u, sy0 = base - 3.8 * u;
      const ex = fx - sx0, ey = fy + 0.6 * u - sy0, el = ex * ex + ey * ey;
      for (let r = row0(Math.min(sy0, fy) - 1); r < row1(Math.max(sy0, fy) + 1); r++) {
        for (let x = col0(Math.min(sx0, fx) - 1); x < col1(Math.max(sx0, fx) + 1); x++) {
          const px = DX[x] - sx0, py = DY[r] - sy0;
          const q = clamp((px * ex + py * ey) / el);
          if (Math.hypot(px - q * ex, py - q * ey) < 0.28 * u) arm[r * OW + x] = 1;
        }
      }
      const fl = 0.85 + 0.15 * Math.sin(t * 13 + i * 5) * Math.sin(t * 7.3 + i);
      addGlow(fx, fy, 0.6 * u, 1.7 * u, fl);
      addWash(fx, fy + 2 * u, 7.5 * s, 0.34 * fl);
      addStreak(fx, wlF(fx), 0.8 * s * sw, 15 * s * sl, 0.75 * fl);
    });
    // the step lamps
    for (const [k, ph] of stepLamps) {
      const v = 0.7 + 0.3 * Math.sin(t * 5 + ph);
      dyn[0][k] += v * FLAME[0], dyn[1][k] += v * FLAME[1] * 0.95, dyn[2][k] += v * FLAME[2];
    }
    // diyas drifting downstream, nearer ones faster
    for (const [x0, y, ph, sz] of diyas) {
      const near = (y - HZ) / 40;
      const x = ((((x0 + t * (0.25 + 0.9 * near)) % 260) + 260) % 260) - 30;
      if (x < -3 || x > 203 || y < wlF(x) + 0.8) continue;
      const fl = 0.8 + 0.2 * Math.sin(t * 9 + ph);
      const s = (0.35 + 0.9 * near) * sz;
      addGlow(x, y - 0.3, 0.45 + 0.3 * s, 0.6 + 1.2 * s, fl * 0.8);
      addStreak(x, y + 0.2, 0.3 + 0.35 * s, 2 + 5 * s, 0.6 * fl);
    }

    const drift = t * 0.9 + 720; // starts with the long streaks over the glow
    const bx = ((((159 - t * 0.1 + 24) % 250) + 250) % 250) - 24, by = 71 + Math.sin(t * 0.9) * 0.15;

    for (let r = 0; r < OH; r++) {
      const y = DY[r];
      for (let x = 0; x < OW; x++) {
        const k = r * OW + x;
        const xc = DX[x];
        const m = mat[k];
        let cr = sR[k], cg = sG[k], cb = sB[k], floor = flo[k], fade = 1;

        if (m === SKY) {
          if (r < CH) {
            const sx = x + 0.5 + drift * S, ix = Math.floor(sx), fx = sx - ix;
            const i0 = r * CW + (ix % CW), i1 = r * CW + ((ix + 1) % CW);
            const c = cover[i0] + (cover[i1] - cover[i0]) * fx;
            if (c > 0.01) {
              // high streaks glow dusty rose from below; low ones stand dark
              // against the afterglow with only their undersides lit, gold near the glow
              const l = clit[i0] + (clit[i1] - clit[i0]) * fx;
              const lo = smooth(12, 30, y);
              const wm = warm[k];
              // the shadowed body: the sky's own light, dimmer and cooler, darkest in the dense low banks
              const sh = mix(0.72, 0.4, lo);
              let kr = cr * sh * 0.85 + 0.004, kg = cg * sh * 0.92 + 0.006, kb = cb * sh + 0.014;
              const i = rampAt(0.5 + 0.42 * wm + 0.08 * l) * 3;
              const lit = mix(0.2 + 0.75 * l, 0.95 * l * l, lo) * (0.62 + 0.38 * wm);
              // thin edges near the glow let its light through: a silver lining
              const a = clamp(lit + 4 * c * (1 - c) * wm * wm * 0.8);
              kr = mix(kr, RT[i], a), kg = mix(kg, RT[i + 1], a), kb = mix(kb, RT[i + 2], a);
              cr = mix(cr, kr, c), cg = mix(cg, kg, c), cb = mix(cb, kb, c);
              floor = mix(floor, 0.05, c * (1 - a));
              cc[k] = c;
            } else {
              cc[k] = 0;
              if (y < 26 && hash(x, r * 3 + 11) > STARS) {
                // stars, bluish or warm, lost as the sky brightens toward the glow
                const tw = (0.3 + 0.22 * Math.sin(t * (1.3 + hash(x, r) * 2) + hash(r, x) * 6.28)) * (1 - smooth(0.1, 0.3, cb));
                const h = hash(r + 3, x);
                cr += tw * (0.82 + 0.18 * h), cg += tw * (0.86 + 0.06 * h), cb += tw * (1 - 0.2 * h);
                floor = 0.08;
              }
            }
            (ccR[k] = cr), (ccG[k] = cg), (ccB[k] = cb);
          }
        } else if (m === WATER) {
          // ripples laid out on the water's plane: broad and slow near us,
          // crowding into fine bands toward the far bank
          const dz = y - HZ, iz = 1 / (dz + 12);
          const wz = 60 * iz, wx = (xc - 100) * iz * 4;
          const v = dz / 40;
          const w = 0.6 * noise(wx * 0.9 + t * 0.04, wz * 5 - t * 0.15, 0) + 0.4 * noise(wx * 2.6 - t * 0.08, wz * 14 - t * 0.45, 0);
          // the river's own colour, dark and a little silty, seen through the surface
          const body = 0.6 + 0.8 * w;
          cr = 0.012 * body, cg = 0.017 * body, cb = 0.026 * body;
          const wob = (noise(wx * 0.7 + 7, wz * 4 - t * 0.5, 0) - 0.5) * (1.2 + 4 * v);
          let sx = x + wob * S;
          if (sx < 0) sx = 0;
          if (sx > OW - 1.001) sx = OW - 1.001;
          const i0 = r * OW + (sx | 0), fx = sx - (sx | 0);
          const dash = smooth(0.28, 0.72, noise(wx * 2.2 + wz * 1.3 + 3, wz * 22 - wx * 0.3 - t * 0.9, 0));
          const ref = (a: Float32Array) => a[i0] + (a[i0 + 1] - a[i0]) * fx;
          // broken bands up close, a smooth mirror far off, and calm in the bright reach under the glow
          const reach = Math.exp(-(((xc - GLOW[0]) / 15) ** 2)) * smooth(HZ + 2.5, HZ + 5.5, y);
          const rough = smooth(0.5, 12, dz);
          let da = mix(1, 0.2 + 1.15 * dash, rough);
          da = mix(da, 0.75 + 0.45 * dash, reach);
          // the sky's smooth light is broken more gently than the lamps' points
          const ds = mix(1, 0.6 + 0.8 * dash, rough);
          let rr = ref(refl[0]), rg = ref(refl[1]), rb = ref(refl[2]);
          // the clouds overhead, mirrored
          const qs = mirS[k];
          if (qs >= 0) {
            const q2 = qs + (sx | 0) - x;
            if (mat[q2] === SKY && cc[q2] > 0.01) {
              const f = fres[k], c = cc[q2] * 0.85;
              (rr = mix(rr, ccR[q2] * f, c)), (rg = mix(rg, ccG[q2] * f, c)), (rb = mix(rb, ccB[q2] * f, c));
            }
          }
          cr += rr * ds, cg += rg * ds, cb += rb * ds;
          // the lamplit stone above, given back in broken bands
          const q = mirK[k];
          if (q >= 0) (cr += dyn[0][q] * 0.4 * da), (cg += dyn[1][q] * 0.4 * da), (cb += dyn[2][q] * 0.4 * da);
          const fl = (ref(dref) + ref(sref)) * (0.2 + 1.1 * dash);
          cr += fl * FLAME[0], cg += fl * FLAME[1], cb += fl * FLAME[2];
          // a narrow road of glitter straight under the glow
          const gw = 1.3 + (y - HZ) * 0.15;
          const gx = (xc - GLOW[0]) / gw;
          if (gx > -3 && gx < 3) {
            const road = Math.exp(-gx * gx) * Math.exp(-(y - HZ) / 24);
            const rip = noise(wx * 3.2 - t * 0.3, wz * 16 - t * 1.2, 0);
            const glint = smooth(0.45, 0.8, 0.45 * w + 0.55 * rip) * road;
            cr += 1.0 * glint + 0.12 * road, cg += 0.8 * glint + 0.07 * road, cb += 0.5 * glint + 0.04 * road;
          }
          floor = 0.1;
          fade = smooth(HB + 4, HB - 16, y);
        }

        // the boat and its dark reflection
        const lx = xc - bx;
        if (lx > -14 && lx < 15 && y > by - 11 && y < by + 11) {
          let cov = 0, rc = 0;
          for (let sy2 = 0; sy2 < 2; sy2++)
            for (let sx2 = 0; sx2 < 2; sx2++) {
              const bpx = (lx + (sx2 - 0.5) * 0.5 / S) / BS, bpy = (by - (y + (sy2 - 0.5) * 0.5 / S)) / BS;
              cov += boatAt(bpx, bpy);
              if (m === WATER) rc += boatAt(bpx, -bpy * 0.9);
            }
          cov /= 4, rc /= 4;
          if (cov > 0) {
            cr = mix(cr, 0.03, cov), cg = mix(cg, 0.022, cov), cb = mix(cb, 0.026, cov);
            floor = mix(floor, 0.02, cov);
          } else if (rc > 0) (cr *= 1 - 0.8 * rc), (cg *= 1 - 0.8 * rc), (cb *= 1 - 0.75 * rc);
        }

        if (arm[k]) (cr = 0.035 + dyn[0][k] * 0.12), (cg = 0.022 + dyn[1][k] * 0.12), (cb = 0.035 + dyn[2][k] * 0.12), (floor = 0.02);
        else (cr += dyn[0][k]), (cg += dyn[1][k]), (cb += dyn[2][k]);

        dot(px, k, cr, cg, cb, floor, fade);
      }
    }
  };
}
