/*
 * kyoto dusk: a five-storey pagoda dark against an indigo to rose sky with a
 * thin crescent moon, a temple pond holding its reflection, and in front a
 * cherry tree in full bloom lit from below by a stone lantern. Petals fall
 * and drift through the frame, the lantern flickers, the pond shivers.
 *
 * Shaded in colour cell by cell, then drawn as a halftone: every cell is a
 * dot whose size is its brightness, in its own colour.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "kyoto dusk",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#0b0a16",
} satisfies Meta;

/*
 * The picture is designed on a 200-wide grid (y 0 at the old top edge, the
 * far bank at 80) and sampled at 1.6 cells per design unit into a 320x180
 * frame: 8 design rows of extra sky above and 4.5 of extra bank and water
 * below make up the 16:9 shape.
 */
const W = 320, H = 180;
const S = 1.6; // output cells per design unit
const Y0 = 8; // design rows added above the old top edge
const YMAX = H / S - Y0; // design y of the frame's bottom edge (104.5)
const DW = W / S; // design width (200)
const SHORE = 80; // the far bank of the pond, where the pagoda stands
const PX = 141; // the pagoda's axis
const MOON = [176, 17];
const LX = 53, LB = 98, LS = 1.8; // the lantern's axis, foot and scale
const LAMP = [LX, LB - (LB - 83) * LS]; // its lit opening

const SKY = 0, HILL = 1, TOWN = 2, PAGODA = 3, POND = 4, BANK = 5, TREE = 6, BLOOM = 7, STONE = 8, FLAME = 9;

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

// distance from a point to a segment, and how far along it the nearest point is
function seg(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay;
  const k = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  const ex = ax + dx * k - px, ey = ay + dy * k - py;
  return [Math.sqrt(ex * ex + ey * ey), k];
}

/*
 * The pagoda, in cells about its axis: returns a shade code or 0 for air.
 * 1 body, 2 roof top, 3 roof underside, 4 roof rim, 5 spire, 6 lit doorway.
 */
const EAVE = [68.5, 58, 48.5, 40, 32.5]; // where each roof's eave sits
const ROOF = [14.5, 13.4, 12.3, 11.2, 10.1]; // each roof's half-width
const BODY = [6.4, 5.9, 5.4, 4.9, 4.4];
function pagoda(dx: number, y: number): number {
  const ax = Math.abs(dx);
  // stone base
  if (y >= 76 && y < SHORE + 0.5) return ax <= 9.5 - (y < 77 ? 1 : 0) ? 1 : 0;
  for (let i = 0; i < 5; i++) {
    const e = EAVE[i], R = ROOF[i];
    // a roof: thin at its upturned tips, rising in a shallow concave curve to the body
    const u = ax / R;
    if (u <= 1) {
      const lift = 3.5 * u * u * u * u;
      const bottom = e - lift + 0.6;
      const top = e - lift - 1.2 - 3.6 * Math.pow(1 - u, 1.7);
      if (y >= top && y < bottom) {
        if (y < top + 0.9) return 4;
        if (y > bottom - 1.0) return 3;
        return 2;
      }
    }
    // the storey beneath this roof, up from the roof below it (or the base)
    const floor = i === 0 ? 76 : EAVE[i - 1] - 3.6;
    if (y >= e + 0.6 && y < floor && ax <= BODY[i]) {
      if (i === 0 && ax <= 1 && y > 72 && y < 75.5) return 6;
      // a railed balcony under each roof
      if (y < e + 2 && ax <= BODY[i] + 1.2) return 3;
      return 1;
    }
    if (i > 0 && y >= e + 0.6 && y < e + 2 && ax <= BODY[i] + 1.2) return 3;
  }
  // the spire: a mast with nine rings and a flame-shaped finial
  const top = EAVE[4] - 1.2 - 3.6 - 0.2;
  if (y < top && y >= 9) {
    if (y >= top - 1.5) return ax <= 2.4 ? 3 : 0; // the roof box
    if (y >= 15 && y < top - 1.5) {
      const ring = Math.floor((y - 15) / 1.2) & 1;
      return ax <= (ring ? 1.4 : 0.55) ? 5 : 0;
    }
    if (y >= 12) return ax <= 1.3 - (y - 12) * 0.2 ? 5 : 0;
    return ax <= 0.6 ? 5 : 0;
  }
  return 0;
}

export default function kyotoDusk(): Frame {
  const N = W * H;

  // each output cell's centre in design units
  const XC = new Float32Array(W), YC = new Float32Array(H);
  for (let x = 0; x < W; x++) XC[x] = (x + 0.5) / S;
  for (let r = 0; r < H; r++) YC[r] = (r + 0.5) / S - Y0;
  const rowOf = (y: number) => Math.floor((y + Y0) * S); // output row holding design y
  const colOf = (x: number) => Math.floor(x * S);
  const SHORE_ROW = Math.ceil((SHORE + Y0) * S - 0.5); // first output row of the pond and bank

  const mat = new Uint8Array(N);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const floorA = new Float32Array(N).fill(0.1);
  const albedo = new Float32Array(N); // how much of the lantern's light each cell sends back
  const balpha = new Float32Array(N); // how much of a blossom cell the blossom covers (soft crown edge)

  // --- sky ----------------------------------------------------------------
  // The sun is a few degrees under the western (left) horizon: deep indigo
  // overhead paling to a dusty violet, and over the west the afterglow, amber
  // on the hills shading up through rose into the blue.
  const skyAt = (x: number, y: number): [number, number, number] => {
    const h = clamp((SHORE - y) / (SHORE + Y0)); // 0 at the horizon, 1 at the top edge
    const z = Math.pow(h, 0.62);
    const wx = (x - 66) / 80;
    const west = Math.exp(-wx * wx);
    const d = Math.max(0, SHORE - y);
    const a1 = Math.exp(-d / 5.5) * (0.22 + 0.78 * west); // amber, hugging the hills
    const a2 = Math.exp(-d / 17) * (0.3 + 0.7 * west); // rose, higher and wider
    const a3 = Math.exp(-d / 34) * (0.45 + 0.55 * west); // the violet it fades through
    const base = 1 - 0.55 * a1;
    let r = mix(0.2, 0.03, z) * base, g = mix(0.2, 0.038, z) * base, b = mix(0.36, 0.12, z) * base;
    r += a1 * 0.78 + a2 * 0.3 + a3 * 0.08;
    g += a1 * 0.4 + a2 * 0.12 + a3 * 0.04;
    b += a1 * 0.14 + a2 * 0.13 + a3 * 0.1;
    // a faint unevenness in the air, so no stretch of sky is one flat tone
    const veil = 0.95 + 0.1 * fbm(x * 0.03, y * 0.08, 3, 0);
    r *= veil, g *= veil, b *= veil;
    // the moon's halo: a small bright aureole in a wide faint glow
    const mx = x - MOON[0], my = y - MOON[1];
    const md = Math.sqrt(mx * mx + my * my);
    const halo = Math.exp(-md / 3.2) * 0.2 + Math.exp(-md / 13) * 0.05;
    r += halo * 0.82, g += halo * 0.84, b += halo * 0.95;
    return [r, g, b];
  };
  // the haze over the water at each column: the low sky, dimmed
  const mistR = new Float32Array(W), mistG = new Float32Array(W), mistB = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const [r, g, b] = skyAt(XC[x], SHORE - 4);
    (mistR[x] = r * 0.62), (mistG[x] = g * 0.6), (mistB[x] = b * 0.66);
  }

  // --- the far side: hills, town roofs, the pagoda -------------------------
  // low in the west where the glow is, rising behind the pagoda and the town
  const hillA = (x: number) => 77.5 - (3 + 13 * smooth(70, 175, x)) * (0.3 + 1.1 * fbm(x * 0.022 + 3, 1, 4, 0));
  const hillB = (x: number) => 77 - 2.5 * fbm(x * 0.04 + 9, 2, 4, 0);
  // low tiled roofs along the far bank, a few lit
  const town = (x: number) => {
    const i = Math.floor((x + 3) / 11);
    const f = (x + 3) / 11 - i;
    // a hipped roof: a short level ridge, sloping ends, a gap between houses
    const h = 2 + hash(i, 5) * 2.5;
    const e = Math.abs(f - 0.5) * 2;
    return e > 0.86 ? SHORE : SHORE - 1 - h + Math.max(0, e - 0.35) * 6;
  };

  // --- the cherry tree's skeleton ----------------------------------------
  const branches: number[][] = [
    // trunk, leaning up and to the right, flaring into the moss below the frame
    [14.6, 106, 20, 86, 5.5, 4.4], [20, 86, 27, 70, 4.4, 3.6], [27, 70, 31, 58, 3.6, 3],
    // limbs
    [31, 58, 50, 46, 3, 2.1], [50, 46, 74, 37, 2.1, 1.4], [74, 37, 98, 31, 1.4, 0.9], [98, 31, 116, 30, 0.9, 0.5],
    [31, 58, 24, 40, 2.6, 1.8], [24, 40, 12, 26, 1.8, 1.1], [12, 26, 0, 18, 1.1, 0.7],
    [29, 50, 42, 30, 2, 1.3], [42, 30, 52, 19, 1.3, 0.8], [52, 19, 70, 13, 0.8, 0.5],
    [50, 46, 60, 52, 1.2, 0.7], [74, 37, 86, 44, 1, 0.5], [42, 30, 66, 24, 1, 0.6], [66, 24, 90, 21, 0.6, 0.4],
    [24, 40, 34, 25, 1, 0.6], [12, 26, 6, 16, 0.7, 0.4], [98, 31, 104, 40, 0.6, 0.35],
    // sprays drooping low over the lantern
    [40, 51, 44, 58, 1.1, 0.4], [58, 43, 62, 55, 0.9, 0.35], [70, 38, 76, 47, 0.7, 0.3],
  ];
  // short twigs off every limb, reaching up and out
  const limbs = branches.length;
  for (let b = 3; b < limbs; b++) {
    const [ax, ay, bx, by, w0, w1] = branches[b];
    const ang = Math.atan2(by - ay, bx - ax);
    for (let j = 0; j < 3; j++) {
      const k = 0.25 + 0.65 * hash(b * 7 + j, 31);
      const sx = mix(ax, bx, k), sy = mix(ay, by, k);
      const turn = (j & 1 ? 1 : -1) * (0.5 + 0.6 * hash(b, j + 40));
      const len = 4 + 7 * hash(b + j, 41);
      const a2 = ang + turn - 0.25;
      branches.push([sx, sy, sx + Math.cos(a2) * len, sy + Math.sin(a2) * len, mix(w0, w1, k) * 0.55, 0.3]);
    }
  }
  // blossom clumps all along the limbs and twigs, thickest at their ends;
  // each with its own shade of pink
  const clusters: [number, number, number, number][] = [];
  for (let b = 3; b < branches.length; b++) {
    const [ax, ay, bx, by, w0] = branches[b];
    const len = Math.hypot(bx - ax, by - ay);
    const n = 1 + Math.round(len / 1.7);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      if (k < 0.3 && w0 > 2) continue;
      const h1 = hash(b * 13 + i, 7), h2 = hash(b * 5 + i, 11), h3 = hash(b * 3 + i, 17);
      const cx = mix(ax, bx, k) + (h1 - 0.5) * 6, cy = mix(ay, by, k) + (h2 - 0.5) * 4.5 - 1;
      // only the drooping sprays (and their twigs) hang below the crown
      const spray = (b >= limbs - 3 && b < limbs) || b >= limbs + 3 * (limbs - 6);
      // the crown is domed: thinner toward its top, never cut by the frame
      const dome = 9 + 10 * Math.pow(clamp(Math.abs(cx - 52) / 70), 1.6);
      if (cx > 122 || cy < dome || cy > (spray ? 55 : 47)) continue;
      clusters.push([cx, cy, 1.4 + 1.6 * h3 + 0.8 * k, hash(b * 11 + i, 19)]);
    }
  }

  const bankX = (y: number) => 38 + (y - SHORE) * 2.3 + 4 * fbm(y * 0.2, 4, 2, 0);

  // build the static picture, sampling the design at each output cell's centre
  const lights: [number, number, number, number][] = []; // lit windows: cell and colour, to spill a halo
  for (let r = 0; r < H; r++) {
    const y = YC[r];
    const bx = y < SHORE ? 0 : bankX(y);
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      const xc = XC[x];
      let m = SKY, cr = 0, cg = 0, cb = 0, fl = 0.1, alb = 0;
      if (y < SHORE) {
        [cr, cg, cb] = skyAt(xc, y);
        fl = 0.03;
        let lit = false;
        // distant hills in haze, then a nearer ridge
        const hA = hillA(xc);
        if (y >= hA) {
          // the Higashiyama hills, flattened by the haze toward the sky behind them
          m = HILL;
          const s = skyAt(xc, hA - 1);
          const tex = 0.7 * fbm(xc * 0.3, y * 0.45, 3, 0) + 0.3 * noise(xc * 1.2, y * 1.4, 0);
          const v = 0.82 + 0.36 * tex;
          const haze = 0.42 - 0.12 * smooth(hA, hA + 8, y);
          cr = mix(0.06 * v, s[0], haze), cg = mix(0.05 * v, s[1], haze), cb = mix(0.1 * v, s[2], haze);
          // the ridge line catches the afterglow
          const lip = smooth(hA + 1.2, hA, y) * 0.35;
          cr = mix(cr, s[0], lip), cg = mix(cg, s[1], lip), cb = mix(cb, s[2], lip);
          fl = 0.06;
        }
        const hB = hillB(xc);
        if (y >= hB) {
          // a nearer wooded bank, darker, less hazed
          m = HILL;
          const tex = 0.6 * fbm(xc * 0.3, y * 0.3, 3, 0) + 0.4 * noise(xc * 1.5, y * 1.5, 0);
          const s = skyAt(xc, 74);
          const v = 0.75 + 0.5 * tex;
          cr = mix(0.04 * v, s[0], 0.2), cg = mix(0.036 * v, s[1], 0.2), cb = mix(0.065 * v, s[2], 0.2);
          fl = 0.06;
        }
        const tw = town(xc);
        if (y >= tw && xc > 70) {
          m = TOWN;
          const v = 0.85 + 0.3 * noise(xc * 2, y * 2, 0);
          (cr = 0.042 * v), (cg = 0.036 * v), (cb = 0.062 * v);
          // the roof ridges catch the sky
          const tf = Math.abs(((xc + 3) / 11) % 1 - 0.5) * 2;
          if (y < tw + 0.7 && tf < 0.45) {
            const s = skyAt(xc, 60);
            (cr = s[0] * 0.55), (cg = s[1] * 0.52), (cb = s[2] * 0.55), (fl = 0.05);
          }
          // a few lit shoji under the eaves, each its own warmth
          const wi = Math.floor(xc / 4);
          if (y > SHORE - 1.6 && y < SHORE - 0.5 && (xc % 4) < 1.2 && hash(wi, 7) > 0.74) {
            const warm = hash(wi, 8), lum = 0.55 + 0.5 * hash(wi, 9);
            (cr = lum), (cg = lum * mix(0.52, 0.74, warm)), (cb = lum * mix(0.2, 0.42, warm));
            fl = 0.25;
            lit = true;
          }
        }
        const p = pagoda(xc - PX, y);
        if (p) {
          m = PAGODA;
          const dx = xc - PX;
          const rim = Math.exp(-Math.abs(dx + 4) / 30); // the sky to the west lights its left
          const west = dx < 0 ? 1 : 0.55;
          const grain = 0.8 + 0.4 * noise(xc * 2.5, y * 0.4, 0);
          fl = 0.05;
          if (p === 1) {
            // dark timber, darkest in the shadow under each eave, its west edge rimmed by the glow
            const ao = pagoda(dx, y - 1.4) > 1 ? 0.55 : pagoda(dx, y - 2.6) > 1 ? 0.8 : 1;
            (cr = 0.05 * grain * ao), (cg = 0.038 * grain * ao), (cb = 0.06 * grain * ao);
            if (!pagoda(dx - 0.8, y)) (cr += 0.1), (cg += 0.06), (cb += 0.08);
          } else if (p === 2) {
            // tiled roofs: rows of tiles running down the slope, lit from the sky above
            const tiles = 0.82 + 0.18 * Math.sin(dx * 4.2);
            const v = tiles * grain * (0.75 + 0.4 * rim) * west;
            (cr = 0.13 * v), (cg = 0.11 * v), (cb = 0.17 * v);
          } else if (p === 3) (cr = 0.025 * grain), (cg = 0.02 * grain), (cb = 0.038 * grain);
          else if (p === 4) {
            // the eave's edge, where the tiles meet the sky
            const v = (0.5 + 0.7 * rim) * west * grain;
            (cr = 0.34 * v), (cg = 0.25 * v), (cb = 0.32 * v);
          } else if (p === 5) {
            // the bronze finial, its west face lit
            const v = dx < 0 ? 1 : 0.55;
            (cr = 0.3 * v), (cg = 0.2 * v), (cb = 0.18 * v);
          } else if (p === 6) {
            (cr = 0.8), (cg = 0.46), (cb = 0.2), (fl = 0.2);
            lit = true;
          }
          // a mile off, so a little of the air's colour lies over it
          if (!lit) {
            const s = skyAt(xc, 70);
            (cr = mix(cr, s[0], 0.07)), (cg = mix(cg, s[1], 0.07)), (cb = mix(cb, s[2], 0.07));
          }
        }
        // mist settling along the water, over everything on the far bank
        if (m !== SKY) {
          const mist = Math.pow(smooth(70, SHORE + 0.5, y), 1.6) * (lit ? 0.25 : 0.6);
          (cr = mix(cr, mistR[x] * 1.3, mist)), (cg = mix(cg, mistG[x] * 1.3, mist)), (cb = mix(cb, mistB[x] * 1.3, mist));
        }
        if (lit) lights.push([k, cr, cg, cb]);
      } else {
        // the pond, and the near bank where the lantern stands
        if (xc < bx) {
          m = BANK;
          // moss and grass, dark and dull, mottled at several scales
          const tex = 0.5 * fbm(xc * 0.25, y * 0.5, 3, 0) + 0.3 * noise(xc * 1.3, y * 1.8, 0) + 0.2 * hash(x * 7, r * 5);
          const v = 0.6 + 0.8 * tex;
          // a little sky sheen on the far part of the bank
          const sheen = smooth(SHORE + 8, SHORE, y) * 0.03;
          (cr = 0.042 * v + sheen), (cg = 0.048 * v + sheen * 0.9), (cb = 0.04 * v + sheen * 1.3);
          alb = 0.45 * v;
          fl = 0.06;
          // fallen petals on the moss, thicker under the tree
          const under = Math.exp(-Math.abs(xc - 30) / 25);
          if (hash(x * 7, r * 3) > 0.985 - 0.03 * under - 0.012 * smooth(SHORE + 4, YMAX, y)) {
            const s = 0.75 + 0.5 * hash(x, r);
            (cr = 0.28 * s), (cg = 0.18 * s), (cb = 0.23 * s), (alb = 0.45 * s), (fl = 0.05);
          }
          // the stone lip of the pond: worn granite, its top lit by the sky
          if (xc > bx - 2.6) {
            const s = 0.7 + 0.35 * hash(x * 3, r * 5) + 0.25 * noise(xc * 1.2, y * 2, 0);
            const top = smooth(bx - 0.6, bx, xc) * 0.6 + 0.4;
            (cr = 0.15 * s * top + 0.03), (cg = 0.14 * s * top + 0.03), (cb = 0.16 * s * top + 0.04);
            (alb = 0.6 * s), (fl = 0.06);
          }
        } else (m = POND), (fl = 0.05);
      }
      mat[k] = m;
      R[k] = cr, G[k] = cg, B[k] = cb;
      floorA[k] = fl;
      albedo[k] = alb;
    }
  }
  // the lit windows spill a soft halo into the mist around them; those along
  // the waterline also lay a long broken streak down the pond (per column)
  const streakR = new Float32Array(W), streakG = new Float32Array(W), streakB = new Float32Array(W);
  for (const [k, lr, lg, lb] of lights) {
    const r0 = (k / W) | 0, x0 = k % W;
    for (let dr = -4; dr <= 4; dr++)
      for (let dx = -4; dx <= 4; dx++) {
        const r = r0 + dr, x = x0 + dx;
        if (r < 0 || r >= SHORE_ROW || x < 0 || x >= W || (!dr && !dx)) continue;
        const j = r * W + x;
        const h = Math.exp(-Math.sqrt(dx * dx + dr * dr * 1.3) / 1.1) * 0.13;
        R[j] += lr * h, G[j] += lg * h, B[j] += lb * h;
      }
    if (YC[r0] < SHORE - 2) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx;
      if (x < 0 || x >= W) continue;
      const h = dx ? 0.1 : 0.22;
      (streakR[x] += lr * h), (streakG[x] += lg * h), (streakB[x] += lb * h);
    }
  }
  // the reflection source: the far side before the tree covers it
  const RR = R.slice(), RG = G.slice(), RB = B.slice();

  // --- the stone lantern ----------------------------------------------------
  const lantern = (dx: number, y: number): number => {
    const ax = Math.abs(dx);
    if (y >= 93.5 && y < LB) return ax <= 4.2 - (y < 94.5 ? 0.8 : 0) ? 1 : 0; // foot
    if (y >= 87 && y < 93.5) return ax <= 1.4 ? 1 : 0; // post
    if (y >= 85.5 && y < 87) return ax <= 3.6 - (y < 86.2 ? 0.6 : 0) ? 1 : 0; // platform
    if (y >= 80 && y < 85.5) {
      if (ax <= 1.7 && y >= 80.8 && y < 84.8) return 2; // lit opening
      return ax <= 2.9 ? 1 : 0;
    }
    if (y >= 76.5 && y < 80) {
      // the roof, flaring out with upturned corners
      const u = (80 - y) / 3.5;
      const hw = 5.6 - 4.1 * Math.pow(u, 0.8) + (y > 79.2 ? 0.6 : 0);
      return ax <= hw ? 3 : 0;
    }
    if (y >= 73.5 && y < 76.5) return ax <= 1.3 - Math.abs(y - 75) * 0.25 ? 3 : ax <= 0.5 ? 3 : 0; // finial
    return 0;
  };
  // drawn a size up from its plan, standing on the bank
  const at = (xc: number, y: number) => lantern((xc - LX) / LS, LB - (LB - y) / LS);
  const flameC = new Float32Array(N); // how near the heart of the firebox each opening cell is
  for (let r = rowOf(45); r < H; r++) {
    const y = YC[r];
    for (let x = colOf(LX - 14); x <= colOf(LX + 14); x++) {
      const xc = XC[x];
      const l = at(xc, y);
      if (!l) continue;
      const k = r * W + x;
      const py = LB - (LB - y) / LS, pdx = (xc - LX) / LS;
      if (l === 2) {
        mat[k] = FLAME;
        // hottest at the heart of the firebox
        flameC[k] = Math.exp(-(pdx * pdx * 0.45 + (py - 82.8) * (py - 82.8) * 0.3));
        floorA[k] = 0.35;
        albedo[k] = 0;
      } else {
        mat[k] = STONE;
        // weathered granite, mottled and pitted, its top surfaces catching the last of the sky
        const g = 0.7 + 0.35 * hash(x * 5, r * 3) + 0.3 * noise(xc * 1.5, y * 1.5, 0);
        const edge = !at(xc, y - 0.9) ? 1 : 0;
        // its west face takes a little of the afterglow, the far face falls away into shadow
        const side = 0.85 + 0.3 * smooth(1, -2, pdx);
        (R[k] = (0.05 + 0.13 * edge) * g * side), (G[k] = (0.045 + 0.1 * edge) * g * side), (B[k] = (0.06 + 0.14 * edge) * g * side);
        // where the stone meets the moss it sits in its own shadow
        if (py > 96.5) (R[k] *= 0.6), (G[k] *= 0.6), (B[k] *= 0.6);
        // the roof's underside, the platform and the opening's jambs take the flame's light
        const under = (l === 3 && py > 78.6) || (py >= 85.5 && py < 86.4);
        const jamb = py >= 80 && py < 85.5 && Math.abs(pdx) < 2.5 ? 1 : 0;
        const f = under ? Math.exp(-Math.abs(py - 82.8) / 3) * 0.7 : jamb * 0.25;
        (R[k] += f * g), (G[k] += f * 0.55 * g), (B[k] += f * 0.2 * g);
        floorA[k] = 0.04;
        albedo[k] = 0.18;
      }
    }
  }

  // --- the cherry tree -------------------------------------------------------
  const TX = colOf(130);
  for (let r = 0; r < H; r++) {
    const y = YC[r];
    // only the clumps and limbs that can reach this row
    const rc = clusters.filter(([, cy, rad]) => Math.abs(y - cy) * 1.15 < rad * 1.74);
    const rb = branches.filter(([, ay, , by, w0, w1]) => y > Math.min(ay, by) - Math.max(w0, w1) && y < Math.max(ay, by) + Math.max(w0, w1));
    for (let x = 0; x < TX; x++) {
      const k = r * W + x;
      const xc = XC[x];
      // blossom density: soft clouds, broken up by noise into clumps
      let d = 0, best = 0, up = 0, tint = 0;
      for (const [cx, cy, rad, hue] of rc) {
        const dx = xc - cx, dy = (y - cy) * 1.15;
        const q = (dx * dx + dy * dy) / (rad * rad);
        if (q < 3) {
          const c = Math.exp(-q * 1.4);
          d += c;
          if (c > best) (best = c), (up = (dy + dx * 0.4) / rad), (tint = hue);
        }
      }
      let onBranch = false, bw = 0;
      for (const [ax, ay, bx, by, w0, w1] of rb) {
        const [dist, kk] = seg(xc, y, ax, ay, bx, by);
        const w = mix(w0, w1, kk) * 0.5 + 0.15;
        if (dist < w) {
          onBranch = true;
          bw = Math.max(bw, (dist / w) * (xc < ax + (bx - ax) * kk ? -1 : 1));
        }
      }
      if (!d && !onBranch) continue;
      // big holes where the sky shows through, small ones between clumps
      const n = fbm(xc * 0.11, y * 0.15, 3, 0), n2 = noise(xc * 0.5, y * 0.6, 0);
      const bloom = (1 - Math.exp(-d * 1.5)) * (0.15 + 1.35 * n) * (0.75 + 0.5 * n2);
      if (onBranch && bloom < 0.85) {
        mat[k] = TREE;
        // dark bark threading through the blossom, faintly ridged;
        // the side toward the lantern catches its light
        const lit = smooth(0.2, 1, bw);
        const v = 0.8 + 0.4 * noise(xc * 0.8, y * 3, 0);
        (R[k] = 0.04 * v), (G[k] = 0.03 * v), (B[k] = 0.04 * v);
        floorA[k] = 0;
        albedo[k] = 0.12 + 0.45 * lit;
        balpha[k] = 1;
      } else if (bloom > 0.38) {
        mat[k] = BLOOM;
        // pale petals, nearly white, some sprays pinker than others
        const pink = tint * tint;
        const ar = 0.98, ag = mix(0.84, 0.64, pink), ab = mix(0.86, 0.74, pink);
        // lit from above by the cool sky, and from the west by the afterglow;
        // the undersides and the hearts of the clumps in shade
        const top = smooth(1.3, -0.9, up);
        const deep = smooth(0.6, 1.6, d) * 0.3;
        const self = (0.26 + 1.0 * top * top) * (1 - deep);
        const west = 0.05 + 0.2 * Math.exp(-Math.abs(xc - 60) / 50) * smooth(0, 1, 0.4 - up);
        // single florets and their gaps, in little knots
        const grain = (0.74 + 0.52 * hash(x * 3, r * 7)) * (0.8 + 0.4 * noise(xc * 1.7, y * 1.9, 0));
        // the lower crown sits in its own shade
        const low = 1 - 0.35 * smooth(28, 48, y);
        const v = grain * low;
        R[k] = ar * (self * 0.8 + west) * v;
        G[k] = ag * (self * 0.76 + west * 0.62) * v;
        B[k] = ab * (self * 0.84 + west * 0.52) * v;
        floorA[k] = 0.08;
        albedo[k] = 0.9 * low;
        balpha[k] = smooth(0.38, 0.8, bloom);
      }
    }
  }

  // the lantern's light: how far each cell sits from the lit opening
  const glow = new Float32Array(N);
  for (let r = 0; r < H; r++)
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      const dx = XC[x] - LAMP[0], dy = (YC[r] - LAMP[1]) * 1.1;
      const d = Math.sqrt(dx * dx + dy * dy);
      glow[k] = Math.exp(-d / 4) * 0.6 + Math.exp(-d / 11) * 0.32 + Math.exp(-d / 32) * 0.1;
      // the blossom overhead takes the lamp's light from below, from further off
      const m = mat[k];
      if (m === BLOOM || m === TREE) glow[k] += Math.exp(-d / 11) * 1.6;
      // and a pool of light on the moss round its foot
      if (m === BANK) {
        const px = (XC[x] - LX) / 20, py = (YC[r] - LB + 3) / 8;
        glow[k] += Math.exp(-(px * px + py * py)) * 0.8;
      }
    }

  // the moon: a thin crescent lit on the side toward the set sun, the rest of
  // its disc faintly there in earthshine; sampled finely so its edge is soft
  const moonLit = new Float32Array(N), moonDisc = new Float32Array(N);
  for (let r = rowOf(MOON[1] - 6); r <= rowOf(MOON[1] + 6); r++)
    for (let x = colOf(MOON[0] - 6); x <= colOf(MOON[0] + 6); x++) {
      let lit = 0, disc = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const dx = (x + (sx + 0.5) / 4) / S - MOON[0], dy = (r + (sy + 0.5) / 4) / S - Y0 - MOON[1];
          if (dx * dx + dy * dy >= 5.2 * 5.2) continue;
          disc++;
          const ex = dx - 2.2, ey = dy + 1.6; // the shadowed disc, offset up and right
          if (ex * ex + ey * ey > 4.9 * 4.9) lit++;
        }
      const k = r * W + x;
      (moonLit[k] = lit / 16), (moonDisc[k] = disc / 16);
    }

  // faint stars in the indigo, each a single fine point, fewer toward the glow
  const stars: [number, number, number, number][] = [];
  const STAR_ROWS = rowOf(36);
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(hash(i, 91) * W), r = Math.floor(hash(i, 92) * STAR_ROWS);
    const k = r * W + x;
    if (mat[k] !== SKY || moonDisc[k] > 0 || hash(i, 93) < 0.72) continue;
    const fadeIn = smooth(36, 10, YC[r]) * (0.4 + 0.6 * smooth(40, 120, XC[x]));
    stars.push([k, hash(i, 94) * 6.28, 0.6 + hash(i, 95) * 1.6, fadeIn * (0.25 + 0.75 * Math.pow(hash(i, 96), 2))]);
  }

  // thin streaks of cloud low in the sky; with the sun below the hills only
  // their undersides are lit, rose toward the west, while their upper parts
  // stand dark against the blue. They wrap so they can drift forever (stored
  // per output cell, CW design units round).
  const CW = 500, C0 = 34, C1 = 68;
  const CWO = CW * S, R0 = rowOf(C0), R1 = rowOf(C1);
  const cdens = (x: number, y: number) =>
    fbm(x * 0.014, y * 0.13, 4, CW * 0.014) - 0.3 * (1 - smooth(C0, C0 + 10, y) * smooth(C1, C1 - 8, y));
  const ccov = new Float32Array(CWO * (R1 - R0)), clit = new Float32Array(CWO * (R1 - R0));
  for (let r = R0; r < R1; r++)
    for (let x = 0; x < CWO; x++) {
      const y = YC[r], xd = x / S, d = cdens(xd, y);
      ccov[(r - R0) * CWO + x] = smooth(0.53, 0.74, d);
      clit[(r - R0) * CWO + x] = clamp(0.5 + (d - cdens(xd - 1, y + 2.2)) * 7);
    }
  // the light a cloud's underside takes in each cell of the band: amber-rose in the west, mauve to the east;
  // and its shadowed body, a little darker and greyer than the sky about it
  const cloudLR = new Float32Array(W * (R1 - R0)), cloudLG = new Float32Array(W * (R1 - R0)), cloudLB = new Float32Array(W * (R1 - R0));
  const cloudDR = new Float32Array(R1 - R0), cloudDG = new Float32Array(R1 - R0), cloudDB = new Float32Array(R1 - R0);
  for (let r = R0; r < R1; r++) {
    const low = smooth(C0, C1, YC[r]);
    (cloudDR[r - R0] = mix(0.06, 0.16, low)), (cloudDG[r - R0] = mix(0.055, 0.11, low)), (cloudDB[r - R0] = mix(0.12, 0.2, low));
    for (let x = 0; x < W; x++) {
      const west = Math.exp(-Math.abs(XC[x] - 66) / 70);
      const s = (0.35 + 0.65 * low) * (0.4 + 0.6 * west);
      const j = (r - R0) * W + x;
      (cloudLR[j] = s * mix(0.62, 1.0, west)), (cloudLG[j] = s * mix(0.4, 0.55, west)), (cloudLB[j] = s * mix(0.5, 0.42, west));
    }
  }

  // petals: each with its own drift, fall, sway and tumble (design units)
  const SPAN = YMAX + Y0 + 20; // they fall from above the frame to below it
  const petals: { x: number; y: number; vx: number; vy: number; sw: number; sf: number; ph: number; tum: number }[] = [];
  for (let i = 0; i < 64; i++)
    petals.push({
      // most of them near the tree, thinning out downwind
      x: Math.pow(hash(i, 101), 2.2) * 140, y: hash(i, 102) * SPAN,
      vx: 3 + hash(i, 103) * 4, vy: 1.6 + hash(i, 104) * 2.2,
      sw: 1 + hash(i, 105) * 2, sf: 0.6 + hash(i, 106) * 1.2, ph: hash(i, 107) * 6.28, tum: 2 + hash(i, 108) * 4,
    });
  // petals afloat on the pond, drifting slowly
  const floaters: [number, number, number][] = [];
  for (let i = 0; i < 34; i++) floaters.push([hash(i, 111) * DW, SHORE + 3 + hash(i, 112) * 21, 0.3 + hash(i, 113) * 0.5]);

  // a soft shoulder, so the brightest lights roll off instead of clipping
  const tone = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) {
    const v = i / 256;
    tone[i] = v < 0.8 ? v : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) * 5));
  }
  // a faint print grain, so even flat stretches are alive
  const grain = new Float32Array(N);
  for (let k = 0; k < N; k++) grain[k] = 0.96 + 0.08 * hash(k, 77);

  // per-row terms of the pond that don't change
  const depthR = new Float32Array(H), fresR = new Float32Array(H), fadeR = new Float32Array(H), mistW = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const y = YC[r];
    const depth = clamp((y - SHORE) / (100 - SHORE));
    depthR[r] = depth;
    // the water mirrors most at a glancing angle, by the far bank, and lets
    // you see down into its dark nearer by
    fresR[r] = mix(0.95, 0.2, Math.pow(depth, 0.5));
    fadeR[r] = smooth(YMAX + 2, YMAX - 9, y);
    mistW[r] = Math.exp(-Math.max(0, y - SHORE) / 3.5) * 0.3;
  }

  const pr = new Float32Array(N), pg = new Float32Array(N), pb = new Float32Array(N);
  const pmask = new Uint8Array(N);
  const LR = 1, LG = 0.6, LBL = 0.27; // the lamp's colour: candle-warm

  return (t, px) => {
    // the flame breathes, with now and then a gutter
    const flick = 0.82 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) + 0.12 * (noise(t * 4, 3.3, 0) - 0.5) * 2;
    const cdrift = (((t * 0.8 * S) % CWO) + CWO) % CWO;

    // petals in the air this frame
    pmask.fill(0);
    for (const p of petals) {
      const xx = ((((p.x + p.vx * t + p.sw * Math.sin(t * p.sf + p.ph)) % (DW + 40)) + DW + 40) % (DW + 40)) - 20;
      const yy = ((((p.y + p.vy * t + 0.6 * Math.sin(t * p.sf * 1.7 + p.ph)) % SPAN) + SPAN) % SPAN) - 10 - Y0;
      const x = Math.floor(xx * S), r = rowOf(yy);
      if (x < 0 || x >= W || r < 0 || r >= H) continue;
      const k = r * W + x;
      // tumbling, catching the sky's light as they turn; dimmer down by the dark bank and water
      const face = (0.35 + 0.65 * Math.abs(Math.sin(t * p.tum + p.ph))) * (mat[k] === POND || mat[k] === BANK ? 0.55 : 1);
      const lg = glow[k] * flick * 1.4;
      (pr[k] = 0.68 * face + lg * LR), (pg[k] = 0.58 * face + lg * LG), (pb[k] = 0.66 * face + lg * LBL);
      pmask[k] = 1;
    }
    // petals resting on the pond, rocking on the ripples
    for (const [fx, fy, sp] of floaters) {
      const x = Math.floor(((fx + t * sp) % DW) * S), r = rowOf(fy + 0.3 * Math.sin(t * 0.8 + fx));
      if (r >= H) continue;
      const k = r * W + x;
      if (mat[k] !== POND) continue;
      const lg = glow[k] * flick * 0.9;
      (pr[k] = 0.3 + lg * LR), (pg[k] = 0.23 + lg * LG), (pb[k] = 0.27 + lg * LBL);
      pmask[k] = 1;
    }

    for (let r = 0; r < H; r++) {
      const y = YC[r];
      const depth = depthR[r], fres = fresR[r];
      const cloudRow = r >= R0 && r < R1;
      const cr0 = (r - R0) * CWO, cl0 = (r - R0) * W;
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const m = mat[k];
        const xc = XC[x];
        let cr: number, cg: number, cb: number, fl = floorA[k], fade = 1;
        if (m === POND) {
          // the far side, upside down, shaken by small ripples
          const wob = Math.sin(y * 1.7 - t * 2 + Math.sin(xc * 0.13 + t * 0.6) * 1.4) * (0.05 + 0.8 * depth);
          const sx = x + wob * S;
          const w = noise(xc * 0.14 + t * 0.2, y * 1.1 - t * 0.8, 0);
          // ripples also tip the image up and down, so level lines break
          // (drawn a little stretched, so the pagoda's lower roofs land in the pond)
          let sr = rowOf(SHORE - (y - SHORE + 0.5) * 1.35 + (w - 0.5) * 3 * depth);
          sr = sr < 0 ? 0 : sr > SHORE_ROW - 1 ? SHORE_ROW - 1 : sr;
          // the further the reflection falls from the bank, the more the ripples smear it
          const spread = 0.6 + depth * 2.6;
          let rr = 0, rg = 0, rb = 0;
          for (let s = -1; s <= 1; s++) {
            let ix = Math.round(sx + s * spread);
            ix = ix < 0 ? 0 : ix > W - 1 ? W - 1 : ix;
            const j = sr * W + ix;
            const wt = s ? 0.28 : 0.44;
            (rr += RR[j] * wt), (rg += RG[j] * wt), (rb += RB[j] * wt);
          }
          // slopes facing the sky brighten, slopes facing us show the dark water
          const f = fres * (0.78 + 0.44 * w);
          cr = 0.012 + rr * f * 0.92, cg = 0.016 + rg * f * 0.94, cb = 0.03 + rb * f;
          // glints: where a ripple's crest tips just right it flashes the bright low sky,
          // in short streaks along the wavelets
          const sp = noise(xc * 0.32 - t * 0.5, y * 2.6 + t * 1.1, 0);
          const glint = smooth(0.78, 0.95, sp * w * 1.35) * (0.5 + 0.5 * (1 - depth)) * 1.4;
          if (glint > 0) (cr += glint * mistR[x]), (cg += glint * mistG[x]), (cb += glint * mistB[x]);
          // the lantern's light laid on the water as a broken warm streak
          const sl = Math.exp(-Math.abs(xc - LX - 9 - (y - SHORE) * 0.25) / (3.5 + depth * 3)) * smooth(0.45, 0.8, w) * 0.9 * flick;
          cr += sl * LR, cg += sl * LG, cb += sl * LBL;
          // and the windows across the water, each a thin wavering column of light
          let wx = Math.round(sx);
          wx = wx < 0 ? 0 : wx > W - 1 ? W - 1 : wx;
          if (streakR[wx] > 0) {
            const ws = Math.exp(-(y - SHORE) / 7) * smooth(0.35, 0.8, w) * 1.4;
            (cr += streakR[wx] * ws), (cg += streakG[wx] * ws), (cb += streakB[wx] * ws);
          }
          // a breath of mist lying on the water by the far bank
          const mw = mistW[r];
          (cr = mix(cr, mistR[x], mw)), (cg = mix(cg, mistG[x], mw)), (cb = mix(cb, mistB[x], mw));
          fade = fadeR[r];
        } else {
          cr = R[k], cg = G[k], cb = B[k];
          if (m === SKY || m === BLOOM) {
            // the sky behind: the clouds drifting over it, then the moon
            let sr = RR[k], sg = RG[k], sb = RB[k];
            if (cloudRow) {
              const sx = x + cdrift, ix = Math.floor(sx), fx = sx - ix;
              const i0 = cr0 + (ix % CWO), i1 = cr0 + ((ix + 1) % CWO);
              const c = ccov[i0] + (ccov[i1] - ccov[i0]) * fx;
              if (c > 0.01) {
                const l = clit[i0] + (clit[i1] - clit[i0]) * fx;
                // the lit underside fades into the dark body above it
                const lit = l * l;
                const j = cl0 + x, i = r - R0;
                const a = c * 0.88;
                sr = mix(sr, cloudDR[i] + cloudLR[j] * lit, a);
                sg = mix(sg, cloudDG[i] + cloudLG[j] * lit, a);
                sb = mix(sb, cloudDB[i] + cloudLB[j] * lit, a);
              }
            }
            const md = moonDisc[k];
            if (md > 0) {
              // the unlit part hides the sky behind it but glows a little with earthshine
              const ml = moonLit[k], dk = md - ml;
              sr = sr * (1 - md) + ml * 1.05 + dk * (sr * 0.6 + 0.035);
              sg = sg * (1 - md) + ml * 1.0 + dk * (sg * 0.6 + 0.04);
              sb = sb * (1 - md) + ml * 0.9 + dk * (sb * 0.6 + 0.06);
              fl = 0.03 + 0.3 * ml;
            }
            if (m === SKY) (cr = sr), (cg = sg), (cb = sb);
            else {
              // the crown's ragged edge lets the sky through
              const a = balpha[k];
              if (a < 1) (cr = mix(sr, cr, a)), (cg = mix(sg, cg, a)), (cb = mix(sb, cb, a));
            }
          }
        }
        // lamplight on everything near the lantern, by how much each surface gives back
        const al = albedo[k];
        if (al > 0) {
          const g = glow[k] * flick * al * (m === BLOOM ? balpha[k] : 1);
          cr += g * LR, cg += g * LG, cb += g * LBL;
        } else if (m === SKY || m === POND) {
          // and the halo it makes in the evening air
          const g = glow[k] * flick * 0.4;
          cr += g * LR, cg += g * LG, cb += g * LBL;
        }
        if (m === FLAME) {
          // the paper-screened firebox: near white at the heart, deep amber at its corners
          const c = flameC[k], f = (0.7 + 0.4 * c) * (0.8 + 0.3 * flick);
          (cr = f * 1.05), (cg = f * (0.55 + 0.3 * c)), (cb = f * (0.2 + 0.3 * c * c));
        }
        if (pmask[k] && m !== FLAME) {
          cr = pr[k], cg = pg[k], cb = pb[k], fl = 0.25;
        }
        const gr = grain[k];
        cr = tone[Math.min(1024, (cr * gr * 256) | 0)], cg = tone[Math.min(1024, (cg * gr * 256) | 0)], cb = tone[Math.min(1024, (cb * gr * 256) | 0)];
        dot(px, k, cr, cg, cb, fl, fade);
      }
    }
    // stars twinkle, each a point of light over the sky's own colour
    for (const [k, ph, sp, lum] of stars) {
      if (pmask[k]) continue;
      const b = lum * (0.55 + 0.45 * Math.sin(t * sp + ph)) * 0.8;
      dot(px, k, RR[k] + b * 0.92, RG[k] + b * 0.92, RB[k] + b, 0.03);
    }
  };
}
