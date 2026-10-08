/*
 * taj dawn: the Taj Mahal at first light, seen down its long reflecting canal
 * between rows of cypress. The sun has just cleared the red sandstone mosque
 * on the left; the haze and the clouds drift, the canal's reflection ripples,
 * light glints along its far end, and a few birds cross.
 *
 * Shaded in colour cell by cell, then drawn as a halftone: every cell is a
 * dot whose size is its brightness, in its own colour.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "taj dawn",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#0d0a13",
} satisfies Meta;

// The scene is designed in the original 200-wide units and sampled finer: K
// output cells per design unit, with Y0 design rows of extra sky added above
// the original frame. Output cell (ox, oy) sits at design (ox + 0.5) / K,
// (oy + 0.5) / K - Y0.
const OW = 320, OH = 180;
const K = OW / 200;
const Y0 = 8;
const W = 200; // design width
const H = OH / K - Y0; // design y of the bottom edge
const CX = 128; // the Taj's axis, and the canal's vanishing point
const BASE = 68; // where the Taj meets the garden, and the far end of the canal
const HZ = 60; // eye level
const S = 0.7; // cells per metre on the Taj
const SUN = [36, 40];
const MX = 45, MB = 67; // the mosque's axis and foot
const KR = 1.55; // the reflection is foreshortened so the dome reaches the canal

// materials
const SKY = 0, BGTREE = 1, MARBLE = 2, LAWN = 3, WALK = 4, POOL = 5, CYPRESS = 6, MOSQUE = 7;

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

// The onion dome's profile: swelling out past the drum, then drawn to a point.
const onion = (h: number) => (h < 0.3 ? 0.8 + 0.2 * Math.sin((h / 0.3) * Math.PI * 0.5) : Math.pow(Math.cos(((h - 0.3) / 0.7) * Math.PI * 0.5), 1.45));

// Pointed arch: half-width at height h above the springline, for an arch of
// half-width w; zero above the apex.
const arch = (w: number, h: number) => {
  if (h <= 0) return w;
  const c = w * 0.5, R = w + c;
  const q = R * R - h * h;
  return q > 0 ? Math.max(0, Math.sqrt(q) - c) : 0;
};

/*
 * The Taj in metres: X across from the axis, Y up from the garden. Returns
 * [lit, recess] for marble, or null for air. lit runs 0 (shadow, facing away
 * from the sun) to 1 (facing it); recess darkens arches and niches.
 */
function taj(X: number, Y: number): [number, number] | null {
  const ax = Math.abs(X);
  const left = X < 0 ? 1 : -1; // +1 on the sun's side
  // finial
  if (Y >= 72 && Y < 80.5 && ax <= 0.75 + (Math.abs(Y - 74.5) < 0.9 ? 0.6 : 0) + (Math.abs(Y - 77) < 0.7 ? 0.4 : 0)) return [0.75 + 0.2 * left, 0];
  // the great dome
  if (Y >= 47.5 && Y < 72) {
    const h = (Y - 47.5) / 24.5;
    const hw = 15 * onion(h);
    if (ax <= hw) {
      // a sphere lit from the left and a little above
      const nx = X / (hw + 0.01);
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx));
      return [clamp(0.3 + 0.5 * (-0.8 * nx + 0.4 * nz) + 0.2 * h), 0];
    }
  }
  // the four chhatris on the roof, two in view
  const cx = ax - 17.5;
  if (Math.abs(cx) <= 4.4 && Y >= 39.5 && Y < 55.5) {
    const nx = (X < 0 ? -cx : cx) / 4.4;
    if (Y < 41) return [clamp(0.5 - 0.4 * nx * left), 0];
    if (Y < 46.5) {
      if (Math.abs(cx) > 3.6) return null;
      const open = Math.abs(cx) < 2.6 && Math.abs(cx) > 0.6 && Y < 45.5;
      return [clamp(0.5 - 0.45 * (X < 0 ? -cx : cx) / 4 * left), open ? 0.75 : 0];
    }
    if (Y < 47.3) return [clamp(0.55 - 0.4 * nx * left), 0];
    const h = (Y - 47.3) / 6.5;
    if (h < 1 && Math.abs(cx) <= 4 * onion(h)) return [clamp(0.55 - 0.6 * ((X < 0 ? -cx : cx) / (4 * onion(h) + 0.01)) * left + 0.1 * h), 0];
    if (h >= 1 && Math.abs(cx) < 0.6) return [0.6, 0];
  }
  // the drum under the dome
  if (Y >= 40 && Y < 47.5 && ax <= 12.2) {
    const nx = X / 12.2;
    const band = Y > 45.8 ? 0.15 : 0;
    return [clamp(0.45 - 0.55 * nx + band), 0];
  }
  // slender pinnacles at the corners of the portal and of the building
  if ((Math.abs(ax - 8.8) < 0.75 && Y >= 40 && Y < 47.5) || (Math.abs(ax - 28.2) < 0.75 && Y >= 38 && Y < 44.5)) return [0.55 + 0.25 * left, 0];
  // the main building
  if (ax <= 28.5 && Y >= 7 && Y < 40) {
    // the portal rises a little above the parapet
    if (Y >= 38.5 && ax > 9 && (Math.floor((ax + 0.5) / (2 / (S * K))) & 1)) return null; // merlons two cells wide
    if (ax <= 9) {
      // central portal: a calligraphy band round a deep pointed arch
      const hw = arch(6, Y - 25);
      if (ax <= hw && Y < 25 + 9) {
        const door = ax <= 3.2 && ax <= arch(3.2, Y - 15.5);
        return [0.35 + 0.15 * left, door ? 0.82 : 0.6 + 0.12 * (1 - smooth(25, 33, Y))];
      }
      if (ax <= hw + 0.8 && Y < 25 + 10.2) return [0.42, 0.35];
      if (ax > 7.6 && ax <= 9 && Y < 40) return [0.5 + 0.12 * left, 0.08];
      return [0.5 + 0.08 * left, 0];
    }
    if (ax <= 21) {
      // front face either side of the portal: two storeys of arched niches
      const nx = ax - 15;
      for (const [y0, y1] of [[9, 21.5], [24.5, 37]]) {
        if (Y >= y0 && Y < y1 && Math.abs(nx) <= arch(3.6, Y - (y1 - 4.5))) return [0.4 + 0.1 * left, 0.5];
        if (Y >= y0 - 0.6 && Y < y1 + 0.6 && Math.abs(nx) <= arch(4.3, Y - (y1 - 4.2)) && Math.abs(nx) > 3.6) return [0.45, 0.22];
      }
      return [0.5 + 0.1 * left, 0];
    }
    // chamfered corners, turned toward the sun on the left and away on the right
    const lit = 0.5 + 0.48 * left;
    const nx = ax - 24.7;
    for (const [y0, y1] of [[9, 21.5], [24.5, 37]]) {
      if (Y >= y0 && Y < y1 && Math.abs(nx) <= arch(2.2, Y - (y1 - 3))) return [lit * 0.7, 0.45];
    }
    return [lit, 0];
  }
  // minarets at the corners of the plinth, tapering, with three galleries
  const mx = ax - 44;
  if (Y >= 7 && Y < 57) {
    const s = X < 0 ? -mx : mx; // across the shaft, toward the sun negative
    const hw = 2.9 - 0.6 * (Y - 7) / 40;
    for (const g of [19.5, 32, 44.5]) {
      if (Y >= g && Y < g + 1.4 && Math.abs(mx) <= hw + 1.1) return [clamp(0.5 - 0.42 * s / (hw + 1.1) * left), Y < g + 0.5 ? 0.35 : 0];
    }
    if (Y < 46 && Math.abs(mx) <= hw) return [clamp(0.5 - 0.48 * (s / hw) * left), 0];
    if (Y >= 45.9 && Y < 49.5 && Math.abs(mx) <= 2.2) return [clamp(0.5 - 0.4 * s / 2.2 * left), Math.abs(mx) < 1.4 && Math.abs(mx) > 0.3 ? 0.7 : 0];
    if (Y >= 49.5) {
      const h = (Y - 49.5) / 4.5;
      if (h < 1 && Math.abs(mx) <= 2.5 * onion(h)) return [clamp(0.55 - 0.55 * s / (2.5 * onion(h) + 0.01) * left), 0];
      if (h >= 1 && Y < 56 && Math.abs(mx) < 0.5) return [0.6, 0];
    }
  }
  // the plinth, with a row of shallow niches
  if (ax <= 47.5 && Y >= 0 && Y < 7) {
    if (Y > 6.2) return [0.62, 0];
    const k = (ax % 5.2) - 2.6;
    if (Y > 1.5 && Y < 5.2 && Math.abs(k) < 1.1) return [0.42, 0.3];
    return [0.52, 0];
  }
  return null;
}

/*
 * The red sandstone mosque that flanks the Taj, in cells: three domes over a
 * five-bay front with a tall central portal. Returns 0 for wall, 1 for dome,
 * 2 for a recess, or -1 for air. It stands against the sun, so it is mostly
 * silhouette.
 */
function mosque(xc: number, y: number): number {
  const dx = xc - MX, ax = Math.abs(dx);
  // plinth
  if (y >= MB - 2.5 && y < MB && ax <= 22) return 0;
  // end towers, each with a small kiosk on top
  const tx = Math.abs(ax - 19.5);
  if (tx <= 1.3 && y >= MB - 13 && y < MB - 2.5) return 0;
  if (y >= MB - 15.5 && y < MB - 13) {
    const h = (MB - 13 - y) / 2.5;
    if (tx <= 1.8 * onion(h)) return 1;
  }
  if (tx < 0.35 && y >= MB - 16.5 && y < MB - 15.5) return 1;
  // central portal, rising above the front
  if (ax <= 5.5 && y >= MB - 15 && y < MB - 2.5) {
    if (y < MB - 14.3 && (Math.floor((xc * K) / 2) & 1)) return -1;
    if (ax <= arch(3.4, MB - 9.5 - y) && y >= MB - 13.5) return 2;
    return 0;
  }
  // the five-bay front and its parapet
  if (ax <= 18 && y >= MB - 10 && y < MB - 2.5) {
    const bay = ((ax - 5.5) % 4.2) - 2.1;
    if (ax > 6 && y >= MB - 8.5 && Math.abs(bay) <= arch(1.4, MB - 6.2 - y)) return 2;
    return 0;
  }
  if (ax <= 18 && y >= MB - 10.8 && y < MB - 10 && (Math.floor((xc * K) / 2) & 1)) return 0;
  // side domes on drums
  const sx = Math.abs(ax - 11.5);
  if (sx <= 2.6 && y >= MB - 12 && y < MB - 10) return 0;
  if (y >= MB - 17 && y < MB - 12) {
    const h = (MB - 12 - y) / 5;
    if (sx <= 3.6 * onion(h)) return 1;
  }
  if (sx < 0.35 && y >= MB - 18.5 && y < MB - 17) return 1;
  // the great central dome
  if (ax <= 4 && y >= MB - 16.5 && y < MB - 15) return 0;
  if (y >= MB - 23.5 && y < MB - 16.5) {
    const h = (MB - 16.5 - y) / 7;
    if (ax <= 5.2 * onion(h)) return 1;
  }
  if (ax < 0.4 && y >= MB - 25.5 && y < MB - 23.5) return 1;
  return -1;
}

export default function tajDawn(): Frame {
  const N = OW * OH;
  // design coordinates of each output column and row
  const DX = new Float32Array(OW), DY = new Float32Array(OH);
  for (let x = 0; x < OW; x++) DX[x] = (x + 0.5) / K;
  for (let r = 0; r < OH; r++) DY[r] = (r + 0.5) / K - Y0;
  const rowOf = (y: number) => Math.floor((y + Y0) * K); // output row holding design y
  const colOf = (x: number) => Math.floor(x * K);


  const mat = new Uint8Array(N);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const floorA = new Float32Array(N).fill(0.12);
  const hazeW = new Float32Array(N); // how much drifting haze each cell takes
  const glowA = new Float32Array(N); // how much of the sun's glow a sky cell holds, for its breathing

  // --- the sky ------------------------------------------------------------
  // The sun's glow through the haze: a hot core, a halo, and a broad warmth.
  const sunGlow = (x: number, y: number) => {
    const dx = x - SUN[0], dy = (y - SUN[1]) * 1.25;
    const d = Math.sqrt(dx * dx + dy * dy);
    return Math.exp(-d / 3.5) * 0.85 + Math.exp(-d / 11) * 0.38 + Math.exp(-d / 34) * 0.3;
  };
  // Clear sky by elevation, from the cold side (away from the sun): deep
  // blue overhead, dusk lavender, then dusty rose and peach at the horizon.
  const SKY_E = [0, 0.1, 0.3, 0.6, 1];
  const SKY_C = [[0.76, 0.6, 0.56], [0.6, 0.48, 0.52], [0.3, 0.29, 0.44], [0.1, 0.12, 0.26], [0.03, 0.04, 0.12]];
  const skyAt = (x: number, y: number) => {
    const e = clamp((HZ - y) / (HZ + Y0)); // 0 at eye level, 1 at the top of the frame
    let i = 0;
    while (i < 3 && e > SKY_E[i + 1]) i++;
    const q = smooth(0, 1, (e - SKY_E[i]) / (SKY_E[i + 1] - SKY_E[i]));
    const c0 = SKY_C[i], c1 = SKY_C[i + 1];
    let r = mix(c0[0], c1[0], q), g = mix(c0[1], c1[1], q), b = mix(c0[2], c1[2], q);
    // toward the sun the low sky turns to apricot and gold
    const az = Math.exp(-Math.abs(x - SUN[0]) / 60);
    const warm = az * (1 - smooth(0, 0.65, e)) * 0.85;
    r = mix(r, 0.98, warm), g = mix(g, 0.66, warm), b = mix(b, 0.42, warm);
    // the last of the night lingering high on the far side
    const night = smooth(10, -Y0, y) * smooth(70, 190, x) * 0.45;
    r *= 1 - night, g *= 1 - night * 0.9, b *= 1 - night * 0.6;
    // the glow: white-gold at the core, reddening as it spreads
    const dx = x - SUN[0], dy = (y - SUN[1]) * 1.25;
    const d = Math.sqrt(dx * dx + dy * dy);
    const core = Math.exp(-d / 3.5) * 0.85, halo = Math.exp(-d / 11) * 0.38, wide = Math.exp(-d / 34) * 0.3;
    // and a band of brightness along the horizon, strongest under the sun
    const band = Math.exp(-Math.abs(y - 57) / 5) * 0.22 * Math.exp(-Math.abs(dx) / 55);
    r += core * 1.0 + halo * 1.0 + (wide + band) * 0.9;
    g += core * 0.92 + halo * 0.74 + (wide + band) * 0.55;
    b += core * 0.75 + halo * 0.46 + (wide + band) * 0.32;
    // faint shafts of light fanning up from the sun through the haze
    const ang = Math.atan2(y - SUN[1], dx);
    const ray = fbm(ang * 9 + 3, 1.7, 2, 0);
    const shaft = smooth(0.5, 0.75, ray) * Math.exp(-d / 45) * smooth(4, 14, d) * 0.1;
    r += shaft, g += shaft * 0.75, b += shaft * 0.5;
    return [r, g, b];
  };
  // The low haze, per column: the colour distance fades toward, warm gold
  // under the sun, cool rose-lavender away from it.
  const mR = new Float32Array(OW), mG = new Float32Array(OW), mB = new Float32Array(OW);
  for (let x = 0; x < OW; x++) {
    const w = Math.exp(-Math.abs(DX[x] - SUN[0]) / 70);
    mR[x] = mix(0.6, 0.94, w), mG[x] = mix(0.5, 0.7, w), mB[x] = mix(0.56, 0.52, w);
  }

  // Dawn cloud in a wrapping strip that drifts: broken noise, gathered into
  // a bank up and right of the sun and a lower one behind the dome. Kept at
  // output resolution: CW design units around, from the top of the frame
  // down to design row CH.
  const CW = 400, CH = 50;
  const OCW = CW * K, OCH = rowOf(CH);
  // [x, y, half-width, height above, depth below, strength]
  const banks = [
    [76, 28, 40, 7, 3.5, 1.4], // over the sun's right shoulder
    [152, 36, 52, 9, 4, 1], // behind the dome
    [16, 13, 32, 4, 2.5, 0.8], // a high wisp
    [250, 24, 40, 8, 4, 1],
    [330, 33, 36, 7, 4, 0.95],
    [120, 0, 40, 3, 2, 0.55], // thin streaks high on the night side
    [300, 3, 46, 3, 2, 0.5],
  ];
  const cdens = (x: number, y: number) => {
    const q = fbm(x * 0.01, y * 0.04, 2, CW * 0.01);
    const n = fbm(x * 0.025 + q * 1.6, y * 0.075 + q * 0.6, 5, CW * 0.025);
    let m = 0;
    for (const [bx, by, rx, up, down, a] of banks) {
      let dx = x - bx;
      dx -= Math.round(dx / CW) * CW;
      const ex = dx / rx, ey = (y - by) / (y < by ? up : down);
      const e = Math.exp(-ex * ex * ex * ex - ey * ey) * a;
      if (e > m) m = e;
    }
    return 0.62 * m + 1.4 * (n - 0.5) + 0.02;
  };
  const cloud = new Float32Array(OCW * OCH);
  const cloudLit = new Float32Array(OCW * OCH);
  for (let r = 0; r < OCH; r++) {
    const y = DY[r];
    for (let ox = 0; ox < OCW; ox++) {
      const x = (ox + 0.5) / K;
      const d = cdens(x, y);
      cloud[r * OCW + ox] = smooth(0.46, 0.66, d);
      // the side toward the sun (down and left) catches the light
      const toward = cdens(x - 2, y + 2.5);
      cloudLit[r * OCW + ox] = clamp(0.56 + (d - toward) * 0.75 - (d - 0.6) * 0.2 + 0.7 * (fbm(x * 0.09, y * 0.2, 2, CW * 0.09) - 0.5));
    }
  }

  // --- the land -----------------------------------------------------------
  // the far tree line: rounded crowns, lower behind the Taj
  const crowns: [number, number, number][] = [];
  for (let x = -12, i = 0; x < W + 12; x += 4 + hash(i, 60) * 5, i++) {
    const rad = 3 + hash(i, 61) * 4.5;
    crowns.push([x, 60.5 - hash(i, 62) * 2.5 - 2.5 * fbm(x * 0.03, 2, 2, 0) + rad * 0.35, rad]);
  }
  const tops = new Float32Array(OW);
  for (let ox = 0; ox < OW; ox++) {
    const x = DX[ox];
    let t0 = 64;
    for (const [cx, cy, rad] of crowns) {
      const dx = x - cx;
      if (Math.abs(dx) < rad) t0 = Math.min(t0, cy - Math.sqrt(rad * rad - dx * dx) * 0.75);
    }
    tops[ox] = t0 - 0.6 * fbm(x * 0.5, 7, 2, 0);
  }
  const poolHalf = (y: number) => 0.5 * (y - HZ) + 1;
  const walkHalf = (y: number) => 0.7 * (y - HZ) + 1.5;

  // cypress rows either side of the canal, near ones last
  const trees: { x: number; base: number; h: number; w: number; s: number }[] = [];
  for (const s of [8.5, 10.4, 13, 16.8, 22.5, 31]) {
    for (const side of [-1, 1]) {
      // an inner row along the walks, and a lower outer row further back
      for (const [off, tall] of [[4.3, 0.8], [2.45, 1]]) {
        if (off > 3 && (s > 20 || side > 0)) continue;
        if (side < 0 && s > 30) continue; // leave the sun clear
        const cxp = CX + side * off * s;
        trees.push({ x: cxp + (hash(s * 10, side + off) - 0.5) * 0.6, base: HZ + s, h: 1.6 * tall * s * (0.94 + 0.12 * hash(s * 7, side + 3 + off)), w: 0.26 * s, s });
      }
    }
  }
  // long shadows of the cypresses, cast toward us and to the right, their
  // edges softening (penumbra) and their tone lifting the further they reach
  const shadowAt = (xc: number, y: number) => {
    let lit = 1;
    for (const tr of trees) {
      const dx = xc - tr.x, dy = y - tr.base;
      if (dy < -0.5) continue;
      const along = (dx * 0.6 + dy * 0.8) / tr.s;
      if (along <= 0 || along >= 3) continue;
      const across = Math.abs(dx * 0.8 - dy * 0.6) / tr.s;
      const hw = 0.17 * (1 - along / 3.4) + 0.03, soft = 0.015 + 0.035 * along;
      const inS = smooth(hw + soft, hw - soft, across);
      if (inS > 0) lit *= 1 - inS * (0.9 - 0.9 * smooth(1.4, 3, along));
    }
    return lit;
  };
  // the low sun's light, and the sky's
  const SUNL = [1.2, 0.86, 0.58], AMB = [0.5, 0.52, 0.68];

  // the mosque's silhouette, and its edges toward the sun
  const mq = new Int8Array(N).fill(-1);
  for (let r = Math.max(0, rowOf(MB - 27)); r <= rowOf(MB); r++) {
    for (let x = colOf(MX - 24); x <= colOf(MX + 25); x++) mq[r * OW + x] = mosque(DX[x], DY[r]);
  }

  for (let r = 0; r < OH; r++) {
    const y = DY[r];
    for (let x = 0; x < OW; x++) {
      const k = r * OW + x;
      const xc = DX[x];
      let m = SKY, cr: number | undefined, cg: number | undefined, cb: number | undefined, fl = 0.18, hz = 0;
      const tt = tops[x];
      if (y < BASE && y >= tt) {
        m = BGTREE;
      } else if (y >= BASE) {
        const dx = Math.abs(xc - CX);
        m = dx < poolHalf(y) ? POOL : dx < walkHalf(y) ? WALK : LAWN;
      }
      if (m === SKY) {
        [cr, cg, cb] = skyAt(xc, y);
        // never quite one flat tone: a faint unevenness in the dawn air
        const veil = 0.95 + 0.1 * fbm(xc * 0.05, y * 0.09, 3, 0);
        cr *= veil, cg *= veil, cb *= veil;
        glowA[k] = sunGlow(xc, y);
        hz = 0.5 + 0.5 * smooth(20, 58, y);
        fl = 0.04 + 0.12 * smooth(14, 44, y);
      } else if (m === BGTREE) {
        // distant trees, flattened by the haze into the colour of the low sky;
        // rimmed where the sun is close
        const tex = fbm(xc * 0.25, y * 0.3, 3, 0);
        const depth = smooth(tt, BASE, y);
        const sky = skyAt(xc, tt + 1);
        const a = 0.5 - 0.1 * depth + 0.14 * (tex - 0.5);
        cr = mix(0.08, sky[0], a), cg = mix(0.09, sky[1], a), cb = mix(0.12, sky[2], a);
        const rim = smooth(tt + 1.4, tt, y) * Math.exp(-Math.abs(xc - SUN[0]) / 18) * (0.6 + 0.4 * tex);
        cr += 0.45 * rim, cg += 0.3 * rim, cb += 0.14 * rim;
        // their feet lost in a bank of ground mist, broken into soft patches
        const patch = 0.45 + 0.75 * smooth(0.3, 0.7, fbm(xc * 0.035 + 11, y * 0.18, 3, 0));
        const mist = smooth(tt + 1, BASE + 1, y) * 0.75 * Math.min(1, patch);
        cr = mix(cr, mR[x], mist), cg = mix(cg, mG[x], mist), cb = mix(cb, mB[x], mist);
        fl = 0.08;
        hz = 0.8;
      } else if (m === LAWN) {
        const v = (y - BASE) / (H - BASE);
        const gy = 40 / (y - HZ); // depth along the ground plane
        const u = (xc - CX) / (y - HZ); // across the ground plane
        // grass at several scales: patches, tufts, and single blades near us
        const tex = fbm(u * 3, gy, 3, 0);
        const tuft = noise(xc * 0.9, y * 2.2, 0);
        const blade = hash(x * 7 + 3, r * 13 + 1);
        const g = 0.78 + 0.3 * tex + (0.1 + 0.18 * v) * (tuft - 0.5) + 0.12 * v * (blade - 0.5);
        // mown bands running toward the Taj: lighter and more silvery one way
        const band = Math.floor(u * 1.4) & 1;
        const stripe = band ? 1 : 0.68;
        // dew-wet grass: dull olive, a little warmer in the drier patches
        const ar = (0.23 + 0.05 * tex) * g, ag = 0.27 * g, ab = (0.15 - 0.03 * tex) * g;
        // the low sun rakes in from the left; the shade holds the cool sky
        const sun = (0.55 + 0.45 * Math.exp(-Math.abs(xc - SUN[0]) / 60)) * shadowAt(xc, y) * stripe;
        const amb = 0.8 * (0.8 + 0.2 * stripe) - 0.2 * v;
        cr = ar * (AMB[0] * amb + SUNL[0] * sun);
        cg = ag * (AMB[1] * amb + SUNL[1] * sun);
        cb = ab * (AMB[2] * amb + SUNL[2] * sun);
        // seen at a slant through the dawn air the green greys over
        const lum = 0.3 * cr + 0.55 * cg + 0.15 * cb;
        cr = mix(cr, lum, 0.28), cg = mix(cg, lum, 0.28), cb = mix(cb, lum, 0.28);
        // dew catching the sky, a cool sheen on the paler bands
        const sheen = 0.04 * (band ? 1 : 0.5) * (1 - v);
        cr += sheen * 0.8, cg += sheen * 0.75, cb += sheen;
        // darker toward the near corners
        const vig = 1 - 0.45 * smooth(0.5, 1, v) * (0.6 + 0.4 * smooth(40, 0, Math.min(xc, W - xc)));
        const fall = 1 - 0.25 * v;
        cr *= vig * fall, cg *= vig * fall, cb *= vig * fall;
        // the far lawn sits in the haze
        const far = smooth(BASE + 14, BASE, y) * 0.75;
        cr = mix(cr, mR[x], far), cg = mix(cg, mG[x], far), cb = mix(cb, mB[x], far);
        fl = 0.08;
        hz = 0.7 * (1 - v);
      } else if (m === WALK) {
        const v = (y - BASE) / (H - BASE);
        // pinkish sandstone paving, slab by slab, with a pale marble kerb along
        // the canal; the joints close up into the distance
        const along = 90 / (y - HZ);
        const slab = Math.floor(along), dxw = Math.abs(xc - CX);
        const kerb = dxw - poolHalf(y) < 0.18 + 0.02 * (y - HZ);
        const sv = 0.92 + 0.12 * hash(slab, xc < CX ? 1 : 2) + 0.06 * (noise(xc * 0.8, y * 1.6, 0) - 0.5);
        const joint = along - slab < 0.14 ? 0.7 : 1;
        const ar = kerb ? 0.8 : 0.52 * sv, ag = kerb ? 0.77 : 0.47 * sv, ab = kerb ? 0.74 : 0.46 * sv;
        const sun = (xc < CX ? 0.82 : 0.7) * shadowAt(xc, y);
        const amb = 0.75;
        cr = ar * (AMB[0] * amb + SUNL[0] * sun) * joint;
        cg = ag * (AMB[1] * amb + SUNL[1] * sun) * joint;
        cb = ab * (AMB[2] * amb + SUNL[2] * sun) * joint;
        const fall = 1 - 0.25 * v;
        cr *= fall, cg *= fall, cb *= fall;
        const far = smooth(BASE + 12, BASE, y) * 0.55;
        cr = mix(cr, mR[x], far), cg = mix(cg, mG[x], far), cb = mix(cb, mB[x], far);
        fl = 0.12;
        hz = 0.3;
      } else {
        fl = 0.1;
      }
      // the mosque, red sandstone against the sun and veiled by the haze,
      // its edges caught by the light
      const q = mq[k];
      if (q >= 0) {
        m = MOSQUE;
        const sg = sunGlow(xc, y);
        let a = q === 1 ? [0.2, 0.14, 0.17] : [0.27, 0.13, 0.12];
        if (q === 2) a = [0.08, 0.05, 0.07];
        // stone texture, faint
        const st = 0.9 + 0.2 * fbm(xc * 0.8, y * 0.8, 2, 0);
        // a few kilometres of dawn air in front of it, thickest at the foot
        const air = 0.1 + 0.4 * smooth(MB - 9, MB, y) + 0.1 * sg;
        cr = mix(a[0] * st, mR[x], air), cg = mix(a[1] * st, mG[x], air), cb = mix(a[2] * st, mB[x], air);
        // rim light where the cell faces open sky toward the sun
        const lft = x > 0 ? mq[k - 1] : -1, up = r > 0 ? mq[k - OW] : -1;
        const toward = xc < SUN[0] ? (x < OW - 1 ? mq[k + 1] : -1) : lft;
        let rim = (up < 0 ? 0.7 : 0) + (toward < 0 ? 0.9 : 0) + (lft < 0 && up < 0 ? 0.2 : 0);
        rim = Math.min(1, rim) * Math.min(1, 0.2 + sg * 1.6);
        cr = mix(cr, 1.05, rim * 0.75), cg = mix(cg, 0.74, rim * 0.75), cb = mix(cb, 0.46, rim * 0.75);
        fl = 0.04;
        hz = 0.15;
      }
      // the Taj in front of the sky and the trees
      if (y < BASE) {
        const t = taj((xc - CX) / S, (BASE - y) / S);
        if (t) {
          m = MARBLE;
          const [lit, rec] = t;
          // white marble lit by two lights: the cool sky everywhere, and the
          // low warm sun on the faces turned toward it. Recesses lose the sun
          // first and then the sky.
          const ao = 1 - rec * 0.72;
          const sun = Math.pow(clamp((lit - 0.18) / 0.82), 1.2) * (1 - rec) * 1.1;
          const amb = (0.72 + 0.22 * lit) * ao;
          // the stone itself: faintly warm, softly weathered, finely grained
          const wx = fbm(xc * 0.35, y * 0.22, 3, 0), gr = hash(x * 3 + 1, r * 5 + 2);
          const alb = 0.86 + 0.1 * wx + 0.05 * (gr - 0.5);
          cr = alb * 0.96 * (AMB[0] * amb + SUNL[0] * sun);
          cg = alb * 0.88 * (AMB[1] * amb + SUNL[1] * sun);
          cb = alb * (0.83 - 0.04 * wx) * (AMB[2] * amb + SUNL[2] * sun);
          // shadowed recesses pick up a little warm bounce from the lit stone
          if (rec > 0) cr += 0.05 * rec * lit, cg += 0.03 * rec * lit;
          // the distance and the morning haze over the lower storeys
          const low = 0.05 + smooth(36, BASE, y) * 0.22;
          cr = mix(cr, mR[x], low), cg = mix(cg, mG[x], low), cb = mix(cb, mB[x], low);
          fl = 0.1;
          hz = 0.55;
        }
      }
      mat[k] = m;
      R[k] = cr as number, G[k] = cg as number, B[k] = cb as number;
      floorA[k] = fl;
      hazeW[k] = hz;
    }
  }

  // cypresses, far to near: dark, with a warm rim on the side toward the sun
  for (const tr of trees) {
    const top = tr.base - tr.h;
    const sunSide = tr.x < CX ? 0.9 : 0.6;
    for (let r = Math.max(0, rowOf(top)); r < Math.min(OH, rowOf(tr.base + 0.6) + 1); r++) {
      const y = DY[r];
      const u = (tr.base - y) / tr.h; // 0 at the foot, 1 at the tip
      if (u > 1 || y > tr.base + 0.6) continue;
      let p = u < 0.06 ? 0.18 : u < 0.3 ? 0.8 + 0.2 * (u / 0.3) : Math.pow((1 - u) / 0.7, 0.8);
      for (let x = Math.max(0, colOf(tr.x - tr.w - 2)); x < Math.min(OW, colOf(tr.x + tr.w + 2) + 1); x++) {
        const xc = DX[x];
        const n = noise(xc * 0.9, y * 0.55 + tr.s, 0);
        const hw = tr.w * p * (0.88 + 0.26 * n) + 0.3;
        const dx = (xc - tr.x) / hw;
        if (Math.abs(dx) > 1) continue;
        const k = r * OW + x;
        const leaf = fbm(xc * 0.6, y * 0.35 + tr.s * 3, 2, 0);
        // backlit by the low sun ahead and to the left: a bright fringe on
        // that edge where light shines through the outer sprays, a softer
        // glow inside it, the rest in its own shade
        const near = 0.5 + 0.5 * Math.exp(-Math.abs(tr.x - SUN[0]) / 80);
        const fringe = smooth(-0.55, -0.97, dx) * (0.35 + 0.65 * leaf) * near;
        const glow = smooth(0.2, -0.8, dx) * leaf * leaf * near * 0.35;
        // clumps of foliage, each catching a little sky on top
        const clump = smooth(0.45, 0.7, fbm(xc * 0.45, y * 0.3 + tr.s * 3, 3, 0));
        const base = (0.55 + 0.5 * leaf + 0.35 * clump) * (0.55 + 0.45 * smooth(0, 0.18, u)) * (1 - 0.25 * smooth(-0.2, 1, dx));
        const dist = smooth(30, 8, tr.s); // far trees take more haze
        const lt = sunSide * (fringe * 0.62 + glow);
        let cr = 0.036 * base + 0.02 * clump + lt * 1.0, cg = 0.058 * base + 0.026 * clump + lt * 0.68, cb = 0.042 * base + 0.04 * clump + lt * 0.3;
        const a = 0.06 + dist * 0.55;
        cr = mix(cr, mR[x], a), cg = mix(cg, mG[x], a), cb = mix(cb, mB[x], a);
        mat[k] = CYPRESS;
        R[k] = cr, G[k] = cg, B[k] = cb;
        floorA[k] = 0.05;
        hazeW[k] = (0.3 + 0.4 * dist) * smooth(tr.base - tr.h * 0.7, tr.base, y);
      }
    }
  }

  // The reflection source: everything above the garden, trees included.
  const RR = R.slice(), RG = G.slice(), RB = B.slice();
  const BROW = rowOf(BASE) + (DY[rowOf(BASE)] < BASE ? 1 : 0); // the first output row of the garden
  const lastSrc = BROW - 1;

  // drifting haze, two layers in a strip that wraps
  const HWd = 400, OHW = HWd * K;
  const haze1 = new Float32Array(OHW * OH), haze2 = new Float32Array(OHW * OH);
  for (let r = 0; r < OH; r++) {
    const y = DY[r] - 0.5;
    for (let ox = 0; ox < OHW; ox++) {
      const x = ox / K;
      haze1[r * OHW + ox] = smooth(0.4, 0.75, fbm(x * 0.018, y * 0.09, 4, HWd * 0.018));
      haze2[r * OHW + ox] = smooth(0.42, 0.8, fbm(x * 0.04 + 7, y * 0.16 + 3, 3, HWd * 0.04));
    }
  }
  // haze is thickest just above the garden
  const hazeRow = new Float32Array(OH);
  for (let r = 0; r < OH; r++) hazeRow[r] = 0.03 + 0.42 * Math.exp(-Math.abs(DY[r] - 63) / 6);

  // the last stars, single points scattered over the night side
  const STAR_BOT = rowOf(24);
  const starA = new Float32Array(OW * STAR_BOT), starF = new Float32Array(OW * STAR_BOT), starP = new Float32Array(OW * STAR_BOT);
  for (let r = 0; r < STAR_BOT; r++) {
    for (let x = 0; x < OW; x++) {
      if (DX[x] <= 96 || hash(x, r * 3 + 11) <= 0.9945) continue;
      const k = r * OW + x;
      starA[k] = 0.62 * smooth(24, 8, DY[r]) * smooth(96, 140, DX[x]) * (0.7 + 0.45 * hash(x, r + 400));
      starF[k] = 1.2 + hash(x, r) * 2;
      starP[k] = hash(r, x) * 6.28;
    }
  }

  const birds: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) birds.push([58 + i * 8 + hash(i, 40) * 4, 30 - i * 2.5 + hash(i, 41) * 2, hash(i, 42) * 6.28]);
  // a bird in output cells: the height of each wing cell out from the body
  const WING_UP = [0, -1, -2, -2], WING_DOWN = [0, 0, 1, 2];
  // a gentle shoulder so the brightest light keeps its gradient
  const tone = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) {
    const v = i / 256;
    tone[i] = v < 0.75 ? v : 0.75 + 0.25 * (1 - Math.exp(-(v - 0.75) * 4));
  }
  const SUNR0 = rowOf(SUN[1] - 5), SUNR1 = rowOf(SUN[1] + 5);
  // a faint, fixed grain in the print, so no surface is perfectly even
  const grain = new Float32Array(N);
  for (let k = 0; k < N; k++) grain[k] = 1 + (mat[k] === SKY ? 0.025 : 0.05) * (hash(k, 91) - 0.5);
  // how far each canal cell sits from the kerb, for the kerb's shadow on the water
  const edgeW = new Float32Array(N);
  for (let r = BROW; r < OH; r++) {
    const y = DY[r];
    for (let x = 0; x < OW; x++) edgeW[r * OW + x] = smooth(0, 0.35 + 0.025 * (y - HZ), poolHalf(y) - Math.abs(DX[x] - CX));
  }

  return (t, px) => {
    const d1 = t * 1.1 * K, d2 = t * 2.3 * K;
    const cd = t * 0.5 * K;
    const breathe = 0.035 * Math.sin((t / 6) * Math.PI * 2);
    // where the birds are this frame, in output cells
    const bx: number[] = [], by: number[] = [], bw: number[][] = [];
    for (const [x0, y0, ph] of birds) {
      bx.push(Math.round(((((x0 + t * 3.2) % 260) + 260) % 260 - 30) * K));
      by.push(rowOf(y0 + Math.sin(t * 0.4 + ph) * 1.3));
      bw.push(Math.sin(t * 7 + ph) > 0 ? WING_UP : WING_DOWN);
    }

    for (let r = 0; r < OH; r++) {
      const y = DY[r];
      const hr = hazeRow[r];
      const sunRow = r >= SUNR0 && r <= SUNR1;
      for (let x = 0; x < OW; x++) {
        const k = r * OW + x;
        const m = mat[k];
        const xc = DX[x];
        let cr: number, cg: number, cb: number, fl = floorA[k], fade = 1;

        if (m === POOL) {
          // the mirror: the scene above, flipped about the far end, shortened
          // and shaken by the ripples, and softer the nearer it comes
          const depth = (y - BASE) / (H - BASE);
          const wob = Math.sin(y * 1.9 - t * 2.4 + Math.sin(xc * 0.11 + t * 0.7) * 1.5) * (0.2 + 0.7 * depth);
          let sx = Math.round(x + wob * K);
          sx = sx < 1 ? 1 : sx > OW - 2 ? OW - 2 : sx;
          let sr = rowOf(BASE - (y - BASE) * KR - (Math.sin(xc * 0.3 + t * 1.3 + y) > 0.6 ? 1 : 0));
          sr = sr < 0 ? 0 : sr > lastSrc ? lastSrc : sr;
          const j = sr * OW + sx;
          const bs = depth > 0.4 ? 1 : 0;
          const ja = j - bs, jb = j + bs;
          let rr = 0.5 * RR[j] + 0.25 * (RR[ja] + RR[jb]);
          let rg = 0.5 * RG[j] + 0.25 * (RG[ja] + RG[jb]);
          let rb = 0.5 * RB[j] + 0.25 * (RB[ja] + RB[jb]);
          // stone reflects a touch brighter than the sky, so the Taj holds its shape
          const src = mat[j] === MARBLE ? 1.0 : 0.9;
          rr *= src, rg *= src, rb *= src;
          // Fresnel: a near-perfect mirror at the far end, where we look along
          // the water; nearer, it turns dark and clear, showing its own depth
          const fres = 0.94 - 0.5 * Math.pow(depth, 0.75);
          const ripple = 1 + 0.08 * Math.sin(y * 3.1 - t * 2.1 + xc * 0.05);
          cr = (rr * 0.93 * fres + 0.025 * (1 - fres)) * ripple;
          cg = (rg * 0.96 * fres + 0.05 * (1 - fres)) * ripple;
          cb = (rb * fres + 0.065 * (1 - fres)) * ripple;
          // the kerb's shadow along both edges of the water
          const ew = 0.7 + 0.3 * edgeW[k];
          cr *= ew, cg *= ew, cb *= ew;
          // ripples catching the sky, and sparks of light that come and go
          const w = noise(xc * 0.12 + t * 0.15, y * 0.9 - t * 0.9, 0);
          const sp = noise(xc * 0.7 - t * 0.5, y * 2.6 + t * 1.7, 0);
          const glint = smooth(0.75, 0.95, w) * 0.1 + smooth(0.86, 0.98, sp) * (0.45 - 0.25 * depth) * smooth(0.4, 0.75, w);
          cr += glint, cg += glint * 0.88, cb += glint * 0.72;
          // a sparse line of light drifting across the far end
          const fe = y - BASE;
          if (fe > 1 && fe < 5) {
            const gl = smooth(0.62, 0.85, noise(xc * 0.55 - t * 0.9, (y - 0.5) * 2.7 + t * 0.2, 0)) * (0.5 - 0.08 * (fe - 0.5));
            cr += gl, cg += gl * 0.82, cb += gl * 0.55;
          }
          // a thin line of light where the far edge meets the plinth
          if (r === BROW) cr += 0.2, cg += 0.16, cb += 0.12;
          fade = 0.8 + 0.2 * smooth(H + 2, H - 6, y);
        } else {
          cr = R[k], cg = G[k], cb = B[k];
          if (m === SKY) {
            const ga = glowA[k] * breathe;
            cr += ga, cg += ga * 0.76, cb += ga * 0.46;
            if (r < OCH) {
              // drifting dawn cloud: lit from below by the low sun, gold near
              // it and rose further off; dusky violet-grey in its own shade
              const sx = x + cd, ix = Math.floor(sx), fx = sx - ix;
              const i0 = r * OCW + (ix % OCW), i1 = r * OCW + ((ix + 1) % OCW);
              const c = cloud[i0] + (cloud[i1] - cloud[i0]) * fx;
              if (c > 0.01) {
                const l = cloudLit[i0] + (cloudLit[i1] - cloudLit[i0]) * fx;
                const near = Math.min(1, glowA[k] * 1.7);
                const hi = smooth(-4, 44, y); // high cloud is still in twilight
                const sh = 0.45 + 0.55 * hi;
                const br = mix(cr, 0.2, 0.75) * sh, bg = mix(cg, 0.165, 0.75) * sh, bb = mix(cb, 0.25, 0.75) * sh;
                const lr = mix(0.92, 1.1, near), lg = mix(0.58, 0.8, near), lb = mix(0.55, 0.5, near);
                const kl = smooth(0.35, 0.82, l) * (0.4 + 0.45 * hi + 0.35 * near);
                let kr = mix(br, lr, kl), kg = mix(bg, lg, kl), kb = mix(bb, lb, kl);
                // thin edges toward the sun light up (a silver, here golden, lining)
                const edge = 4 * c * (1 - c) * near * l * 0.5;
                kr += edge, kg += edge * 0.8, kb += edge * 0.55;
                const a = Math.pow(Math.min(1, c), 0.85) * 0.92;
                cr = mix(cr, kr, a), cg = mix(cg, kg, a), cb = mix(cb, kb, a);
              }
            }
            if (r < STAR_BOT && starA[k] > 0) {
              // the last few stars, fading where the dawn reaches
              const s = (0.7 + 0.3 * Math.sin(t * starF[k] + starP[k])) * starA[k];
              cr = Math.max(cr, s * 0.85), cg = Math.max(cg, s * 0.85), cb = Math.max(cb, s);
            }
            if (sunRow) {
              // the sun's disc, softened by the haze
              const dx = xc - SUN[0], dy = y - SUN[1];
              const dd = dx * dx + dy * dy;
              if (dd < 22) {
                const a = smooth(22, 9, dd);
                cr = mix(cr, 1.05, a), cg = mix(cg, 0.98, a), cb = mix(cb, 0.86, a);
              }
            }
            // birds, dark against the light
            for (let i = 0; i < bx.length; i++) {
              const ox = x - bx[i];
              if (ox < -3 || ox > 3) continue;
              if (r - by[i] === bw[i][ox < 0 ? -ox : ox]) (cr = cr * 0.22 + 0.02), (cg = cg * 0.2 + 0.015), (cb = cb * 0.24 + 0.025), (fl = 0);
            }
          }
        }

        // the morning haze, drifting
        const hw = hazeW[k];
        if (hw > 0 || m === POOL) {
          const a = (m === POOL ? 0.12 : hw) * hr;
          const sx1 = (x + d1) % OHW, sx2 = (x + d2) % OHW;
          const i1 = r * OHW + (sx1 | 0), i2 = r * OHW + (sx2 | 0);
          const hz = a * (0.35 + 0.75 * haze1[i1] + 0.45 * haze2[i2]);
          cr = mix(cr, mR[x] * 1.08, hz), cg = mix(cg, mG[x] * 1.04, hz), cb = mix(cb, mB[x], hz);
        }

        const gk = grain[k];
        cr = tone[Math.min(1024, (cr * gk * 256) | 0)], cg = tone[Math.min(1024, (cg * gk * 256) | 0)], cb = tone[Math.min(1024, (cb * gk * 256) | 0)];
        dot(px, k, cr, cg, cb, fl, fade);
      }
    }
  };
}
