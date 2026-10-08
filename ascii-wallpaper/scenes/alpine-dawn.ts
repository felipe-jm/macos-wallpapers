/*
 * alpine dawn: jagged snow peaks catch the first pink light on their east
 * faces while their flanks stay in blue shadow. Mist pools along the far shore
 * and a still lake mirrors it all. The light warms toward gold as the sun
 * clears the ridge, the mist drifts, and slow ripples cross the water.
 *
 * The range is a heightfield, raymarched once from a camera just above the
 * water: each cell keeps its depth, height, sunlight (with cast shadows) and
 * snow cover, so a frame only re-tints it. The lake looks up the picture above
 * it along each cell's reflected ray. Every cell is then drawn as a halftone
 * dot: its size is its brightness, in its own colour.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "alpine dawn",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#090c18",
} satisfies Meta;

// The picture is drawn on a 320x180 grid of square cells, but laid out in the
// original 200-wide design units: S output cells to a design unit, with Y0
// design rows of extra sky above the old frame and the rest as extra lake below.
const W = 320, H = 180;
const S = 1.6;
const Y0 = 8;
const YB = H / S - Y0; // design row at the bottom edge
const XD = Float32Array.from({ length: W }, (_, x) => (x + 0.5) / S); // cell centres
const YD = Float32Array.from({ length: H }, (_, r) => (r + 0.5) / S - Y0);
const K = 0.62; // tangent of half the field of view, across the width
const HZ = 56.5; // eye level, in rows
const CAM = 1.5; // camera height above the water
const SHORE_Z = 46; // distance to the far shore
const SHORE = 62; // first row of open water
const SR = Math.round((SHORE + Y0) * S); // first output row of open water
const SUN = [151, 50];

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

// Sharp crests where plain noise crosses its middle: rock ribs and couloirs.
function ridged(x: number, y: number, octaves: number): number {
  let s = 0, n = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    const v = 1 - Math.abs(2 * noise(x * f + i * 17.3, y * f, 0) - 1);
    s += amp * v * v;
    n += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const k = clamp((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

// Peaks as pyramids, each turned a little, placed by where their summits
// should land on screen: [column, row, distance, spread, turn].
const PEAKS = [
  [66, 11, 140, 0.95, 0.3],
  [38, 26, 115, 1.1, -0.15],
  [116, 22, 175, 0.9, 0.2],
  [92, 33, 150, 1.0, 0.1],
  [96, 25, 340, 1.1, 0.4],
  [180, 38, 200, 1.5, -0.1],
  [8, 30, 160, 1.2, 0.25],
].map(([sx, row, z, f, a]) => {
  const h = CAM + ((HZ - row) / 100) * K * z - 1.5;
  return [((sx - 100) / 100) * K * z, z, h, h * f, Math.cos(a), Math.sin(a)];
});

function terrain(x: number, z: number): number {
  let h = 0;
  for (const [px, pz, ph, pr, c, s] of PEAKS) {
    const dx = x - px, dz = z - pz;
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    const v = ph * (1 - (Math.abs(rx) + Math.abs(rz)) / pr);
    if (v > h) h = v;
  }
  const hills = (1 + 3 * fbm(x * 0.04, z * 0.04, 3, 0)) * smooth(SHORE_Z, SHORE_Z + 15, z);
  if (hills > h) h = hills;
  // crags, deeper on the high ground
  h += ((ridged(x * 0.06, z * 0.06, 3) - 0.45) * 6 + (ridged(x * 0.2, z * 0.2, 2) - 0.45) * 1.6) * smooth(4, 22, h);
  return h;
}

// Distance along a ray from height `oy` with slope `v` and spread `u` to the
// terrain beyond the shore, or 0 when it reaches the sky.
function march(u: number, v: number, oy: number): number {
  let z = SHORE_Z, prev = z;
  for (let i = 0; i < 260 && z < 520; i++) {
    const gap = oy + v * z - terrain(u * z, z);
    if (gap < 0) {
      let a = prev, b = z;
      for (let j = 0; j < 7; j++) {
        const m = (a + b) / 2;
        if (oy + v * m - terrain(u * m, m) < 0) b = m;
        else a = m;
      }
      return b;
    }
    prev = z;
    z += Math.max(0.35, gap * 0.45) + z * 0.002;
  }
  return 0;
}

export default function alpineDawn(): Frame {
  const N = W * H;

  const L = (() => {
    const v = [0.9, 0.3, 0.14];
    const n = Math.hypot(...v);
    return v.map((c) => c / n);
  })();

  // --- the range, raymarched once ------------------------------------------
  const depth = new Float32Array(SR * W);
  const alt = new Float32Array(SR * W);
  const sun = new Float32Array(SR * W);
  const snow = new Float32Array(SR * W);
  const up = new Float32Array(SR * W);
  const ao = new Float32Array(SR * W); // hollows and couloirs see less sky
  const tex = new Float32Array(SR * W); // fine grain in the snow and rock
  for (let r = 0; r < SR; r++) {
    const v = ((HZ - YD[r]) / 100) * K;
    for (let x = 0; x < W; x++) {
      const u = ((XD[x] - 100) / 100) * K;
      const z = march(u, v, CAM);
      const k = r * W + x;
      if (!z) continue;
      const px = u * z, py = CAM + v * z;
      const e = 0.35;
      const hx = (terrain(px + e, z) - terrain(px - e, z)) / (2 * e);
      const hz = (terrain(px, z + e) - terrain(px, z - e)) / (2 * e);
      const nl = Math.hypot(hx, 1, hz);
      const nx = -hx / nl, ny = 1 / nl, nz = -hz / nl;
      let lit = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      if (lit > 0) {
        // cast shadow: walk toward the sun
        for (let s = 0.8; s < 160; s += 0.6 + s * 0.04) {
          const qx = px + L[0] * s, qy = py + L[1] * s + 0.15, qz = z + L[2] * s;
          if (qz < SHORE_Z) break;
          if (qy < terrain(qx, qz)) {
            lit = 0;
            break;
          }
        }
      }
      depth[k] = z;
      alt[k] = py;
      sun[k] = lit;
      up[k] = ny;
      // how far the ground dips below its surroundings, at two scales
      const h0 = terrain(px, z);
      let cav = 0;
      for (let d = 1; d <= 3; d += 2) {
        const lap = terrain(px + d, z) + terrain(px - d, z) + terrain(px, z + d) + terrain(px, z - d) - 4 * h0;
        cav += lap / d;
      }
      ao[k] = Math.max(0.45, Math.min(1.12, 1 - 0.32 * cav));
      tex[k] = fbm(px * 0.9, py * 1.3, 3, 0);
      const grain = fbm(px * 0.4, py * 0.25, 2, 0);
      // rock shows through in couloirs running down the fall line
      const gully = ridged(px * 0.22 + z * 0.05, py * 0.045, 2);
      snow[k] = smooth(0.34, 0.54, ny + 0.3 * (grain - 0.5) + 0.12 * (tex[k] - 0.5)) * smooth(5, 11, py + 5 * grain) * (1 - 0.75 * smooth(0.62, 0.85, gully));
    }
  }

  // sunlit terrain with open sky directly above: the crest line
  const rim = new Uint8Array(SR * W);
  for (let k = W; k < SR * W; k++) rim[k] = depth[k] && !depth[k - W] && sun[k] > 0 ? 1 : 0;

  // --- the far shore's treeline, in design rows ------------------------------
  const treeTop = new Float32Array(W);
  for (let x = 0; x < W; x++) treeTop[x] = SHORE - 0.6 - 1.2 * fbm((XD[x] - 0.5) * 0.06, 2.3, 2, 0);
  for (let tx = -2; tx < 202; tx += 1.6 + hash(tx * 9, 7) * 2.2) {
    const tip = SHORE - 2.6 - hash(tx * 3, 8) * 4 - 1.5 * smooth(60, 0, tx);
    const slope = 1.1 + hash(tx * 5, 9) * 0.5;
    for (let x = Math.max(0, Math.floor((tx - 6) * S)); x < Math.min(W, (tx + 6) * S); x++) {
      treeTop[x] = Math.min(treeTop[x], tip + Math.abs(XD[x] - tx) * slope);
    }
  }

  // --- the lake: where each cell's reflected ray lands in the picture above,
  // kept as a fractional output row
  const LR = H - SR;
  const src = new Float32Array(LR * W);
  for (let r = SR; r < H; r++) {
    const y = YD[r];
    const v = ((HZ - y) / 100) * K;
    for (let x = 0; x < W; x++) {
      const u = ((XD[x] - 100) / 100) * K;
      const z = march(u, -v, -CAM);
      const vs = -v - (z ? (2 * CAM) / z : 0);
      let row = HZ - (vs * 100) / K;
      const mirror = 2 * SHORE - y; // the treeline stands on the shore
      if (mirror - 0.5 >= treeTop[x]) row = mirror;
      src[(r - SR) * W + x] = (row + Y0) * S - 0.5;
    }
  }
  // how much the water mirrors on each row (Schlick's Fresnel): most of it at
  // the grazing angles by the far shore, a fifth or so at the viewer's feet
  const fres = new Float32Array(LR);
  for (let r = SR; r < H; r++) {
    const v = ((YD[r] - HZ) / 100) * K;
    const c = v / Math.hypot(1, v);
    fres[r - SR] = 0.03 + 0.97 * Math.pow(1 - c, 5);
  }

  // --- the near pines and the bank they stand on ---------------------------
  const fg = new Uint8Array(N);
  const fgShade = new Float32Array(N); // needle texture, lighter atop each tier
  const fgWarm = new Float32Array(N); // dawn light caught on the sunward edge
  const fgCool = new Float32Array(N); // sky light on the other
  const PINES = [
    [9, 5, 1.15], [20, 38, 0.85], [32, 66, 0.5],
    [192, 10, 1.15], [181, 40, 0.75], [204, 26, 1],
  ];
  const EB = YB - 100; // in the middle the lake runs on below the old frame
  for (let r = 0; r < H; r++) {
    const y = YD[r];
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      const xc = XD[x];
      const bankL = 88 + (14 + EB) * smooth(0, 52, xc) + 2 * fbm(xc * 0.2, 1, 2, 0);
      const bankR = 90 + (12 + EB) * smooth(200, 160, xc) + 2 * fbm(xc * 0.2, 4, 2, 0);
      if (y > bankL || y > bankR) {
        fg[k] = 1;
        // stones and moss along the bank, the lip of it catching the sky
        const lip = Math.exp(-(y - Math.min(bankL, bankR)) / 0.9);
        fgShade[k] = 0.35 * fbm(xc * 0.9, y * 1.4, 3, 0) + 0.15 * hash(x, r) + 0.5 * lip;
      }
      for (const [px, tip, s] of PINES) {
        const d = y - tip;
        if (d < 0) continue;
        const tier = 3.4 * s;
        const f = d / tier - Math.floor(d / tier);
        const hw = (0.4 + d * 0.2) * (0.5 + 0.5 * f) * (1 + 0.6 * (hash(Math.floor(y), Math.floor(px) * 7) - 0.5) * smooth(0, 8, d));
        const dx = xc - px;
        if (Math.abs(dx) <= hw) {
          fg[k] = 2;
          // the outline catches the dawn sky from behind: a warm rim on the side
          // facing the sun, a dim cool one on the other, fading into the crown;
          // it is light from the sky behind, so it fades out below the shore
          const edge = Math.exp(-(hw - Math.abs(dx)) / 0.42);
          const sunward = px < SUN[0] ? dx > 0 : dx < 0;
          const back = edge * smooth(72, 40, y) * (0.7 + 0.3 * hash(x, r * 7));
          fgWarm[k] = sunward ? back : 0;
          fgCool[k] = sunward ? 0 : back * 0.6;
          // branch tops hold a little sky light, their undersides none
          fgShade[k] = (0.25 + 0.75 * smooth(0.9, 0.1, f)) * (0.4 + 0.6 * hash(x * 3, r * 5)) * (0.5 + 0.5 * smooth(70, 20, y));
        }
      }
    }
  }

  // --- mist, a wrapping sheet that drifts along the valley -----------------
  // 480 design columns around, stored per output cell
  const MW = 768, M0 = 36;
  const MR0 = Math.ceil((M0 + Y0) * S - 0.5); // first output row with mist
  const MR = SR + 2 - MR0;
  const mist = new Float32Array(MW * MR);
  for (let r = 0; r < MR; r++) {
    const y = YD[r + MR0];
    for (let x = 0; x < MW; x++) {
      const xd = x / S;
      const q = fbm(xd * 0.0125, y * 0.1, 2, 6);
      mist[r * MW + x] = fbm(xd * 0.025 + q * 1.4, y * 0.22 + q, 4, 12);
    }
  }

  // --- thin high cloud, streaked and lit from below by the sun -------------
  // 640 design columns around, down to design row 34
  const CW = 1024, CR = Math.ceil((34 + Y0) * S - 0.5);
  const cloud = new Float32Array(CW * CR);
  for (let r = 0; r < CR; r++) {
    const y = YD[r];
    if (y < 4) continue;
    for (let x = 0; x < CW; x++) {
      const xd = x / S;
      const q = fbm(xd * 0.0125, y * 0.12, 2, 8);
      const c = fbm(xd * 0.025 + q * 2, y * 0.2 + q * 0.8, 4, 16);
      const fine = fbm(xd * 0.1, y * 0.5 + q, 2, 64);
      cloud[r * CW + x] = smooth(0.5, 0.74, c + 0.08 * (fine - 0.5) - 0.06 * Math.abs(y - 18) / 10) * smooth(5, 13, y) * smooth(33, 24, y);
    }
  }
  // the sun is below the cloud, so its undersides take the light and its
  // tops stay grey: how much more cloud lies above a cell than below it
  const under = new Float32Array(CW * CR);
  for (let r = 0; r < CR; r++) {
    for (let x = 0; x < CW; x++) {
      let above = 0, below = 0;
      for (let j = 1; j <= 4; j++) {
        above += r - j >= 0 ? cloud[(r - j) * CW + x] : 0;
        below += r + j < CR ? cloud[(r + j) * CW + x] : 0;
      }
      under[r * CW + x] = clamp(0.5 + (above - below) * 0.4);
    }
  }

  // a faint large-scale unevenness, so the open sky and the deep water are
  // never one flat halftone screen
  const hz = new Float32Array(N);
  for (let k = 0; k < N; k++) hz[k] = fbm((XD[k % W] - 0.5) * 0.03, (YD[Math.floor(k / W)] - 0.5) * 0.06, 3, 0);
  // and a very slight print grain in every dot
  const grain = new Float32Array(N);
  for (let k = 0; k < N; k++) grain[k] = 1 + (hash(k, 77) - 0.5) * 0.07;

  // the sky's colour at a point, for the sky itself and as haze on the peaks:
  // deep blue overhead, paling through clear blue to a rose-lilac horizon in
  // the west and a warm one under the sun. The warm part is kept as a weight
  // (skyT) so its colour can shift from salmon to amber as the light grows.
  const skyR = new Float32Array(SR * W), skyG = new Float32Array(SR * W), skyB = new Float32Array(SR * W);
  const skyT = new Float32Array(SR * W);
  const glowA = new Float32Array(SR * W);
  for (let r = 0; r < SR; r++) {
    const y = YD[r];
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      const xc = XD[x];
      const a = clamp((y + Y0) / (HZ + Y0)); // 0 at the top, 1 at eye level
      const dx = xc - SUN[0], dy = (y - SUN[1]) * 2.2;
      const ds = Math.sqrt(dx * dx + dy * dy);
      // nearness to the sun along the horizon
      const sp = Math.exp(-Math.abs(dx) / 55) * 0.85 + 0.15 * smooth(30, 180, xc);
      const mid = Math.pow(a, 2.1);
      const low = Math.pow(a, mix(6.5, 3.2, sp));
      const veil = (hz[k] - 0.5) * 0.06 * (1 - a);
      // zenith, the clear blue below it, and the cool west horizon
      const zr = 0.028, zg = 0.045, zb = 0.14;
      const mr = 0.2, mg = 0.27, mb = 0.47;
      const wr = 0.6, wg = 0.5, wb = 0.6;
      skyR[k] = zr + veil + (mr - zr) * mid + (wr * (1 - sp) - mr) * low;
      skyG[k] = zg + veil + (mg - zg) * mid + (wg * (1 - sp) - mg) * low;
      skyB[k] = zb + veil * 1.5 + (mb - zb) * mid + (wb * (1 - sp) - mb) * low;
      skyT[k] = low * sp;
      // the sun's glow, kept apart so it can breathe
      glowA[k] = Math.exp(-ds / 3.5) * 0.55 + Math.exp(-ds / 11) * 0.28 + Math.exp(-ds / 38) * 0.14;
    }
  }

  // a few stars still out in the west: single cells, as sparse as before
  const star = new Float32Array(SR * W);
  const starRate = new Float32Array(SR * W);
  const starPhase = new Float32Array(SR * W);
  for (let r = 0; r < SR; r++) {
    const y = YD[r];
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      if (y < 34 && !depth[k] && hash(x, r * 3 + 11) > 1 - 0.015 / (S * S)) {
        star[k] = smooth(150, 40, XD[x]) * smooth(34, 6, y) * (0.45 + 0.4 * hash(x * 5, r));
        starRate[k] = 1.5 + hash(x, r) * 3;
        starPhase[k] = hash(r, x) * 6.28;
      }
    }
  }

  const AR = new Float32Array(SR * W), AG = new Float32Array(SR * W), AB = new Float32Array(SR * W);
  const FR = new Float32Array(N), FG = new Float32Array(N), FB = new Float32Array(N);
  const floor = new Float32Array(N);
  const fade = new Float32Array(N).fill(1);
  const wisp = new Float32Array(W);

  return (t, px) => {
    const warm = 0.75 - 0.5 * Math.exp(-t / 60); // rose first light warming toward gold
    const line = 6 + 4 * Math.exp(-t / 70); // the sunlit line creeps down the slopes
    const drift = t * 1.1;
    const pulse = 1 + 0.06 * Math.sin((t / 8) * Math.PI * 2); // the sun's glow breathes
    for (let x = 0; x < W; x++) wisp[x] = noise((XD[x] - 0.5 + drift * 0.6) * 0.06, 3.7, 0);
    const mistShift = drift * S;
    const footShift = (drift * 1.9 + 211) * S;
    const cloudShift = t * 0.8 * S;

    // the low sun's light, from rose toward gold
    const lr = 1, lg = mix(0.54, 0.72, warm), lb = mix(0.41, 0.36, warm);
    // the horizon under the sun, from salmon toward amber
    const tr = 1.02, tg = mix(0.55, 0.66, warm), tb = mix(0.42, 0.34, warm);

    for (let r = 0; r < SR; r++) {
      const y = YD[r];
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const xc = XD[x];
        const gl = glowA[k] * pulse;
        const gc = smooth(0.08, 0.6, gl); // gold at the core, orange further out
        const st = skyT[k];
        // the air at this cell: what the sky behind gives, and what haze takes on
        const hr = skyR[k] + st * tr + gl;
        const hg = skyG[k] + st * tg + gl * mix(0.52, 0.86, gc);
        const hb = skyB[k] + st * tb + gl * mix(0.26, 0.62, gc);
        let cr = hr, cg = hg, cb = hb, fl = 0.1;
        const z = depth[k];
        if (z) {
          const sn = snow[k];
          const a = alt[k];
          const lit = sun[k] * smooth(line, line + 7, a);
          const tx = tex[k];
          const o = ao[k];
          // light from the blue dome above, less in hollows and low down
          const amb = (0.4 + 0.6 * up[k]) * o * (0.62 + 0.38 * smooth(4, 30, a));
          const kr = 0.14 * amb, kg = 0.19 * amb, kb = 0.34 * amb;
          // low sunlight: golder on the summits it has lit longest
          const gold = clamp(0.5 * smooth(0.3, 0.9, lit) + 0.5 * smooth(14, 36, a));
          const si = Math.pow(lit, 0.6) * (0.88 + 0.22 * o);
          const sr = lr * si, sg = mix(lg - 0.06, lg + 0.1, gold) * si, sb = mix(lb - 0.03, lb + 0.06, gold) * si;
          // snow, with a soft grain to it
          const sa = 0.84 + 0.18 * tx;
          // rock: a warm grey, darker in its cracks
          const ra = (0.16 + 0.22 * tx) * (0.6 + 0.4 * o);
          cr = mix((kr + sr) * ra * 1.05, (kr + sr) * sa, sn);
          cg = mix((kg + sg) * ra * 0.93, (kg + sg) * sa, sn);
          cb = mix((kb + sb) * ra * 0.85, (kb + sb) * sa, sn);
          // forested foothills: dark spruce in clumps, their tops just catching light
          const wood = smooth(9, 4, a) * smooth(110, 75, z);
          if (wood > 0) {
            const clump = 0.55 + 0.9 * tx * tx;
            cr = mix(cr, (0.035 + 0.25 * sr) * clump, wood);
            cg = mix(cg, (0.055 + 0.22 * sg) * clump, wood);
            cb = mix(cb, (0.075 + 0.12 * sb) * clump, wood);
          }
          // distance hazes toward the sky behind, and haze settles in the
          // far valleys so each ridge stands clear of the one behind it
          const fog = smooth(16, 2, a) * smooth(70, 150, z) * 0.5;
          const haze = Math.max(fog, (1 - Math.exp(-(z - SHORE_Z) / 200)) * 0.62);
          cr = mix(cr, hr, haze);
          cg = mix(cg, hg, haze);
          cb = mix(cb, hb, haze);
          // the first light catches the crest itself in a bright line
          if (rim[k] && lit > 0.15) {
            const e = smooth(0.15, 0.5, lit) * 0.55 * (1 - haze);
            cr = mix(cr, 1, e);
            cg = mix(cg, mix(0.84, 0.92, warm), e);
            cb = mix(cb, mix(0.74, 0.8, warm), e);
          }
          fl = mix(mix(0.2, 0.06, wood), 0.04, smooth(0.05, 0.3, lit));
        } else {
          if (star[k]) {
            const s = star[k] * (0.65 + 0.35 * Math.sin(t * starRate[k] + starPhase[k]));
            cr = Math.max(cr, s * 0.92);
            cg = Math.max(cg, s * 0.94);
            cb = Math.max(cb, s);
            fl = 0;
          }
          // high cloud: grey-violet tops against the deep sky, undersides lit
          // salmon to gold by the low sun, thin edges near the sun glowing
          // with the light coming through them
          if (r < CR) {
            const sx = x + cloudShift, ix = Math.floor(sx), fx = sx - ix;
            const i0 = r * CW + (ix % CW), i1 = r * CW + ((ix + 1) % CW);
            const c = (cloud[i0] + (cloud[i1] - cloud[i0]) * fx) * (0.35 + 0.65 * smooth(40, 150, xc));
            if (c > 0.005) {
              const u = under[i0] + (under[i1] - under[i0]) * fx;
              const g = Math.exp(-Math.hypot(xc - SUN[0], (y - SUN[1]) * 1.6) / 60);
              const lit = (0.18 + 0.82 * u * u) * (0.3 + 0.95 * g);
              const thin = c * (1 - c) * 4 * g * 0.45;
              const kr = 0.14 + lit * lr + thin, kg = 0.13 + lit * mix(lg - 0.12, lg, g) + thin * 0.8, kb = 0.21 + lit * (lb - 0.06) + thin * 0.55;
              const a = Math.min(0.92, c * 1.1);
              cr = mix(cr, kr, a);
              cg = mix(cg, kg, a);
              cb = mix(cb, kb, a);
              fl = 0.1;
            }
          }
          // the sun, just clearing the ridge
          const dx = xc - SUN[0], dy = y - SUN[1];
          const ds = Math.sqrt(dx * dx + dy * dy);
          if (ds < 4.5) {
            const a = smooth(4.5, 3.4, ds);
            cr = mix(cr, 1.3, a);
            cg = mix(cg, 1.15, a);
            cb = mix(cb, 0.9, a);
          }
        }
        // mist pooled in the valley behind the shore: cool and pale in the
        // shadow of the range, glowing gold where the sun shines through it
        const near = Math.exp(-Math.abs(xc - SUN[0]) / 24) * (0.5 + 0.2 * warm);
        const east = smooth(20, 190, xc);
        const mr = mix(0.5, 0.68, east) + near * lr, mg = mix(0.52, 0.56, east) + near * lg * 0.95, mb = mix(0.68, 0.6, east) + near * lb * 0.8;
        if (r >= MR0) {
          const m = mist[(r - MR0) * MW + (Math.floor(x + mistShift) % MW)];
          // a ragged top edge: the sheet heaves in long swells and small tufts
          const edge = 5 * (m - 0.5) + 4 * (wisp[x] - 0.5);
          const band = smooth(M0 + 14, SHORE - 3, y + edge);
          const a = (0.15 + 0.85 * smooth(0.36, 0.68, m)) * band * 0.58;
          // thicker parts scatter more light; the upper skin of the sheet more still
          const lift = (0.82 + 0.3 * m) * (1 + 0.15 * smooth(0.5, 0.15, band));
          cr = mix(cr, mr * lift, a);
          cg = mix(cg, mg * lift, a);
          cb = mix(cb, mb * lift, a);
          if (a > 0.05) fl = Math.max(fl, 0.14);
        }
        if (y >= treeTop[x]) {
          // the far shore's spruce, dark but softened by the mist in front
          const tc = hash(x * 7, Math.floor(r / 2)) * 0.6 + 0.4 * hz[k];
          const s = 0.5 + 0.7 * tc;
          cr = 0.03 * s + 0.04 * mr;
          cg = 0.042 * s + 0.04 * mg;
          cb = 0.055 * s + 0.04 * mb;
          // the tips against the bright sky toward the sun glow faintly
          const tip = smooth(treeTop[x] + 1.2, treeTop[x], y) * near * 0.6;
          cr += tip * lr * 0.4;
          cg += tip * lg * 0.4;
          cb += tip * lb * 0.4;
          fl = 0.02;
          // and low wisps drifting across their feet
          const m = mist[(r - MR0) * MW + (Math.floor(x * 0.7 + footShift) % MW)];
          const a = smooth(0.42, 0.72, m) * smooth(treeTop[x] + 1, SHORE, y) * 0.5;
          cr = mix(cr, mr, a);
          cg = mix(cg, mg, a);
          cb = mix(cb, mb, a);
        }
        AR[k] = cr;
        AG[k] = cg;
        AB[k] = cb;
        const gk = grain[k];
        FR[k] = cr * gk;
        FG[k] = cg * gk;
        FB[k] = cb * gk;
        floor[k] = fl;
      }
    }

    // the lake: the picture above, shaken by slow ripples and blurred the
    // more the further the light has come; Fresnel sets how much of it the
    // water gives back, and the rest is the dark water itself
    const RMAX = SR - 1.001;
    for (let r = SR; r < H; r++) {
      const y = YD[r];
      const d = (y - SHORE) / 38;
      const fd = smooth(YB + 2, YB - 22, y);
      const F = fres[r - SR];
      const blur = 0.4 + 1.5 * d;
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const xd = XD[x] - 0.5;
        const w1 = noise(xd * 0.045 + t * 0.06, y * 0.5 - t * 0.35, 0);
        const w2 = noise(xd * 0.12 - t * 0.1, y * 1.1 - t * 0.7, 0);
        const sway = (w1 - 0.5) * (0.4 + 1.4 * d) + (w2 - 0.5) * 0.5;
        const sx = Math.max(0, Math.min(W - 1.001, x + sway * S));
        const sy = src[(r - SR) * W + x] + (w2 - 0.5) * 0.6 * d * S;
        const ix = Math.floor(sx), fx = sx - ix;
        let ar = 0, ag = 0, ab = 0;
        for (let j = -1; j <= 1; j++) {
          const yy = Math.max(0, Math.min(RMAX, sy + j * blur));
          const iy = Math.floor(yy), fy = yy - iy;
          const k0 = iy * W + ix, k1 = k0 + W;
          const wt = j ? 0.25 : 0.5;
          const w00 = (1 - fx) * (1 - fy) * wt, w10 = fx * (1 - fy) * wt, w01 = (1 - fx) * fy * wt, w11 = fx * fy * wt;
          ar += AR[k0] * w00 + AR[k0 + 1] * w10 + AR[k1] * w01 + AR[k1 + 1] * w11;
          ag += AG[k0] * w00 + AG[k0 + 1] * w10 + AG[k1] * w01 + AG[k1 + 1] * w11;
          ab += AB[k0] * w00 + AB[k0 + 1] * w10 + AB[k1] * w01 + AB[k1 + 1] * w11;
        }
        const w3 = noise(xd * 0.03 + t * 0.04, y * 1.9 - t * 0.45, 0);
        // long, faint ripple lines: facets tipped toward the sky mirror more
        const lift = 1 + (w3 - 0.5) * (0.35 + 0.5 * d);
        const refl = F * lift * 0.94;
        const deep = (hz[k] - 0.5) * 0.04;
        let cr = (0.012 + deep) * (1 - F) + ar * refl;
        let cg = (0.03 + deep) * (1 - F) + ag * refl;
        let cb = (0.045 + deep * 1.4) * (1 - F) + ab * refl;
        // the sun's road: wave facets catching the low sun, sparkling as they turn
        const roadW = 1.5 + (y - SHORE) * 0.45;
        const road = Math.exp(-(((XD[x] - SUN[0]) / roadW) ** 2));
        if (road > 0.01) {
          const sp = noise(xd * 0.9 + t * 0.25, y * 3.2 - t * 1.9, 0);
          const flash = smooth(0.66, 0.94, sp);
          const glint = road * (smooth(0.55, 0.85, w2) * 0.45 + flash * flash * 1.1) * (0.5 + 0.5 * warm) * (1.1 - 0.4 * d);
          cr += glint;
          cg += glint * mix(0.72, 0.84, warm);
          cb += glint * 0.55;
        }
        const gk = grain[k];
        FR[k] = cr * gk;
        FG[k] = cg * gk;
        FB[k] = cb * gk;
        floor[k] = 0.08;
        fade[k] = fd;
        if (r === SR) {
          // a dark seam where the shore meets the water
          FR[k] *= 0.35;
          FG[k] *= 0.4;
          FB[k] *= 0.45;
          floor[k] = 0;
        }
      }
    }

    // the near pines and the bank: nearly black against it all, the sky
    // behind just showing through their outlines
    for (let k = 0; k < N; k++) {
      if (!fg[k]) continue;
      const s = fgShade[k];
      let cr = 0.012 + 0.03 * s, cg = 0.02 + 0.042 * s, cb = 0.024 + 0.05 * s;
      const w = fgWarm[k], c = fgCool[k];
      if (w > 0) {
        cr += 0.62 * w * lr;
        cg += 0.62 * w * lg * 0.85;
        cb += 0.62 * w * lb * 0.85;
      }
      if (c > 0) {
        cr += 0.22 * c;
        cg += 0.24 * c;
        cb += 0.38 * c;
      }
      FR[k] = cr;
      FG[k] = cg;
      FB[k] = cb;
      floor[k] = 0;
      fade[k] = 1;
    }

    for (let k = 0; k < N; k++) dot(px, k, FR[k], FG[k], FB[k], floor[k], fade[k]);
  };
}
