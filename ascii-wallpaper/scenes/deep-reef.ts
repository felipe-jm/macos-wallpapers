/*
 * deep reef: looking along a coral reef from a few metres down. The sun is a
 * bright blaze in the rippled surface, shafts of light fan down from it,
 * kelp sways in the swell, a school of fish wheels through the dark water,
 * bubbles rise and caustics crawl over the sand.
 *
 * The water, the sand and the reef are shaded once; each frame adds the light
 * that moves (shafts, ripples, caustics) and draws what swims or sways on top.
 * The light is treated roughly as water treats it: sunlight loses its red
 * first on the way down, everything seen through the water loses its own red
 * with distance and fades into the blue the particles scatter, and that
 * scattering glows around the sun and inside the shafts. Every cell is then a
 * halftone dot sized by its brightness, in its own colour.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "deep reef",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#03101a",
} satisfies Meta;

// The picture is laid out in design units (a 200 x 100 grid, extended a little
// above and well below to fill 16:9) and sampled on a finer 320 x 180 grid.
const W = 320, H = 180;
const S = 1.6; // output cells per design unit
const Y0 = 2; // design rows added above the original frame (the rest go below)
const DW = W / S, DH = H / S; // 200 x 112.5 design units
const SURF = 15; // the surface band
const HZ = 61; // where the sea floor would meet the haze
const LEVEL = 54; // the design row we look straight out along
const SUNX = 136; // where the sun shows through the surface

const NONE = 0, SAND = 1, REEF = 2, FAR = 3, FAN = 4;

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

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const k = clamp((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

// A seeded generator for laying things out.
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function deepReef(): Frame {
  const N = W * H;
  // design coordinates of each output column / row (cell centres); X and R
  // stand where the original's integer column and row indices stood
  const XD = new Float32Array(W), YD = new Float32Array(H);
  for (let x = 0; x < W; x++) XD[x] = (x + 0.5) / S;
  for (let r = 0; r < H; r++) YD[r] = (r + 0.5) / S - Y0;
  const BOT = DH - Y0; // the design row at the bottom edge

  // --- caustics: a tiling web of bright lines (cell edges of a Voronoi) -----
  // thin and sharp, with the light pooling where three cells meet
  const CT = 64, CC = 6, CS = CT / CC;
  const caus = new Float32Array(CT * CT);
  {
    const rnd = prng(7);
    const pts: [number, number][] = [];
    for (let j = 0; j < CC; j++) for (let i = 0; i < CC; i++) pts.push([(i + 0.15 + 0.7 * rnd()) * CS, (j + 0.15 + 0.7 * rnd()) * CS]);
    for (let y = 0; y < CT; y++) {
      for (let x = 0; x < CT; x++) {
        let f1 = 1e9, f2 = 1e9, f3 = 1e9;
        for (const [px, py] of pts) {
          for (let oy = -CT; oy <= CT; oy += CT) {
            for (let ox = -CT; ox <= CT; ox += CT) {
              const dx = x + 0.5 - px - ox, dy = y + 0.5 - py - oy;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < f1) (f3 = f2), (f2 = f1), (f1 = d);
              else if (d < f2) (f3 = f2), (f2 = d);
              else if (d < f3) f3 = d;
            }
          }
        }
        const line = Math.pow(1 - smooth(0, 0.34 * CS, f2 - f1), 2.4);
        const node = Math.pow(1 - smooth(0, 0.5 * CS, f3 - f1), 2) * 0.35;
        caus[y * CT + x] = Math.min(1, line + node);
      }
    }
  }
  const causAt = (u: number, v: number): number => {
    u = ((u % CT) + CT) % CT;
    v = ((v % CT) + CT) % CT;
    const x0 = u | 0, y0 = v | 0, ax = u - x0, ay = v - y0;
    const x1 = (x0 + 1) % CT, y1 = (y0 + 1) % CT;
    const a = caus[y0 * CT + x0], b = caus[y0 * CT + x1], c = caus[y1 * CT + x0], d = caus[y1 * CT + x1];
    return a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay;
  };

  // --- the water: the colour of the light scattered toward us ---------------
  // Overhead it is a bright, slightly green aqua; looking level a clear blue,
  // the haze in the distance lit a little paler; looking down it sinks to ink.
  // The particles throw the sun's light forward, so it glows around the sun.
  const wr = new Float32Array(N), wg = new Float32Array(N), wb = new Float32Array(N);
  // which shaft each cell sits in: shafts fan out from the sun, above the frame
  // (kept fractional so shaft edges stay smooth on the finer grid)
  const rayAt = new Float32Array(N);
  const grain = new Float32Array(N); // a faint, fixed unevenness, like print grain
  const SUNY = -12, RAYS = 320;
  for (let r = 0; r < H; r++) {
    const R = YD[r] - 0.5;
    for (let x = 0; x < W; x++) {
      const X = XD[x] - 0.5;
      const k = r * W + x;
      grain[k] = 0.95 + 0.1 * hash(x * 13 + 5, r * 7 + 3);
      const e = (LEVEL - R) / LEVEL; // 1 at the top edge, 0 looking level
      let cr: number, cg: number, cb: number;
      if (e >= 0) {
        const u = Math.pow(e, 1.25);
        cr = mix(0.022, 0.1, u), cg = mix(0.13, 0.34, u), cb = mix(0.25, 0.47, u);
      } else {
        const u = smooth(0, 0.95, -e);
        cr = mix(0.022, 0.003, u), cg = mix(0.13, 0.03, u), cb = mix(0.25, 0.08, u);
      }
      // forward scattering of the sun: a tight glow and a broad one
      const ds = Math.hypot((X - SUNX) * 0.9, R - 3);
      const fwd = 0.5 * Math.exp(-ds / 16) + 0.3 * Math.exp(-ds / 48);
      cr += 0.3 * fwd, cg += 0.5 * fwd, cb += 0.52 * fwd;
      // looking level, the distance is a lit haze the reefs stand against
      const haze = Math.exp(-(((R - LEVEL) / 14) ** 2)) * (1 - 0.6 * smooth(30, 100, Math.abs(X - 112)));
      cr += 0.03 * haze, cg += 0.1 * haze, cb += 0.12 * haze;
      // darker away from the sun and toward the floor, but the upper water
      // stays lit so the kelp stands dark against it
      const edge = 1 - 0.5 * smooth(50, 104, Math.abs(X - 112)) * smooth(8, 70, R) - 0.35 * smooth(66, 108, R);
      // soft clouds of plankton haze, so open water is never one flat tone
      const veil = 0.86 + 0.28 * fbm(X * 0.022 + 5, R * 0.04, 4) + 0.06 * (fbm(X * 0.11, R * 0.16, 2) - 0.5);
      const m = edge * veil;
      wr[k] = cr * m, wg[k] = cg * m, wb[k] = cb * m;
      const a = Math.atan2(X + 0.5 - SUNX, R + 0.5 - SUNY);
      rayAt[k] = Math.max(0, Math.min(RAYS - 1.001, (a + 1.6) * 100));
    }
  }
  const RAY0 = 160; // the shaft straight down from the sun

  // the sunlight reaching a given depth: red is gone within a few metres,
  // green lasts longer, blue longest
  const LR = new Float32Array(H), LG = new Float32Array(H), LB = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const d = Math.max(0, YD[r] + 6);
    LR[r] = 1.0 * Math.exp(-d / 105), LG[r] = 0.9 * Math.exp(-d / 260), LB[r] = 0.86 * Math.exp(-d / 420);
  }
  // the dim, blue light that comes from all around, even into the shadows
  const AMB = [0.012, 0.06, 0.1];

  // --- the static scene: sand, the reef, a far reef in the haze, a sea fan --
  const mat = new Uint8Array(N);
  const ar = new Float32Array(N), ag = new Float32Array(N), ab = new Float32Array(N); // what it reflects
  const sh = new Float32Array(N); // how much of the sunlight falls on it
  const am = new Float32Array(N); // how open it is to the light from all round
  const fog = new Float32Array(N); // how much water stands between us and it
  const cu = new Float32Array(N), cv = new Float32Array(N), cw = new Float32Array(N); // caustic coords, weight
  // both reefs are rounded masses, shouldering down toward the open sand; below
  // the original frame their flanks keep falling away steeply
  const dome = (u: number): number => 1 - Math.sqrt(Math.max(0, 1 - u * u));
  const leftTop = (x: number): number => 47 + 56 * dome(Math.min(1, x / 86)) + 5 * Math.max(0, x - 86) - 8 * fbm(x * 0.06, 3.1, 4) + 3 * Math.max(0, (10 - x) / 10);
  const rightTop = (x: number): number => 69 + 34 * dome(Math.min(1, (196 - x) / 48)) + 5 * Math.max(0, 148 - x) - 5 * fbm(x * 0.08, 8.3, 3) - 3 * Math.exp(-(((x - 191) / 6) ** 2));
  const farTop = (x: number): number => HZ - 1 - 6 * fbm(x * 0.035 + 2, 1.7, 3) - 3 * Math.exp(-(((x - 120) / 18) ** 2));
  // brain corals: domes on the crests
  // [x, depth of the centre below the crest, radius, kind]
  const domes = [[16, 3, 7, 0], [41, 2.5, 6.5, 1], [53, 2, 4.5, 3], [65, 2, 5, 2], [158, 2, 4, 2], [186, 3, 5, 1], [196, 3, 4.5, 3]]
    .map(([x, d, r, kind]) => [x, (x < 100 ? leftTop(x) : rightTop(x)) + d, r, kind]);
  // living coral as it would look in white light: rose, orange, mauve, ochre
  const coral = [
    [0.84, 0.38, 0.42], [0.92, 0.5, 0.26], [0.62, 0.36, 0.6], [0.92, 0.6, 0.32],
  ];
  // bare reef rock: a grey limestone, furred with olive algae
  const stone = [0.26, 0.25, 0.22], algae = [0.2, 0.22, 0.11];
  // [x, crest row, half width, fog, coral kind]
  const BOMMIES = [[114, 69, 9, 0.32, 0], [94, 63.6, 4, 0.5, 2], [139, 64.4, 4, 0.42, 1]];
  const FAN_C = [167, rightTop(167) + 1.5], FAN_R = 27;
  for (let r = 0; r < H; r++) {
    const y = YD[r], R = y - 0.5;
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox, xc = XD[ox], x = xc - 0.5;
      // the sea floor, a plane running off into the haze
      if (R >= HZ + 2) {
        const d = y - HZ;
        const z = 300 / d; // distance
        // the floor is seen at a low angle, so its pattern squeezes toward the
        // haze; spacing grows as it comes nearer, and fades out before it
        // gets too fine to draw
        const near = 0.4 + 0.6 * (d / 38);
        const sx = (xc - 100) / near;
        const sy = 30 * Math.log(d);
        const aa = smooth(2.2, 1.4, 30 / d);
        // ripples in the sand run across our view, bending a little: their
        // backs face the sun and catch it, their lee sides fall into shade
        const ph = sy + 7 * fbm(sx * 0.07, sy * 0.06, 2) + sx * 0.05;
        const amp = smooth(0.3, 0.6, fbm(sx * 0.09 + 7, sy * 0.12, 2));
        const crest = Math.pow(0.5 + 0.5 * Math.sin(ph), 3) * amp;
        const slope = Math.cos(ph) * amp;
        const rip = 0.78 + aa * (0.42 * crest + 0.12 * slope - 0.1) + 0.14 * (fbm(sx * 0.08, sy * 0.15, 3) - 0.5);
        mat[k] = SAND;
        const lit = 0.46 + 0.14 * smooth(100, 130, x) - 0.22 * smooth(84, 108, R);
        // pale coral sand, a little darker where weed and rubble lie
        const patch = smooth(0.58, 0.72, fbm(sx * 0.03 + 3, sy * 0.05, 3)) * aa;
        const fine = 0.94 + 0.12 * hash(ox * 3 + 1, r * 5 + 2);
        ar[k] = mix(0.9, 0.55, patch) * fine, ag[k] = mix(0.74, 0.48, patch) * fine, ab[k] = mix(0.55, 0.34, patch) * fine;
        sh[k] = rip * lit, am[k] = 1;
        fog[k] = 1 - Math.exp(-z / 40);
        cu[k] = sx * 0.9, cv[k] = sy * 2.3, cw[k] = 1.5 * smooth(14, 26, d);
      }
      if (y >= farTop(x) && R < HZ + 6) {
        mat[k] = FAR;
        // lit along its crest, dim below, mostly lost in the blue
        const s = (0.45 + 0.55 * fbm(x * 0.15, y * 0.15, 2)) * (0.45 + 0.8 * Math.exp(-(y - farTop(x)) / 2));
        ar[k] = stone[0], ag[k] = stone[1], ab[k] = stone[2];
        sh[k] = 0.5 * s, am[k] = 0.6;
        fog[k] = 0.66;
        cw[k] = 0;
      }
      // the sea fan: a thin lattice of veins spreading up from its root
      {
        const dx = xc - FAN_C[0], dy = FAN_C[1] - y;
        const d = Math.hypot(dx, dy), a = Math.atan2(dx, dy);
        const reach = FAN_R * (0.68 + 0.36 * fbm(a * 2.6 + 5, 1, 3));
        if (dy > -1 && Math.abs(a) < 1.2 && d < reach) {
          const aw = a + 0.08 * (fbm(d * 0.2, a * 2, 2) - 0.5) * 4;
          const ray = Math.abs(((aw * 7.5) / Math.PI + 100) % 1 - 0.5);
          const ring = Math.abs(((d / 3.2) + 100) % 1 - 0.5);
          const mesh = hash(ox * 3, r * 5) < 0.08;
          const vein = ray > 0.43 || (ring > 0.46 && d > 5) || mesh || (d < 4 && Math.abs(dx) < 1.2) || d > reach - 0.9;
          mat[k] = FAN;
          // dark at the root, catching the light toward its rim; between the
          // veins a thin web the water shows through
          const o = smooth(2, reach, d);
          ar[k] = mix(0.5, 0.78, o), ag[k] = mix(0.18, 0.28, o), ab[k] = mix(0.4, 0.56, o);
          sh[k] = (0.3 + 0.8 * o) * (vein ? 1 : 0.3) * (0.85 + 0.3 * hash(ox, r * 3 + 1));
          am[k] = 0.8;
          fog[k] = vein ? 0.18 : 0.55;
          cw[k] = 0;
        }
      }
      // small coral heads out on the sand, half lost in the blue
      for (const [bx, crest, hw, f0, kind] of BOMMIES) {
        const u = (xc - bx) / hw;
        if (Math.abs(u) >= 1.1) continue;
        const top = crest + u * u * u * u * hw * 0.5 - 1.6 * fbm(x * 0.35, crest, 2);
        if (y >= top && y < crest + hw * 0.5 + 1.5 * fbm(x * 0.3, crest + 5, 2) - 0.6 * u * u) {
          mat[k] = REEF;
          const below = y - top;
          const living = smooth(2.2, 0.6, below) * smooth(0.45, 0.6, fbm(x * 0.25 + bx, y * 0.3, 2));
          const lit = 0.24 + 0.75 * Math.exp(-below / 2.6) + 0.16 * (fbm(x * 0.5, y * 0.5, 2) - 0.5);
          const c = coral[kind];
          ar[k] = mix(stone[0], c[0], living), ag[k] = mix(stone[1], c[1], living), ab[k] = mix(stone[2], c[2], living);
          sh[k] = lit, am[k] = 0.4 + 0.6 * Math.exp(-below / 2.5);
          fog[k] = f0;
          cu[k] = x * 0.5, cv[k] = y * 0.9, cw[k] = 0.5 * Math.exp(-below / 1.5);
        }
      }
      // reef masses, left and right: rough rock, crowned with living coral
      const top = x < 100 ? leftTop(x) : rightTop(x);
      if (y >= top) {
        mat[k] = REEF;
        const below = y - top;
        const n = fbm(x * 0.18, y * 0.22, 4);
        const fine = fbm(x * 0.6 + 3, y * 0.7, 2);
        // lumps of rock and coral heads, each lit on its upper side, with the
        // hollows between them in shade
        const lump = fbm(x * 0.07, y * 0.1, 3), lumpUp = fbm(x * 0.07, (y - 1.5) * 0.1, 3);
        const face = clamp(0.5 + (lumpUp - lump) * 14);
        const hollow = smooth(0.35, 0.6, lump);
        const deep = 0.3 + 0.7 * smooth(100, 40, R); // the lower face sees less of the surface
        const lit = (0.16 + 0.55 * face + 0.55 * Math.exp(-below / 5) + 0.18 * (n - 0.5) + 0.12 * (fine - 0.5)) * deep * (0.55 + 0.45 * hollow);
        // patches of living coral, thick along the crest, a few sponges below
        const kind = Math.floor(fbm(x * 0.06 + 11, y * 0.09, 3) * 7) % 4;
        const patch = fbm(x * 0.12 + 4, y * 0.12, 3);
        const living = Math.max(smooth(0.44, 0.56, patch) * smooth(7, 1.5, below), smooth(0.66, 0.72, patch) * 0.35 * smooth(24, 6, below));
        const c = coral[kind];
        const weed = smooth(0.35, 0.65, fbm(x * 0.09 + 21, y * 0.11, 3));
        const rr = mix(stone[0], algae[0], weed), rg = mix(stone[1], algae[1], weed), rb = mix(stone[2], algae[2], weed);
        const tone = 0.8 + 0.4 * fine;
        ar[k] = mix(rr, c[0], living) * tone, ag[k] = mix(rg, c[1], living) * tone, ab[k] = mix(rb, c[2], living) * tone;
        // the bright water behind rims the crest, and the upper lips of ledges
        // down the face catch a little of it
        const rim = smooth(2.4, 0.3, below) * 0.45;
        const ledge = smooth(0.66, 0.9, face) * smooth(3, 8, below) * 0.3;
        sh[k] = lit + rim + ledge * deep;
        am[k] = (0.35 + 0.65 * hollow) * (0.5 + 0.5 * Math.exp(-below / 14));
        fog[k] = x < 100 ? 0.05 + 0.05 * smooth(0, 80, x) : 0.1;
        cu[k] = x * 0.5, cv[k] = y * 0.9, cw[k] = 0.8 * Math.exp(-below / 1.5);
      }
      for (const [dx0, dy0, dr, kind] of domes) {
        const dx = xc - dx0, dy = y - dy0;
        if (Math.abs(dx) >= dr) continue;
        const d = Math.hypot(dx, dy * 1.25);
        if (d < dr && dy < dr * 0.3) {
          mat[k] = REEF;
          const nz = Math.sqrt(Math.max(0, 1 - (d / dr) ** 2));
          const lamb = clamp(0.1 + 0.9 * (nz * 0.6 - (dy / dr) * 0.55 + (dx / dr) * 0.25));
          // the meandering grooves of a brain coral, shadowed in their troughs
          const groove = 0.7 + 0.3 * Math.sin(d * 2.4 + 2 * fbm(x * 0.3, y * 0.3, 2) * 3);
          const c = coral[(kind + 1) % 4];
          ar[k] = c[0], ag[k] = c[1], ab[k] = c[2];
          sh[k] = (0.08 + 0.95 * lamb) * groove;
          am[k] = 0.3 + 0.7 * nz * groove;
          fog[k] = dx0 < 100 ? 0.05 + 0.05 * smooth(0, 80, dx0) : 0.1;
          cu[k] = x * 0.5, cv[k] = y * 0.9, cw[k] = 0.5 * clamp(-dy / dr + 0.6);
        }
      }
    }
  }
  // branching coral standing up off both crests, traced on the fine grid:
  // two cells thick toward the base, one at the tips
  for (const [seed, count, x0, span, topAt] of [[31, 10, 3, 60, leftTop], [53, 3, 178, 20, rightTop]] satisfies [seed: number, count: number, x0: number, span: number, topAt: (x: number) => number][]) {
    const rnd = prng(seed);
    for (let i = 0; i < count; i++) {
      const bx = x0 + rnd() * span;
      if (Math.abs(bx - FAN_C[0]) < 3) continue; // leave the fan's root clear
      const base = topAt(bx);
      const h = 2 + rnd() * 3.5;
      const lean = (rnd() - 0.5) * 0.5;
      const kind = rnd() < 0.5 ? 1 : 3;
      const c = coral[kind];
      for (let s = 0; s < h + 0.3; s += 0.25) {
        const xd = bx + 0.5 + lean * s + (s > h * 0.55 ? (i % 2 ? 1 : -1) * (s - h * 0.55) * 0.6 : 0);
        const tip = Math.min(1, s / h);
        const wide = tip < 0.6 ? 1 : 0;
        const r = Math.floor((base - s + 0.5 + Y0) * S);
        const xa = Math.floor(xd * S - 0.5 * wide);
        if (r < 0 || r >= H) continue;
        for (let x = xa; x <= xa + wide; x++) {
          if (x < 0 || x >= W) continue;
          const k = r * W + x;
          mat[k] = REEF;
          // pale growing tips, the shaded side of a two-cell stem a little darker
          const side = wide && x === xa ? 0.75 : 1;
          ar[k] = mix(c[0], 0.86, tip * 0.35), ag[k] = mix(c[1], 0.8, tip * 0.35), ab[k] = mix(c[2], 0.66, tip * 0.35);
          sh[k] = (0.35 + 0.65 * tip) * side, am[k] = 0.5 + 0.5 * tip;
          fog[k] = 0.07;
          cu[k] = XD[x] * 0.5, cv[k] = YD[r] * 0.9, cw[k] = 0.4;
        }
      }
    }
  }
  // the reef shades the sand at its foot: soften the reef's outline into a
  // wide blur and darken the sand under it
  const occ = new Float32Array(N);
  {
    const tmp = new Float32Array(N), RAD = 7;
    for (let r = 0; r < H; r++) {
      let acc = 0;
      for (let x = -RAD; x < W + RAD; x++) {
        const xi = x + RAD;
        if (xi < W) acc += mat[r * W + xi] === REEF ? 1 : 0;
        const xo = x - RAD - 1;
        if (xo >= 0) acc -= mat[r * W + xo] === REEF ? 1 : 0;
        if (x >= 0 && x < W) tmp[r * W + x] = acc / (2 * RAD + 1);
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let r = -RAD; r < H + RAD; r++) {
        const ri = r + RAD;
        if (ri < H) acc += tmp[ri * W + x];
        const ro = r - RAD - 1;
        if (ro >= 0) acc -= tmp[ro * W + x];
        if (r >= 0 && r < H) occ[r * W + x] = acc / (2 * RAD + 1);
      }
    }
  }

  // Light the scene, then look at it through the water: what lies further
  // off loses its red first, then its green, and the water's own scattered
  // blue takes its place.
  const br = new Float32Array(N), bg = new Float32Array(N), bb = new Float32Array(N);
  // how the moving caustics and shafts show on each cell, folded together
  const kr = new Float32Array(N), kg = new Float32Array(N), kb = new Float32Array(N);
  const EX = 1.25;
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      const gr = grain[k];
      if (mat[k] === NONE) {
        br[k] = wr[k] * gr, bg[k] = wg[k] * gr, bb[k] = wb[k] * gr;
        continue;
      }
      const f = fog[k];
      const tg = 1 - f, tr = Math.pow(tg, 2.6), tb = Math.pow(tg, 0.75);
      let s = sh[k];
      if (mat[k] === SAND) s *= 1 - 0.55 * smooth(0.05, 0.6, occ[k]);
      const lr = (LR[r] * s + AMB[0] * am[k]) * EX, lg = (LG[r] * s + AMB[1] * am[k]) * EX, lb = (LB[r] * s + AMB[2] * am[k]) * EX;
      br[k] = (ar[k] * lr * tr + wr[k] * (1 - tr)) * gr;
      bg[k] = (ag[k] * lg * tg + wg[k] * (1 - tg)) * gr;
      bb[k] = (ab[k] * lb * tb + wb[k] * (1 - tb)) * gr;
      const c = cw[k] * (mat[k] === SAND ? 1 - 0.7 * smooth(0.05, 0.5, occ[k]) : 1) * EX;
      // focused sunlight reads paler than the light around it
      kr[k] = c * ar[k] * LR[r] * tr * 1.5, kg[k] = c * ag[k] * LG[r] * tg * 0.95, kb[k] = c * ab[k] * LB[r] * tb * 1.05;
    }
  }
  // how far down the light reaches, per row
  const depthFadeR = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const R = YD[r] - 0.5;
    depthFadeR[r] = Math.exp(-Math.max(-4, R) / 30) * smooth(0, 14, R + 6);
  }

  // --- the moving things, laid out once ------------------------------------
  const rnd = prng(1234);
  const gauss = (): number => {
    let s = 0;
    for (let i = 0; i < 4; i++) s += rnd();
    return (s - 2) * 1.7;
  };
  const fish: { a: number; b: number; ph: number; sp: number }[] = [];
  for (let i = 0; i < 150; i++) fish.push({ a: gauss() * 10, b: gauss() * 3.8, ph: rnd() * 6.28, sp: 0.8 + rnd() * 0.6 });
  // kelp: x, base row (just below the frame), length, width, phase, and how much water hides it
  const kelp: { bx: number; base: number; len: number; sz: number; ph: number; haze: number }[] = [];
  for (const [bx, base, len, sz, ph, haze] of [
    [14, BOT + 1, BOT - 3, 3.5, 0.0, 0], [189, BOT + 1, BOT - 3, 3.5, 5.2, 0],
  ])
    kelp.push({ bx, base, len, sz, ph, haze });
  const streams = [[44, 52, 8], [168, 66, 7], [116, 96, 6]];
  const bubbles: { x0: number; y0: number; ph: number; sp: number; w: number }[] = [];
  for (const [x0, y0, n] of streams) for (let i = 0; i < n; i++) bubbles.push({ x0, y0, ph: rnd(), sp: 4 + rnd() * 3, w: rnd() * 6.28 });
  // particles drifting in the water at every distance: far ones faint and
  // fine, near ones out of focus, soft and quicker across the view
  const snow: { x: number; y: number; sp: number; ph: number; b: number; z: number }[] = [];
  for (let i = 0; i < 320; i++) {
    const z = rnd();
    snow.push({ x: rnd() * DW, y: rnd() * DH, sp: (0.3 + rnd() * 0.7) * (0.6 + 1.2 * z * z), ph: rnd() * 6.28, b: 0.1 + rnd() * 0.2, z });
  }

  // --- each frame ------------------------------------------------------------
  const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N), floor = new Float32Array(N);
  const rays = new Float32Array(RAYS);
  const rayOf = (k: number): number => {
    const u = rayAt[k], i = u | 0;
    return rays[i] + (rays[i + 1] - rays[i]) * (u - i);
  };
  const add = (x: number, r: number, R: number, G: number, B: number) => {
    if (x < 0 || x >= W || r < 0 || r >= H) return;
    const k = r * W + x;
    cr[k] += R, cg[k] += G, cb[k] += B;
  };
  const put = (x: number, r: number, R: number, G: number, B: number, a: number) => {
    if (x < 0 || x >= W || r < 0 || r >= H) return;
    const k = r * W + x;
    cr[k] = mix(cr[k], R, a), cg[k] = mix(cg[k], G, a), cb[k] = mix(cb[k], B, a);
  };
  // a design-space position (cell-corner based, as the original rounded) -> output cell
  const gx = (x: number): number => Math.floor(x * S);
  const gy = (y: number): number => Math.floor((y + Y0) * S);

  return (t, px) => {
    // shafts: a slow pattern across the surface, shimmering as the waves pass,
    // strongest straight under the sun
    for (let u = 0; u < RAYS; u++) {
      const s = Math.pow(smooth(0.48, 0.64, fbm(u * 0.06 + t * 0.025, 3.3, 3)), 1.3);
      const shimmer = 0.6 + 0.4 * noise(u * 0.18 - t * 0.7, t * 0.3);
      rays[u] = s * shimmer * (0.3 + 0.7 * Math.exp(-(((u - RAY0) / 60) ** 2)));
    }
    const cx0 = t * 0.9, cy0 = t * 0.35, cx1 = -t * 0.6 + 21, cy1 = t * 0.5 + 9;
    // the sun's blaze wobbles as the swell passes over it
    const hx = SUNX + 1.6 * Math.sin(t * 0.6) + 0.8 * Math.sin(t * 1.7 + 1);

    for (let r = 0; r < H; r++) {
      const y = YD[r], Rr = y - 0.5;
      const depthFade = depthFadeR[r];
      const ceil = Rr < SURF + 6;
      const dist = SURF + 7 - y, q = 30 / dist;
      const lit = ceil ? Math.pow(smooth(SURF + 6, 0, y), 1.3) : 0;
      for (let ox = 0; ox < W; ox++) {
        const k = r * W + ox;
        let R = br[k], G = bg[k], B = bb[k];
        const m = mat[k];
        const ray = rayOf(k) * depthFade;
        if (m === NONE) {
          if (ceil) {
            // the underside of the surface: a rippling ceiling, pressed flat
            // toward the haze, where it mirrors the dark water below
            const x = XD[ox] - 0.5;
            const a = causAt(((x - 100) / dist) * 1.6 + t * 1.6, q * 6 + t * 0.8);
            const b2 = causAt(((x - 100) / dist) * 1.2 - t * 1.1 + 31, q * 4.5 - t * 0.6 + 17);
            const c = Math.pow(Math.max(a, b2), 1.6);
            const near = Math.exp(-(((x - hx) / 34) ** 2));
            // troughs darken the water under them, crests focus light into lines
            const dim = 1 - lit * 0.65 * (1 - c);
            R *= dim, G *= dim, B *= dim;
            const v = lit * c * (0.1 + 0.45 * near);
            // the sun: a compact white blaze broken by the ripples, in a glow
            const dx = x + 0.5 - hx;
            const hot = Math.exp(-((dx / 8) ** 2) - (((y - 6) / 3.6) ** 2)) * (1 + 0.3 * c);
            const halo = Math.exp(-((dx / 15) ** 2) - (((y - 6) / 7) ** 2)) * 0.3 * (0.6 + 0.6 * c);
            R += 0.6 * v + 1.0 * hot + 0.45 * halo;
            G += 0.88 * v + 1.0 * hot + 0.65 * halo;
            B += 0.86 * v + 0.95 * hot + 0.62 * halo;
          }
          // a shaft is sunlight scattered off the particles: pale, losing
          // its warmth as it goes down
          R += (0.24 + 0.2 * depthFade) * ray, G += 0.64 * ray, B += 0.68 * ray;
          floor[k] = 0;
        } else {
          const f = fog[k];
          if (cw[k] > 0) {
            // two drifting webs of focused light, swelling and fading in
            // patches as the wave groups pass overhead
            const c = Math.min(causAt(cu[k] + cx0, cv[k] + cy0), 1) * 0.6 + causAt(cu[k] * 0.8 + cx1, cv[k] * 0.8 + cy1) * 0.6;
            const swell = 0.45 + 0.9 * noise(cu[k] * 0.045 + t * 0.12, cv[k] * 0.03 - t * 0.09);
            const s = c * c * swell * (0.7 + 0.6 * ray + 0.3 * depthFade);
            R += kr[k] * s, G += kg[k] * s, B += kb[k] * s;
          }
          // the shafts light the water between us and it
          R += 0.14 * ray * f, G += 0.34 * ray * f, B += 0.34 * ray * f;
          floor[k] = 0.03;
        }
        cr[k] = R, cg[k] = G, cb[k] = B;
      }
    }

    // the school: one body turning along a slow loop, each fish a beat behind
    const pathX = (s: number): number => 95 + 24 * Math.sin(0.11 * s + 0.4);
    const pathY = (s: number): number => 44 + 8 * Math.sin(0.17 * s + 2.2);
    for (const f of fish) {
      const s = t - f.a * 0.08;
      const vx = 24 * 0.11 * Math.cos(0.11 * s + 0.4), vy = 8 * 0.17 * Math.cos(0.17 * s + 2.2);
      const th = Math.atan2(vy, vx);
      const ct = Math.cos(th), st = Math.sin(th);
      const wob = Math.sin(t * 1.3 * f.sp + f.ph);
      const fx = pathX(s) + f.a * ct - f.b * st + wob * 0.6;
      const fy = pathY(s) + f.a * st + f.b * ct + Math.cos(t * f.sp + f.ph) * 0.4;
      const h = th + 0.15 * wob;
      const dx = Math.cos(h), dy = Math.sin(h);
      // dark blue-grey backs against the light, seen through a few metres
      // of water, until a fish turns its silver flank to the sun
      const flash = smooth(0.72, 0.97, Math.abs(Math.sin(th * 1.6 + f.a * 0.35 + f.b * 0.4 - t * 0.5 + 0.6)));
      const far = 0.28 + 0.12 * Math.tanh(f.b * 0.3); // the far side of the school is hazier
      const R0 = mix(0.02, 0.62, flash), G0 = mix(0.05, 0.86, flash), B0 = mix(0.07, 0.9, flash);
      // a short body on the fine grid: head, body, tail
      for (let j = 0; j < 3; j++) {
        const cx = gx(fx + 0.5 - dx * j * 0.55), cy = gy(fy + 0.5 - dy * j * 0.55);
        if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
        const k = cy * W + cx;
        // the belly is paler than the back
        const belly = j === 1 ? 1.15 : 1;
        put(cx, cy, mix(R0 * belly, wr[k], far), mix(G0 * belly, wg[k], far), mix(B0 * belly, wb[k], far), j === 0 ? 1 : j === 1 ? 0.9 : 0.7);
      }
    }

    // kelp: dark fronds framing the view; the blades are thin enough for the
    // bright water behind them to glow through, olive-gold, and a sun-side
    // edge catches the light where a shaft hits it
    for (const kp of kelp) {
      const { bx, base, len, sz, ph, haze } = kp;
      const side = bx < 100 ? 1 : -1; // which way the sun lies
      for (let r = H - 1; r >= 0; r--) {
        const yr = YD[r] - 0.5; // design row
        if (yr >= base || yr < base - len) continue;
        const s01 = (base - yr) / len;
        const lean = side * 2.5 * sz * s01 * s01;
        // the swell runs up the frond, so it bends in an S rather than tipping like a stick
        const bend = Math.sin(t * 0.55 + ph - s01 * 4.2) * 2.2 * sz * Math.pow(s01, 1.2) + Math.sin(t * 0.21 + ph) * 1.5 * s01 + lean;
        const x = bx + bend;
        // the frond: a stipe with blades off alternate sides, each blade a lobe
        // that swells and tapers, trailing a little behind the stipe's sway
        const stem = 0.8 + 0.4 * sz * (1 - s01);
        const beat = (base - yr) * 0.32 + ph;
        const lobeL = Math.pow(Math.max(0, Math.sin(beat)), 1.2) * sz * 2.3 * (1 - 0.35 * s01);
        const lobeR = Math.pow(Math.max(0, -Math.sin(beat)), 1.2) * sz * 2.3 * (1 - 0.35 * s01);
        const drag = Math.cos(t * 0.55 + ph - s01 * 4.2) * 0.8 * sz;
        const x0 = x - stem - lobeL + Math.min(0, drag), x1 = x + stem + lobeR + Math.max(0, drag);
        const ray = rayOf(r * W + Math.max(0, Math.min(W - 1, gx(x + 0.5)))) * Math.exp(-Math.max(0, yr) / 30);
        const lit = smooth(0.25, 0.6, ray);
        const down = Math.exp(-Math.max(0, yr) / 70); // less light reaches the lower fronds
        const xa = gx(x0 + 0.5), xb = gx(x1 + 0.5);
        for (let xx = xa; xx <= xb; xx++) {
          if (xx < 0 || xx >= W) continue;
          const k = r * W + xx;
          const off = Math.abs(XD[xx] - 0.5 - x);
          const sun = side > 0 ? xx === xb : xx === xa;
          const rim = xx === xa || xx === xb;
          const blade = off > stem ? 1 : 0;
          // light through the blade: the water's brightness behind, filtered
          // to olive-gold, thinner (brighter) toward the blade's edge and
          // mottled along it
          const back = wg[k] + 0.4 * wb[k];
          const vein = 0.6 + 0.4 * noise(XD[xx] * 1.3, YD[r] * 0.45 + ph * 7);
          const thin = blade * (0.35 + 0.65 * smooth(0, 1.5 * sz, off - stem)) * vein;
          const through = back * 0.75 * thin * (0.7 + 0.6 * lit);
          const edge = rim ? 0.05 + 0.1 * down : 0;
          const glint = sun ? (0.06 + 0.5 * lit * (0.4 + 0.6 * blade)) * down : 0;
          let R0 = 0.01 + 0.62 * through + 0.55 * edge + 0.85 * glint;
          let G0 = 0.014 + 0.52 * through + 0.55 * edge + 0.72 * glint;
          let B0 = 0.01 + 0.12 * through + 0.35 * edge + 0.3 * glint;
          // the stipe is a dark rope, faintly brown where it is lit
          if (!blade) R0 += 0.012 * down, G0 += 0.008 * down;
          put(xx, r, mix(R0, wr[k], haze), mix(G0, wg[k], haze), mix(B0, wb[k], haze), 1);
          floor[k] = 0.03;
        }
      }
    }

    // bubbles: wobbling up to the surface, growing as they rise; a bright
    // highlight on top, a faint ring of light around them
    for (const b of bubbles) {
      const span = b.y0 - SURF;
      const p = ((t * b.sp) / span + b.ph) % 1;
      const y = b.y0 - p * span;
      const x = b.x0 + Math.sin(y * 0.35 + b.w) * 1.2 + p * 3;
      const v = 0.5 + 0.5 * p;
      const bx = gx(x + 0.5), by = gy(y + 0.5);
      add(bx, by, 0.62 * v, 0.88 * v, 0.95 * v);
      const e = (0.08 + 0.2 * smooth(0.45, 1, p)) * v;
      add(bx + 1, by, 0.6 * e, 0.85 * e, 0.92 * e), add(bx - 1, by, 0.4 * e, 0.6 * e, 0.65 * e);
      add(bx, by - 1, 0.7 * e, 0.95 * e, e), add(bx, by + 1, 0.3 * e, 0.45 * e, 0.5 * e);
    }
    // particles: lit by the sun from above, brighter inside a shaft, fading
    // with the light as the water deepens
    for (const s of snow) {
      const x = (((s.x + t * s.sp + 2 * Math.sin(t * 0.3 + s.ph)) % DW) + DW) % DW;
      const y = (((s.y + t * s.sp * 0.4) % DH) + DH) % DH;
      const cx = Math.floor(x * S), cy = Math.floor(y * S);
      if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
      const k = cy * W + cx;
      const light = (0.35 + 1.6 * rayOf(k) * depthFadeR[cy] + 0.4 * depthFadeR[cy]) * (0.75 + 0.25 * Math.sin(t * 1.7 + s.ph * 3));
      if (s.z > 0.82) {
        // close to us and out of focus: a soft disc spread over four cells
        const v = s.b * light * 0.38;
        add(cx, cy, 0.6 * v, 0.85 * v, 0.9 * v), add(cx + 1, cy, 0.6 * v, 0.85 * v, 0.9 * v);
        add(cx, cy + 1, 0.6 * v, 0.85 * v, 0.9 * v), add(cx + 1, cy + 1, 0.6 * v, 0.85 * v, 0.9 * v);
      } else {
        const v = s.b * light * (0.35 + 0.65 * s.z);
        add(cx, cy, 0.6 * v, 0.85 * v, 0.9 * v);
      }
    }

    for (let k = 0; k < N; k++) dot(px, k, cr[k], cg[k], cb[k], floor[k]);
  };
}
