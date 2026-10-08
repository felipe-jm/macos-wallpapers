/*
 * desert night: a moonless desert under the milky way. The galaxy's bright
 * core sits low over a lone acacia on a dune crest and arches up across the
 * sky, split by its dark dust lane; a distant town warms the far horizon and
 * catches the dunes' faces. Stars twinkle, sand glints along the ridges, and
 * now and then a meteor crosses.
 *
 * The dunes are a heightfield raymarched once, keeping each cell's depth,
 * light and shadow. Each cell is one halftone dot in its own true colour,
 * sized by its brightness.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "desert night",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#04060c",
} satisfies Meta;

// The picture is designed on a 200-wide grid with the horizon at row 64; it
// is sampled at 1.6 output cells per design unit, with Y0 extra design rows of
// sky above row 0 and the rest of the 16:9 frame as more sand below.
const W = 320, H = 180;
const S = W / 200;
const Y0 = 8;
const YB = H / S - Y0; // the design row at the frame's bottom edge
const gx = (x: number) => (x + 0.5) / S; // design x at an output column's centre
const gy = (r: number) => (r + 0.5) / S - Y0; // design y at an output row's centre
const K = 0.62;
const HZ = 64; // eye level, in rows
const CAM = 6;
const HMAX = 16; // no dune is taller
const TOWN = [30, 66]; // the far glow, just under the horizon
const CORE = [152, 38]; // the galaxy's bright centre
const ARC = [50, 209.8, 199.8]; // the milky way's arch: centre and radius
const ARC_S = [-1.035, 0.8]; // its angle at the core, and the sweep to the west edge
const ACACIA = 150;

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
    s += amp * noise(x * f + i * 31.7, y * f);
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

// Where a point sits across the dunes' wave: 0 at a trough, rising gently up
// the windward side to the crest at 0.72, then dropping down the slip face.
function phase(x: number, z: number): number {
  const p = x * 0.9 + z * 0.42 + 26 * fbm(x * 0.014, z * 0.014, 3);
  const q = p / 19;
  return q - Math.floor(q);
}

// The tall dune the acacia stands on: a sharp crest that snakes toward us from
// its summit, a gentle face on the town's side and a steep one on the other.
const crestX = (z: number) => {
  const k = clamp((z - 22) / 52);
  return -4 + 26 * k * k * (3 - 2 * k) + 5 * Math.sin((z - 22) * 0.09);
};
function ridge(x: number, z: number): number {
  if (z < 8) return 0;
  const hc = z <= 74 ? 0.5 + 13 * Math.pow(clamp((z - 12) / 62), 1.25) : 13.5 * (1 - (z - 74) / 9);
  const dx = x - crestX(z);
  return hc - (dx < 0 ? -dx * 0.36 : dx * 0.8);
}

function dunes(x: number, z: number): number {
  const u = phase(x, z);
  const prof = u < 0.72 ? Math.pow(u / 0.72, 1.5) : Math.pow((1 - u) / 0.28, 0.75);
  const rg = ridge(x, z);
  // the field lies low around the big dune so its faces stay clean
  const amp = (1 + 4.5 * fbm(x * 0.008 + 5, z * 0.008, 2)) * (1 - 0.8 * smooth(-3, 3, rg));
  return Math.max(prof * amp, rg) + 0.3 * fbm(x * 0.05, z * 0.05, 2);
}

function march(u: number, v: number): number {
  let z = 3, prev = z;
  for (let i = 0; i < 300 && z < 600; i++) {
    const y = CAM + v * z;
    if (v > 0 && y > HMAX) return 0;
    const gap = y - dunes(u * z, z);
    if (gap < 0) {
      let a = prev, b = z;
      for (let j = 0; j < 7; j++) {
        const m = (a + b) / 2;
        if (CAM + v * m - dunes(u * m, m) < 0) b = m;
        else a = m;
      }
      return b;
    }
    prev = z;
    z += Math.max(0.25, gap * 0.5) + z * 0.004;
  }
  return 0;
}

export default function desertNight(): Frame {
  const N = W * H;

  const unit = (v: number[]) => {
    const n = Math.hypot(...v);
    return v.map((c) => c / n);
  };
  // the town's light comes in low from ahead and to the left
  const L = unit([-0.8, 0.32, 0.5]);
  // the galaxy's faint fill, from up and to the right
  const G = unit([0.6, 0.5, 0.4]);

  // --- the sky's own light: night glow, thick air low down, the town's dome --
  // Writes the colour into `out` and returns how much of the night's blue the
  // town's glow leaves standing there.
  const skyBase = (X: number, y: number, out: number[]): number => {
    // 0 at the horizon, 1 at the frame's top edge
    const alt = clamp((HZ - y) / (HZ + Y0));
    // a deep blue-black overhead, paler and greyer down through the thicker air
    const f = Math.exp(-alt * 3.4);
    const cr = 0.008 + 0.046 * f, cg = 0.012 + 0.054 * f, cb = 0.032 + 0.062 * f;
    // the town: sodium orange low down, thinning to a dusty beige as it spreads
    const tx = X - TOWN[0], ty = (y - TOWN[1]) * 1.9;
    const td = Math.sqrt(tx * tx + ty * ty);
    const glow = Math.exp(-td / 12) * 0.3 + Math.exp(-td / 40) * 0.15 + Math.exp(-td / 110) * 0.045;
    const hot = Math.exp(-td / 28);
    const cool = 1 - 0.75 * clamp(Math.exp(-td / 26) * 1.4);
    out[0] = cr * cool + glow;
    out[1] = cg * cool + glow * mix(0.68, 0.5, hot);
    out[2] = cb * cool + glow * mix(0.5, 0.22, hot);
    return cool;
  };

  // per-cell print grain, so no surface is a perfectly flat fill
  const grain = new Float32Array(N);
  for (let k = 0; k < N; k++) grain[k] = 1 + 0.09 * (hash(k * 7 + 1, 3) - 0.5);

  // --- the dunes, raymarched once ------------------------------------------
  const SKY = 0, SAND = 1, TREE = 2;
  const mat = new Uint8Array(N);
  const depth = new Float32Array(N);
  const sR = new Float32Array(N), sG = new Float32Array(N), sB = new Float32Array(N);
  const crest = new Float32Array(N);
  const top = new Int16Array(W).fill(H);
  const hc = [0, 0, 0];
  // the town's light is a warm sodium; the sky's a faint blue; the galaxy's a neutral starlight
  const TL = [1.0, 0.74, 0.52];
  const SL = [0.42, 0.56, 1.0];
  const GL = [0.85, 0.88, 1.0];
  for (let r = 0; r < H; r++) {
    const v = ((HZ - gy(r)) / 100) * K;
    for (let x = 0; x < W; x++) {
      const u = ((gx(x) - 100) / 100) * K;
      const z = march(u, v);
      if (!z) continue;
      const k = r * W + x;
      mat[k] = SAND;
      depth[k] = z;
      if (r < top[x]) top[x] = r;
      const px = u * z, py = CAM + v * z;
      const e = 0.2;
      const hx = (dunes(px + e, z) - dunes(px - e, z)) / (2 * e);
      const hz = (dunes(px, z + e) - dunes(px, z - e)) / (2 * e);
      const nl = Math.hypot(hx, 1, hz);
      const nx = -hx / nl, ny = 1 / nl, nz = -hz / nl;
      let lit = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      if (lit > 0) {
        // a soft shadow: how close the ray to the light passes over the sand
        let sh = 1;
        for (let s = 0.6; s < 90; s += 0.5 + s * 0.05) {
          const qx = px + L[0] * s, qy = py + L[1] * s + 0.05, qz = z + L[2] * s;
          if (qy > HMAX) break;
          sh = Math.min(sh, (qy - dunes(qx, qz)) / (0.08 * s));
          if (sh <= 0) break;
        }
        lit *= clamp(sh);
      }
      lit = Math.min(1, Math.pow(lit, 1.4) * 1.45); // faces square to the light stand out
      // brightest along the crests, shading down each face into the trough
      const ph = phase(px, z);
      const onRidge = ridge(px, z) >= dunes(px, z) - 0.35;
      const dxc = px - crestX(z);
      const fall = onRidge ? 0.5 + 0.5 * Math.exp(-Math.abs(dxc) / 7) : 0.55 + 0.45 * smooth(0.2, 0.72, ph);
      const near = 0.72 + 0.28 * smooth(5, 25, z);
      const reach = (0.55 + 0.45 * Math.exp(-Math.abs(gx(x) - 0.5 - TOWN[0]) / 90)) * fall * near * smooth(300, 120, z);
      // wind ripples on the windward slopes, running along the crests; only
      // the near ones are big enough to see, and slip faces have none
      const windward = onRidge ? smooth(-0.4, -2.5, dxc) : smooth(0.7, 0.6, ph) * smooth(0.02, 0.12, ph);
      const rAmt = windward * smooth(60, 14, z);
      let rip = 0;
      if (rAmt > 0) {
        const w = Math.sin((onRidge ? dxc * 1.2 + z * 0.15 : px * 0.9 + z * 0.42) * 10 + 7 * fbm(px * 0.22, z * 0.22, 2));
        rip = (Math.pow(0.5 + 0.5 * w, 2.2) - 0.32) * rAmt;
      }
      lit *= 1 + 0.6 * rip;
      // the sand itself: a pale ochre, redder or greyer in broad drifts, with
      // smaller patches of coarser, darker grains wind-sorted along the slopes
      const drift = fbm(px * 0.05 + 3, z * 0.05, 2) - 0.5;
      const patch = 1 + 0.24 * drift + 0.14 * (fbm(px * 0.35 + 11, z * 0.35, 2) - 0.5);
      const ar = 0.76 * (1 + 0.25 * drift) * patch, ag = 0.64 * (1 + 0.15 * drift) * patch, ab = 0.53 * patch;
      const tl = lit * reach * 0.82;
      // the sky's dome lights every slope, least down in the troughs
      const sky = (0.03 + 0.04 * ny) * (0.6 + 0.4 * fall) * near * (1 + 0.25 * rip);
      const fill = 0.06 * Math.max(0, nx * G[0] + ny * G[1] + nz * G[2]) * near;
      let cr = ar * (tl * TL[0] + sky * SL[0] + fill * GL[0]);
      let cg = ag * (tl * TL[1] + sky * SL[1] + fill * GL[1]);
      let cb = ab * (tl * TL[2] + sky * SL[2] + fill * GL[2]);
      // the big dune's shadowed brink catches a line of starlight
      if (onRidge && z < 76 && dxc > 0) {
        const cellW = z * K * 0.01;
        const rim = smooth(2.2 * cellW, 0.6 * cellW, dxc) * smooth(10, 20, z);
        cr += 0.06 * rim;
        cg += 0.075 * rim;
        cb += 0.11 * rim;
      }
      // distance thins the light into the haze, which takes the horizon's colour
      skyBase(gx(x), HZ - 0.5, hc);
      const haze = clamp(1 - Math.exp(-z / 190)) * mix(0.72, 0.95, smooth(110, 320, z));
      cr = mix(cr, hc[0] * 0.78, haze);
      cg = mix(cg, hc[1] * 0.78, haze);
      cb = mix(cb, hc[2] * 0.8, haze);
      const gr = grain[k];
      sR[k] = cr * gr;
      sG[k] = cg * gr;
      sB[k] = cb * gr;
      const big = ridge(px, z) > 0.5 && z < 76 ? smooth(0.9, 0, Math.abs(dxc)) : 0;
      crest[k] = Math.max(smooth(0.07, 0, Math.abs(ph - 0.72)) * smooth(260, 30, z), big) * (0.3 + 0.7 * smooth(0, 0.2, lit));
    }
  }

  // --- the acacia, on the crest under the galaxy's core ---------------------
  // how much of each cell the tree covers, sampled 3x3 so its edges are soft
  const leaf = new Float32Array(N);
  {
    // design row of the crest's top edge under the trunk
    const base = top[Math.floor((ACACIA + 0.5) * S)] / S - Y0;
    const canopyTop = base - 16;
    // an umbrella: a low lumpy dome on top, thinning to the tips, tufts below,
    // the foliage lacy toward its edges where the sky shows through
    const SPAN = 17;
    const canopy = (x: number, px: number, py: number) => {
      const q = (px - ACACIA) / SPAN;
      if (Math.abs(q) > 1.08) return false;
      const topY = canopyTop + 0.4 + 2.6 * q * q + 1.3 * (noise(px * 0.3, 7.1) - 0.5);
      const botY =
        canopyTop + 3.8 + 1.4 * (1 - q * q) - 1.4 * smooth(0.8, 1.08, Math.abs(q)) +
        1.2 * (noise(px * 0.45, 3.3) - 0.5) + (hash(x, 51) < 0.2 ? 0.9 : 0);
      if (py <= topY || py >= botY) return false;
      const edge = Math.max(smooth(1.1, 0, Math.min(py - topY, botY - py)), smooth(0.7, 1.05, Math.abs(q)));
      return noise(px * 1.3 + 4, py * 2.1) > 0.36 * edge;
    };
    // limbs: from the fork up and out to the canopy
    const fork: [number, number] = [ACACIA + 0.3, base - 5];
    const limbs: [[number, number], [number, number], number][] = [
      [[ACACIA, base + 1], fork, 1.3],
      [fork, [ACACIA - 9, canopyTop + 3], 0.8],
      [fork, [ACACIA + 1.5, canopyTop + 2], 0.75],
      [fork, [ACACIA + 10, canopyTop + 3.2], 0.8],
      [fork, [ACACIA - 4, canopyTop + 2.6], 0.55],
      [[ACACIA - 4, base - 9], [ACACIA - 14, canopyTop + 3.5], 0.55],
      [[ACACIA + 3, base - 8], [ACACIA + 15, canopyTop + 3.6], 0.5],
    ];
    const on = (x: number, px: number, py: number) => {
      if (canopy(x, px, py)) return true;
      for (const [[ax, ay], [bx, by], w] of limbs) {
        const lx = bx - ax, ly = by - ay;
        const t = clamp(((px - ax) * lx + (py - ay) * ly) / (lx * lx + ly * ly));
        const dx = px - (ax + lx * t), dy = py - (ay + ly * t);
        if (dx * dx + dy * dy < (w * (1 - 0.4 * t)) ** 2) return true;
      }
      return false;
    };
    const r0 = Math.max(0, Math.floor((canopyTop - 3 + Y0) * S)), r1 = Math.min(H - 1, Math.ceil((base + 2 + Y0) * S));
    const x0 = Math.max(0, Math.floor((ACACIA - 26) * S)), x1 = Math.min(W - 1, Math.ceil((ACACIA + 27) * S));
    for (let r = r0; r <= r1; r++) {
      for (let x = x0; x <= x1; x++) {
        let n = 0;
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < 3; sx++) {
            if (on(x, (x + (sx + 0.5) / 3) / S, (r + (sy + 0.5) / 3) / S - Y0)) n++;
          }
        }
        if (!n) continue;
        const k = r * W + x;
        leaf[k] = n / 9;
        if (n >= 5) mat[k] = TREE;
      }
    }
  }
  // the tree's own colour: near black, the canopy's upper edge rimmed by the
  // bulge behind it, the trunk's town side faintly warmed
  const treeK: number[] = [];
  const tR: number[] = [], tG: number[] = [], tB: number[] = [];
  for (let k = W; k < N; k++) {
    if (!leaf[k]) continue;
    const x = k % W, r = (k - x) / W;
    let rim = 0;
    if (leaf[k - W] < 0.5) {
      const dx = gx(x) - CORE[0], dy = (gy(r) - 0.5 - CORE[1]) * 1.3;
      rim = 0.25 + 0.75 * Math.exp(-Math.sqrt(dx * dx + dy * dy) / 18);
    }
    treeK.push(k);
    tR.push(0.006 + rim * 0.3);
    tG.push(0.007 + rim * 0.25);
    tB.push(0.011 + rim * 0.19);
  }

  // --- the town's lights, a few pinpricks along the far horizon -------------
  const lamps: [number, number, number, number, number, number][] = [];
  for (let x = Math.floor((TOWN[0] - 9) * S); x <= Math.ceil((TOWN[0] + 10) * S) && lamps.length < 6; x++) {
    const r = top[x];
    if (r >= H || depth[r * W + x] < 140 || hash(x, 91) > 0.4) continue;
    if (lamps.some(([k]) => Math.abs((k % W) - x) < 3)) continue;
    // sodium orange, or the whiter light of newer lamps
    const white = hash(x, 94) < 0.4;
    lamps.push([r * W + x, hash(x, 92) * 6.28, 0.7 + hash(x, 93) * 1.4, 1, white ? 0.9 : 0.7, white ? 0.74 : 0.4]);
  }

  // --- the sky: its glow, the airglow and the milky way ---------------------
  const kR = new Float32Array(N), kG = new Float32Array(N), kB = new Float32Array(N);
  const air = new Float32Array(N);
  const band = new Float32Array(N);
  const trans = new Float32Array(N); // how much light the dust lets through
  const sc = [0, 0, 0];
  // faint pink nebulae near the core: [along the band, across it, radius]
  const NEB = [[5, -3, 2.2], [10, 2.5, 1.5], [-4, 4, 1.7], [18, -1, 1.3]];
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      const X = gx(x), y = gy(r);
      const v = clamp(y / HZ);
      const cool = skyBase(X, y, sc);
      let cr = sc[0], cg = sc[1], cb = sc[2];
      // airglow: a faint green-teal sheen peaking a little above the horizon,
      // kept off the town and varied along the skyline; it drifts each frame
      const along = 0.72 + 0.5 * fbm(X * 0.025 + 3, y * 0.04, 2);
      air[k] = Math.pow(smooth(0.3, 0.94, v), 3) * (1 - 0.3 * smooth(0.92, 1.02, v)) * 0.11 * cool * along;
      // the milky way, along an arc from the core up and over to the west
      const ax = X - ARC[0], ay = y - ARC[1];
      const d = Math.sqrt(ax * ax + ay * ay) - ARC[2];
      const sRaw = (ARC_S[0] - Math.atan2(ay, ax)) / ARC_S[1]; // 0 at the core end
      const s = clamp(sRaw);
      const alongArc = sRaw * ARC_S[1] * ARC[2];
      // past the core the band narrows and fades on down toward the horizon
      const end = sRaw < 0 ? Math.exp(-((sRaw / 0.16) ** 2)) : 1;
      const laneEnd = sRaw < 0 ? Math.exp(-((sRaw / 0.12) ** 2)) : 1;
      const w = (9 + 8 * Math.pow(1 - s, 1.4)) * Math.max(0.55, 1 + sRaw * 2.2);
      const q = d / w;
      let b = Math.exp(-q * q) * 0.82 + Math.exp(-((q / 1.6) ** 2)) * 0.18;
      // star clouds: big clumps, mottling and the grain of unresolved stars
      const c1 = fbm(X * 0.045 + 17, y * 0.045, 3);
      const c2 = fbm(X * 0.13, y * 0.13, 3);
      const c3 = noise(X * 0.55 + 7, y * 0.55);
      b *= (0.1 + 1.35 * smooth(0.35, 0.75, c1)) * (0.6 + 0.8 * c2) * (0.78 + 0.44 * c3);
      // brightest toward the core, the arm thinning away from it
      b *= (0.24 + 0.9 * Math.pow(1 - s, 1.6)) * end;
      // the core's bulge, drawn out along the band
      const ce = Math.sqrt((alongArc / 1.6) ** 2 + d * d);
      const core = (Math.exp(-ce / 6) * 0.85 + Math.exp(-ce / 20) * 0.45) * (0.78 + 0.44 * c2);
      b = (b + core) * (0.82 + 0.36 * hash(x * 13 + 5, r * 7 + 1));
      // dust: the great rift down the band, a crisp cut through the bulge,
      // dark filaments and clouds across it, reddening what they let through
      const cx = X - CORE[0], cy = (y - CORE[1]) * 1.3;
      const cd = Math.sqrt(cx * cx + cy * cy);
      const nearCore = Math.exp(-cd / 16);
      const lane0 = (noise(s * 9, 3.3) - 0.5) * w * 0.5 * smooth(0, 0.25, s);
      const laneW = w * (0.1 + 0.08 * fbm(X * 0.1 + 5, y * 0.1, 2));
      const lane =
        Math.exp(-(((d - lane0) / laneW) ** 2)) *
        mix((0.5 + 0.6 * fbm(X * 0.12, y * 0.12, 3)) * (0.55 + 0.45 * (1 - s)), 1, nearCore) *
        laneEnd;
      const ridged = 1 - Math.abs(2 * fbm(X * 0.085 + 9, y * 0.085, 4) - 1);
      const fil = smooth(0.87, 0.97, ridged) * 0.6 + smooth(0.64, 0.8, fbm(X * 0.16 + 9, y * 0.16, 3)) * 0.35;
      const inB = Math.exp(-((d / (w * 1.4)) ** 2)) * end;
      const T = clamp(1 - mix(0.9, 0.96, nearCore) * lane) * (1 - clamp(fil) * inB * 0.8);
      trans[k] = T;
      band[k] = Math.exp(-((d / (w * 1.2)) ** 2)) * end + core;
      // the thick air low down dims and reddens it
      const ext = smooth(HZ + 1, HZ - 16, y);
      b *= 0.3 + 0.7 * ext;
      // warm toward the core, a cooler white along the arm
      const warm = clamp(Math.exp(-cd / 26) * 1.2 + (1 - s) * 0.25);
      const m = 0.48 + 0.25 * nearCore;
      cr += b * mix(0.8, 1.0, warm) * Math.pow(T, 0.75) * m;
      cg += b * mix(0.83, 0.86, warm) * T * m;
      cb += b * mix(0.98, 0.64, warm) * Math.pow(T, 1.35) * mix(0.75, 1, ext) * m;
      // a few faint pink nebulae sit among the star clouds by the core
      let neb = 0;
      for (const [na, nd, nr] of NEB) {
        const ex = alongArc - na, ey = d - nd;
        neb += Math.exp(-(ex * ex + ey * ey) / (nr * nr));
      }
      neb *= 0.075 * T * ext * (0.7 + 0.6 * c3);
      cr += neb;
      cg += neb * 0.28;
      cb += neb * 0.42;
      const gr = grain[k];
      kR[k] = cr * gr;
      kG[k] = cg * gr;
      kB[k] = cb * gr;
    }
  }

  // per-cell dot floor: a little grain inside the band, none in the open sky
  const floor0 = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    floor0[k] = mat[k] === SKY ? 0.07 * clamp(band[k]) : mat[k] === SAND ? 0.02 : 0;
  }

  // --- stars: thick in the band, a few bright ones everywhere ---------------
  const stars: [number, number, number[], number, number, number][] = [];
  for (let r = 0; gy(r) < HZ + 2; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      if (mat[k] !== SKY || leaf[k]) continue;
      const p = (0.016 + 0.14 * clamp(band[k])) / 1.8;
      if (hash(x * 7 + 3, r * 13 + 1) > p) continue;
      const y = gy(r);
      // near the horizon the air dims them, reddens them and sets them twinkling
      const low = smooth(HZ - 16, HZ, y);
      const m = Math.pow(hash(x * 5 + 1, r * 3 + 7), 12);
      // the dust hides most of the stars behind it
      const bright = (0.14 + 1.0 * m) * smooth(HZ + 1, HZ - 6, y) * (0.3 + 0.7 * trans[k]) * (1 - 0.4 * low);
      // hot blue-white, white, sunlike yellow, cool orange and red
      const c = hash(x * 11, r * 17 + 5);
      const tint =
        c < 0.12 ? [0.72, 0.82, 1] : c < 0.55 ? [0.95, 0.96, 1] : c < 0.82 ? [1, 0.93, 0.8] : c < 0.95 ? [1, 0.78, 0.55] : [1, 0.64, 0.44];
      tint[1] *= 1 - 0.2 * low;
      tint[2] *= 1 - 0.4 * low;
      stars.push([k, bright, tint, 1.5 + hash(x, r * 9) * 4, hash(r, x * 3) * 6.28, 0.2 + 0.35 * low]);
    }
  }

  const FR = new Float32Array(N), FG = new Float32Array(N), FB = new Float32Array(N);
  const floor = new Float32Array(N);
  const AIR0 = Math.floor((HZ * 0.3 + Y0) * S), AIR1 = Math.ceil((HZ + 2 + Y0) * S);

  // meteor 0 is already falling; meteor n starts somewhere in its 7 second slot
  const meteor = (n: number): [number, number, number, number, number, number] => {
    const start = n === 0 ? -0.35 : 7 * (n - 1) + 2.5 + hash(n, 71) * 2.5;
    const x0 = n === 0 ? 199 : 30 + hash(n, 72) * 140;
    const y0 = n === 0 ? 4 : 4 + hash(n, 73) * 18;
    // each one heads across the sky rather than straight off its nearer edge
    const a = n === 0 ? 2.65 : (x0 > 100 ? 2.6 : 0.55) + (hash(n, 75) - 0.5) * 0.4;
    return [start, x0, y0, Math.cos(a), Math.sin(a), 52 + hash(n, 76) * 30];
  };

  return (t, px) => {
    FR.set(kR);
    FG.set(kG);
    FB.set(kB);
    floor.set(floor0);
    // the airglow drifts slowly along the horizon
    for (let r = AIR0; r < AIR1; r++) {
      const ny = gy(r) * 0.08;
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        if (mat[k] !== SKY) continue;
        const a = air[k] * (0.8 + 0.4 * noise((gx(x) - 0.5 - t * 0.3) * 0.03, ny));
        FR[k] += a * 0.32;
        FG[k] += a * 0.62;
        FB[k] += a * 0.5;
      }
    }
    for (let k = 0; k < N; k++) {
      if (mat[k] !== SAND) continue;
      FR[k] = sR[k];
      FG[k] = sG[k];
      FB[k] = sB[k];
      const c = crest[k];
      if (c > 0) {
        // sand grains glinting along the brink of each slip face
        const h = hash(k, 5);
        const g = c * Math.pow(Math.max(0, Math.sin(t * (0.8 + 2.2 * h) + h * 40)), 10) * 0.42;
        FR[k] += g;
        FG[k] += g * 0.9;
        FB[k] += g * 0.82;
      }
    }
    for (const [k, b, tint, rate, ph, amp] of stars) {
      const tw = 1 - amp + amp * Math.sin(t * rate + ph) * Math.sin(t * rate * 1.7 + ph * 2);
      const s = b * tw;
      FR[k] += s * tint[0];
      FG[k] += s * tint[1];
      FB[k] += s * tint[2];
    }
    for (const [k, ph, rate, lr, lg, lb] of lamps) {
      // shimmering through the warm air above the sand, each with a small halo
      const g = 0.55 + 0.16 * Math.sin(t * rate + ph) * Math.sin(t * rate * 2.3 + ph * 3);
      FR[k] = g * lr;
      FG[k] = g * lg;
      FB[k] = g * lb;
      for (const n of [k - 1, k + 1, k - W]) {
        FR[n] += 0.1 * g * lr;
        FG[n] += 0.1 * g * lg;
        FB[n] += 0.1 * g * lb;
      }
    }
    // a meteor, if one is crossing: a green-white head, a fading blue-white trail
    const n = Math.floor((t - 2.5) / 7) + 1;
    for (let i = Math.max(0, n - 1); i <= n + 1; i++) {
      const [start, x0, y0, dx, dy, speed] = meteor(i);
      const age = t - start;
      if (age < 0 || age > 0.9) continue;
      const fadeIn = smooth(0, 0.12, age), fadeOut = smooth(0.9, 0.6, age);
      const hx = x0 + dx * speed * age, hy = y0 + dy * speed * age * 0.75;
      const len = Math.min(28, speed * age);
      const steps = len * 2 * S;
      for (let j = 0; j < steps; j++) {
        const f = j / steps;
        const px = Math.floor((hx - dx * f * len) * S), py = Math.floor((hy - dy * f * len * 0.75 + Y0) * S);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const k = py * W + px;
        if (mat[k] !== SKY) continue;
        const s = Math.pow(1 - f, 1.5) * fadeIn * fadeOut * 1.2;
        const head = smooth(0.12, 0, f);
        FR[k] = Math.max(FR[k], s * mix(0.85, 0.8, head));
        FG[k] = Math.max(FG[k], s * mix(0.92, 1, head));
        FB[k] = Math.max(FB[k], s * mix(1, 0.82, head));
      }
    }
    // the acacia over whatever is behind it, its edges letting the sky through
    for (let i = 0; i < treeK.length; i++) {
      const k = treeK[i], c = leaf[k];
      FR[k] = mix(FR[k], tR[i], c);
      FG[k] = mix(FG[k], tG[i], c);
      FB[k] = mix(FB[k], tB[i], c);
      floor[k] *= 1 - c;
    }

    for (let r = 0; r < H; r++) {
      const edge = smooth(YB + 1, YB - 12, gy(r));
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        dot(px, k, FR[k], FG[k], FB[k], floor[k], edge);
      }
    }
  };
}
