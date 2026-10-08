/*
 * tokyo rain: a narrow side street in tokyo at night, in the rain. Vertical
 * signs stand out from the walls on both sides in pink, cyan and amber, a
 * vending machine and an izakaya's red lanterns glow at street level, power
 * lines cross the strip of sky, and the wet road carries every light down in
 * smeared, rippling streaks. Someone under an umbrella walks slowly away.
 *
 * The street is built once in one-point perspective. Everything in it has a
 * depth, which places and sizes it, fogs it, and says where the wet road
 * mirrors it. Each frame adds what moves (rain, ripples, the walker, the
 * lanterns, a failing tube) and draws the picture as a halftone: every cell a
 * dot whose size is its brightness, in its own colour.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "tokyo rain",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#07060d",
} satisfies Meta;

// The street was laid out on a 200 by 100 grid; it is drawn K times finer, on a
// 16:9 frame that shows Y0 more of those rows above and the rest below.
const K = 1.6, Y0 = 8.75;
const W = 320, H = 180;
const VX = 160, HY = 94; // the vanishing point, where the street meets the horizon
const F = 46 * K; // how many cells a metre spans, a metre away
const EYE = 1.5; // the camera's height above the road
const HALF = 3.2; // from the middle of the street to the walls
const THICK = 0.3; // how deep a sign box is
const ZF = 17; // the rain haze hides most of what is further than this
const EXT = 112; // rows of mirror image kept below the frame, for the gloss to pull up

const SKY = 0, WALL = 1, ROAD = 2, SIGN = 3, SIDE = 4, VEND = 5, POLE = 6, WIRE = 7, TOWER = 8;
// how much of each the wet road gives back, and the least dot each may draw
const GIVE = [0.25, 0.1, 0, 1, 0.5, 0.9, 0.12, 0.15, 0.2];
const FLOOR = [0.12, 0.04, 0.05, 0.1, 0.06, 0.1, 0.03, 0, 0];

const PINK = [1, 0.2, 0.62], CYAN = [0.14, 0.88, 1], AMBER = [1, 0.6, 0.14], RED = [1, 0.16, 0.1];
const NEON = 0, PANEL = 1, WHITE = 2, BULBS = 3;

// Letters on a 7 by 7 grid: katakana and a few made-up characters. The
// long-vowel mark stands upright, as it does in vertical text.
const FONT: Record<string, string> = {
  ra: ".#####. ....... ####### ......# .....#. ...##.. .##....",
  "-": "...#... ...#... ...#... ...#... ...#... ...#... ...#...",
  me: "......# .#...#. ..#.#.. ...#... ..#.#.. .#..... #......",
  n: "##..... ......# .....#. ....#.. ..##... .#..... #......",
  ka: "..#.... ####### ..#...# ..#...# .#....# .#....# #...##.",
  o: "....#.. ####### ....#.. ...##.. ..#.#.. .#..#.. #..##..",
  ke: ".#..... .###### #...#.. ....#.. ....#.. ...#... .##....",
  su: "######. .....#. ....#.. ...#... ..#.#.. .#...#. #.....#",
  na: "...#... ####### ...#... ...#... ...#... ..#.... ##.....",
  tsu: "#.#...# .#.#..# ......# .....#. ....#.. ..##... ##.....",
  ku: ".#..... .###### #.....# .....#. ....#.. ..##... ##.....",
  ho: "...#... ####### ...#... .#.#.#. #..#..# ...#... ..##...",
  te: ".#####. ....... ####### ...#... ...#... ..#.... ##.....",
  ru: ".#.#... .#.#... .#.#... .#.#... .#.#..# #..#.#. #..##..",
  k1: "#.##### ...#.#. #.##### ..#.#.# #.##### ..#...# #.#####",
  k2: "####### #.....# ####### #..#... #.##### #..#... #.#####",
  k3: "#.##### #.#...# ###.### #.#.#.# #.#.### ###...# #.#####",
  k4: "...#... ..#.#.. .#...#. ####### .#.#.#. .#####. .#...##",
  k5: "...#... ####### ..###.. .#.#.#. #..#..# .#####. ...#...",
};

// A letter drawn g cells to the grid square: its squares as points joined to
// their neighbours, so a big letter's slants run smooth rather than stepped.
function glyphMask(name: string, g: number): Uint8Array {
  const G = 7 * g, m = new Uint8Array(G * G);
  // the letter's squares, with a blank border so neighbours need no bounds check
  const on = new Uint8Array(81);
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) on[(r + 1) * 9 + c + 1] = FONT[name][r * 8 + c] === "#" ? 1 : 0;
  const segs: number[][] = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 7; c++) {
      if (!on[(r + 1) * 9 + c + 1]) continue;
      segs.push([c, r, c, r]);
      for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) if (on[(r + 1 + dr) * 9 + c + 1 + dc]) segs.push([c, r, c + dc, r + dr]);
    }
  const hw = g / 2 + 0.01;
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) {
      const px = (x + 0.5) / g - 0.5, py = (y + 0.5) / g - 0.5;
      for (const [ax, ay, bx, by] of segs) {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const q = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
        if (Math.hypot(ax + dx * q - px, ay + dy * q - py) * g < hw) {
          m[y * G + x] = 1;
          break;
        }
      }
    }
  return m;
}

interface Sign {
  side: number; // -1 the left wall, 1 the right
  s: number; // depth, in cells a metre on the 200 by 100 grid
  hb: number; // the bottom's height above the road
  w: number; // width in cells of that grid
  g: number; // a letter's size on it (2 the big ones, 1 the small), or 0 for a plain strip
  kind: number;
  hue: number[];
  rows?: number; // a strip's height in cells of that grid
  text?: string;
  edge?: number; // where its outer edge stands, if not at the wall
  group?: number; // it flickers with this group
  fail?: number; // this letter of it flickers alone
}

const SIGNS: Sign[] = [
  { side: -1, s: 27, hb: 2.3, w: 16, g: 2, kind: NEON, hue: PINK, text: "ra - me n", fail: 2 },
  { side: -1, s: 17.5, hb: 2.45, w: 14, g: 2, kind: PANEL, hue: AMBER, text: "k1 k2 k3" },
  { side: -1, s: 11.5, hb: 2.55, w: 9, g: 1, kind: NEON, hue: CYAN, text: "k4 k5 k1", group: 1 },
  { side: -1, s: 7.4, hb: 2.6, w: 7, g: 1, kind: WHITE, hue: RED, text: "k2 k3 k5" },
  { side: -1, s: 5, hb: 2.7, w: 4, g: 0, kind: PANEL, hue: PINK, rows: 18 },
  { side: -1, s: 5, hb: 6.6, w: 4, g: 0, kind: NEON, hue: AMBER, rows: 10 },
  { side: -1, s: 3.4, hb: 2.5, w: 3, g: 0, kind: NEON, hue: CYAN, rows: 14 },
  { side: -1, s: 2.3, hb: 2.8, w: 2, g: 0, kind: PANEL, hue: AMBER, rows: 10 },
  { side: 1, s: 24, hb: 2.55, w: 16, g: 2, kind: NEON, hue: CYAN, text: "ka ra o ke" },
  { side: 1, s: 14.5, hb: 2.5, w: 11, g: 1, kind: BULBS, hue: PINK, text: "su na tsu ku" },
  { side: 1, s: 6.6, hb: 2.6, w: 7, g: 1, kind: PANEL, hue: AMBER, text: "ho te ru" },
  { side: 1, s: 4.6, hb: 2.7, w: 4, g: 0, kind: NEON, hue: CYAN, rows: 16, group: 2 },
  { side: 1, s: 4.6, hb: 6.4, w: 4, g: 0, kind: PANEL, hue: PINK, rows: 9 },
  { side: 1, s: 3.1, hb: 2.6, w: 3, g: 0, kind: PANEL, hue: AMBER, rows: 13 },
  { side: 1, s: 2.1, hb: 2.9, w: 2, g: 0, kind: NEON, hue: PINK, rows: 10 },
  // the andon: a lit box standing on the road outside the izakaya
  { side: 1, s: 18, hb: 0.14, w: 7, g: 1, kind: WHITE, hue: RED, text: "k1 k4", edge: 2.44 },
];

// The buildings along each side: [from, to, height, front], in metres down the
// street. Fronts: 0 a bare wall, 1 a shutter, 2 a lit shop, 3 a door, 4 the
// izakaya. A height of 0 is an alley between two buildings.
const LEFT = [
  [0, 2.55, 10.5, 1], [2.55, 4.6, 7.2, 3], [4.6, 7, 6.2, 2], [7, 10.5, 11, 3], [10.5, 15, 8.4, 2],
  [15, 22, 12.5, 0], [22, 32, 9.5, 2], [32, 60, 14, 0], [60, 1e5, 18, 0],
];
const RIGHT = [
  [0, 3.2, 9.6, 4], [3.2, 5, 8.2, 0], [5, 6.4, 0, 0], [6.4, 9.5, 7.4, 2], [9.5, 14, 13.5, 3],
  [14, 20, 8, 2], [20, 30, 11, 0], [30, 1e5, 16, 0],
];
// water tanks on the roofs [side, from, to, height], and masts [side, at, height]
const TANKS = [[-1, 5.3, 6.2, 1.7], [-1, 11.6, 12.7, 1.5], [1, 7.3, 8.1, 1.4]];
const MASTS = [[-1, 13.8, 3], [1, 18.4, 2.4]];
// utility poles [across, along, height, thickness] and the wires between them
// [across, height, along, across, height, along, sag]
const POLES = [[2.9, 4.3, 9.4, 0.32], [-2.95, 9.6, 9.4, 0.3], [2.9, 15, 9.2, 0.28], [-2.95, 24, 9.2, 0.26]];
const WIRES = [
  [2.9, 8.6, 4.3, -2.95, 8.9, 9.6, 0.45], [2.9, 8.2, 4.3, -2.95, 8.4, 9.6, 0.55], [2.9, 7.6, 4.3, -3.2, 5.9, 6, 0.3],
  [2.9, 9.0, 4.3, 2.9, 8.9, 15, 0.4], [2.9, 8.4, 4.3, 2.9, 8.5, 15, 0.5], [-2.95, 8.9, 9.6, -2.95, 8.9, 24, 0.35],
  [-2.95, 8.4, 9.6, 2.9, 8.5, 15, 0.4], [2.9, 8.5, 15, -2.95, 8.6, 24, 0.3], [2.9, 8.9, 15, 2.9, 8.8, 28, 0.3],
  [-2.95, 8.4, 24, 2.9, 8.4, 34, 0.25],
];
// the izakaya's red lanterns [depth in cells a metre on the 200 by 100 grid, across, centre height, swing phase]
const LANTERNS = [[26.3, 2.72, 1.88, 0], [14.8, 2.72, 1.95, 1.9]];
const VEND_S = 16 * K; // the vending machine's depth

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

// The glow of the busy street the alley runs into, seen through the rain at its far end.
// Mixed neon and shop light, warmer and greyer than any one sign once the rain has scattered it.
const END = [1, 0.68, 0.76];
// building fronts: grey concrete, beige tile, cool render, brick-brown
const WALLHUE = [[0.3, 0.29, 0.28], [0.33, 0.29, 0.25], [0.26, 0.27, 0.3], [0.31, 0.26, 0.25]];
function endGlow(x: number, y: number): number {
  const d = Math.hypot(((x - VX) * 0.9) / K, ((y - HY) / K + 2) * 1.25);
  return Math.exp(-d / 6.5) * 0.95 + Math.exp(-d / 16) * 0.26 + Math.exp(-d / 45) * 0.08;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const k = clamp((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

// The walker under the umbrella, in metres about their feet: 0 outside, 1 the
// figure, 2 the umbrella's lit crown, 3 the rest of the umbrella.
function walkerShape(u: number, v: number, ph: number): number {
  v -= 0.014 * Math.abs(Math.cos(ph));
  const R = 0.56, RIM = 1.74;
  if (v > RIM - 0.07) {
    const q = u / R;
    if (q > -1 && q < 1) {
      const top = RIM + 0.4 * Math.sqrt(1 - q * q);
      const bottom = RIM - 0.05 * Math.abs(Math.cos(q * 2.5 * Math.PI));
      if (v <= top && v >= bottom) return v > top - 0.06 ? 2 : 3;
    }
    if (u > -0.03 && u < 0.03 && v < RIM + 0.5) return 3;
  }
  const hy = (v - 1.6) / 0.125, hx = u / 0.1;
  if (hx * hx + hy * hy < 1) return 1;
  if (v >= 0.5 && v <= 1.48) {
    const hw = v > 1.36 ? 0.2 * Math.sqrt(1 - ((v - 1.36) / 0.12) ** 2) : 0.18 + 0.035 * smooth(0.85, 0.5, v);
    if (u > -hw && u < hw) return 1;
  }
  // the arm up to the handle
  if (v > 1.2 && v < RIM && u > 0.01 && u < 0.07) return 1;
  for (let i = -1; i <= 1; i += 2) {
    const lift = 0.09 * Math.max(0, Math.sin(ph + (i > 0 ? Math.PI : 0)));
    const lx = u - i * 0.075;
    if (v >= lift && v < 0.62 && lx > -0.055 && lx < 0.055) return 1;
  }
  return 0;
}

export default function tokyoRain(): Frame {
  const N = W * H;

  const mat = new Uint8Array(N);
  const S = new Float32Array(N); // how near each cell's surface is, in cells a metre; 0 for the sky
  const ER = new Float32Array(N), EG = new Float32Array(N), EB = new Float32Array(N); // light given off
  const AR = new Float32Array(N), AG = new Float32Array(N), AB = new Float32Array(N); // how much light a surface takes back
  const KG = new Float32Array(N); // how much of the glow round the lights reaches it
  const grp = new Uint8Array(N);
  const SR = new Float32Array(N), SG = new Float32Array(N), SB = new Float32Array(N); // the sky
  const wet = new Float32Array(N);

  const emit = (k: number, r: number, g: number, b: number) => {
    ER[k] = r, EG[k] = g, EB[k] = b, AR[k] = 0, AG[k] = 0, AB[k] = 0;
  };
  const surface = (k: number, r: number, g: number, b: number, kg: number) => {
    ER[k] = 0, EG[k] = 0, EB[k] = 0, AR[k] = r, AG[k] = g, AB[k] = b, KG[k] = kg;
  };

  // --- the walls, the road and the sky, column by column -------------------
  const wallS = new Float32Array(W), roofY = new Float32Array(W), bareY = new Float32Array(W), baseY = new Float32Array(W);
  const colI = new Int8Array(W), colH = new Float32Array(W), tankCol = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    const xc = x + 0.5, side = xc < VX ? -1 : 1;
    const list = side < 0 ? LEFT : RIGHT;
    const s0 = Math.abs(xc - VX) / HALF, z = F / s0;
    let i = 0;
    while (i < list.length - 1 && z >= list[i][1]) i++;
    let s = s0, hgt = list[i][2];
    if (!hgt) {
      // an alley: through it, the side wall of the next building along
      s = F / list[i][1];
      hgt = list[i + 1][2];
    }
    let extra = 0;
    for (const [ts, a, b, e] of TANKS) if (ts === side && z >= a && z < b) (extra = e), (tankCol[x] = 1);
    wallS[x] = s;
    baseY[x] = HY + EYE * s;
    bareY[x] = HY - (hgt - EYE) * s;
    roofY[x] = HY - (hgt + extra - EYE) * s;
    colI[x] = i;
    colH[x] = hgt;
  }
  for (const [ms, at, e] of MASTS) {
    const s = F / at, x = Math.floor(VX + ms * HALF * s);
    roofY[x] = Math.min(roofY[x], bareY[x] - e * s);
  }

  for (let r = 0; r < H; r++) {
    const y = r + 0.5;
    for (let x = 0; x < W; x++) {
      const k = r * W + x, xc = x + 0.5;
      const side = xc < VX ? -1 : 1;
      if (y >= baseY[x]) {
        // the road: dark wet asphalt, a white line along each edge, a gutter of grates
        mat[k] = ROAD;
        const s = (y - HY) / EYE, z = F / s, xw = (xc - VX) / s, ax = Math.abs(xw);
        S[k] = s;
        // asphalt: patches of wear, and the fine grit of the stones in it
        let a = 0.1 + 0.07 * fbm(xw * 2.2, z * 1.1, 3, 0) + 0.035 * (hash(x, r + 77) - 0.5);
        const lo = ax - 0.5 / s, hi = ax + 0.5 / s;
        const paint = clamp((Math.min(hi, 2.66) - Math.max(lo, 2.52)) * s);
        a = mix(a, 0.75, paint);
        if (ax > 2.85) a = z % 0.55 < 0.08 ? 0.07 : 0.2;
        surface(k, a * 0.82, a * 0.86, a, 0.6);
        // the wet paint shines a little of its own, so the lines run on into the dark
        ER[k] = paint * 0.07, EG[k] = paint * 0.07, EB[k] = paint * 0.08;
        // puddles hold the reflections sharper
        wet[k] = smooth(0.42, 0.6, fbm(xw * 0.9 + 3, z * 0.35, 3, 0));
        continue;
      }
      const tankLeg = tankCol[x] && y < bareY[x] && y > roofY[x] && (HY - y) / wallS[x] + EYE - colH[x] < 0.45 && (x & 1) === 0;
      if (y < roofY[x] || tankLeg) {
        mat[k] = SKY;
        continue;
      }
      // a wall: its depth and height give where on the building this is
      mat[k] = WALL;
      const s = wallS[x];
      S[k] = s;
      const list = side < 0 ? LEFT : RIGHT;
      const i = colI[x];
      const [z0, z1, , front] = list[i];
      const h = EYE + (HY - y) / s;
      // each building its own weathered concrete or tile, stained in streaks
      // where the rain runs down it, and darker where it meets the wet road
      const tone = 0.7 + 0.5 * hash(i, side + 7);
      const hue = WALLHUE[Math.floor(hash(i, side + 11) * WALLHUE.length)];
      const tex =
        (0.74 + 0.4 * fbm((xc * 0.6) / K, (y * 0.6) / K, 3, 0)) *
        (0.8 + 0.35 * fbm((xc * 0.8) / K + 40, (y * 0.05) / K, 2, 0)) *
        (0.93 + 0.14 * hash(x, r + 31)) *
        (0.55 + 0.45 * smooth(0, 0.9, h));
      const wr = hue[0] * tone * tex, wg = hue[1] * tone * tex, wb = hue[2] * tone * tex;
      if (!list[i][2]) {
        // the far wall of the alley, with a bare bulb by a door
        const xw = (xc - VX) / s;
        const dl = Math.hypot(xw - 3.65, (h - 2.9) * 0.8);
        if (dl < 0.1) emit(k, 1.2, 1, 0.7);
        else if (h > 2.95 && h < 3.05 && Math.abs(xw - 3.65) < 0.16) surface(k, 0.05, 0.05, 0.06, 0.4);
        else if (Math.abs(xw - 3.36) < 0.05) surface(k, 0.12, 0.12, 0.14, 0.6);
        else if (xw > 3.85 && h < 2.1) surface(k, 0.06, 0.05, 0.05, 0.5);
        else {
          // the bulb's own pool of light on the wall, for someone to pass in front of
          const pool = Math.exp(-dl / 0.9) * 0.55;
          surface(k, wr * 0.8, wg * 0.8, wb * 0.8, 1);
          ER[k] = pool * 0.9, EG[k] = pool * 0.62, EB[k] = pool * 0.36;
        }
        continue;
      }
      const z = F / s;
      if (side < 0 && i === 0) {
        // a caged bulb on the near wall, over the shutter
        const lx = VX - HALF * (F / 1.62), ly = HY - (2.2 - EYE) * (F / 1.62);
        const dl = Math.hypot((xc - lx) / (1.4 * K), (y - ly) / (1.1 * K));
        if (dl < 1) {
          emit(k, 1.3, 0.95, 0.6);
          continue;
        }
        if (dl < 1.9 && y < ly - 0.6 * K) {
          surface(k, 0.06, 0.06, 0.07, 0.5);
          continue;
        }
      }
      if (h > 2.6) {
        // upper floors: rows of windows, a few lit, a slab line between floors
        const fl = Math.floor((h - 2.9) / 2.8), fh = h - 2.9 - fl * 2.8;
        const bay = Math.floor((z - z0 - 0.5) / 1.9), bz = z - z0 - 0.5 - bay * 1.9;
        if (h > 2.9 && fh > 0.55 && fh < 1.85 && bz > 0.3 && bz < 1.3 && z < z1 - 0.5 && h < colH[x] - 0.5) {
          const hh = hash(bay * 7 + fl, side * 31 + i);
          if (hh < 0.36) {
            // lit rooms behind blinds: cool tubes or warm bulbs, brighter at the ceiling, some curtained
            const curtain = hash(bay * 3 + fl, side * 17 + i) < 0.3 && bz > 0.62 && bz < 0.98 ? 0.35 : 1;
            const v = (0.22 + 0.32 * hash(bay, fl + 9)) * (fh % 0.17 < 0.045 ? 0.6 : 1) * (0.75 + 0.35 * smooth(0.55, 1.85, fh)) * curtain;
            if (hh < 0.12) emit(k, 0.62 * v, 0.78 * v, 1 * v);
            else if (hh < 0.18) emit(k, 0.95 * v, 0.88 * v, 0.72 * v);
            else emit(k, v, 0.66 * v, 0.36 * v);
          } else {
            // dark glass, giving back a little of the street's light
            const gl = 0.06 + 0.05 * hash(bay * 5 + fl, side * 13 + i) + 0.04 * smooth(1.85, 0.55, fh);
            surface(k, gl * 0.85, gl * 0.95, gl * 1.2, 0.9);
          }
        } else if (h > 2.9 && fh < 0.14) surface(k, wr * 1.25, wg * 1.25, wb * 1.25, 1);
        else surface(k, wr, wg, wb, 1);
        // the lit sign band above the shop front on the low building
        if (side < 0 && i === 2 && z > 4.85 && z < 6.75 && h > 2.45 && h < 2.85) {
          const letter = (z - 4.85) % 0.42 > 0.1 && (z - 4.85) % 0.42 < 0.3 && h > 2.53 && h < 2.77;
          emit(k, AMBER[0] * (letter ? 0.12 : 0.9), AMBER[1] * (letter ? 0.12 : 0.9), AMBER[2] * (letter ? 0.12 : 0.9));
        }
        continue;
      }
      // the shop fronts at street level
      surface(k, wr, wg, wb, 1);
      if (front === 1) {
        // the shutter, its ribs picked out by the caged bulb above it
        const lx = VX - HALF * (F / 1.62), ly = HY - (2.2 - EYE) * (F / 1.62);
        const pool = Math.exp(-Math.hypot((xc - lx) * 0.7, y - ly) / (11 * K)) * 0.42;
        if (h < 2.15) {
          const rib = h % 0.11 < 0.035 ? 0.3 : 1;
          surface(k, 0.27 * rib, 0.29 * rib, 0.35 * rib, 1);
          ER[k] = pool * rib, EG[k] = pool * 0.72 * rib, EB[k] = pool * 0.45 * rib;
        } else surface(k, 0.16, 0.16, 0.2, 1);
      } else if (front === 2) {
        const zz = z - z0;
        if (zz > 0.3 && zz < z1 - z0 - 0.3 && h > 0.1 && h < 2.15) {
          const cool = i === 4 && side < 0;
          const shelf = Math.abs(h - 0.75) < 0.05 || Math.abs(h - 1.3) < 0.05 || Math.abs(h - 1.82) < 0.05;
          const v = (zz % 1.4 < 0.07 ? 0.05 : shelf ? 0.3 : 0.62) * (0.85 + 0.3 * hash(Math.floor(zz * 3), 5));
          if (cool) emit(k, 0.7 * v, 0.85 * v, 1 * v);
          else emit(k, v, 0.72 * v, 0.44 * v);
        }
      } else if (front === 3) {
        const zz = z - z0;
        if (zz > 0.35 && zz < 1.15) {
          if (h < 2) surface(k, 0.07, 0.05, 0.04, 0.8);
          else if (h < 2.22) emit(k, 0.55, 0.38, 0.2);
        } else if (zz > 1.5 && zz < 2.5 && h > 1 && h < 1.9) {
          const lattice = zz % 0.12 < 0.03 || (h - 1) % 0.18 < 0.035;
          // paper lit from inside, never quite even
          const p = 0.8 + 0.3 * fbm(zz * 9, h * 9, 2, 0);
          if (lattice) surface(k, 0.06, 0.04, 0.03, 0.6);
          else emit(k, 0.5 * p, 0.36 * p, 0.2 * p);
        }
      } else if (front === 4) {
        // dark wood, in boards
        const grain = 0.75 + 0.35 * fbm(z * 14, h * 0.8, 2, 0);
        surface(k, 0.3 * grain, 0.19 * grain, 0.12 * grain, 1);
        if (z > 2.35 && z < 3 && h < 2.05) {
          if (h > 1.42) {
            // the noren over the door: indigo cloth in panels hanging in soft folds, a white crest
            const slit = (z - 2.35) % 0.217 < 0.028;
            const fold = 0.72 + 0.4 * (0.5 + 0.5 * Math.sin((z - 2.35) * 88)) * (0.85 + 0.3 * smooth(2.05, 1.42, h));
            const crest = ((z - 2.675) / 0.09) ** 2 + ((h - 1.76) / 0.13) ** 2 < 1 && ((z - 2.675) / 0.09) ** 2 + ((h - 1.76) / 0.13) ** 2 > 0.35;
            if (slit) emit(k, 0.8, 0.5, 0.22);
            else if (crest) emit(k, 0.72 * fold, 0.71 * fold, 0.68 * fold);
            else emit(k, 0.09 * fold, 0.1 * fold, 0.3 * fold);
          } else {
            // the room inside, warm under a lamp over the counter, two people sat at it
            let v = (Math.abs(h - 0.95) < 0.06 ? 0.35 : 0.5 + 0.35 * smooth(0.2, 1.4, h)) * (h < 0.3 ? 0.6 : 1);
            v *= (0.78 + 0.4 * Math.exp(-(((z - 2.68) / 0.22) ** 2))) * (0.9 + 0.2 * fbm(z * 20, h * 10, 2, 0));
            for (const pz of [2.52, 2.83]) {
              const head = ((z - pz) / 0.075) ** 2 + ((h - 1.3) / 0.1) ** 2 < 1;
              const back = h > 0.9 && h < 1.22 && Math.abs(z - pz) < 0.1 + 0.05 * smooth(1.2, 0.95, h);
              if (head || back) v = 0.07;
            }
            emit(k, v, 0.6 * v, 0.28 * v);
          }
        } else if (z > 1.5 && z < 1.85 && h > 1.05 && h < 1.8) {
          const lattice = z % 0.11 < 0.03 || (h - 1.05) % 0.19 < 0.04;
          const p = 0.78 + 0.32 * fbm(z * 12, h * 12, 2, 0);
          if (lattice) surface(k, 0.12, 0.07, 0.04, 0.6);
          else emit(k, 0.6 * p, 0.38 * p, 0.18 * p);
        }
      }
    }
  }

  // the sky: low rain cloud lit from below by the city, near black overhead,
  // a dull warm mauve toward the roofs, brightest over the street's far end
  for (let k = 0; k < N; k++) {
    const x = k % W, y = Math.floor(k / W) + 0.5;
    const v = clamp(y / HY) ** 1.8;
    const glow = endGlow(x + 0.5, y);
    SR[k] = 0.035 + 0.14 * v + glow * END[0];
    SG[k] = 0.03 + 0.08 * v + glow * END[1];
    SB[k] = 0.06 + 0.1 * v + glow * END[2];
  }

  // a tower far off beyond the street, its top lit. It is darker than the cloud
  // behind it, so it stands as a silhouette rather than melting into the glow.
  // Laid out in rows above the horizon: the spire from 41, the lit top at 35, down to 12.
  const towerTop = Math.round(HY - 35 * K), spireTop = Math.round(HY - 41 * K), towerEnd = Math.round(HY - 12 * K);
  const towerX0 = Math.round(VX - 4 * K), towerX1 = Math.round(VX + 4 * K); // 6 cells either side
  for (let r = spireTop; r < towerEnd; r++) {
    for (let x = towerX0; x < towerX1; x++) {
      const k = r * W + x;
      if (mat[k] !== SKY) continue;
      const spire = x === VX - 1 || x === VX;
      if (r < towerTop && !spire) continue;
      mat[k] = TOWER;
      S[k] = 0.05;
      if (r < towerTop) emit(k, 0.015, 0.012, 0.025);
      else if (r < towerTop + 3) emit(k, 0.42, 0.36, 0.5);
      else {
        // a lit window here and there, a floor every three rows
        const lit = (x & 1) === 0 && (r - towerTop) % 3 === 2 && hash(x, r + 5) < 0.45;
        emit(k, lit ? 0.32 : 0.015, lit ? 0.24 : 0.012, lit ? 0.18 : 0.025);
      }
    }
  }

  // --- poles and wires -------------------------------------------------------
  for (let p = 0; p < POLES.length; p++) {
    const [px, pz, top, thick] = POLES[p];
    const s = F / pz, xc = VX + px * s, hw = (thick / 2) * s;
    const yt = HY - (top - EYE) * s, yb = HY + EYE * s;
    const arm = top - 0.45;
    for (let r = Math.max(0, Math.floor(yt - 3)); r < Math.min(H, Math.ceil(yb)); r++) {
      const y = r + 0.5, h = EYE + (HY - y) / s;
      for (let x = Math.max(0, Math.floor(xc - 0.9 * s)); x < Math.min(W, Math.ceil(xc + 0.9 * s)); x++) {
        const k = r * W + x;
        if (S[k] >= s) continue;
        // how much of the cell the pole covers, so the far ones stay thin
        let cov = 0;
        if (h <= top && h >= 0) cov = clamp(Math.min(x + 1, xc + hw) - Math.max(x, xc - hw));
        const onArm = Math.abs(h - arm) < Math.max(0.06, 0.5 / s) && Math.abs(x + 0.5 - xc) < 0.65 * s;
        const can = p === 1 && h > 6.4 && h < 7.5 && x + 0.5 - xc > 0 && x + 0.5 - xc < 0.45 * s;
        if (onArm || can) cov = Math.max(cov, can ? 1 : clamp(0.12 * s));
        if (cov < 0.05) continue;
        let cr = 0.36, cg = 0.36, cb = 0.4;
        if (p === 0) {
          // the near pole: concrete, a yellow and black guard, a blue address plate
          const u = (x + 0.5 - xc) / hw;
          const round = 0.55 + 0.45 * Math.sqrt(clamp(1 - u * u));
          cr *= round, cg *= round, cb *= round;
          if (h > 0.25 && h < 1.8) {
            const stripe = (h * 4.5 + u * 0.35) % 1 < 0.5;
            if (stripe) (cr = 0.9), (cg = 0.72), (cb = 0.08);
            else (cr = 0.05), (cg = 0.05), (cb = 0.05);
          } else if (h > 1.95 && h < 2.35 && Math.abs(u) < 0.85) {
            const dot = (x + r) % 2 === 0 && h > 2.03 && h < 2.27;
            if (dot) (cr = 0.85), (cg = 0.88), (cb = 0.95);
            else (cr = 0.12), (cg = 0.25), (cb = 0.75);
          }
        } else if (can) (cr = 0.4), (cg = 0.42), (cb = 0.46);
        else (cr = 0.12), (cg = 0.12), (cb = 0.15);
        AR[k] = mix(AR[k], cr, cov), AG[k] = mix(AG[k], cg, cov), AB[k] = mix(AB[k], cb, cov);
        ER[k] *= 1 - cov, EG[k] *= 1 - cov, EB[k] *= 1 - cov;
        KG[k] = mix(KG[k], 1, cov);
        if (cov > 0.5) (mat[k] = POLE), (S[k] = s);
      }
    }
  }
  for (const [ax, ah, az, bx, bh, bz, sag] of WIRES) {
    let px = 0, py = 0, ps = 0;
    for (let i = 0; i <= 120; i++) {
      const q = i / 120;
      const wx = mix(ax, bx, q), wz = mix(az, bz, q), wh = mix(ah, bh, q) - sag * 4 * q * (1 - q);
      const s = F / wz, sx = VX + wx * s, sy = HY - (wh - EYE) * s;
      if (i > 0) {
        // a thin dark line from the last point to this one
        const minx = Math.max(0, Math.floor(Math.min(px, sx) - 1)), maxx = Math.min(W - 1, Math.ceil(Math.max(px, sx) + 1));
        const miny = Math.max(0, Math.floor(Math.min(py, sy) - 1)), maxy = Math.min(H - 1, Math.ceil(Math.max(py, sy) + 1));
        const dx = sx - px, dy = sy - py, len2 = dx * dx + dy * dy || 1e-6;
        for (let r = miny; r <= maxy; r++) {
          for (let x = minx; x <= maxx; x++) {
            const k = r * W + x;
            const kk = clamp(((x + 0.5 - px) * dx + (r + 0.5 - py) * dy) / len2);
            const ex = px + dx * kk - x - 0.5, ey = py + dy * kk - r - 0.5;
            const cov = clamp(1.15 - Math.sqrt(ex * ex + ey * ey) * 1.5) * 0.9;
            const s2 = mix(ps, s, kk);
            if (cov < 0.05 || S[k] >= s2) continue;
            AR[k] = mix(AR[k], 0.05, cov), AG[k] = mix(AG[k], 0.05, cov), AB[k] = mix(AB[k], 0.07, cov);
            ER[k] *= 1 - cov, EG[k] *= 1 - cov, EB[k] *= 1 - cov;
            KG[k] = mix(KG[k], 0.8, cov);
            if (mat[k] === SKY || mat[k] === TOWER) (SR[k] *= 1 - cov), (SG[k] *= 1 - cov), (SB[k] *= 1 - cov);
            if (cov > 0.45 && mat[k] !== ROAD) (mat[k] = mat[k] === SKY || mat[k] === TOWER ? WIRE : mat[k]), (S[k] = Math.max(S[k], 0.01));
          }
        }
      }
      (px = sx), (py = sy), (ps = s);
    }
  }

  // --- the vending machine: a lit front, and its side toward the street -----
  {
    const s = VEND_S, s2 = s / (1 + (0.7 * s) / F);
    // the cans behind the glass, row by row
    const CANS = [[1, 0.16, 0.1], [0.15, 0.4, 1], [1, 0.55, 0.1], [0.2, 0.85, 0.45], [0.95, 0.95, 0.95], [1, 0.85, 0.15], [0.85, 0.2, 0.6]];
    for (let r = 0; r < H; r++) {
      const y = r + 0.5, h0 = EYE + (HY - y) / s;
      for (let x = Math.floor(VX - 3.2 * s); x < Math.ceil(VX - 2.1 * s); x++) {
        const k = r * W + x, xc = x + 0.5;
        const u = (xc - VX) / s + 3.15;
        if (u >= 0 && u <= 0.95 && h0 >= 0 && h0 <= 1.83 && S[k] < s) {
          mat[k] = VEND;
          S[k] = s;
          grp[k] = 0;
          let cr = 0.62, cg = 0.66, cb = 0.74; // the white casing, lit by its own light
          if (u > 0.05 && u < 0.9 && h0 > 0.05 && h0 < 1.78) {
            if (h0 > 1.5) {
              cr = 0.85, cg = 0.93, cb = 1;
              if (h0 > 1.6 && h0 < 1.71) (cr = 1), (cg = 0.18), (cb = 0.12);
            } else if (h0 > 0.53) {
              const band = h0 > 1.13 ? 0 : h0 > 0.83 ? 1 : 2;
              const b0 = [1.13, 0.83, 0.53][band];
              const hb = h0 - b0;
              const slot = Math.floor((u - 0.08) / 0.135), su = u - 0.08 - slot * 0.135;
              cr = 0.82, cg = 0.9, cb = 1;
              if (hb < 0.045) {
                // the buttons under each row
                const lit = su > 0.05 && su < 0.09 && slot >= 0 && slot < 6;
                cr = lit ? 0.35 : 0.2, cg = lit ? 0.75 : 0.22, cb = lit ? 1 : 0.28;
              } else if (hb > 0.07 && hb < 0.26 && slot >= 0 && slot < 6 && su > 0.02 && su < 0.1) {
                const c = CANS[Math.floor(hash(slot, band + 3) * CANS.length)];
                (cr = c[0] * 0.95), (cg = c[1] * 0.95), (cb = c[2] * 0.95);
              }
            } else {
              cr = 0.3, cg = 0.32, cb = 0.38;
              if (u > 0.12 && u < 0.62 && h0 > 0.1 && h0 < 0.26) (cr = 0.02), (cg = 0.02), (cb = 0.03);
              if (u > 0.7 && u < 0.86 && h0 > 0.3 && h0 < 0.46) {
                const read = h0 > 0.38 && h0 < 0.44;
                cr = read ? 0.2 : 0.06, cg = read ? 1 : 0.06, cb = read ? 0.5 : 0.08;
              }
            }
          }
          // the tubes sit at the top, and the glass over the cans catches a pale streak
          const lamp = 0.84 + 0.2 * smooth(0.4, 1.6, h0);
          const sheen = h0 > 0.53 && h0 < 1.5 ? 0.09 * Math.exp(-(((u - 0.62 + (h0 - 1) * 0.45) / 0.05) ** 2)) : 0;
          emit(k, cr * lamp + sheen, cg * lamp + sheen, cb * lamp + sheen * 1.1);
        }
      }
    }
    // the side, from the front edge back toward the far end
    const xin = VX - 2.2 * s, xend = VX - 2.2 * s2;
    for (let x = Math.floor(xin); x < Math.ceil(xend); x++) {
      const sc = (VX - x - 0.5) / 2.2;
      if (sc > s || sc < s2) continue;
      const along = (F / sc - F / s) / 0.7;
      for (let r = 0; r < H; r++) {
        const y = r + 0.5, h = EYE + (HY - y) / sc;
        const k = r * W + x;
        if (h < 0 || h > 1.83 || S[k] >= sc) continue;
        mat[k] = VEND;
        S[k] = sc;
        const seam = Math.abs(along - 0.5) < 0.04;
        const v = (h > 1.72 ? 0.5 : 0.36) * (seam ? 0.6 : 1) * (1 - 0.3 * along);
        emit(k, v * 0.92, v * 0.96, v * 1.05);
      }
    }
  }

  // --- the signs, far ones first ----------------------------------------------
  const bulbs: [number, number][] = []; // the chasing bulbs round one sign: [cell, place in the ring]
  const order = SIGNS.map((_, i) => i).sort((a, b) => SIGNS[a].s - SIGNS[b].s);
  for (const si of order) {
    const sg = SIGNS[si];
    const { side, g, kind, hue } = sg;
    const s = sg.s * K;
    const text = sg.text ? sg.text.split(" ") : [];
    const n = text.length;
    const G = 7 * g; // a letter's size in cells
    // the box keeps its size from the 200 by 100 grid, its width evened up so
    // the letters sit square in it, and the letters are spread evenly down it
    let w = Math.round(sg.w * K);
    if (g && (w - G) & 1) w += sg.w * K > w ? 1 : -1;
    const xo = Math.round(VX + side * (sg.edge ?? HALF) * s);
    const x0 = side < 0 ? xo : xo - w, x1 = x0 + w;
    const y1 = Math.round(HY - (sg.hb - EYE) * s);
    const hc = Math.round((g ? 2 * (kind === BULBS ? 3 : g + 1) + n * (6 * g + 1) - g - 1 : sg.rows!) * K);
    const y0 = y1 - hc;
    const gx = x0 + (w - G) / 2;
    const masks = text.map((c) => glyphMask(c, g));
    const rowGlyph = new Int8Array(hc).fill(-1), rowIn = new Uint8Array(hc);
    const gap = (hc - n * G) / (n + 1);
    for (let i = 0; i < n; i++) {
      const top = Math.round(gap * (i + 1) + i * G);
      for (let gr = 0; gr < G; gr++) (rowGlyph[top + gr] = i), (rowIn[top + gr] = gr);
    }
    const pale = [mix(hue[0], 1, 0.32), mix(hue[1], 1, 0.32), mix(hue[2], 1, 0.32)];
    let ring = 0;
    // which cells of the box are lit tube, for the haze of light round each tube
    const tube = new Uint8Array(w * hc);
    for (let r = Math.max(0, y0); r < Math.min(H, y1); r++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const k = r * W + x;
        if (S[k] >= s) continue;
        const i = x - x0, j = r - y0, jb = y1 - 1 - r;
        const edge = i === 0 || i === w - 1 || j === 0 || jb === 0;
        let stroke = false, gi = -1;
        if (g) {
          gi = rowGlyph[j];
          const gc = x - gx;
          if (gi >= 0 && gc >= 0 && gc < G) stroke = masks[gi][rowIn[j] * G + gc] === 1;
        } else if (sg.w > 2 && i > 0 && i < w - 1) stroke = j % 6 >= 1 && j % 6 <= 3;
        let cr: number, cg: number, cb: number;
        // a lit panel is brighter in the middle, over its tubes, and never quite even
        const back = (0.8 + 0.24 * (1 - (2 * (i + 0.5) / w - 1) ** 2)) * (0.94 + 0.12 * fbm(x * 0.35, r * 0.35, 2, 0));
        if (kind === NEON) {
          if (edge) (cr = hue[0]), (cg = hue[1]), (cb = hue[2]), (tube[j * w + i] = 1);
          else if (stroke) (cr = pale[0]), (cg = pale[1]), (cb = pale[2]), (tube[j * w + i] = 1);
          else (cr = 0.02 + hue[0] * 0.04), (cg = 0.018 + hue[1] * 0.04), (cb = 0.03 + hue[2] * 0.04);
        } else if (kind === PANEL) {
          if (stroke) (cr = hue[0] * 0.07), (cg = hue[1] * 0.07), (cb = hue[2] * 0.07);
          else if (edge && sg.w > 3) (cr = hue[0] * 0.55), (cg = hue[1] * 0.55), (cb = hue[2] * 0.55);
          else (cr = pale[0] * 0.92 * back), (cg = pale[1] * 0.92 * back), (cb = pale[2] * 0.92 * back);
        } else if (kind === WHITE) {
          if (stroke) (cr = hue[0] * 0.9), (cg = hue[1] * 0.9), (cb = hue[2] * 0.9);
          else if (edge) (cr = hue[0] * 0.7), (cg = hue[1] * 0.7), (cb = hue[2] * 0.7);
          else (cr = 0.95 * back), (cg = 0.92 * back), (cb = 0.85 * back);
        } else {
          if (edge) {
            (cr = 0.04), (cg = 0.03), (cb = 0.03);
            if ((i + j) % 3 === 0) bulbs.push([k, ring++]);
          } else if (stroke) (cr = 1), (cg = 0.95), (cb = 0.86);
          else (cr = hue[0] * 0.42 * back), (cg = hue[1] * 0.42 * back), (cb = hue[2] * 0.42 * back);
        }
        mat[k] = SIGN;
        S[k] = s;
        emit(k, cr, cg, cb);
        grp[k] = sg.group ?? (sg.fail !== undefined && gi === sg.fail && stroke ? 3 : 0);
      }
    }
    // Neon: the glass tubes light the dark panel behind them in a soft fringe
    // of their own colour, so the letters glow without losing their shape.
    const sf = Math.fround(s);
    if (kind === NEON) {
      for (let r = Math.max(0, y0); r < Math.min(H, y1); r++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          const k = r * W + x, i = x - x0, j = r - y0;
          if (S[k] !== sf || mat[k] !== SIGN || tube[j * w + i]) continue;
          let sum = 0;
          for (let dj = -2; dj <= 2; dj++) {
            if (j + dj < 0 || j + dj >= hc) continue;
            for (let di = -2; di <= 2; di++) {
              if (i + di < 0 || i + di >= w || !tube[(j + dj) * w + i + di]) continue;
              sum += Math.exp(-(di * di + dj * dj) / 1.6);
            }
          }
          const hl = Math.min(1, sum) * 0.3;
          ER[k] += hue[0] * hl, EG[k] += hue[1] * hl, EB[k] += hue[2] * hl;
          // round the failing letter the fringe goes dark with it
          if (sg.fail !== undefined && rowGlyph[j] === sg.fail) grp[k] = 3;
        }
      }
    }
    // the box's side, running back toward the far end of the street
    const xin = side < 0 ? x1 : x0;
    const xwIn = (xin - VX) / s;
    const s2 = s / (1 + (THICK * s) / F);
    const xend = VX + xwIn * s2;
    const hb = EYE + (HY - y1) / s, ht = EYE + (HY - y0) / s;
    const lo = Math.floor(Math.min(xin, xend)), hi = Math.ceil(Math.max(xin, xend));
    for (let x = Math.max(0, lo); x < Math.min(W, hi); x++) {
      const sc = (x + 0.5 - VX) / xwIn;
      if (sc > s || sc < s2) continue;
      const yt = HY - (ht - EYE) * sc, yb = HY - (hb - EYE) * sc;
      for (let r = Math.max(0, Math.floor(yt)); r < Math.min(H, Math.ceil(yb)); r++) {
        const y = r + 0.5;
        const k = r * W + x;
        if (y < yt || y >= yb || S[k] >= sc) continue;
        const v = kind === NEON ? 0.14 : kind === BULBS ? 0.3 : 0.5;
        const c = kind === WHITE ? [0.95, 0.93, 0.88] : kind === NEON ? hue : pale;
        mat[k] = SIDE;
        S[k] = sc;
        emit(k, c[0] * v, c[1] * v, c[2] * v);
        grp[k] = sg.group ?? 0;
      }
    }
  }

  // the andon's legs
  {
    const s = 18 * K, y0 = Math.round(HY + (EYE - 0.14) * s), y1 = Math.round(HY + EYE * s);
    for (const xw of [2.1, 2.4]) {
      const x = Math.floor(VX + xw * s);
      for (let r = y0; r < y1; r++) {
        const k = r * W + x;
        if (S[k] < s) (mat[k] = POLE), (S[k] = s), surface(k, 0.05, 0.05, 0.06, 0.5);
      }
    }
  }

  // --- the lanterns, drawn each frame as they swing --------------------------
  // [cell, r, g, b] for one lantern at a given swing, in front of what is there
  const lantern = (li: number, swing: number, put: (k: number, r: number, g: number, b: number) => void) => {
    const [ds, lx, lh] = LANTERNS[li];
    const s = ds * K;
    const xc = VX + lx * s, yc = HY - (lh - EYE) * s;
    const top = HY - (lh + 0.62 - EYE) * s;
    for (let r = Math.max(0, Math.floor(top)); r < Math.min(H, Math.ceil(yc + 0.48 * s)); r++) {
      const y = r + 0.5;
      const v = (yc - y) / s; // height about the centre
      const off = swing * (0.62 - v); // swinging from the hook above
      for (let x = Math.floor(xc - 0.36 * s - 1); x <= Math.ceil(xc + 0.36 * s + 1); x++) {
        if (x < 0 || x >= W) continue;
        const u = (x + 0.5 - xc) / s - off;
        const k = r * W + x;
        if (v > 0.44) {
          // the cord up to the eave
          if (Math.abs(u) < 0.5 / s) put(k, 0.04, 0.02, 0.02);
          continue;
        }
        if (v < -0.44) continue;
        if (Math.abs(v) > 0.38) {
          if (Math.abs(u) < 0.15) put(k, 0.06, 0.02, 0.02); // the black caps
          continue;
        }
        const hw = 0.26 * Math.sqrt(1 - (v / 0.46) ** 2);
        if (Math.abs(u) > hw) continue;
        const q = u / hw;
        // the candle-warm middle shows through the paper yellow; the edges deepen to red
        const core = (1 - q * q) * (1 - (v / 0.42) ** 2);
        let b = 0.5 + 0.6 * core;
        if ((v + 0.38) % 0.095 < 0.024) b *= 0.55; // the ribs
        // a dark character down the middle
        const letter = Math.abs(v) < 0.24 && (Math.abs(u) < 0.02 || (Math.abs(u) < 0.08 && (v + 0.24) % 0.12 < 0.03));
        if (letter) b *= 0.12;
        put(k, b, b * (0.2 + 0.32 * core), b * (0.07 + 0.12 * core));
      }
    }
  };
  const LR = new Float32Array(N), LG = new Float32Array(N), LB = new Float32Array(N);
  for (let li = 0; li < LANTERNS.length; li++) lantern(li, 0, (k, r, g, b) => ((LR[k] = r), (LG[k] = g), (LB[k] = b)));

  // --- light: the glow round every light, what it falls on, the haze --------
  const blur = (src: Float32Array, rad: number, passes: number): Float32Array => {
    let a = src.slice();
    const b = new Float32Array(N);
    const pre = new Float32Array(Math.max(W, H) + 1);
    const n = 2 * rad + 1;
    for (let p = 0; p < passes; p++) {
      for (let r = 0; r < H; r++) {
        for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + a[r * W + x];
        for (let x = 0; x < W; x++) b[r * W + x] = (pre[Math.min(W, x + rad + 1)] - pre[Math.max(0, x - rad)]) / n;
      }
      for (let x = 0; x < W; x++) {
        for (let r = 0; r < H; r++) pre[r + 1] = pre[r] + b[r * W + x];
        for (let r = 0; r < H; r++) a[r * W + x] = (pre[Math.min(H, r + rad + 1)] - pre[Math.max(0, r - rad)]) / n;
      }
    }
    return a;
  };
  const glow = (e: Float32Array) => {
    const a = blur(e, 3, 2), b = blur(e, 10, 3), c = blur(e, 32, 2);
    for (let k = 0; k < N; k++) a[k] = a[k] * 0.5 + b[k] * 1.0 + c[k] * 0.22;
    return a;
  };
  const fog = new Float32Array(N);
  const HZR = new Float32Array(N), HZG = new Float32Array(N), HZB = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const s = S[k];
    fog[k] = mat[k] === TOWER ? 0.1 : s > 0 ? 1 - Math.exp(-F / s / ZF) : 0;
    // the haze itself is lit, brightest down at the far end of the street
    const x = k % W, y = Math.floor(k / W) + 0.5;
    const g = endGlow(x + 0.5, y) * 1.1;
    HZR[k] = 0.065 + g * END[0], HZG[k] = 0.055 + g * END[1], HZB[k] = 0.085 + g * END[2];
  }
  // The picture before anything moves, from a set of lights: the colour of each
  // cell and the glow there. Lights that flicker run it again with them off.
  const shade = (er: Float32Array, eg: Float32Array, eb: Float32Array) => {
    const gr = glow(er.map((v, k) => v + LR[k])), gg = glow(eg.map((v, k) => v + LG[k])), gb = glow(eb.map((v, k) => v + LB[k]));
    const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const m = mat[k];
      let r: number, g: number, b: number;
      if (m === SKY || m === WIRE) {
        r = SR[k] + gr[k] * 0.06, g = SG[k] + gg[k] * 0.06, b = SB[k] + gb[k] * 0.06;
        if (m === WIRE) (r = r * 0.3 + gr[k] * 0.3), (g = g * 0.3 + gg[k] * 0.3), (b = b * 0.3 + gb[k] * 0.3);
      } else {
        const kg = (KG[k] + (m === SIGN ? 0.05 : 0)) * 2.4;
        r = er[k] + AR[k] * (0.06 + gr[k] * kg), g = eg[k] + AG[k] * (0.05 + gg[k] * kg), b = eb[k] + AB[k] * (0.09 + gb[k] * kg);
        const f = fog[k];
        r = mix(r, HZR[k] + gr[k] * 0.3, f), g = mix(g, HZG[k] + gg[k] * 0.3, f), b = mix(b, HZB[k] + gb[k] * 0.3, f);
      }
      cr[k] = r, cg[k] = g, cb[k] = b;
    }
    return [cr, cg, cb, gr, gg, gb];
  };

  // The wet road as a mirror: each cell above it lands where its depth says,
  // the nearest winning, and the gloss smears what lands up and down the road.
  const XH = H + EXT;
  const mirror = (cr: Float32Array, cg: Float32Array, cb: Float32Array) => {
    const xr = new Float32Array(W * XH), xg = new Float32Array(W * XH), xb = new Float32Array(W * XH);
    const xd = new Float32Array(W * XH).fill(-1);
    for (let k = 0; k < N; k++) {
      const m = mat[k];
      if (m === ROAD) continue;
      const x = k % W, r = (k / W) | 0;
      const s = S[k];
      const rr = Math.floor(2 * HY + 2 * EYE * s - r - 0.5);
      if (rr < HY || rr >= XH || (rr < H && mat[rr * W + x] !== ROAD)) continue;
      const q = rr * W + x;
      if (s <= xd[q]) continue;
      xd[q] = s;
      // whatever gives off light shows in the water, lit shop fronts and windows as much as signs
      const f = m === WALL && ER[k] + EG[k] + EB[k] + LR[k] > 0.25 ? 0.8 : GIVE[m];
      xr[q] = cr[k] * f, xg[q] = cg[k] * f, xb[q] = cb[k] * f;
    }
    // per row of this grid, the falloff the 200 by 100 grid had per row
    const upK = 0.96 ** (1 / K), dnK = 0.9 ** (1 / K);
    const glR = new Float32Array(N), glG = new Float32Array(N), glB = new Float32Array(N);
    const upR = new Float32Array(XH), upG = new Float32Array(XH), upB = new Float32Array(XH);
    for (let x = 0; x < W; x++) {
      for (let r = HY + 1; r < XH; r++) {
        const q = r * W + x;
        if (xd[q] < 0 && xd[q - W] >= 0) (xr[q] = xr[q - W]), (xg[q] = xg[q - W]), (xb[q] = xb[q - W]), (xd[q] = 0);
      }
      // The gloss: light pulled a long way up the road, so the near signs,
      // whose mirror images fall below the frame, still leave a streak under them.
      let ur = 0, ug = 0, ub = 0, dr = 0, dg = 0, db = 0;
      for (let r = XH - 1; r >= HY; r--) {
        const q = r * W + x;
        ur = ur * upK + xr[q] * (1 - upK), ug = ug * upK + xg[q] * (1 - upK), ub = ub * upK + xb[q] * (1 - upK);
        upR[r] = ur, upG[r] = ug, upB[r] = ub;
      }
      // and a shorter smear down the road toward us
      for (let r = HY; r < H; r++) {
        const q = r * W + x;
        dr = dr * dnK + xr[q] * (1 - dnK), dg = dg * dnK + xg[q] * (1 - dnK), db = db * dnK + xb[q] * (1 - dnK);
        if (mat[q] !== ROAD) continue;
        glR[q] = dr * 0.45 + upR[r], glG[q] = dg * 0.45 + upG[r], glB[q] = db * 0.45 + upB[r];
      }
    }
    // Standing water holds a sharp image; the rough asphalt round it only a
    // streak, a little spread sideways. Steep up close the wet road gives back
    // little and shows its own dark grit; toward the far end it is nearly a mirror.
    const rr = new Float32Array(N), rg = new Float32Array(N), rb = new Float32Array(N);
    for (let r = HY; r < H; r++) {
      const fres = 0.4 + 0.6 * smooth((106 + Y0) * K, HY + 3 * K, r + 0.5) ** 1.3;
      for (let x = 1; x < W - 1; x++) {
        const q = r * W + x;
        if (mat[q] !== ROAD) continue;
        const pud = wet[q], sh = 0.25 + 0.6 * pud, gl = 0.85 + 0.35 * pud;
        const br = glR[q] * 0.5 + (glR[q - 1] + glR[q + 1]) * 0.25;
        const bg = glG[q] * 0.5 + (glG[q - 1] + glG[q + 1]) * 0.25;
        const bb = glB[q] * 0.5 + (glB[q - 1] + glB[q + 1]) * 0.25;
        rr[q] = (xr[q] * sh + br * gl) * fres;
        rg[q] = (xg[q] * sh + bg * gl) * fres;
        rb[q] = (xb[q] * sh + bb * gl) * fres;
      }
    }
    return [rr, rg, rb];
  };

  const [CR, CG, CB, GR, GG, GB] = shade(ER, EG, EB);
  const [RR, RG, RB] = mirror(CR, CG, CB);

  // Each flickering group: what it adds, to the picture and to the road's
  // mirror, so a frame can take it away again when the group goes dark.
  const NG = 3;
  const dropC: [Int32Array, Float32Array][] = [];
  const dropR: Float32Array[][] = [];
  for (let gi = 1; gi <= NG; gi++) {
    const er = ER.slice(), eg = EG.slice(), eb = EB.slice();
    for (let k = 0; k < N; k++) {
      if (grp[k] !== gi) continue;
      // a dark tube still shows a little; a dead letter shows its panel
      if (gi === 3) (er[k] = 0.03 + PINK[0] * 0.05), (eg[k] = 0.025 + PINK[1] * 0.05), (eb[k] = 0.045 + PINK[2] * 0.05);
      else (er[k] *= 0.08), (eg[k] *= 0.08), (eb[k] *= 0.08);
    }
    const [cr, cg, cb] = shade(er, eg, eb);
    const ks: number[] = [], vs: number[] = [];
    for (let k = 0; k < N; k++) {
      const d = Math.abs(CR[k] - cr[k]) + Math.abs(CG[k] - cg[k]) + Math.abs(CB[k] - cb[k]);
      if (d > 0.004) ks.push(k), vs.push(CR[k] - cr[k], CG[k] - cg[k], CB[k] - cb[k]);
    }
    dropC.push([Int32Array.from(ks), Float32Array.from(vs)]);
    const [rr, rg, rb] = mirror(cr, cg, cb);
    dropR.push([RR.map((v, k) => v - rr[k]), RG.map((v, k) => v - rg[k]), RB.map((v, k) => v - rb[k])]);
  }

  // The far end's glow laid down the middle of the road: a long bright path,
  // wider as it nears, that the walker crosses.
  for (let k = 0; k < N; k++) {
    if (mat[k] !== ROAD) continue;
    const s = S[k] / K, d = Math.abs((k % W) + 0.5 - VX) / K; // in the 200 by 100 grid's cells
    const path = Math.exp(-((d / (1.4 + 0.36 * s)) ** 1.6)) * (0.16 + 0.7 * Math.exp(-s / 12));
    RR[k] += path * END[0], RG[k] += path * END[1], RB[k] += path * END[2];
  }

  // the road's cells, for the per-frame pass, with where each lies on the road in metres
  const road: number[] = [];
  for (let k = 0; k < N; k++) if (mat[k] === ROAD) road.push(k);
  const roadK = Int32Array.from(road);
  const RXW = new Float32Array(roadK.length), RZ = new Float32Array(roadK.length), RS = new Float32Array(roadK.length);
  for (let i = 0; i < roadK.length; i++) {
    const k = roadK[i], s = S[k];
    (RS[i] = s), (RZ[i] = F / s), (RXW[i] = ((k % W) + 0.5 - VX) / s);
  }
  // a faint unevenness in every dot, like ink on paper
  const GRAIN = new Float32Array(N);
  for (let k = 0; k < N; k++) GRAIN[k] = 0.95 + 0.1 * hash(k, 991);
  const sky: number[] = [];
  for (let k = 0; k < N; k++) if (mat[k] === SKY) sky.push(k);
  const skyK = Int32Array.from(sky);

  // low cloud: heaped noise that wraps, so it can drift forever
  const CW = 640;
  const cloud = new Float32Array(CW * HY);
  for (let r = 0; r < HY; r++)
    for (let x = 0; x < CW; x++) cloud[r * CW + x] = fbm((x * 0.03) / K, (r * 0.09) / K, 4, (CW * 0.03) / K);

  // rain in three depths: [count, speed in rows a second, length, brightness, slant].
  // The streaks are a cell wide, thinner than before, so there are more of them.
  const LAYERS = [[185, 40 * K, 5, 0.18, 0.1], [235, 72 * K, 10, 0.38, 0.13], [75, 125 * K, 18, 0.7, 0.17]];
  const drops: number[][] = [];
  LAYERS.forEach(([count, v, len, b, sl], li) => {
    for (let i = 0; i < count; i++) {
      const h = (n: number) => hash(i * 7 + li * 1001, n);
      drops.push([h(1) * (W + 30 * K) - 20 * K, h(2) * (H + len + 6), v * (0.85 + 0.3 * h(3)), len, b * (0.75 + 0.5 * h(4)), sl]);
    }
  });

  const FR = new Float32Array(N), FG = new Float32Array(N), FB = new Float32Array(N);
  const rain = new Float32Array(N);
  const hold = new Float32Array(N); // how solidly the walker covers a cell, so no stray dots show through

  // where the walker is: walking out of the alley, then away down the street.
  // The walk is short, so the street is never empty for long, and it keeps time
  // with the traffic light.
  const walker = (t: number) => {
    const tau = (((t + 5.5) % 24) + 24) % 24;
    // they turn from walking out of the alley to walking away, without a jolt
    const k = clamp((tau - 3) / 4);
    const ramp = tau < 3 ? 0 : tau < 7 ? 4 * (k * k * k - (k * k * k * k) / 2) : 2 + tau - 7;
    const z = 5.6 + 0.06 * tau + 0.5 * ramp;
    const xw = 4.4 - 4.05 * smooth(0, 5.5, tau);
    return { xw, z, s: F / z, fade: smooth(15, 12, z), ph: tau * 1.7 * Math.PI };
  };

  // a flickering group's brightness at time t: steady, then now and then a stutter
  const flicker = (gi: number, t: number) => {
    const f = Math.floor(t * 15);
    if (gi === 1) {
      const c = (t + 3) % 9;
      return c < 0.9 ? (hash(f, 11) > 0.45 ? 1 : 0.1) : 0.96 + 0.04 * hash(f, 12);
    }
    if (gi === 2) {
      // this tube dies for a few seconds, then catches again
      const c = (t + 7) % 13;
      if (c < 0.7 || (c > 4 && c < 4.8)) return hash(f, 21) > 0.5 ? 1 : 0;
      return c < 4 ? 0 : 1;
    }
    const c = (t + 1.5) % 7;
    return c < 1.2 ? (hash(f, 31) > 0.35 ? 1 : 0) : 1;
  };

  return (t, px) => {
    FR.set(CR), FG.set(CG), FB.set(CB);
    const mg = [1, flicker(1, t), flicker(2, t), flicker(3, t)];
    for (let gi = 1; gi <= NG; gi++) {
      const off = 1 - mg[gi];
      if (off <= 0) continue;
      const [ks, vs] = dropC[gi - 1];
      for (let i = 0; i < ks.length; i++) {
        const k = ks[i];
        FR[k] -= vs[i * 3] * off, FG[k] -= vs[i * 3 + 1] * off, FB[k] -= vs[i * 3 + 2] * off;
      }
    }

    // the sky: cloud drifting slowly across the strip between the roofs, its
    // heavy undersides catching the city's light from below
    const drift = t * 0.9 * K;
    for (let i = 0; i < skyK.length; i++) {
      const k = skyK[i], x = k % W, r = (k / W) | 0;
      const sx = x + drift, ix = Math.floor(sx), fx = sx - ix;
      const c0 = cloud[r * CW + (ix % CW)], c1 = cloud[r * CW + ((ix + 1) % CW)];
      const rb = Math.min(HY - 1, r + 4) * CW;
      const b0 = cloud[rb + (ix % CW)], b1 = cloud[rb + ((ix + 1) % CW)];
      const d = smooth(0.32, 0.75, c0 + (c1 - c0) * fx), below = smooth(0.32, 0.75, b0 + (b1 - b0) * fx);
      const c = 0.55 + 0.75 * d + 0.9 * Math.max(0, d - below);
      FR[k] *= c, FG[k] *= c, FB[k] *= c;
    }

    // the walker, and the patch of road their reflection hides
    const wk = walker(t);
    const fs = wk.s, fx = VX + wk.xw * fs, fy = HY + EYE * fs;
    const fz = fs * 1.12; // drawn a touch tall, so they hold the middle of the frame
    // their reflection lies on the street only once they are out of the alley
    const seen = wk.fade * smooth(3.5, 2.7, wk.xw);
    const bx0 = Math.max(0, Math.floor(fx - 0.62 * fz - 1)), bx1 = Math.min(W - 1, Math.ceil(fx + 0.62 * fz + 1));

    // the road: the mirror, wavering and broken by the rain. The ripples are
    // laid out on the road itself, so they shrink and crowd toward the far end.
    const tg = Math.floor(t * 7.5);
    for (let i = 0; i < roadK.length; i++) {
      const k = roadK[i], x = k % W, r = (k / W) | 0;
      const y = r + 0.5, xw = RXW[i], z = RZ[i], s = RS[i];
      const n1 = noise(xw * 1.6 + 7, z * 2.4 - t * 0.9, 0) - 0.5;
      const n2 = noise(xw * 5 + 1, z * 7 - t * 2.3, 0) - 0.5;
      const wob = (n1 * 0.09 + n2 * 0.035) * s + (n1 + n2) * 0.7;
      let sx = x + wob;
      if (sx < 0) sx = 0;
      if (sx > W - 1.001) sx = W - 1.001;
      const j = r * W + (sx | 0), f = sx - (sx | 0);
      // broken into soft bands that roll toward us, as rain stirs the water
      const dash = 0.62 + 0.55 * smooth(0.25, 0.75, noise(xw * 1.1 + 3, z * 1.8 - t * 1.4, 0));
      let rr = RR[j] + (RR[j + 1] - RR[j]) * f, rg = RG[j] + (RG[j + 1] - RG[j]) * f, rb = RB[j] + (RB[j + 1] - RB[j]) * f;
      for (let gi = 1; gi <= NG; gi++) {
        const off = 1 - mg[gi];
        if (off <= 0) continue;
        const [dr, dg, db] = dropR[gi - 1];
        rr -= (dr[j] + (dr[j + 1] - dr[j]) * f) * off, rg -= (dg[j] + (dg[j + 1] - dg[j]) * f) * off, rb -= (db[j] + (db[j + 1] - db[j]) * f) * off;
      }
      let a = dash;
      if (seen > 0 && x >= bx0 && x <= bx1 && y > fy && y < fy + 2.3 * fz) {
        if (walkerShape((x + 0.5 - fx) / fz, (y - fy) / fz, wk.ph)) a *= 1 - 0.8 * seen;
      }
      rr = Math.max(0, rr), rg = Math.max(0, rg), rb = Math.max(0, rb);
      // a ripple's crest catching a light for an instant
      if (hash(k, tg) > 0.982 - 0.012 * wet[k]) {
        const gl = 1.6 + 1.4 * hash(k, tg + 5);
        (rr = rr * gl + GR[k] * 0.25), (rg = rg * gl + GG[k] * 0.25), (rb = rb * gl + GB[k] * 0.25);
      }
      FR[k] += rr * a, FG[k] += rg * a, FB[k] += rb * a;
    }

    // the lanterns swing a little in the wind
    for (let li = 0; li < LANTERNS.length; li++) {
      const sw = 0.05 * Math.sin(t * 1.1 + LANTERNS[li][3]) + 0.015 * Math.sin(t * 2.7 + li);
      const ls = LANTERNS[li][0] * K;
      lantern(li, sw, (k, r, g, b) => {
        if (S[k] > ls) return;
        const f = fog[k] * 0.3;
        FR[k] = mix(r, HZR[k], f), FG[k] = mix(g, HZG[k], f), FB[k] = mix(b, HZB[k], f);
      });
    }

    // the bulbs chase round their sign
    const chase = Math.floor(t * 6);
    for (const [k, i] of bulbs) {
      const on = (i + chase) % 3 !== 0;
      FR[k] = on ? 1 : 0.22, FG[k] = on ? 0.9 : 0.1, FB[k] = on ? 0.7 : 0.06;
    }

    // the traffic light far down the street, and the tower's beacon atop its spire
    {
      const c = t % 24;
      const lamp = c < 14 ? 0 : c < 17 ? 1 : 2;
      const k = Math.floor(HY - 8.5 * K) * W + VX - 1 + 2 * lamp;
      const col = [[0.25, 1, 0.55], [1, 0.75, 0.15], [1, 0.15, 0.1]][lamp];
      FR[k] = col[0], FG[k] = col[1], FB[k] = col[2];
      for (const d of [-1, 1, -W, W]) (FR[k + d] += col[0] * 0.12), (FG[k + d] += col[1] * 0.12), (FB[k + d] += col[2] * 0.12);
      const on = t % 1.6 < 0.35;
      for (const kb of [(spireTop - 1) * W + VX - 1, (spireTop - 1) * W + VX])
        (FR[kb] = on ? 1 : 0.2), (FG[kb] = on ? 0.15 : 0.05), (FB[kb] = on ? 0.1 : 0.05);
    }

    // the walker: a dark shape against the far glow, the umbrella's crown catching the neon
    hold.fill(0);
    if (wk.fade > 0) {
      // near, they are a solid shape; the haze takes them only further off
      const f = 0.7 * smooth(8, 26, wk.z);
      const top = Math.max(0, Math.floor(fy - 2.3 * fz - 1));
      for (let r = top; r <= Math.min(H - 1, Math.ceil(fy)); r++) {
        for (let x = bx0; x <= bx1; x++) {
          const k = r * W + x;
          if (S[k] >= fs) continue;
          let cov = 0, lit = 0;
          for (let q = 0; q < 4; q++) {
            const u = (x + 0.25 + 0.5 * (q & 1) - fx) / fz, v = (fy - r - 0.25 - 0.5 * (q >> 1)) / fz;
            const sh = walkerShape(u, v, wk.ph);
            if (sh) cov += 0.25;
            if (sh === 2) lit += 0.25;
          }
          if (!cov) continue;
          // dark, but for the wet crown of the umbrella catching the signs
          const l = lit / cov;
          let cr = 0.006 + l * GR[k] * 0.12, cg = 0.005 + l * GG[k] * 0.12, cb = 0.01 + l * GB[k] * 0.12;
          cr = mix(cr, HZR[k], f), cg = mix(cg, HZG[k], f), cb = mix(cb, HZB[k], f);
          const a = cov * wk.fade;
          FR[k] = mix(FR[k], cr, a), FG[k] = mix(FG[k], cg, a), FB[k] = mix(FB[k], cb, a);
          hold[k] = a * (1 - f);
        }
      }
    }

    // rings spreading where drops land on the road, and the splash at their
    // start: thin, and lit only by what the water round them gives back
    for (let i = 0; i < 64; i++) {
      const per = 0.6 + 0.6 * hash(i, 301), tt = t + hash(i, 302) * per;
      const c = Math.floor(tt / per), a = (tt - c * per) / per;
      // spread evenly down the screen, so most land near enough to see
      const cy = HY + (6 + 47 * hash(i * 7 + c, 303)) * K, xw = (hash(i * 5 + c, 304) * 2 - 1) * 2.7;
      const s = (cy - HY) / EYE, cx = VX + xw * s;
      const rad = (0.03 + 0.13 * a) * s, sq = (EYE * s) / F;
      const ry = Math.max(0.6, rad * sq);
      const b = (1 - a) ** 1.5 * 0.65;
      for (let r = Math.floor(cy - ry - 1); r <= Math.ceil(cy + ry + 1); r++) {
        if (r < 0 || r >= H) continue;
        for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
          if (x < 0 || x >= W) continue;
          const k = r * W + x;
          if (mat[k] !== ROAD) continue;
          const d = Math.hypot((x + 0.5 - cx) / Math.max(0.6, rad), (r + 0.5 - cy) / ry);
          const ring = Math.exp(-(((d - 1) / 0.3) ** 2)) * b + (a < 0.1 && d < 0.6 ? 0.35 : 0);
          if (ring < 0.02) continue;
          FR[k] += ring * (0.05 + RR[k] * 2.2 + GR[k] * 0.25), FG[k] += ring * (0.055 + RG[k] * 2.2 + GG[k] * 0.25), FB[k] += ring * (0.07 + RB[k] * 2.2 + GB[k] * 0.25);
        }
      }
    }

    // the rain, falling at three depths, each streak shared between the two
    // columns it falls across so the slant runs smooth
    rain.fill(0);
    for (const [x0, y0, v, len, b, sl] of drops) {
      const span = H + len + 6;
      const head = ((y0 + v * t) % span) - 3;
      for (let i = 0; i < len; i++) {
        const y = head - i;
        const r = Math.floor(y);
        if (r < 0 || r >= H) continue;
        const xf = x0 + sl * y, x = Math.floor(xf);
        if (x < 0 || x >= W - 1) continue;
        const k = r * W + x, fx = xf - x;
        const a = b * (1 - (0.7 * i) / len);
        if (a * (1 - fx) > rain[k]) rain[k] = a * (1 - fx);
        if (a * fx > rain[k + 1]) rain[k + 1] = a * fx;
      }
    }

    for (let r = 0; r < H; r++) {
      const y = r + 0.5;
      const fade = smooth(H + 8 * K, H - 6 * K, y);
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const gn = GRAIN[k];
        let cr = FR[k] * gn, cg = FG[k] * gn, cb = FB[k] * gn;
        // rain falls in front of everything, but lets the walker keep their shape
        const rn = rain[k] * (1 - 0.85 * hold[k]);
        if (rn) {
          // the drops show where light is behind or round them, and fade toward nothing in the dark
          cr += rn * (0.2 + HZR[k] * 0.6 + GR[k] * 1.6), cg += rn * (0.21 + HZG[k] * 0.6 + GG[k] * 1.6), cb += rn * (0.25 + HZB[k] * 0.6 + GB[k] * 1.6);
        }
        cr = Math.max(0, cr), cg = Math.max(0, cg), cb = Math.max(0, cb);
        dot(px, k, cr, cg, cb, FLOOR[mat[k]] * (1 - hold[k]), fade);
      }
    }
  };
}
