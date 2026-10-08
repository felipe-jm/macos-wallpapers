/*
 * misty forest: morning in a pine forest. Ridge after ridge of pines recedes
 * into fog, each paler than the one in front, with mist lying in sheets in the
 * valleys between them. A low sun sits behind the farthest trees and sends
 * beams slanting down through the fog to a clearing on the forest floor. The
 * fog drifts, the beams shimmer, and motes of dust float in the light.
 *
 * Every cell is shaded in colour, layer by layer with the haze of its depth,
 * then drawn as a halftone: every cell is a dot whose size is its brightness,
 * in its own colour.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "misty forest",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#090f0e",
} satisfies Meta;

// The picture is designed on a 200 x 100 grid (all positions, sizes and
// noise scales below are in those units) and sampled on a finer 320 x 180
// grid: 1.6 cells per design unit, with 7 design rows of sky added above and
// 5.5 rows of forest floor below to fill the 16:9 frame.
const W = 320, H = 180;
const S = 1.6, Y0 = 7;
const DW = 200, YB = H / S - Y0; // design width, and the design row at the bottom
const XD = Float32Array.from({ length: W }, (_, x) => (x + 0.5) / S);
const YD = Float32Array.from({ length: H }, (_, r) => (r + 0.5) / S - Y0);
const SUN: [number, number] = [146, 45.5];
const SUN_R = 3.4;
const SKY = -1, FLOOR = 5, GIANT = 6;

function hash(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, period: number) {
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

function fbm(x: number, y: number, octaves: number, period: number) {
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

// The ridges, far to near: [ridge row, its rise and fall, tree spacing, tree
// heights from and to, haze, how fast its fog drifts, mist lying in the
// valley below it, drifting fog in front of it, sunbeam in front of it]
const LAYERS = [
  [50, 6, 1.6, 1, 2.5, 0.62, 0.8, 1, 0.14, 0.6],
  [59, 6, 2, 3, 5.5, 0.42, 1.3, 0.8, 0.16, 0.8],
  [69, 7, 2.6, 4, 7, 0.22, 2, 0.66, 0.18, 0.9],
  [80, 6, 3.4, 5, 9, 0.07, 2.8, 0.44, 0.14, 1],
  [90, 1.5, 10, 9, 24, 0.03, 3.4, 0, 0.08, 0.6],
];
const NEAR = LAYERS.length - 1;

export default function mistyForest(): Frame {
  const N = W * H;

  // the colour of the fog: a cool blue-grey in the shade of the morning,
  // warming to gold-cream where it scatters the sun toward us
  const fogR = (s: number) => mix(0.6, 0.96, s), fogG = (s: number) => mix(0.635, 0.8, s), fogB = (s: number) => mix(0.66, 0.58, s);

  // output rows spanning design rows [a, b)
  const rowFrom = (a: number) => Math.max(0, Math.floor((a + Y0) * S));
  const rowTo = (b: number) => Math.min(H, Math.ceil((b + Y0) * S));

  // --- the layers, rasterised far to near so nearer ones cover farther -----
  const layer = new Int8Array(N).fill(SKY);
  const edge = new Float32Array(N); // how much a cell sits on a silhouette's sunward rim
  const below = new Float32Array(N); // design rows below the layer's tree line
  const tex = new Float32Array(N); // the lower edge of a tier of boughs, near trees only
  const ground = new Float32Array(N); // the row a cell's ridge rises from, for its valley mist
  LAYERS.forEach(([Y, amp, gap, h0, h1], i) => {
    // nearer ridges dip toward the sun, a valley opening onto the light
    const ridge = (x: number) => Y + amp * (fbm(x * (0.018 + i * 0.003), i * 13 + 2, 3, 0) - 0.5) * (i < 3 ? 4 : 3) + (i > 0 && i < NEAR ? (2 + i * 2) * Math.exp(-(((x - SUN[0] - 4) / 38) ** 2)) : 0);
    const base = Float32Array.from({ length: W }, (_, x) => ridge(XD[x]));
    const fill = new Uint8Array(N);
    const spire = new Uint8Array(N);
    for (let x = 0; x < W; x++) for (let r = rowFrom(base[x] - 1.5); r < H; r++) if (YD[r] >= base[x] - 0.5) fill[r * W + x] = 1;
    // pines: a spire of tiers, each tier flaring out and stepping back in
    for (let tx = -2 + hash(i, 1) * gap; tx < DW + 2; tx += gap * (0.7 + hash(tx | 0, i + 3) * 0.7)) {
      // the nearest trees leave a clearing under the sun for the light to land in
      if (i === NEAR && tx > 92 && tx < 140) continue;
      const th = h0 + (h1 - h0) * hash(tx * 7 | 0, i + 5);
      const tip = ridge(tx) - th;
      const bot = ridge(tx) + 2.5;
      const tier = 2 + th * 0.12;
      for (let r = rowFrom(tip); r < rowTo(bot); r++) {
        const d = YD[r] - tip;
        if (d < 0) continue;
        const saw = (d % tier) / tier;
        // never thinner than a single dot, so the tips stay unbroken
        const half = Math.max(0.33, d * 0.3 * (0.6 + 0.5 * saw) + 0.3);
        for (let x = Math.max(0, Math.floor((tx - half) * S)); x <= Math.min(W - 1, Math.ceil((tx + half) * S)); x++) {
          const dx = Math.abs(XD[x] - tx);
          if (dx > half) continue;
          const k = r * W + x;
          fill[k] = spire[k] = 1;
          if (i === NEAR) tex[k] = smooth(0.62, 0.95, saw) * smooth(0.3, 0.85, dx / half) * (0.55 + 0.45 * hash(x, r * 5));
        }
      }
    }
    // where the silhouette starts in each column, smoothed a little so the
    // mist line follows the forest rather than every single spire
    const top = new Float32Array(W).fill(YB);
    for (let x = 0; x < W; x++)
      for (let r = 0; r < H; r++)
        if (fill[r * W + x]) {
          top[x] = YD[r] - 0.5 / S;
          break;
        }
    const line = top.map((_, x) => {
      let s = 0;
      for (let d = -5; d <= 5; d++) s += top[Math.min(W - 1, Math.max(0, x + d))];
      return Math.max(s / 11, top[x]);
    });
    const open = (xx: number, rr: number) => xx >= 0 && xx < W && (rr < 0 || !fill[rr * W + xx]);
    for (let r = 0; r < H; r++)
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        if (!fill[k]) continue;
        layer[k] = i === NEAR && !spire[k] ? FLOOR : i;
        if (i !== NEAR) tex[k] = 0;
        below[k] = YD[r] - line[x];
        ground[k] = base[x];
        // a rim where the sky (or a farther layer) shows beside or above
        const t = XD[x] < SUN[0] ? 1 : -1;
        edge[k] = open(x + t, r) || open(x, r - 1) ? 1 : open(x + 2 * t, r) || open(x, r - 2) ? 0.7 : open(x + 3 * t, r) ? 0.3 : 0;
      }
  });

  // --- what stands in front: a giant pine cut by the left of the frame, and a
  // smaller one at the right edge, so the frame is not a symmetric curtain ---
  const giant = new Uint8Array(N);
  for (const [gx, tip, spread, tier] of [[9, -12, 15, 7], [192, 12, 7, 5]]) {
    for (let r = rowFrom(tip); r < H; r++) {
      const d = YD[r] - tip;
      if (d < 0) continue;
      const saw = (d % tier) / tier;
      // each tier of boughs sweeps out and droops, so the outline is a stack
      // of points rather than a straight edge where it meets the frame
      const half = Math.min(spread * (0.5 + 0.5 * saw), d * 0.34 * (0.45 + 0.7 * saw) + 0.5);
      const reach = half * 1.6 * 1.12 + 1;
      for (let x = Math.max(0, Math.floor((gx - reach) * S)); x <= Math.min(W - 1, Math.ceil((gx + reach) * S)); x++) {
        const dx = Math.abs(XD[x] - gx);
        // the side toward the frame stays full, so no sliver of sky shows there
        const outer = (XD[x] - gx) * (gx - DW / 2) > 0 ? 1.6 : 1;
        const ragged = half * outer * (0.82 + 0.3 * noise(XD[x] * 0.5, YD[r] * 0.4, 0));
        if (dx <= ragged || dx < 0.9) {
          const k = r * W + x;
          giant[k] = 1;
          tex[k] = smooth(0.66, 0.96, saw) * smooth(0.25, 0.8, dx / ragged) * (0.5 + 0.5 * hash(x * 3, r));
        }
      }
    }
  }
  for (let k = 0; k < N; k++) if (giant[k]) (layer[k] = GIANT), (below[k] = 0);
  // a rim two design cells deep on the side that faces the sun
  {
    const open = (x: number, r: number) => x >= 0 && x < W && (r < 0 || !giant[r * W + x]);
    for (let r = 0; r < H; r++)
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        if (!giant[k]) continue;
        const t = XD[x] < SUN[0] ? 1 : -1;
        edge[k] = open(x + t, r) || open(x, r - 1) ? 1 : open(x + 2 * t, r) || open(x, r - 2) ? 0.85 : open(x + 3 * t, r) ? 0.55 : open(x + 4 * t, r) ? 0.25 : 0;
      }
  }

  // how much of the near trees stands round a cell, for the shade they cast
  // on the floor at their feet (a box blur a little wider than tall)
  const occ = new Float32Array(N);
  {
    const tmp = new Float32Array(N);
    for (let r = 0; r < H; r++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let d = -5; d <= 5; d++) {
          const L = layer[r * W + Math.min(W - 1, Math.max(0, x + d))];
          if (L === NEAR || L === GIANT) s++;
        }
        tmp[r * W + x] = s / 11;
      }
    for (let r = 0; r < H; r++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let d = -4; d <= 2; d++) s += tmp[Math.min(H - 1, Math.max(0, r + d)) * W + x];
        occ[r * W + x] = s / 7;
      }
  }

  // --- static colour --------------------------------------------------------
  const sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N);
  const fogAmt = new Float32Array(N); // how much drifting fog shows in front of a cell
  const fogSpeed = new Float32Array(N); // in output cells per second
  const rayAmt = new Float32Array(N); // how much of a sunbeam the air in front of it holds
  const sunS = new Float32Array(N); // nearness to the sun, for the fog's warmth
  const floorLit = new Float32Array(N); // where a beam that reaches the floor lights it
  const fr = new Float32Array(N), fg = new Float32Array(N), fb = new Float32Array(N); // the floor in full sun
  const lift = new Float32Array(N); // the dot floor, so the darkest air still shows
  const cloudAmt = new Float32Array(N); // where high cloud can show, in the sky only
  const abin = new Float32Array(N), dist = new Float32Array(N);
  const RA = 720;
  for (let r = 0; r < H; r++)
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox;
      // design coords: x is the cell's left edge, y its centre, as on the 200 x 100 grid
      const x = XD[ox] - 0.5, y = YD[r];
      const L = layer[k];
      const dx = x + 0.5 - SUN[0], dy = y - SUN[1];
      const ang = Math.atan2(dy, dx);
      abin[k] = ((ang / (Math.PI * 2)) * RA + RA) % RA;
      const d = (dist[k] = Math.sqrt(dx * dx + dy * dy));
      const s = (sunS[k] = Math.exp(-Math.sqrt(dx * dx + dy * dy * 1.96) / 30));
      // a soft warm bloom over a wide radius, in the air and the fog
      const bloom = Math.exp(-d / 16) * 0.22 + Math.exp(-d / 6) * 0.1;
      let cr: number, cg: number, cb: number, ray: number;
      if (L === SKY) {
        // sky: a slate blue overhead, paling through grey-blue to the fog
        // band low down, and warming toward the sun
        const v = clamp((y + 3) / 55);
        const p = Math.pow(v, 1.35);
        const veil = 0.95 + 0.1 * fbm(x * 0.04, y * 0.08, 3, 0);
        cr = mix(0.05, 0.5, p) * veil, cg = mix(0.08, 0.52, p) * veil, cb = mix(0.125, 0.53, p) * veil;
        // the low sky warms toward the side the sun rises on
        const hw = 0.35 * smooth(15, 48, y) * Math.exp(-Math.abs(dx) / 70);
        cr *= 1 + 0.3 * hw, cg *= 1 + 0.08 * hw, cb *= 1 - 0.2 * hw;
        // the fog band the far ridge stands in
        const band = 0.75 * smooth(28, 50, y) * (0.55 + 0.75 * fbm(x * 0.025, y * 0.16, 3, 0));
        cr = mix(cr, fogR(0), band), cg = mix(cg, fogG(0), band), cb = mix(cb, fogB(0), band);
        // warm in hue round the sun, but falling off in brightness, so the
        // disc stands in a halo rather than a flat blaze
        const kw = s * 0.55, kb = 0.42 + 0.25 * Math.exp(-d / 9);
        cr = mix(cr, fogR(s) * kb, kw), cg = mix(cg, fogG(s) * kb, kw), cb = mix(cb, fogB(s) * kb, kw);
        // forward scattering: a tight bright aureole and a wider warm one
        const glow = Math.exp(-d / 2) * 0.25 + Math.exp(-d / 9) * 0.1 + bloom * 0.6;
        cr += glow, cg += glow * 0.84, cb += glow * 0.6;
        // the disc itself, softened by the fog, a little hotter in the middle
        const disc = smooth(SUN_R + 0.5, SUN_R - 0.6, d);
        const core = 1 + 0.15 * smooth(SUN_R, 0, d);
        cr = mix(cr, 1.25 * core, disc), cg = mix(cg, 1.16 * core, disc), cb = mix(cb, 0.98 * core, disc);
        fogAmt[k] = 0.3 * smooth(30, 50, y);
        fogSpeed[k] = 0.4 * S;
        cloudAmt[k] = 0.75 * smooth(-4, 10, y) * smooth(44, 28, y) * smooth(SUN_R + 2, SUN_R + 8, d);
        ray = 0.35 * smooth(26, 46, y);
        lift[k] = 0.04;
      } else if (L <= NEAR - 1) {
        const [, , , , , haze, speed, M, drift, beam] = LAYERS[L];
        // pine: a dark blue-green, paling into the fog with distance; mist
        // pooled just under the tree line, and a sheet of it lying along the
        // valley floor below
        const pool = smooth(2.5, 8 + L * 1.5, below[k]) * smooth(20, 11, below[k]);
        // the sheet follows the lie of the land, smoothly, so it never streaks
        const sheet = Math.exp(-(((y - (ground[k] + 5)) / 3) ** 2)) * (0.75 + 0.5 * fbm(x * 0.035, L * 7.3, 3, 0));
        const mist = clamp(Math.max(pool * 0.5, sheet) * M);
        // aerial perspective deepens a little toward each ridge's foot too
        const h = clamp(haze + (1 - haze) * mist + 0.08 * smooth(0, 10, below[k]) * (1 - haze));
        const veil = 0.9 + 0.2 * fbm(x * 0.06, y * 0.12, 3, 0);
        // the crowns vary: clumps of darker and lighter needles
        const pine = 0.6 + 0.8 * fbm(x * 0.45 + L * 17, y * 0.6, 2, 0);
        const pr = 0.016 * pine, pg = 0.03 * pine, pb = 0.033 * pine;
        cr = mix(pr, fogR(s) * veil, h), cg = mix(pg, fogG(s) * veil, h), cb = mix(pb, fogB(s) * veil, h);
        cr += bloom * 0.6 * h, cg += bloom * 0.5 * h, cb += bloom * 0.36 * h;
        // the sun behind the ridge lights the needles along its crest
        const rim = edge[k] * s * (0.2 + 0.6 * (1 - haze));
        cr += rim * 1.0, cg += rim * 0.78, cb += rim * 0.5;
        fogAmt[k] = drift;
        fogSpeed[k] = speed * S;
        // the trees stop most of the light; the beams show in the mist between
        // (far off there is more air in front of them to hold the light)
        ray = beam * (L < 3 ? 0.45 + 0.55 * clamp(mist / M) : 0.25 + 0.75 * clamp(mist / M));
        lift[k] = 0.03;
      } else if (L === NEAR || L === GIANT) {
        // the near pines and the giants: backlit, nearly black, with the cool
        // light of the sky on the drooping edge of each tier of boughs and a
        // rim where the light comes round them, warm near the sun and grey-blue
        // away from it
        const needle = 0.6 + 0.8 * hash(ox * 3 + 1, r * 7 + 2);
        const g = tex[k] * (L === GIANT ? 0.22 : 0.18) * needle;
        cr = 0.005 + g * 0.55, cg = 0.008 + g * 0.72, cb = 0.009 + g * 0.8;
        const warm = L === GIANT ? Math.exp(-d / 50) : s;
        const rim = edge[k] * (L === GIANT ? 0.13 + 0.55 * warm : 0.1 + 0.6 * warm);
        cr += rim * mix(0.45, 1.0, warm), cg += rim * mix(0.56, 0.74, warm), cb += rim * mix(0.62, 0.44, warm);
        if (L === NEAR) {
          // still a little air in front of them, thickest round their feet,
          // so they stand back from the giants
          const h = 0.04 + 0.09 * smooth(ground[k] - 12, ground[k] + 1, y);
          cr = mix(cr, fogR(s) * 0.8, h), cg = mix(cg, fogG(s) * 0.8, h), cb = mix(cb, fogB(s) * 0.8, h);
        }
        fogAmt[k] = L === GIANT ? 0.04 : LAYERS[L][8];
        fogSpeed[k] = (L === GIANT ? 4 : LAYERS[L][6]) * S;
        ray = L === GIANT ? 0.04 : 0.12;
        lift[k] = 0;
      } else {
        // the forest floor: needle litter and clumps of moss in the shade of
        // the fog, darker at the feet of the trees and toward the frame
        const clump = smooth(0.38, 0.74, fbm(x * 0.09, y * 0.4, 4, 0));
        const speck = 0.45 + 0.9 * hash(ox * 7, r * 11) * (0.6 + 0.4 * fbm(x * 0.5, y * 1.2, 2, 0));
        const ar = mix(0.12, 0.16, clump), ag = mix(0.088, 0.17, clump), ab = mix(0.055, 0.07, clump);
        const ao = clamp(1 - 1.4 * occ[k]);
        const amb = 0.75 * speck * ao * smooth(YB + 2, YB - 10, y);
        cr = 0.006 + ar * amb * 0.9, cg = 0.008 + ag * amb, cb = 0.008 + ab * amb * 1.2;
        // the far side of the clearing recedes into a low ground mist
        const h = 0.2 * smooth(97, 89, y);
        cr = mix(cr, fogR(s) * 0.7, h), cg = mix(cg, fogG(s) * 0.7, h), cb = mix(cb, fogB(s) * 0.7, h);
        // in a beam the same floor glows: litter amber, moss golden-green
        const sun = 4.2 * speck * Math.sqrt(ao);
        fr[k] = ar * sun, fg[k] = ag * 0.8 * sun, fb[k] = ab * 0.58 * sun;
        fogAmt[k] = 0.06;
        fogSpeed[k] = 3.4 * S;
        ray = 0;
        // dappled patches the beams can land on
        floorLit[k] = smooth(0.32, 0.56, fbm(x * 0.06 + 3, y * 0.24, 3, 0)) * smooth(YB + 3, YB - 8, y);
        lift[k] = 0;
      }
      // the beams fan out mostly down and to the west, the way the gaps face
      ray *= 0.2 + 0.8 * smooth(1.25, 1.75, ang) * smooth(3.1, 2.6, ang);
      rayAmt[k] = ray;
      sr[k] = cr, sg[k] = cg, sb[k] = cb;
    }

  // drifting fog banks: wide soft noise that wraps so it can slide forever
  // (400 design columns around, sampled per output cell)
  const FW = 400 * S;
  const fog = new Float32Array(FW * H);
  for (let r = 0; r < H; r++)
    for (let u = 0; u < FW; u++) fog[r * FW + u] = smooth(0.42, 0.75, fbm((u / S) * 0.022, (YD[r] - 0.5) * 0.09, 4, 400 * 0.022));

  // thin high cloud, long and flat, lit from below by the low sun
  const CH = rowTo(46);
  const cloud = new Float32Array(FW * CH);
  for (let r = 0; r < CH; r++)
    for (let u = 0; u < FW; u++) {
      const ux = u / S, ry = YD[r] - 0.5;
      const q = fbm(ux * 0.01, ry * 0.05, 2, 400 * 0.01);
      cloud[r * FW + u] = smooth(0.44, 0.68, fbm(ux * 0.016 + q * 1.5, ry * 0.17, 4, 400 * 0.016));
    }
  // the undersides, where the cloud thins out below a cell: these face the
  // low sun and catch its light
  const cloudLit = new Float32Array(FW * CH);
  for (let r = 0; r < CH; r++)
    for (let u = 0; u < FW; u++) {
      const c = cloud[r * FW + u], under = r + 3 < CH ? cloud[(r + 3) * FW + u] : 0;
      cloudLit[r * FW + u] = clamp((c - under) * 1.1 + (1 - c) * 0.2);
    }
  // a fine print grain, so even the smoothest air is not a flat fill
  const grain = new Float32Array(N);
  for (let k = 0; k < N; k++) grain[k] = 0.95 + 0.1 * hash(k, 77);

  // sunbeams: a handful of wide shafts through the gaps, [angle, half width,
  // strength], with a faint grain along each, and a slower pattern sliding
  // across them so they brighten and fade
  const SHAFTS = [[1.42, 0.05, 0.7], [1.66, 0.07, 1], [1.93, 0.05, 0.8], [2.18, 0.08, 1], [2.45, 0.05, 0.75], [2.7, 0.06, 0.9], [2.95, 0.04, 0.6]];
  const rayA = new Float32Array(RA), rayB = new Float32Array(RA);
  for (let i = 0; i < RA; i++) {
    const a = (i / RA) * Math.PI * 2;
    let v = 0;
    for (const [c, w, st] of SHAFTS) v = Math.max(v, st * smooth(w, w * 0.35, Math.abs(a - c)));
    rayA[i] = v * (0.8 + 0.2 * fbm(i * 0.4, 3.1, 2, RA * 0.4));
    rayB[i] = smooth(0.4, 0.7, fbm(i * 0.03, 8.7, 2, RA * 0.03));
  }

  // dust in the air, in design units: [x, y, drift speed, bob phase, size]
  const motes: [number, number, number, number, number][] = [];
  for (let i = 0; i < 170; i++) motes.push([hash(i, 1) * DW, 50 + hash(i, 2) * 48, 0.3 + hash(i, 3) * 0.8, hash(i, 4) * 6.28, hash(i, 5)]);
  const mote = new Float32Array(N);
  const moteCells: number[] = [];

  return (t, px) => {
    for (const k of moteCells) mote[k] = 0;
    moteCells.length = 0;
    for (const [mx, my, sp, ph, sz] of motes) {
      const x = Math.floor(((((mx + t * sp + 2.5 * Math.sin(t * 0.4 + ph)) % DW) + DW) % DW) * S);
      const y = Math.floor((my + 2 * Math.sin(t * 0.3 + ph * 1.7) - ((t * sp * 0.2) % 6) + Y0) * S);
      if (y < 0 || y >= H) continue;
      const k = y * W + x;
      mote[k] = 0.5 + 0.5 * sz;
      moteCells.push(k);
    }
    // the beams hold their places (the gaps in the trees do not move) and
    // only sway a hair; a second, slower pattern drifts across them
    const shiftA = 2 * Math.sin(t * 0.35), shiftB = -t * 1.6;
    const pulse = 0.88 + 0.12 * Math.sin(t * 0.7);
    const cloudShift = t * 0.6 * S;

    for (let r = 0; r < H; r++) {
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        let cr = sr[k], cg = sg[k], cb = sb[k];
        const s = sunS[k];

        // the fog banks drift, nearer ones faster
        const fa = fogAmt[k];
        if (fa > 0.01) {
          const u = x + t * fogSpeed[k], ui = Math.floor(u), uf = u - ui;
          const f0 = fog[r * FW + (ui % FW)], f1 = fog[r * FW + ((ui + 1) % FW)];
          const a = (f0 + (f1 - f0) * uf) * fa;
          cr = mix(cr, fogR(s), a), cg = mix(cg, fogG(s), a), cb = mix(cb, fogB(s), a);
        }

        const ca = cloudAmt[k];
        if (ca > 0.01) {
          const u = x + cloudShift, ui = Math.floor(u), uf = u - ui;
          const c0 = cloud[r * FW + (ui % FW)], c1 = cloud[r * FW + ((ui + 1) % FW)];
          const a = (c0 + (c1 - c0) * uf) * ca;
          if (a > 0.005) {
            // slate grey-blue in the cloud's own shade, gold where its
            // underside or thin edges catch the sun; denser cores a shade darker
            const w = Math.exp(-dist[k] / 40);
            const lit = cloudLit[r * FW + (ui % FW)];
            const kw = clamp(w * (0.35 + 0.65 * lit) + 0.12 * lit);
            const sh = 1.05 - 0.2 * a;
            cr = mix(cr, mix(0.2, 0.95, kw) * sh, a), cg = mix(cg, mix(0.24, 0.76, kw) * sh, a), cb = mix(cb, mix(0.29, 0.6, kw) * sh, a);
          }
        }

        // the beams: brightest near the sun, fading with distance
        const ra = rayAmt[k], fl = floorLit[k];
        let beam = 0;
        if (ra > 0.01 || fl > 0.01) {
          const ai = abin[k];
          const ia = Math.floor(ai + shiftA), ib = Math.floor(ai + shiftB);
          beam = rayA[((ia % RA) + RA) % RA] * (0.6 + 0.4 * rayB[((ib % RA) + RA) % RA]) * pulse;
        }
        if (ra > 0.01 && dist[k] > SUN_R) {
          // lit shafts brighten the air, the shadows between them dim it
          const fall = Math.exp(-dist[k] / 80) * smooth(SUN_R, 12, dist[k]);
          const b = (beam - 0.3) * fall * ra * 1.9;
          if (b > 0) cr += b * 1.0, cg += b * 0.82, cb += b * 0.54;
          else {
            const dim = 1 + b;
            cr *= dim, cg *= dim, cb *= dim;
          }
        }
        if (fl > 0.01) {
          // a patch of sun on the floor where a beam lands
          const b = beam * fl * 1.1;
          cr += b * fr[k], cg += b * fg[k], cb += b * fb[k];
        }

        let floor = lift[k];
        if (mote[k] && dist[k] > 6) {
          // a mote shows up where a beam catches it
          const ia = Math.floor(abin[k] + shiftA);
          const lit = rayA[((ia % RA) + RA) % RA] * Math.exp(-dist[k] / 90);
          const v = mote[k] * (0.1 + 1.6 * lit) * Math.min(1, rayAmt[k] * 2);
          if (v > 0.18) {
            cr = Math.max(cr, v * 1.05), cg = Math.max(cg, v * 0.94), cb = Math.max(cb, v * 0.74);
            floor = 0.3;
          }
        }

        const gr = grain[k];
        dot(px, k, cr * gr, cg * gr, cb * gr, floor);
      }
    }
  };
}
