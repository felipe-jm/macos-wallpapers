/*
 * aurora fjord: curtains of aurora ripple over a fjord between snowy
 * mountains. The still water holds a broken shimmer of them, and a red cabin
 * on the far shore keeps its lamps lit.
 *
 * Shaded in colour per cell on a square grid, then drawn as a halftone: every
 * cell is a dot whose size is its brightness, in its own colour.
 * The land is built once; each frame shades the sky, then mirrors it into the
 * water.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "aurora fjord",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#05080f",
} satisfies Meta;

// The picture is designed on a 200-wide grid of square cells and sampled at
// 1.6 cells a design cell, on a 16:9 frame with sky added above.
const DW = 200; // design width
const W = 320, H = 180; // output cells
const S = W / DW; // output cells per design cell
const Y0 = 9; // design rows added above the original frame
const DH = H / S - Y0; // design y of the bottom edge
const WL = 62; // the waterline, in design rows
const OWL = Math.ceil((WL + Y0) * S - 0.5); // first output row of water

const AIR = 0, NEAR = 1, FAR = 2, SHORE = 3, WALL = 4, ROOF = 5, PANE = 6, TREE = 7, DOOR = 8;
const CAB = [142, 161]; // the cabin's walls, x from and to
const PANES = [[145, 148], [156, 159]];
const DOOR_X = [150, 152];
const LAMPS = [[147, 1], [158, 0.8]]; // pane centres and their strength

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
// a soft shoulder, so the brightest light rolls off (and whitens) instead of clipping flat
const tone = (v: number) => (v < 0.62 ? v : 0.62 + 0.4 * (1 - Math.exp(-(v - 0.62) / 0.4)));

// Ranges as tent peaks [x, height, slope], roughened.
const LEFT: [number, number, number][] = [[25, 38, 1.3], [6, 29, 0.9], [50, 25, 1.0], [72, 13, 0.6]];
const RIGHT: [number, number, number][] = [[172, 30, 1.15], [194, 24, 0.85], [151, 16, 1.0], [212, 22, 0.6]];
const DISTANT: [number, number, number][] = [[100, 10, 0.5], [119, 12, 0.55], [86, 7, 0.45], [134, 8, 0.5]];

function range(x: number, peaks: [number, number, number][], seed: number, rough: number): [number, number] {
  let m = -99, px = 0;
  for (const [cx, h, s] of peaks) {
    const v = h - Math.abs(x - cx) * s;
    if (v > m) (m = v), (px = cx);
  }
  const j = rough * (fbm(x * 0.09, seed, 3) - 0.5) + rough * 0.45 * (noise(x * 0.45, seed + 5) - 0.5);
  return [m + j * Math.min(1, Math.max(0, m) / 6), px];
}

export default function auroraFjord(): Frame {
  const N = W * H;

  // design coordinates of each cell's centre
  const XD = new Float32Array(W), YD = new Float32Array(H);
  for (let x = 0; x < W; x++) XD[x] = (x + 0.5) / S;
  for (let r = 0; r < H; r++) YD[r] = (r + 0.5) / S - Y0;
  const LAND = OWL * W;

  // The night sky by row: a deep indigo zenith easing to a paler, greener
  // blue at the horizon, where the long path through the air gathers the
  // airglow and the aurora's scattered light.
  const skyR = new Float32Array(OWL), skyG = new Float32Array(OWL), skyB = new Float32Array(OWL);
  for (let r = 0; r < OWL; r++) {
    const v = clamp((YD[r] + Y0) / (WL + Y0));
    const h = Math.pow(v, 2.4), low = Math.exp(-(WL - YD[r]) / 7);
    skyR[r] = 0.006 + 0.03 * h + 0.012 * low;
    skyG[r] = 0.011 + 0.05 * h + 0.016 * low;
    skyB[r] = 0.034 + 0.075 * h + 0.022 * low;
  }
  // the colour of the haze that lies over the far shore
  const mistR = skyR[OWL - 1] * 1.25, mistG = skyG[OWL - 1] * 1.25, mistB = skyB[OWL - 1] * 1.2;

  // --- the land, built once ------------------------------------------------
  const mat = new Uint8Array(N);
  const sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N);
  const rec = new Float32Array(N); // how much aurora light a cell picks up
  const rim = new Float32Array(N); // aurora light caught on ridgelines and treetops
  const nearTop = new Float32Array(W), farTop = new Float32Array(W), peakX = new Float32Array(W);
  for (let ox = 0; ox < W; ox++) {
    const [hl, pl] = range(XD[ox], LEFT, 3.1, 4);
    const [hr, pr] = range(XD[ox], RIGHT, 7.7, 4);
    const [hd] = range(XD[ox], DISTANT, 11.3, 2.2);
    nearTop[ox] = WL - Math.max(hl, hr, 0);
    peakX[ox] = hl > hr ? pl : pr;
    farTop[ox] = WL - Math.max(hd, 0);
  }
  const shoreTop = (x: number) => WL - 2.2 * smooth(134, 140, x) * smooth(178, 168, x) - 0.6 * noise(x * 0.3, 2);
  const cabBase = WL - 2.2;

  for (let r = 0; r < OWL; r++) {
    const y = YD[r];
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox;
      const x = XD[ox], xi = x - 0.5;
      if (y >= nearTop[ox]) {
        mat[k] = NEAR;
        const px = peakX[ox];
        const side = x - px;
        const depth = y - nearTop[ox];
        const height = WL - nearTop[ox];
        // Faces turned toward the fjord catch the aurora; the ridge between
        // the faces wanders as it comes down from the peak.
        const ridge = px + (depth + 1) * 0.6 * (noise(y * 0.1, px) - 0.5);
        const inward = px < 100 ? 1 : -1;
        const face = smooth(-4, 4, (x - ridge) * inward);
        // ribs and couloirs running down the fall line, each with a lit side
        const u = xi + depth * 0.45 * Math.sign(side || 1);
        const rib = (v: number) => fbm(v * 0.13, px * 0.37, 3);
        const grad = (rib(u + 1) - rib(u - 1)) * 7 * inward;
        // the snow reaches further down the ribs than the couloirs, in fingers
        const reach = 3 + height * (0.62 + 0.42 * rib(u + 40));
        const streak = smooth(0.56, 0.64, fbm(u * 0.32, y * 0.035 + px, 3)) * smooth(1, 5, depth);
        // bands of cliff too steep to hold snow break through it here and there
        const crag = smooth(0.55, 0.63, fbm(u * 0.2 + 7, y * 0.16 + px, 3)) * smooth(2, 6, depth);
        // a stand of spruce climbing the slope behind the cabin, jagged on top
        const cx = x - 152;
        const wood = WL - 18.5 + 9 * (cx / 19) ** 2 + 1.5 * (noise(xi * 0.7, 9) - 0.5) - 2.6 * hash(ox, 77) * ((ox & 1) ? 1 : 0.3);
        const snow = smooth(reach + 1.6, reach - 1.6, depth) * (1 - smooth(WL - 3, WL - 0.5, y)) * (1 - 0.5 * streak) * (1 - 0.75 * crag);
        const lit = clamp(0.35 + 0.55 * face + grad * 0.5);
        // dark blue-grey rock, a little lighter on the lit faces, never flat
        const rv = 0.65 + 0.7 * fbm(xi * 0.4, y * 0.4, 3);
        const rr = (0.028 + 0.025 * lit) * rv, rg = (0.036 + 0.03 * lit) * rv, rb = (0.058 + 0.04 * lit) * rv;
        // snow: blue in the starlight, wind-carved, darker in the shadowed faces
        const tex = 0.84 + 0.32 * fbm(xi * 0.9, y * 1.7, 2);
        const s = (0.12 + 0.88 * lit * lit) * tex;
        // the mountains lose contrast toward their feet, in the fjord's haze
        const hz = 0.45 * smooth(WL - 16, WL, y);
        sr[k] = mix(mix(rr, 0.35 * s + 0.025, snow), mistR, hz);
        sg[k] = mix(mix(rg, 0.4 * s + 0.033, snow), mistG, hz);
        sb[k] = mix(mix(rb, 0.49 * s + 0.05, snow), mistB, hz);
        rec[k] = snow * (0.2 + 0.8 * lit) + 0.05;
        rim[k] = smooth(2.2, 0.3, depth) * 0.5;
        if (y > wood && cx > -14 - 2 * hash(r, 3) && cx < 13 + 2 * hash(r, 4)) {
          mat[k] = TREE;
          const h = hash(ox * 13 + r, 5);
          sr[k] = 0.012 + 0.016 * h, sg[k] = 0.022 + 0.022 * h, sb[k] = 0.028 + 0.02 * h;
          // snow lying on the branches
          if (hash(ox, r * 7 + 3) > 0.86) (sr[k] += 0.05 * h + 0.03), (sg[k] += 0.06 * h + 0.035), (sb[k] += 0.08 * h + 0.05);
          rec[k] = 0.05;
          rim[k] = smooth(wood + 1.6, wood + 0.2, y) * (0.7 + 0.3 * h);
        }
      } else if (y >= farTop[ox]) {
        mat[k] = FAR;
        // the far range, seen through miles of air: pale, flat and bluish,
        // sinking into the horizon's haze toward its foot
        const depth = y - farTop[ox];
        const snow = smooth(0.5, 0.62, fbm(xi * 0.18, y * 0.25, 3) * 0.6 + (1 - depth / 7) * 0.55);
        const lit = 0.5 + 0.3 * (noise(xi * 0.25, y * 0.1) - 0.5);
        const hz = 0.35 + 0.35 * smooth(WL - 10, WL, y);
        sr[k] = mix(mix(0.045, 0.16 * lit + 0.07, snow), mistR, hz);
        sg[k] = mix(mix(0.06, 0.2 * lit + 0.09, snow), mistG, hz);
        sb[k] = mix(mix(0.1, 0.28 * lit + 0.15, snow), mistB, hz);
        rec[k] = 0.15 + 0.25 * snow;
      }
      // the shelf the cabin stands on, snowed over
      if (x >= 133 && x < 180 && y >= shoreTop(xi)) {
        mat[k] = SHORE;
        const f = 0.6 + 0.35 * fbm(xi * 0.3, y * 0.5, 3);
        sr[k] = 0.14 * f, sg[k] = 0.165 * f, sb[k] = 0.24 * f;
        rec[k] = 0.4;
        rim[k] = 0;
      }
    }
  }

  // a spruce treeline along the foot of both ranges, open where the fjord runs in
  const spruce = (tx: number, th: number, tw: number, tb: number, guard: ((k: number) => boolean) | null) => {
    const x0 = Math.max(0, Math.floor((tx - tw - 1) * S)), x1 = Math.min(W - 1, Math.ceil((tx + tw + 1) * S));
    for (let r = Math.max(0, Math.floor((tb - th + Y0) * S - 1)); r < OWL; r++) {
      const y = YD[r], dy = y - (tb - th);
      if (dy < 0 || y >= tb + 0.5) continue;
      const tier = (dy + th * 0.3) / 1.8;
      const w = (dy / th) * tw * (0.7 + 0.45 * (tier - Math.floor(tier))) + 0.35;
      for (let ox = x0; ox <= x1; ox++) {
        const k = r * W + ox;
        const ex = XD[ox] - tx;
        if (Math.abs(ex) > w || (guard && guard(k))) continue;
        mat[k] = TREE;
        const h = hash(ox * 13 + r, 5);
        const s = ex < 0 ? 0.7 : 0.3; // the aurora is up and left
        sr[k] = 0.01 + 0.02 * s * h, sg[k] = 0.02 + 0.03 * s * (0.5 + h), sb[k] = 0.026 + 0.028 * s;
        // snow caught on the tips of the tiers, more on the lit side
        if (tier - Math.floor(tier) > 0.72 && hash(ox, r * 5 + 11) > (ex < 0 ? 0.45 : 0.8)) {
          const q = 0.6 + 0.4 * h;
          sr[k] += 0.08 * q * s, sg[k] += 0.1 * q * s, sb[k] += 0.14 * q * s;
        }
        rec[k] = 0.05;
        rim[k] = Math.max(smooth(1.6, 0.2, dy), ex < 0 && ex < -w + 0.8 ? 0.45 * smooth(th, 0, dy) : 0);
      }
    }
  };
  const solid = (k: number) => mat[k] === WALL || mat[k] === ROOF || mat[k] === PANE || mat[k] === DOOR || mat[k] === SHORE;
  for (let x = -1; x < DW + 2; ) {
    const h = hash(Math.floor(x * 7), 21);
    const open = smooth(96, 80, x) + smooth(122, 136, x);
    const onShelf = x > 132 && x < 180;
    if (open > 0.05 && !(x > 136 && x < 166)) {
      const th = (3.2 + hash(Math.floor(x * 3), 5) * 3 + (hash(Math.floor(x * 5), 8) > 0.7 ? 2.4 : 0)) * Math.min(1, open) * (onShelf ? 0.7 : 1);
      if (th > 1.5) spruce(x + hash(Math.floor(x), 2), th, 1 + hash(Math.floor(x), 4) * 0.6, onShelf ? shoreTop(x) - 0.4 : WL + 0.3, onShelf ? solid : null);
    }
    x += 2 + 2.2 * h;
  }

  // The cabin: falu-red boards, a snowed roof, two warm panes, a door, a chimney.
  const eave = cabBase - 7;
  const roofTop = eave - 8;
  const CHIM = CAB[1] - 5, CHIM_TOP = eave - 8.5;
  const cabX0 = Math.floor((CAB[0] - 3) * S), cabX1 = Math.ceil((CAB[1] + 4) * S);
  const cx = (CAB[0] + CAB[1] + 1) / 2;
  const paneV = new Float32Array(LAND); // how bright each cell of a pane glows
  const paneY0 = eave + 1.5, paneY1 = cabBase - 2;
  for (let r = 0; r < OWL; r++) {
    const y = YD[r];
    for (let ox = cabX0; ox <= cabX1; ox++) {
      const k = r * W + ox;
      const x = XD[ox];
      if (x >= CAB[0] && x < CAB[1] + 1 && y >= eave && y < cabBase + 0.5) {
        mat[k] = WALL;
        const boards = r & 1 ? 0.86 : 1;
        // in shadow under the eaves, weathered along the boards
        const ao = 0.5 + 0.5 * smooth(eave, eave + 2.5, y);
        const wv = 0.85 + 0.3 * fbm(x * 0.6, r * 2.1, 2);
        const s = (0.55 + 0.45 * ((CAB[1] + 0.5 - x) / (CAB[1] - CAB[0]))) * boards * ao * wv;
        sr[k] = 0.3 * s, sg[k] = 0.07 * s, sb[k] = 0.055 * s;
        rec[k] = 0.04;
        rim[k] = 0;
        for (const [a, b] of PANES) {
          if (x >= a && x < b + 1 && y >= paneY0 && y < paneY1) {
            mat[k] = PANE;
            // a lamp low in the room: brighter toward the sill, with a dim
            // cross of glazing bars and a slightly shaded frame
            const mx = Math.abs(x - (a + b + 1) / 2), my = Math.abs(y - (paneY0 + paneY1) / 2);
            const bars = mx < 0.35 || my < 0.3 ? 0.5 : 1;
            const frame = smooth(0.2, 0.9, Math.min(x - a, b + 1 - x, y - paneY0, paneY1 - y));
            paneV[k] = (0.72 + 0.28 * smooth(paneY0, paneY1, y)) * bars * (0.75 + 0.25 * frame) * (0.94 + 0.12 * hash(ox, r + 61));
          }
        }
        if (x >= DOOR_X[0] && x < DOOR_X[1] + 1 && y >= eave + 1.5) {
          mat[k] = DOOR;
          sr[k] = 0.075, sg[k] = 0.03, sb[k] = 0.025;
        }
        // snow banked against the foot of the wall
        if (y > cabBase - 0.6 - 0.8 * noise(x * 0.8, 13)) {
          mat[k] = SHORE;
          const f = 0.7 + 0.3 * hash(ox, r + 17);
          sr[k] = 0.17 * f, sg[k] = 0.2 * f, sb[k] = 0.28 * f;
          rec[k] = 0.3;
        }
      }
      const half = 12.5 - (eave - y) * 1.45;
      if (y >= roofTop && y < eave && Math.abs(x - cx) <= half) {
        mat[k] = ROOF;
        const snowy = y < eave - 1;
        // the slope away from the aurora a shade darker, and the snow uneven
        const s = (0.72 + 0.28 * ((cx - x) / 12)) * (0.9 + 0.2 * fbm(x * 0.7, y * 1.3, 2));
        if (snowy) (sr[k] = 0.42 * s), (sg[k] = 0.47 * s), (sb[k] = 0.6 * s);
        else (sr[k] = 0.06), (sg[k] = 0.025), (sb[k] = 0.03);
        rec[k] = snowy ? 0.5 : 0;
        rim[k] = 0;
      }
      if (x >= CHIM && x < CHIM + 2 && y >= CHIM_TOP && y < eave - 4) {
        mat[k] = WALL;
        const s = x < CHIM + 1 ? 1 : 0.55;
        sr[k] = 0.1 * s, sg[k] = 0.1 * s, sb[k] = 0.12 * s;
        if (y < CHIM_TOP + 0.6) (sr[k] = 0.3), (sg[k] = 0.34), (sb[k] = 0.44); // a cap of snow
        rim[k] = 0;
      }
    }
  }
  // the lit crack of the door: its rightmost column of cells
  let crackX = 0;
  for (let ox = 0; ox < W; ox++) if (XD[ox] < DOOR_X[1] + 1) crackX = ox;

  // a few spruce on the shelf, beside the cabin
  for (const [tx, th] of [[134, 7], [137.8, 10], [166.5, 9], [170, 6], [174.5, 8]]) {
    spruce(tx, th, 2.2, shoreTop(tx) + 0.5, (k) => mat[k] === WALL || mat[k] === ROOF || mat[k] === PANE || mat[k] === DOOR);
  }

  // a faint grain over the land, like the print of a real halftone
  for (let k = 0; k < LAND; k++) {
    if (mat[k] === AIR || mat[k] === PANE) continue;
    const g = 0.93 + 0.14 * hash(k, 919);
    sr[k] *= g, sg[k] *= g, sb[k] *= g;
  }

  // the warm light the panes throw on the snow and the air around them
  const lampLand = new Float32Array(LAND);
  for (let r = 0; r < OWL; r++) {
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox, m = mat[k];
      if (m === PANE || m === WALL || m === ROOF || m === DOOR) continue;
      let g = 0;
      for (const [lx, s] of LAMPS) {
        const wx = XD[ox] - lx, wy = YD[r] - (cabBase - 2.5);
        const d2 = wx * wx * 0.6 + wy * wy * 2.2;
        // a tight halo in the cold air, and a wider falloff on the snow
        g += s * (Math.exp(-Math.sqrt(d2) / 3.6) * 0.55 + 0.1 / (1 + d2 * 0.12));
      }
      lampLand[k] = g * (m === AIR ? 0.22 : m === TREE ? 0.3 : 0.35 + 0.25 * hash(ox, r + 31));
    }
  }

  // the sky's unevenness and its stars, single fine points of many brightnesses
  // and temperatures, dimmed by the thick air toward the horizon
  const haze = new Float32Array(LAND);
  const starR = new Float32Array(LAND), starG = new Float32Array(LAND), starB = new Float32Array(LAND);
  const starTw = new Float32Array(LAND);
  for (let r = 0; r < OWL; r++) {
    const ext = smooth(WL - 2, 26, YD[r]);
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox;
      haze[k] = 0.88 + 0.24 * fbm((XD[ox] - 0.5) * 0.04, (YD[r] - 0.5) * 0.07, 3);
      const h = hash(ox, r + 101);
      if (h > 0.984 && mat[k] === AIR) {
        const m = (h - 0.984) / 0.016;
        const s = (0.05 + 0.85 * m * m * m) * ext;
        const c = hash(r, ox + 7);
        const [tr, tg, tb] = c < 0.15 ? [1, 0.8, 0.6] : c < 0.45 ? [1, 0.95, 0.88] : c < 0.85 ? [0.9, 0.94, 1] : [0.75, 0.85, 1];
        starR[k] = s * tr, starG[k] = s * tg, starB[k] = s * tb;
        starTw[k] = 1.3 + 3 * hash(ox, r);
      }
    }
  }
  // rows of the water that break the reflection into strips
  const gap = new Uint8Array(H);
  for (let r = OWL; r < H; r++) gap[r] = hash(r, 404) < 0.3 ? 1 : 0;

  // per-column aurora state, filled each frame
  const baseA = new Float32Array(W), tallA = new Float32Array(W), envA = new Float32Array(W);
  const baseB = new Float32Array(W), envB = new Float32Array(W);
  const RAYS = 4 * DW;
  const raysA = new Float32Array(RAYS + 2), raysB = new Float32Array(RAYS + 2), raysF = new Float32Array(RAYS + 2);
  const R = new Float32Array(LAND), G = new Float32Array(LAND), B = new Float32Array(LAND);
  const lightX = new Float32Array(W); // the aurora's light falling on the land below
  const LX_OFF = [-24, -18, -12, -6, 0, 6, 12, 18, 24].map((d) => Math.round(d * S));

  const ray = (arr: Float32Array, u: number) => {
    const s = u * 4;
    let i = Math.floor(s);
    const f = s - i;
    i = ((i % RAYS) + RAYS) % RAYS;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  };

  return (t, px) => {
    // --- the curtains -------------------------------------------------------
    for (let ox = 0; ox < W; ox++) {
      const x = XD[ox] - 0.5;
      const u = x / DW;
      // the main curtain sweeps down from the upper left, low over the fjord,
      // and lifts again to the right; ripples travel along it and fold it
      baseA[ox] = 5 + 40 * Math.pow(Math.sin(Math.min(1, Math.max(0, u) / 0.6) * Math.PI / 2), 1.5) - 13 * smooth(0.6, 0.95, u)
        + 2.6 * Math.sin(x * 0.07 - t * 0.55) + 1.4 * Math.sin(x * 0.17 + t * 0.9 + 1.3) + 2.2 * Math.sin(x * 0.22 + t * 1.2)
        + 4 * (fbm(x * 0.015 + t * 0.03, 4.2, 2) - 0.5);
      tallA[ox] = 11 + 8 * fbm(x * 0.03 - t * 0.05, 1.7, 2);
      envA[ox] = smooth(0.0, 0.2, u) * smooth(0.98, 0.72, u) * (0.4 + 0.8 * fbm(x * 0.022 - t * 0.07, 8.8, 3));
      // a fainter curtain behind, higher up, on the right
      baseB[ox] = 14 + 4 * Math.sin(x * 0.035 + t * 0.3 + 2) + 1.6 * Math.sin(x * 0.11 - t * 0.7);
      envB[ox] = smooth(0.45, 0.7, u) * smooth(1.05, 0.85, u) * (0.25 + 0.5 * fbm(x * 0.03 + t * 0.05, 3.3, 2));
    }
    for (let i = 0; i <= RAYS + 1; i++) {
      const u = i / 4;
      raysA[i] = 0.14 + Math.pow(fbm(u * 0.6 + t * 0.35, t * 0.12, 3), 2.4) * 2.5;
      raysB[i] = 0.1 + Math.pow(fbm(u * 0.45 - t * 0.2, 5 + t * 0.1, 3), 2.2) * 2.0;
      // fine striations within the rays, drifting faster
      raysF[i] = noise(u * 2.3 - t * 0.6, 9 + t * 0.4);
    }
    for (let ox = 0; ox < W; ox++) {
      let s = 0;
      for (const d of LX_OFF) {
        const xx = Math.min(W - 1, Math.max(0, ox + d));
        s += envA[xx] + 0.4 * envB[xx];
      }
      lightX[ox] = s / 9;
    }
    const flick = 0.93 + 0.04 * Math.sin(t * 2.3) + 0.03 * Math.sin(t * 7.1);

    // --- sky and land ---------------------------------------------------------
    for (let r = 0; r < OWL; r++) {
      const y = YD[r];
      const fadeB = smooth(-Y0, 8 - Y0, y); // curtain B thins out toward the top of the frame
      const low = Math.exp(-(WL - y) / 10);
      // a thin mist lying on the water along the far shore
      const mistK = 0.3 * Math.exp(-(WL - y) / 1.6);
      for (let ox = 0; ox < W; ox++) {
        const k = r * W + ox;
        const m = mat[k];
        const x = XD[ox] - 0.5;
        let cr: number, cg: number, cb: number;
        if (m === AIR) {
          const hz = haze[k];
          cr = skyR[r] * hz, cg = skyG[r] * hz, cb = skyB[r] * hz;
          // curtain A: a bright lower hem, rays rising out of it, fading from
          // oxygen green into the thin red-violet of the upper air
          let a = 0;
          const d = baseA[ox] - y;
          if (d > -5 && d < 64) {
            const bend = Math.abs(baseA[Math.min(W - 1, ox + 1)] - baseA[Math.max(0, ox - 1)]) * S;
            const hc = tallA[ox];
            const xs = x + d * 0.22;
            const lean = ray(raysA, xs) * (0.7 + 0.6 * ray(raysF, xs));
            const prof = d < 0 ? Math.exp(-d * d * 0.7) : (1 - Math.exp(-(d + 0.5) * 1.0)) * Math.exp(-d / hc);
            // the rays, over a continuous bright band along the hem
            const band = d < 0 ? Math.exp(-d * d * 0.8) : Math.exp(-d / 3.2);
            a = (prof * lean + 0.3 * band * (0.55 + 0.45 * Math.min(1.4, lean))) * envA[ox] * (1.1 + 0.35 * bend);
            const up = clamp(d / (hc * 1.6));
            const gk = 1 - smooth(0, 0.5, up), vk = smooth(0.35, 0.95, up);
            const tk = 1 - gk - vk;
            cr += a * (0.36 * gk + 0.14 * tk + 0.46 * vk);
            cg += a * (1.0 * gk + 0.8 * tk + 0.14 * vk);
            cb += a * (0.5 * gk + 0.55 * tk + 0.34 * vk);
            // a faint pink fringe just under the hem where it is brightest
            const hem = Math.exp(-((d + 1.1) ** 2) * 1.1) * smooth(0.3, 0.9, a) * 0.32 * (0.45 + 0.55 * Math.min(1, lean));
            cr += hem * 0.95, cg += hem * 0.12, cb += hem * 0.5;
          }
          // curtain B, further away
          const db = baseB[ox] - y;
          if (db > -3 && db < 30) {
            const prof = db < 0 ? Math.exp(-db * db * 0.8) : (1 - Math.exp(-(db + 0.4))) * Math.exp(-db / 9);
            const b = prof * ray(raysB, x + db * 0.18) * envB[ox] * 0.75 * fadeB;
            const up = clamp(db / 12);
            cr += b * (0.2 + 0.32 * up);
            cg += b * (0.82 - 0.62 * up);
            cb += b * (0.5 + 0.05 * up);
            a += b;
          }
          // the curtain's light scattered in the air round it: a tight glow
          // under the hem, a broad one behind the rays
          const below = y - baseA[ox];
          const gl = envA[ox] * (below > 0 ? Math.exp(-below / 6) * 0.06 + Math.exp(-below / 20) * 0.015 : Math.exp(below / 10) * 0.12);
          cr += gl * 0.2, cg += gl * 0.62, cb += gl * 0.45;
          // airglow on the horizon, stronger under the aurora
          const ag = low * (0.035 + 0.08 * lightX[ox]);
          cr += ag * 0.24, cg += ag * 0.7, cb += ag * 0.6;
          // the stars shine through the thin aurora
          const sR = starR[k];
          if (sR > 0) {
            const tw = 0.7 + 0.3 * Math.sin(t * starTw[k] + 6.28 * hash(r, ox));
            const s = tw * (1 - 0.6 * clamp(a));
            cr += sR * s, cg += starG[k] * s, cb += starB[k] * s;
          }
        } else {
          cr = sr[k], cg = sg[k], cb = sb[k];
          const L = lightX[ox] * rec[k];
          cr += L * 0.05, cg += L * 0.15, cb += L * 0.07;
          const e = rim[k];
          if (e > 0) {
            const q = e * (m === TREE ? 0.12 + 0.35 * lightX[ox] : 0.04 + 0.18 * lightX[ox]);
            cr += q * 0.3, cg += q * 0.9, cb += q * 0.65;
          }
          if (m === PANE) {
            const f = (flick + 0.04 * Math.sin(t * 5.3 + Math.floor(XD[ox]))) * paneV[k];
            cr = 1.05 * f, cg = 0.72 * f, cb = 0.36 * f;
          } else if (m === DOOR) {
            // light through the crack of the door
            if (ox === crackX && y > eave + 1.5) (cr = 0.6 * flick), (cg = 0.38 * flick), (cb = 0.15 * flick);
          }
        }
        if (mistK > 0.02 && m !== PANE && m !== TREE) {
          const mk = mistK * (0.45 + 0.55 * noise(x * 0.06 - t * 0.04, y * 0.4 + t * 0.01));
          const ml = 1 + 0.6 * lightX[ox];
          cr = mix(cr, mistR * ml, mk), cg = mix(cg, (mistG + 0.012 * lightX[ox]) * ml, mk), cb = mix(cb, mistB * ml, mk);
        }
        const lg = lampLand[k] * flick;
        if (lg > 0) cr += lg, cg += lg * 0.6, cb += lg * 0.27;
        R[k] = cr, G[k] = cg, B[k] = cb;
      }
    }

    const span = DH - WL;
    for (let r = 0; r < H; r++) {
      const y = YD[r];
      let floor = 0.06, fade = 1;
      const dw = y - WL;
      // Fresnel: the water is a near-perfect mirror at the far shore and,
      // looked into more steeply near us, mostly shows its own dark depth
      const near = clamp(dw / span);
      const fres = mix(0.78, 0.18, Math.pow(near, 0.75));
      // the mirror row, and rows above it blurred in, more so close by where
      // the ripples are larger
      const ry = OWL - 1 - (r - OWL);
      const o1 = Math.round(1 + dw * 0.1), o2 = Math.round(2 + dw * 0.22);
      const r0 = Math.max(0, ry) * W, r1 = Math.max(0, ry - o1) * W, r2 = Math.max(0, ry - o2) * W;
      const rd = y - 0.5;
      for (let ox = 0; ox < W; ox++) {
        const k = r * W + ox;
        let cr: number, cg: number, cb: number;
        if (r < OWL) {
          cr = R[k], cg = G[k], cb = B[k];
          const m = mat[k];
          floor = m === AIR ? 0.06 : m === NEAR ? 0.05 : m === TREE ? 0.035 : 0.05;
        } else {
          const x = XD[ox] - 0.5;
          // still water: the mirror image, stretched and broken by slow ripples
          const wave = noise(x * 0.04 + t * 0.05, rd * 0.55 - t * 0.35);
          const sx = ox + S * (0.5 + dw * 0.12) * Math.sin(rd * 1.3 + t * 1.6 + wave * 4);
          let ix = Math.floor(sx);
          const fx = sx - ix;
          ix = Math.max(0, Math.min(W - 2, ix));
          const a0 = r0 + ix, a1 = r1 + ix, a2 = r2 + ix;
          const ms = mat[a0];
          const sky = ms === AIR;
          let kr = fres * (0.85 + 0.3 * wave);
          // patches of catspaw ripple turn up the darker sky overhead
          if (sky && gap[r]) kr *= mix(1, 0.3, smooth(0.5, 0.38, wave));
          // the cabin's own image is soft; the lamplight road below carries it
          if (ms === PANE) kr *= 0.45;
          else if (ms === WALL || ms === ROOF || ms === DOOR) kr *= 0.75;
          const gx = 1 - fx;
          cr = ((R[a0] * gx + R[a0 + 1] * fx) * 0.5 + (R[a1] * gx + R[a1 + 1] * fx) * 0.3 + (R[a2] * gx + R[a2 + 1] * fx) * 0.2) * kr;
          cg = ((G[a0] * gx + G[a0 + 1] * fx) * 0.5 + (G[a1] * gx + G[a1 + 1] * fx) * 0.3 + (G[a2] * gx + G[a2 + 1] * fx) * 0.2) * kr;
          cb = ((B[a0] * gx + B[a0 + 1] * fx) * 0.5 + (B[a1] * gx + B[a1 + 1] * fx) * 0.3 + (B[a2] * gx + B[a2 + 1] * fx) * 0.2) * kr;
          // glints: ripple faces tilted to catch the bright curtain sparkle
          if (sky) {
            const sp = noise(x * 0.9 + t * 0.4, rd * 2.6 - t * 1.3);
            const g = sp > 0.72 ? (sp - 0.72) * 6 * (0.3 + 0.7 * near) : 0;
            cr *= 1 + g, cg *= 1 + g, cb *= 1 + g;
          }
          // the water's own dark, cold depth
          const deep = 1 - fres;
          cr += 0.006 * deep, cg += 0.014 * deep, cb += 0.026 * deep;
          // a faint pale line where the water laps the shore
          if (r === OWL) {
            const e = 0.07 * (0.3 + 0.7 * smooth(0.25, 0.75, noise(x * 0.3, t * 0.4)));
            cr += e * 0.7, cg += e * 0.85, cb += e;
          }
          // the lamplight laid on the water as a broken golden road
          if (dw < 14 && x > 138 && x < 166) {
            const rip = noise(x * 0.5 - t * 0.2, rd * 1.4 - t * 1.5);
            for (const [lx, s] of LAMPS) {
              const lw = 1 + dw * 0.1;
              const q = (x + 0.5 - lx) / lw;
              const g = Math.exp(-q * q) * Math.exp(-dw / 8) * smooth(0.3, 0.65, rip) * s * 1.5 * flick;
              cr += g, cg += g * 0.64, cb += g * 0.28;
            }
          }
          floor = sky ? 0.035 + 0.03 * (1 - near) : 0.03;
          fade = smooth(DH + 3, DH - 12, y);
        }
        dot(px, k, tone(cr), tone(cg), tone(cb), floor, fade);
      }
    }
  };
}
