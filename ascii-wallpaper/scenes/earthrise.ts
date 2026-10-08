/*
 * earthrise: the Earth coming up over the lunar horizon. The sun is low on the
 * right, so every crater rim and boulder throws a long black shadow across the
 * grey ground, and the same light makes a gibbous Earth with a clean line
 * between day and night. The Earth turns, its clouds drift, it climbs very
 * slowly, and a few bright stars breathe.
 *
 * The ground is a heightfield of craters, rendered once column by column from
 * a camera standing on it, with real shadows marched toward the sun. Each
 * frame only the Earth and the few stars that twinkle are shaded again. Every
 * cell is then drawn as a halftone dot sized by its brightness, in its own colour.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "earthrise",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#030408",
} satisfies Meta;

const W = 320, H = 180;
// The view is designed in a coarser grid of 200 columns and drawn S times finer;
// design row 0 sits Y0 design rows below the top of the frame, the extra sky.
const S = W / 200, Y0 = 8;
const EYE = (37 + Y0) * S; // screen row of eye level; the horizon dips below it
const F = 112 * S; // focal length in cells
const CAM_H = 20;
const RM = 1500; // the moon's radius, in ground units, for the falling horizon
const ZMAX = 520;
const EC = [141, 32], ER = 22; // the Earth on screen, in design cells, its lower edge still behind the horizon
const LON0 = 3.5; // which face of the globe is turned to us at the start
const RISE = 5, RISE_T = 150; // it climbs RISE rows and settles back over RISE_T seconds
// the bright stars, which twinkle: [col, row, brightness, period in seconds], in design cells
const BRIGHT = [[24, 9, 1, 4.6], [67, 27, 0.85, 3.4], [99, 12, 0.95, 5.8], [189, 7, 0.8, 4.1], [52, -2, 0.8, 5.1], [163, -3, 0.7, 3.9]].map(
  ([x, r, s, p]) => [Math.floor((x + 0.5) * S), Math.floor((r + Y0 + 0.5) * S), s, p],
);
// a design-space column and row for an output cell's centre
const dx_ = (x: number): number => (x + 0.5) / S;
const dy_ = (r: number): number => (r + 0.5) / S - Y0;

// toward the sun: low, from the right and a little behind us (z is forward)
const SUN = (() => {
  const v = [0.94, 0.14, -0.3];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();

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

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const k = clamp((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

// A bowl with a raised rim, r in ground units, q its distance in radii.
const bowl = (q: number, r: number): number => r * ((q < 1 ? -0.36 * (1 - q * q) : 0) + 0.14 * Math.exp(-(((q - 1) / 0.25) ** 2)));

// Craters scattered one to a cell.
function craters(X: number, Z: number, cell: number, salt: number, r0: number, r1: number, p: number): number {
  const ci = Math.floor(X / cell), cj = Math.floor(Z / cell);
  let h = 0;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (hash(i + salt, j - salt) > p) continue;
      const cx = (i + hash(i, j + salt * 3)) * cell, cz = (j + hash(i + salt * 5, j)) * cell;
      const e = hash(j + salt, i - salt * 7);
      const r = cell * (r0 + (r1 - r0) * e * e);
      const dx = X - cx, dz = Z - cz, d2 = dx * dx + dz * dz;
      if (d2 > 4 * r * r) continue;
      h += bowl(Math.sqrt(d2) / r, r) * 0.95;
    }
  }
  return h;
}

// The bright blankets of fresh ejecta round the youngest of those craters,
// as extra albedo: the crater floor a little lighter, a halo fading outward.
function ejecta(X: number, Z: number): number {
  let a = 0;
  for (const [cell, salt, r0, r1, p, zmax] of FIELDS) {
    if (Z > zmax) continue;
    const ci = Math.floor(X / cell), cj = Math.floor(Z / cell);
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let i = ci - 1; i <= ci + 1; i++) {
        if (hash(i + salt, j - salt) > p) continue;
        const fresh = hash(i * 7 + salt, j * 3 - salt);
        if (fresh < 0.72) continue;
        const cx = (i + hash(i, j + salt * 3)) * cell, cz = (j + hash(i + salt * 5, j)) * cell;
        const e = hash(j + salt, i - salt * 7);
        const r = cell * (r0 + (r1 - r0) * e * e);
        const q = Math.hypot(X - cx, Z - cz) / r;
        if (q > 3) continue;
        a += ((fresh - 0.72) / 0.28) * (q < 0.85 ? 0.12 : 0.35 * Math.exp(-(((q - 1.05) / 0.7) ** 2)));
      }
    }
  }
  return a;
}
// the two fields of small craters in height(): cell, salt, radii, share, reach
const FIELDS = [[34, 23, 0.12, 0.36, 0.85, 300], [10, 37, 0.12, 0.34, 0.85, 170]];
// a few big boulders in the near ground, [x, z, radius]
const ROCKS = [[30, 50, 2.4], [62, 63, 1.8], [12, 70, 1.3], [-4, 45, 1.2], [90, 55, 1.6], [46, 90, 1.4]];

function height(X: number, Z: number): number {
  let h = 6 * fbm(X * 0.006 + 50, Z * 0.006 + 50, 3, 0) + 0.6 * fbm(X * 0.04, Z * 0.04, 2, 0);
  // old, worn highlands at the edge of sight, rising to the left, and a lower
  // ridge in front of them
  if (Z > 150) {
    const lift = smooth(150, 300, Z);
    // rounded massifs: folded noise, worn smooth
    const m = 1 - Math.abs(2 * fbm(X * 0.006 + 7, Z * 0.006, 4, 0) - 1);
    h += lift * (28 * Math.exp(-(((X + 260) / 230) ** 2)) + 45 * (m * m - 0.35));
    const ridge = Math.exp(-(((Z - 205) / 20) ** 2)) * Math.exp(-(((X + 140) / 130) ** 2));
    h += ridge * 22 * (0.35 + fbm(X * 0.018 + 3, Z * 0.01, 3, 0));
  }
  // big basins only out in the middle distance, so we do not stand in one
  if (Z > 90) h += craters(X, Z, 110, 11, 0.14, 0.34, 0.55) * smooth(90, 150, Z);
  if (Z < 300) h += craters(X, Z, 34, 23, 0.12, 0.36, 0.85);
  if (Z < 170) h += craters(X, Z, 10, 37, 0.12, 0.34, 0.85) * smooth(170, 110, Z);
  // one big crater in the near ground, off to the left
  {
    const dx = X + 24, dz = Z - 58;
    const q = Math.sqrt(dx * dx + dz * dz) / 16;
    if (q < 2) h += bowl(q, 16);
  }
  // boulders strewn close by, and a few big ones
  if (Z < 90) {
    const c = 5, ci = Math.floor(X / c), cj = Math.floor(Z / c);
    if (hash(ci + 91, cj) < 0.14) {
      const bx = (ci + 0.2 + 0.6 * hash(ci, cj + 92)) * c, bz = (cj + 0.2 + 0.6 * hash(ci + 93, cj)) * c;
      const br = 0.3 + 0.5 * hash(ci + 94, cj + 95) ** 2;
      const d2 = ((X - bx) ** 2 + (Z - bz) ** 2) / (br * br);
      if (d2 < 4) h += br * 0.9 * Math.exp(-d2 * 1.4);
    }
    for (const [bx, bz, br] of ROCKS) {
      const d2 = ((X - bx) ** 2 + (Z - bz) ** 2) / (br * br);
      // a squat, lumpy dome
      if (d2 < 1) h += br * (0.85 + 0.3 * noise(X * 1.3, Z * 1.3, 0)) * Math.sqrt(1 - d2);
    }
  }
  return h;
}

export default function earthrise(): Frame {
  const N = W * H;
  // --- the ground: march each column from near to far ---------------------
  const ground = new Uint8Array(N);
  const top = new Int16Array(W).fill(H);
  const gx = new Float32Array(N), gz = new Float32Array(N), gy = new Float32Array(N);
  const camY = height(0, 7) + CAM_H;
  for (let c = 0; c < W; c++) {
    const dir = (c + 0.5 - W / 2) / F;
    let topR = H, Z = 26, prevY = 0, prevZ = 0, prevF = 1e9;
    while (Z < ZMAX && topR > 0) {
      const X = dir * Z;
      const hy = height(X, Z);
      const Y = hy - (Z * Z) / (2 * RM);
      const yf = EYE - (F * (Y - camY)) / Z;
      let r0 = Math.max(0, Math.ceil(yf - 0.5));
      for (let r = r0; r < topR; r++) {
        // place the cell between this sample and the last, by where its row falls
        const a = prevF > yf + 1e-6 ? clamp((prevF - (r + 0.5)) / (prevF - yf)) : 1;
        const k = r * W + c;
        ground[k] = 1;
        gz[k] = prevZ ? mix(prevZ, Z, a) : Z;
        gx[k] = dir * gz[k];
        gy[k] = prevZ ? mix(prevY, hy, a) : hy;
      }
      if (r0 < topR) topR = r0;
      (prevF = yf), (prevY = hy), (prevZ = Z);
      Z += 0.02 + Z * 0.0075;
    }
    top[c] = topR;
  }

  // Static light: the ground and the sky, everything but the Earth's disc.
  const sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N), sf = new Float32Array(N);
  // fine lumps in the regolith, felt only by the light, not by the shadows
  const bump = (X: number, Z: number): number => 0.1 * noise(X * 0.7 + 31, Z * 0.7, 0) + 0.035 * noise(X * 2.1, Z * 2.1 + 17, 0);
  const SHL = Math.hypot(SUN[0], SUN[2]);
  const SX = SUN[0] / SHL, SZ = SUN[2] / SHL; // toward the sun, along the ground
  // toward the Earth, for the faint earthshine in the shadows
  const EL = Math.hypot(0.3, 0.45, 1);
  const EX = 0.3 / EL, EY = 0.45 / EL, EZ = 1 / EL;
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      if (!ground[k]) continue;
      const X = gx[k], Z = gz[k], Y = gy[k];
      const e = 0.1 + Z * 0.004;
      let hx = (height(X + e, Z) - height(X - e, Z)) / (2 * e);
      let hz = (height(X, Z + e) - height(X, Z - e)) / (2 * e);
      const lam0 = (-hx * SUN[0] + SUN[1] - hz * SUN[2]) / Math.hypot(hx, 1, hz);
      const close = smooth(150, 30, Z);
      if (close > 0) {
        const eb = 0.15;
        hx += (close * (bump(X + eb, Z) - bump(X - eb, Z))) / (2 * eb);
        hz += (close * (bump(X, Z + eb) - bump(X, Z - eb))) / (2 * eb);
      }
      const nl = Math.hypot(hx, 1, hz);
      const lam = (-hx * SUN[0] + SUN[1] - hz * SUN[2]) / nl;
      // toward the eye, for the moon's own way of reflecting (Lommel-Seeliger)
      const vx = -X, vy = camY - Y, vz = -Z, vl = Math.hypot(vx, vy, vz);
      const mu = Math.max(0.03, (-hx * vx + vy - hz * vz) / (nl * vl));
      let lit = 0;
      if (lam0 > 0) {
        // march toward the sun; a soft edge for the sun's own width
        lit = 1;
        let s = 0.1 + Z * 0.003;
        while (s < 120) {
          const px = X + SUN[0] * s, pz = Z + SUN[2] * s, py = Y + SUN[1] * s;
          const d = py - height(px, pz);
          if (d < 0) {
            lit = 0;
            break;
          }
          lit = Math.min(lit, (d * 30) / s);
          s += 0.05 + s * 0.2;
        }
        lit = smooth(0, 1, lit);
      }
      // regolith: patchy at every scale, the maria darker and a touch cooler,
      // fresh ejecta bright round the young craters
      const mare = smooth(0.46, 0.64, fbm(X * 0.0035, Z * 0.0035 + 20, 3, 0));
      const fine = fbm(X * 0.35, Z * 0.35, 2, 0) - 0.5;
      const micro = close * (fbm(X * 1.5 + 5, Z * 1.5, 2, 0) - 0.5);
      const albedo = Math.max(0.25, 0.62 + 0.55 * (fbm(X * 0.025 + 3, Z * 0.025, 3, 0) - 0.5) + 0.3 * fine + 0.25 * micro - 0.2 * mare + ejecta(X, Z));
      // mostly the moon's flat Lommel-Seeliger glow, with some Lambert for relief
      const lm = Math.max(0, lam);
      const direct = lit * ((1.1 * lm) / (lm + mu) + 1.5 * lm);
      // the near corners fall off a little, to frame the view
      const vig = 1 - 0.3 * smooth(84, 106, dy_(r)) * smooth(30, 100, Math.abs(dx_(x) - 100));
      let b = 0.88 * (1 - Math.exp(-direct * albedo * 1.25));
      // light thrown back off the sunlit ground into the shadows, mostly onto
      // the walls that face away from the sun, and a breath of earthshine
      const away = clamp(0.35 - 1.4 * ((-hx * SX - hz * SZ) / nl));
      const bounce = (1 - lit) * albedo * 0.014 * away * (0.6 + 0.4 * close);
      const es = (1 - lit) * 0.006 * clamp((-hx * EX + EY - hz * EZ) / nl);
      // the far crest catches the sun along its whole length
      const crest = r - top[x];
      if (crest < 2 && lit > 0.2) b = Math.max(b, (crest < 1 ? 0.62 : 0.45) * albedo);
      // print grain
      const grain = (1 + 0.06 * (hash(x + 401, r + 7) - 0.5)) * vig;
      const warm = 1 - mare;
      sr[k] = (b * (0.95 + 0.03 * warm) + bounce * 1.02 + es * 0.7) * grain;
      sg[k] = (b * (0.945 + 0.005 * warm) + bounce * 0.96 + es * 0.85) * grain;
      sb[k] = (b * (0.93 - 0.03 * warm) + bounce * 0.9 + es * 1.2) * grain;
      sf[k] = 0.04;
    }
  }

  // the sky: a faint band of the galaxy, and stars that hold still
  const near = (x: number, r: number): number => Math.hypot(dx_(x) - EC[0], dy_(r) - (EC[1] - RISE / 2));
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      if (ground[k]) continue;
      // a black sky. Faint stars, thicker along a diagonal where the galaxy
      // runs, drowned out round the bright Earth
      const X = dx_(x), Y = dy_(r);
      const bandD = (Y - (4 + X * 0.32)) / 1.05;
      const clumps = fbm(X * 0.05, (Y + 20) * 0.08, 3, 0);
      const band = Math.exp(-((bandD / 10) ** 2)) * smooth(0.35, 0.65, clumps) * smooth(120, 70, X);
      // the galaxy's own unresolved glow, split by a dark lane of dust
      const lane = 1 - 0.7 * Math.exp(-(((bandD + 1.5 + 4 * (fbm(X * 0.08 + 9, Y * 0.08, 2, 0) - 0.5)) / 2.2) ** 2));
      const glow = 0.02 * Math.exp(-((bandD / 9) ** 2)) * smooth(130, 60, X) * (0.4 + 0.9 * clumps) * lane;
      const dE = near(x, r);
      let cr = glow * 0.9, cg = glow * 0.92, cb = glow * 1.05;
      const hs = hash(x * 3 + 1, r * 7 + 2);
      if (hs > 0.9965 - 0.03 * band && dE > 1.6 * ER) {
        // many faint, few bright; hot stars blue-white, cool ones amber
        const m = Math.pow(hash(x + 17, r + 29), 4);
        const s = (0.12 + 0.6 * m) * smooth(1.6 * ER, 2.4 * ER, dE);
        const tint = hash(x + 5, r + 77);
        const [tr, tg, tb] = tint < 0.25 ? [0.78, 0.86, 1] : tint > 0.9 ? [1, 0.82, 0.62] : tint > 0.75 ? [1, 0.94, 0.84] : [0.96, 0.97, 1];
        (cr += s * tr), (cg += s * tg), (cb += s * tb);
      }
      sr[k] = cr, sg[k] = cg, sb[k] = cb, sf[k] = 0;
    }
  }

  // --- the Earth -----------------------------------------------------------
  // Equirectangular maps, wrapping in longitude: surface colour and cloud.
  const TW = 192, TH = 96;
  const tr = new Float32Array(TW * TH), tg = new Float32Array(TW * TH), tb = new Float32Array(TW * TH), sea = new Float32Array(TW * TH);
  const cloud = new Float32Array(TW * TH);
  const storms = [[0.9, 0.8, 1], [3.1, -0.85, -1], [4.6, 0.62, 1], [1.9, 0.25, 1], [5.6, -0.55, -1]];
  const elev = new Float32Array(TW * TH);
  for (let j = 0; j < TH; j++) {
    const v = (j + 0.5) / TH, lat = (0.5 - v) * Math.PI, al = Math.abs(lat);
    for (let i = 0; i < TW; i++) {
      const u = i / TW, lon = u * Math.PI * 2, t = j * TW + i;
      const wx = fbm(u * 6, v * 3 + 9, 3, 6);
      elev[t] = fbm(u * 8 + 1.6 * wx, v * 4, 5, 8) - 0.04 * smooth(1.2, 1.5, al);
      // clouds: warped noise, wound into spirals around a few storms
      let cx = u * 14, cy = v * 7;
      for (const [slon, slat, spin] of storms) {
        let dl = lon - slon;
        dl -= Math.round(dl / (Math.PI * 2)) * Math.PI * 2;
        const lx = dl * Math.cos(lat), ly = lat - slat;
        const dd = Math.hypot(lx, ly);
        const a = spin * 5 * Math.exp(-dd / 0.2);
        if (a * spin > 0.02) {
          const ca = Math.cos(a), sa = Math.sin(a);
          cx += ((lx * ca - ly * sa - lx) / (Math.PI * 2)) * 14;
          cy -= ((lx * sa + ly * ca - ly) / Math.PI) * 7;
        }
      }
      // streaked along the winds, east to west
      const q = fbm(cx * 0.5 + 3, cy * 1.2, 3, 7);
      const n0 = fbm(cx + 1.6 * q, cy * 1.3 + 0.5 * q, 5, 14);
      // folded into filaments, the way weather fronts string out
      const n = 0.4 * n0 + 0.6 * (1 - Math.abs(2 * fbm(cx * 1.5 + 2.2 * q, cy * 1.6 + 9, 4, 21) - 1));
      // cloudy at the equator and in the storm belts, clearer in the subtropics
      const belt = 0.05 * Math.exp(-((lat / 0.12) ** 2)) - 0.07 * Math.exp(-(((al - 0.42) / 0.16) ** 2)) + 0.05 * Math.exp(-(((al - 0.95) / 0.25) ** 2));
      cloud[t] = n + belt;
    }
  }
  // thresholds by share of the globe: about three tenths land, a third cloud
  const quantile = (A: Float32Array, p: number): number => {
    const s = Float32Array.from(A).sort();
    return s[Math.floor(p * (s.length - 1))];
  };
  const shore = quantile(elev, 0.7), c0 = quantile(cloud, 0.6), c1 = quantile(cloud, 0.86), c2 = quantile(cloud, 0.95);
  const thick = new Float32Array(TW * TH);
  for (let j = 0; j < TH; j++) {
    const v = (j + 0.5) / TH, lat = (0.5 - v) * Math.PI, al = Math.abs(lat);
    for (let i = 0; i < TW; i++) {
      const u = i / TW, t = j * TW + i, e = elev[t];
      const land = smooth(shore - 0.004, shore + 0.006, e);
      const ice = smooth(1.22, 1.32, al + 0.12 * fbm(u * 12, v * 6, 2, 12));
      // desert in the subtropics and on high ground, forest and scrub elsewhere,
      // broken up finely so a continent is never one flat tone
      const grain = fbm(u * 36 + 2, v * 18, 3, 36) - 0.5;
      const arid = clamp(Math.exp(-(((al - 0.4) / 0.22) ** 2)) * (0.1 + 1.2 * fbm(u * 10 + 4, v * 5, 3, 10)) + (e - shore - 0.04) * 4 + 0.8 * grain);
      const relief = 1 + 0.9 * grain - 2 * Math.max(0, e - shore - 0.08);
      // dark forest, olive grassland, ochre desert
      const a2 = arid * 2, a3 = Math.max(0, a2 - 1);
      let r = arid < 0.5 ? mix(0.12, 0.26, a2) : mix(0.26, 0.52, a3);
      let g = arid < 0.5 ? mix(0.16, 0.25, a2) : mix(0.25, 0.43, a3);
      let b = arid < 0.5 ? mix(0.08, 0.14, a2) : mix(0.14, 0.31, a3);
      (r *= relief), (g *= relief), (b *= relief);
      // ocean, deep navy, lighter and greener over the shelves near the coasts
      const shelf = smooth(shore - 0.06, shore, e);
      const or = mix(0.025, 0.04, shelf), og = mix(0.06, 0.13, shelf), ob = mix(0.15, 0.22, shelf);
      r = mix(or, r, land), g = mix(og, g, land), b = mix(ob, b, land);
      r = mix(r, 0.82, ice), g = mix(g, 0.86, ice), b = mix(b, 0.9, ice);
      tr[t] = r, tg[t] = g, tb[t] = b, sea[t] = (1 - land) * (1 - ice);
      thick[t] = smooth(c1, c2, cloud[t]);
      cloud[t] = smooth(c0, c1, cloud[t]);
    }
  }
  const sample = (A: Float32Array, lon: number, vy: number): number => {
    const fx = (((lon / (Math.PI * 2)) % 1) + 1) % 1 * TW;
    const x0 = Math.floor(fx), ax = fx - x0, x1 = (x0 + 1) % TW;
    const y0 = Math.max(0, Math.min(TH - 2, Math.floor(vy))), ay = clamp(vy - y0);
    const a = A[y0 * TW + x0], b = A[y0 * TW + x1], c = A[y0 * TW + TW + x0], d = A[y0 * TW + TW + x1];
    return a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay;
  };

  const L = [SUN[0], SUN[1], -SUN[2]]; // into screen space, z toward us
  const HV = (() => {
    const v = [L[0], L[1], L[2] + 1];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  })();
  const tilt = 0.4, nod = 0.22;
  const ct = Math.cos(tilt), st = Math.sin(tilt), cn = Math.cos(nod), sn = Math.sin(nod);
  // the sky cells the Earth and its air can reach, as it rises and settles
  const box: number[] = [];
  const r0 = Math.max(0, Math.floor((EC[1] - RISE - ER - 5 + Y0) * S)), r1 = Math.min(H - 1, Math.ceil((EC[1] + ER + 2 + Y0) * S));
  const x0 = Math.floor((EC[0] - ER - 5) * S), x1 = Math.min(W - 1, Math.ceil((EC[0] + ER + 5) * S));
  for (let r = r0; r <= r1; r++) {
    for (let x = x0; x <= x1; x++) if (!ground[r * W + x]) box.push(r * W + x);
  }
  // the bright stars and the faint cross each one carries
  const twinkle: [k: number, s: number, p: number, ph: number, core: boolean][] = [];
  for (const [x, r, s, p] of BRIGHT) {
    for (const [ox, oy, w] of [[0, 0, 1], [-1, 0, 0.14], [1, 0, 0.14], [0, -1, 0.14], [0, 1, 0.14]]) {
      const k = (r + oy) * W + x + ox;
      if (!ground[k]) twinkle.push([k, s * w, p, hash(x, r) * 6.28, w === 1]);
    }
  }
  let painted: Uint8ClampedArray | null = null;

  return (t, px) => {
    if (painted !== px) {
      for (let k = 0; k < N; k++) dot(px, k, sr[k], sg[k], sb[k], sf[k]);
      painted = px;
    }
    const spin = t * 0.045;
    const drift = t * 0.012; // clouds run a little ahead of the ground
    const ey = EC[1] - RISE * (0.5 - 0.5 * Math.cos((t / RISE_T) * Math.PI * 2));
    for (const k of box) {
      const x = k % W, r = (k / W) | 0;
      let cr = sr[k], cg = sg[k], cb = sb[k], floor = 0;
      const dx = dx_(x) - EC[0], dy = dy_(r) - ey;
      const d = Math.hypot(dx, dy);
      // the Earth's air, a thin blue rim on its sunlit side
      if (d >= ER - 1 && d < ER + 4) {
        const side = smooth(0, 0.8, (dx * L[0] - dy * L[1]) / d);
        const g = Math.exp(-Math.max(0, d - ER) / 0.5) * 0.45 * side;
        if (g > 0.02) (cr += 0.3 * g), (cg += 0.55 * g), (cb += 1.0 * g);
      }
      // how much of the cell the disc covers, for a clean round edge
      const cov = clamp((ER - d) * S + 0.5);
      if (cov > 0) {
        const q = Math.min(d / ER, 0.999), sc = d > 0 ? q / d : 0;
        const nx = dx * sc, ny = -dy * sc;
        const nz = Math.sqrt(1 - q * q);
        // into the globe's own frame: tip the pole toward us, then lean it
        const ax = nx * ct + ny * st;
        const ay0 = -nx * st + ny * ct;
        const ay = ay0 * cn - nz * sn;
        const az = ay0 * sn + nz * cn;
        const lat = Math.asin(Math.max(-1, Math.min(1, ay)));
        const lon = Math.atan2(ax, az) + LON0 + spin;
        const vy = (0.5 - lat / Math.PI) * TH - 0.5;
        const ndl = nx * L[0] + ny * L[1] + nz * L[2];
        // sunlight on the ground, fading through a soft twilight band into night
        const irr = smooth(-0.025, 0.1, ndl) * Math.pow(clamp(0.9 * ndl + 0.1), 0.85);
        const dusk = Math.exp(-(((ndl - 0.04) / 0.07) ** 2));
        const cl = sample(cloud, lon + drift, vy);
        const th = sample(thick, lon + drift, vy);
        // the cloud's own shadow, offset away from the sun
        const sh = sample(cloud, lon + drift - 0.03, vy + 0.4);
        const sw = sample(sea, lon, vy);
        let er = sample(tr, lon, vy), eg = sample(tg, lon, vy), eb = sample(tb, lon, vy);
        const shade = 1 - 0.55 * sh * (1 - cl);
        (er *= shade), (eg *= shade), (eb *= shade);
        // clouds: thick tops bright white, thin veils greyer and see-through
        const cw = 0.8 + 0.22 * th;
        (er = mix(er, 0.93 * cw, cl)), (eg = mix(eg, 0.95 * cw, cl)), (eb = mix(eb, 0.98 * cw, cl));
        // the low sun reddens the light along the terminator
        const warm = dusk * (0.4 + 0.6 * cl);
        (er *= irr * 1.12 * (1 + 0.3 * warm)), (eg *= irr * 1.12 * (1 - 0.02 * warm)), (eb *= irr * 1.12 * (1 - 0.3 * warm));
        // the blue of the air, thicker toward the limb: it veils the ground
        // and lights up in the sun
        const path = 0.22 / (nz + 0.12);
        const ext = Math.exp(-0.28 * path);
        const air = Math.min(1.4, path) * smooth(-0.06, 0.2, ndl) * Math.pow(clamp(ndl + 0.1), 0.6);
        (er = er * ext + 0.05 * air), (eg = eg * ext + 0.12 * air), (eb = eb * ext + 0.3 * air);
        // the sun's glint on open water, roughened by the waves
        const hv = nx * HV[0] + ny * HV[1] + nz * HV[2];
        if (hv > 0.9 && sw > 0) {
          const glint = Math.pow(hv, 40) * 0.5 * sw * (1 - cl) * (0.55 + 0.9 * noise(lon * 60, vy * 6 + t * 0.3, 0) ** 2);
          (er += glint * 0.98), (eg += glint * 0.94), (eb += glint * 0.85);
        }
        (cr = mix(cr, er, cov)), (cg = mix(cg, eg, cov)), (cb = mix(cb, eb, cov));
        // the day side is the brightest thing in the sky: full, round dots
        floor = 0.12 * cov * smooth(0, 0.15, irr);
      }
      dot(px, k, cr, cg, cb, floor);
    }
    for (const [k, s, p, ph, core] of twinkle) {
      const v = s * (0.86 + 0.14 * Math.sin((t / p) * Math.PI * 2 + ph));
      if (core) dot(px, k, v * 0.97, v * 0.98, v, 0);
      else dot(px, k, Math.max(sr[k], v * 0.95), Math.max(sg[k], v), Math.max(sb[k], v * 1.1), 0);
    }
  };
}
