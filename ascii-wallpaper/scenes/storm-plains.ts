/*
 * storm plains: an anvil thunderhead at dusk over open wheat country. The
 * sun has just set behind the farmhouse, so the storm's top and western flank
 * still catch its light while the base sinks into slate shadow. Lightning
 * flickers inside the cloud, now and then a bolt reaches the ground, rain
 * curtains drift under the base and the wheat moves in gusts.
 *
 * The cloud is built as a height field (heaped domes, a flat anvil, pouches
 * hanging under it) and lit from its surface normals. Every cell is shaded in
 * colour, then drawn as a halftone: a dot whose size is its brightness, in its
 * own colour.
 *
 * Coordinates are in design units (200 wide, the horizon at 64); every
 * output cell is sampled at its centre in those units.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "storm plains",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#0b0912",
} satisfies Meta;

// The picture is designed on a 200-wide grid (the original 200 x 100 frame)
// and sampled at 1.6 output cells per design unit, so the 320 x 180 frame
// shows 112.5 design rows: 8.5 more of sky on top, 4 more of wheat below.
const W = 320, H = 180; // output cells
const S = 1.6; // output cells per design unit
const Y0 = 8.5; // design rows above the original frame
const YB = H / S - Y0; // design y of the bottom edge
const FD = 36; // depth of the field, horizon to the original bottom edge
const XD = Float32Array.from({ length: W }, (_, i) => (i + 0.5) / S);
const YD = Float32Array.from({ length: H }, (_, i) => (i + 0.5) / S - Y0);
const HZ = 64; // the horizon
const SUN = [30, 70]; // just below the horizon, behind the farmhouse
const BASE = 45; // the storm's flat base

const SKY = 0, PLAIN = 1, FIELD = 2, ROAD = 3, HOUSE = 4, ROOF = 5, PANE = 6, TREE = 7, PUMP = 8, BELT = 9;

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
const dome = (dx: number, dy: number, r: number) => {
  const q = 1 - dx * dx - dy * dy;
  return q > 0 ? r * Math.sqrt(q) : 0;
};

// Distance from (px, py) to the segment a-b.
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const k = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  const ex = px - ax - dx * k, ey = py - ay - dy * k;
  return Math.sqrt(ex * ex + ey * ey);
}

export default function stormPlains(): Frame {
  const N = W * H;

  // --- the thunderhead, as a height field ----------------------------------
  const towerC = (y: number) => 138 + (BASE - y) * 0.14;
  const towerHW = (y: number) => 23 - (BASE - y) * 0.08;
  const anvilTop = (x: number) => 7.5 + 2.5 * smooth(150, 210, x) + 3 * smooth(112, 58, x);
  const anvilBot = (x: number) => 21 - 9 * smooth(124, 62, x) - 7 * smooth(152, 210, x);
  // The towers are heaps of puffs: [x, y, radius, bulge toward us]. Each puff
  // is a dome in the height field, so it gets its own lit side and shadow.
  const puffs: [number, number, number, number, number][] = [];
  let seed = 1;
  const rnd = () => hash(seed++, 911);
  for (let y = BASE - 4.5; y > 14; y -= 4.4) {
    const cx = towerC(y), hw = towerHW(y);
    const n = Math.max(2, Math.round((hw * 2) / 11));
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) / n) * 2 - 1;
      const rr = 7 + rnd() * 4;
      puffs.push([cx + u * (hw - rr * 0.55) + (rnd() - 0.5) * 3, y + (rnd() - 0.5) * 2, rr, 4 * Math.sqrt(1 - u * u * 0.85), 1]);
    }
  }
  // the overshooting top, bulging out of the anvil
  puffs.push([141, 8.5, 9, 2, 0], [133, 9.5, 6, 1, 0], [149, 10, 6, 1, 0]);
  // the flanking line: younger towers stepping down to the west
  for (const [cx, top, w] of [
    [104, 27, 9],
    [89, 34, 6.5],
    [77, 40.5, 3.8],
  ]) {
    for (let y = BASE - w * 0.4; y > top + w * 0.6; y -= w * 0.75) puffs.push([cx + (rnd() - 0.5) * w * 0.6, y, w * (0.75 + rnd() * 0.2), 1, 1]);
    puffs.push([cx - w * 0.35, top + w * 0.75, w * 0.62, 1, 1], [cx + w * 0.3, top + w * 0.6, w * 0.7, 1.5, 1], [cx, top + w * 0.45, w * 0.55, 2, 1]);
  }
  // one continuous low base under the line, so the towers stand on something
  for (let x = 66; x < 126; x += 3.2 + rnd() * 1.6) puffs.push([x, BASE - 1.8 - rnd() * 1.2, 3 + rnd() * 1.6 + 1.6 * smooth(70, 110, x), 0.4, 1]);

  // the grid: output cells, two of margin either side, down past the base
  const SX = W + 4, SY = Math.ceil((BASE + 8 + Y0) * S);
  const sh = new Float32Array(SX * SY);
  const anv = new Float32Array(SX * SY); // how much of the height is anvil
  const lip = new Float32Array(SX * SY); // the anvil's sunlit top edge
  for (let r = 0; r < SY; r++) {
    for (let i = 0; i < SX; i++) {
      const x = (i - 2 + 0.5) / S, y = (r + 0.5) / S - Y0;
      // the towers, cut flat along the base
      let tower = 0;
      const cut = smooth(BASE + 1, BASE - 1.5, y + 1.2 * (noise(x * 0.15, 3.3, 0) - 0.5));
      for (const [px, py, pr, pz, flat] of puffs) {
        const dx = (x - px) / pr, dy = (y - py) / pr;
        if (dx * dx + dy * dy >= 1) continue;
        const v = (pr * 0.6 + pz) * Math.sqrt(1 - dx * dx - dy * dy) * (flat ? cut : 1);
        if (v > tower) tower = v;
      }
      // the anvil: flat on top, a lens in section, combed by the wind
      const fib = fbm(x * 0.035, y * 0.2, 3, 0) - 0.5;
      const top = anvilTop(x) + 2.2 * fib, bot = anvilBot(x) - 1.5 * fib - 3 * (fbm(x * 0.2, 7, 2, 0) - 0.5);
      const mid = (top + bot) / 2, half = Math.max(0.5, (bot - top) / 2);
      let anvil = dome(0, (y - mid) / half, Math.min(5, half * 0.9)) * smooth(58, 72, x + 6 * fib);
      const onTop = anvil > 0 ? smooth(top + 3.2, top + 0.6, y) : 0;
      // pouches of mammatus hanging under its western half, in two staggered
      // ranks of uneven size with gaps, so they do not read as a row of beads
      if (x > 63 && x < 131 && y > bot - 2 && y < bot + 6) {
        const fadeIn = smooth(64, 76, x) * smooth(130, 116, x);
        for (let L = 0; L < 2; L++) {
          const row0 = Math.floor((x - 66 - L * 2.6) / 5.2);
          for (let row = row0 - 1; row <= row0 + 1; row++) {
            const q = row * 2 + L;
            if (hash(q, 6) < 0.18) continue;
            const s = (0.65 + 0.6 * hash(q, 5)) * (L ? 0.8 : 1);
            const off = row * 5.2 + 66 + 2.6 + L * 2.6 + (hash(q, 3) - 0.5) * 1.6;
            const py = bot + (L ? 0.1 : 0.7) + hash(q, 4) * 1.3 * s;
            anvil = Math.max(anvil, dome((x - off) / (2.7 * s), (y - py) / (2.3 * s), 2.2 * s) * fadeIn);
          }
        }
      }
      const solid = tower;
      let h = Math.max(solid, anvil);
      const a = anvil > solid ? smooth(0, 2, anvil - solid) : 0;
      // small billows on the towers; long streaks on the anvil, combed at a
      // slight slant so they do not line up with the rows
      const billow = fbm(x * 0.22, y * 0.24, 3, 0) - 0.5;
      const sy = y * 0.18 + 0.9 * (noise(x * 0.04, 5.5, 0) - 0.5) + x * 0.012;
      const streaky = fbm(x * 0.03 + 0.6 * noise(x * 0.08, y * 0.1, 0), sy, 3, 0) - 0.5;
      h += Math.min(1, h / 2.5) * mix(3 * billow, 2.2 * streaky, a);
      sh[r * SX + i] = Math.max(0, h);
      anv[r * SX + i] = a;
      lip[r * SX + i] = onTop * a;
    }
  }

  // --- static colour of every cell: sky, storm, land -----------------------
  const sr = new Float32Array(N), sg = new Float32Array(N), sb = new Float32Array(N);
  const mat = new Uint8Array(N);
  const cloud = new Float32Array(N); // storm cover, for the lightning
  const dark = new Float32Array(N); // base and shelf, lit from behind by a flash
  const darkSky = new Float32Array(N); // the slot under the storm
  const floorOf = new Float32Array(N);
  const grain = new Float32Array(N); // a faint per-cell print grain
  for (let k = 0; k < N; k++) grain[k] = 0.96 + 0.08 * hash(k, 517);
  const glowSun = (x: number, y: number) => {
    const dx = x - SUN[0], dy = y - SUN[1];
    return Math.exp(-((dx / 48) ** 2) - ((dy / 10) ** 2)) * 0.9 + Math.exp(-((dx / 95) ** 2) - ((dy / 20) ** 2)) * 0.26;
  };
  // The clear sky at (x, y), into SC: deep blue overhead, paling and warming
  // toward the horizon, which glows dusky rose in the west and goes slate in
  // the east where the earth's shadow rises; around the set sun a red-orange
  // rim hugs the horizon under a wider amber-gold glow, and above that a pale
  // band where the gold turns to blue.
  const SC = [0, 0, 0];
  const skyAt = (x: number, y: number) => {
    const h = Math.max(0, HZ - y);
    const east = smooth(50, 170, x);
    const lo = Math.exp(-h / 14), mid = Math.exp(-h / 36);
    const dx = x - SUN[0], dy = y - SUN[1];
    const rim = Math.exp(-((dx / 36) ** 2) - ((dy / 7) ** 2));
    const gold = Math.exp(-((dx / 72) ** 2) - ((dy / 16) ** 2));
    const wash = Math.exp(-((dx / 150) ** 2) - ((dy / 32) ** 2));
    const pale = Math.exp(-((dx / 110) ** 2) - (((h - 20) / 13) ** 2));
    SC[0] = 0.018 + 0.05 * mid + lo * mix(0.26, 0.1, east) + 0.5 * rim + 0.32 * gold + 0.1 * wash + 0.07 * pale;
    SC[1] = 0.026 + 0.075 * mid + lo * mix(0.16, 0.115, east) + 0.2 * rim + 0.22 * gold + 0.07 * wash + 0.09 * pale;
    SC[2] = 0.07 + 0.15 * mid + lo * mix(0.13, 0.17, east) + 0.04 * rim + 0.06 * gold + 0.04 * wash + 0.1 * pale;
  };
  // the sky just above the land in each column, for the haze over the field
  const hzR = new Float32Array(W), hzG = new Float32Array(W), hzB = new Float32Array(W);
  const LX = -0.72, LY = -0.3, LZ = 0.62; // toward the light: west, a touch high, out of the page

  // the farmhouse, its tree and a windpump, standing on the horizon
  const ground = (x: number) => HZ + 3 - 1.2 * smooth(20, 70, x) * smooth(110, 70, x);
  const HX0 = 40, HX1 = 55, HW0 = 58; // walls from x 40 to 55, eaves at row 58
  const hb = ground(47);
  const PUMP_X = 66, PUMP_Y = hb - 15;

  // the shelf: a flat dark lip of cloud along the storm's leading edge
  const shelfTop = (x: number) => BASE - 2.4 + 1.2 * (noise(x * 0.2, 8.1, 0) - 0.5);
  const shelfBot = (x: number) => BASE + 2.4 + 1.8 * (fbm(x * 0.12, 8.7, 2, 0) - 0.5) - 2 * smooth(184, 199, x) - 2 * smooth(114, 104, x);
  const shelfOn = (x: number) => smooth(103, 112, x) * smooth(199, 190, x);

  for (let r = 0; r < H; r++) {
    const y = YD[r];
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox;
      const x = XD[ox];
      if (y < ground(x)) {
        // sky: deep blue overhead, paling toward the horizon; around the set
        // sun a red-orange rim on the horizon warming to gold above it
        skyAt(x, y);
        const veil = 0.95 + 0.1 * fbm(x * 0.05, y * 0.09, 3, 0);
        let cr = SC[0] * veil, cg = SC[1] * veil, cb = SC[2] * veil;
        // under the storm the air itself goes dark slate, with only a thread
        // of light left along the ground behind the rain
        const under = smooth(98, 128, x + 8 * (noise(y * 0.15, 4.4, 0) - 0.5)) * smooth(BASE - 14, BASE - 1, y);
        // near black under the base, opening to a dim blue-grey at the ground:
        // the clear sky far beyond the storm, for the rain to hang against
        const slot = Math.pow(smooth(BASE + 1.5, HZ - 4, y), 0.7) * (0.85 + 0.3 * noise(x * 0.06, 6.6, 0));
        cr = mix(cr, mix(0.026, 0.22, slot) * veil, under * 0.94);
        cg = mix(cg, mix(0.028, 0.215, slot) * veil, under * 0.94);
        cb = mix(cb, mix(0.042, 0.25, slot) * veil, under * 0.94);
        darkSky[k] = under;
        // the storm
        if (r < SY - 1) {
          const i = ox + 2, j = r * SX + i;
          const h = sh[j];
          const c = smooth(0.15, 1.6, h);
          if (c > 0) {
            const up = r > 0 ? sh[j - SX] : 0, dn = sh[j + SX];
            // slopes per design unit, from neighbours one output cell away
            const gx = ((sh[j + 1] - sh[j - 1]) / 2) * S, gy = ((dn - up) / 2) * S;
            const nl = Math.sqrt(gx * gx + gy * gy + 1);
            const nx = -gx / nl, ny = -gy / nl, nz = 1 / nl;
            const an = anv[j];
            const lam = Math.pow(clamp(nx * LX + ny * LY + nz * LZ), 1.5);
            // earth's shadow climbing the tower: the tops still lit, the
            // lower bulk already in dusk
            const vis = 1 - 0.4 * smooth(22, BASE - 4, y + 5 * (noise(x * 0.12, 2.2, 0) - 0.5));
            const a = smooth(8, BASE, y);
            const near = Math.exp(-(((x - SUN[0]) / 110) ** 2));
            const flank = smooth(122, 108, x) * (1 - an); // the younger towers to the west
            // sunlight, reddened by the long path: cream-gold up high,
            // apricot lower down
            const sR = 1.0, sG = mix(0.8, 0.58, a), sB = mix(0.58, 0.36, a);
            // the tower's own bulk shades its eastern side, along a ragged edge
            const ej = 8 * (fbm(y * 0.14 + x * 0.02, 21.3, 3, 0) - 0.5);
            const lee = 1 - 0.7 * smooth(towerC(y) - 14 + ej, towerC(y) + towerHW(y) + 16 + ej, x) * (1 - an) * smooth(anvilBot(x) - 3, anvilBot(x) + 9, y + 5 * (noise(x * 0.15, 21, 0) - 0.5)) * (y < BASE ? 1 : 0);
            const sun = lam * vis * lee * (0.9 + 0.4 * near) * (1 - 0.3 * flank) * (1 - 0.2 * an);
            // skylight from above, a cool blue-grey; the afterglow lighting the
            // undersides from the west, orange
            const sky = 0.5 + 0.5 * Math.max(0, -ny);
            const bounce = Math.max(0, ny) * (0.2 + 0.5 * near) * (1 - 0.6 * flank) * (1 - 0.4 * an);
            // deep inside the heap, where neither reaches, the cloud darkens
            const occ = (1 - 0.4 * smooth(4, 22, h) * (1 - lam)) * (0.9 + 0.2 * fbm(x * 0.55, y * 0.55, 2, 0));
            let kr = (0.17 * sky + sR * sun + 0.52 * bounce) * occ;
            let kg = (0.175 * sky + sG * sun + 0.26 * bounce) * occ;
            let kb = (0.26 * sky + sB * sun + 0.14 * bounce) * occ;
            // the anvil's underside sinks into grey shadow; its top edge
            // catches the last direct light, cream toward the west
            const below = clamp(ny * 2.2) * an;
            kr *= 1 - 0.4 * below, kg *= 1 - 0.4 * below, kb *= 1 - 0.3 * below;
            const rim = lip[j] * smooth(196, 120, x) * (0.6 + 0.4 * lam);
            kr = mix(kr, 1.0, rim * 0.75), kg = mix(kg, 0.88, rim * 0.75), kb = mix(kb, 0.68, rim * 0.75);
            // the flankers' lower halves turn slate grey
            const low = clamp(ny * 1.6 + 0.2) * flank;
            kr = mix(kr, 0.12, low * 0.6), kg = mix(kg, 0.12, low * 0.6), kb = mix(kb, 0.18, low * 0.6);
            // the base: dark slate where the rain hangs
            const base = smooth(BASE - 5, BASE - 0.5, y) * (1 - an) * (1 - 0.3 * near);
            kr = mix(kr, 0.03, base * 0.9), kg = mix(kg, 0.032, base * 0.9), kb = mix(kb, 0.045, base * 0.9);
            cr = mix(cr, kr, c), cg = mix(cg, kg, c), cb = mix(cb, kb, c);
            // a silver lining where the thin edges face the sun and the light
            // shines through them
            const lining = 4 * c * (1 - c) * clamp(0.3 - 1.4 * nx) * vis * lee * (1 - base) * (0.6 + 0.6 * near);
            cr += 0.55 * lining, cg += 0.55 * sG * lining, cb += 0.55 * sB * lining;
            cloud[k] = c;
            dark[k] = base * c;
          }
        }
        // the shelf, hung along the base, a touch lighter on its leading lip
        const on = shelfOn(x);
        if (on > 0 && y > BASE - 5 && y < BASE + 5) {
          const st = shelfTop(x), sbt = shelfBot(x);
          const s = smooth(st - 1, st + 0.6, y) * smooth(sbt + 0.6, sbt - 0.8, y) * on;
          if (s > 0) {
            const n = fbm(x * 0.15, y * 0.5, 2, 0);
            // striations along its face, and a faint lip of light underneath
            const lit = 0.55 + 0.9 * n * (0.7 + 0.6 * noise(x * 0.05, y * 1.3, 0)) + 0.9 * smooth(sbt - 1.6, sbt - 0.2, y);
            cr = mix(cr, 0.065 * lit, s), cg = mix(cg, 0.068 * lit, s), cb = mix(cb, 0.09 * lit, s);
            cloud[k] = Math.max(cloud[k], s);
            dark[k] = Math.max(dark[k], s);
          }
        }
        sr[k] = cr, sg[k] = cg, sb[k] = cb;
        hzR[ox] = cr, hzG[ox] = cg, hzB[ox] = cb;
        mat[k] = SKY;
        floorOf[k] = 0.05 - 0.04 * Math.max(darkSky[k], dark[k]);
      } else {
        mat[k] = y < HZ + 4 ? PLAIN : FIELD;
        floorOf[k] = 0.05;
      }

      // a shelterbelt of trees on the far horizon, half lost in the rain
      const belt = HZ + 2 - (1.5 + 2.2 * fbm(x * 0.3, 2, 2, 0)) * smooth(140, 150, x) * smooth(196, 186, x);
      const belt2 = HZ + 2 - (1 + 1.8 * fbm(x * 0.35, 9, 2, 0)) * smooth(0, 4, x) * smooth(18, 10, x);
      if (y >= Math.min(belt, belt2) && y < HZ + 3) mat[k] = BELT;

      // the cottonwood by the house
      const tx = (x - 31) / 8.5, ty = (y - (hb - 10)) / 7;
      const crown = tx * tx + ty * ty < 1 + 0.35 * (fbm(x * 0.4, y * 0.4, 2, 0) - 0.5);
      if (crown || (Math.abs(x - 31.5) < 0.8 && y > hb - 6 && y < hb + 1)) mat[k] = TREE;

      // the farmhouse: two storeys, a gable roof, a chimney, a porch
      if (x >= HX0 && x < HX1 && y >= HW0 && y < hb + 1) mat[k] = HOUSE;
      if (y >= HW0 - 7 && y < HW0 && Math.abs(x - 47.5) <= 8.6 - (HW0 - y) * 1.15) mat[k] = ROOF;
      if (x >= 50 && x < 52 && y >= HW0 - 8 && y < HW0 - 3) mat[k] = ROOF;
      if (x >= 36 && x < HX0 && y >= hb - 4 && y < hb - 3.2) mat[k] = ROOF;
      if (x >= 36 && x < 36 + 1 / S && y >= hb - 3.2 && y < hb) mat[k] = HOUSE;
      // the lit window, split by a mullion, and a dimmer one upstairs-left
      if (x >= 49 && x < 52 && y >= HW0 + 2 && y < HW0 + 5 && Math.abs(x - 50.5) > 0.3) mat[k] = PANE;
      if (x >= 43 && x < 45 && y >= HW0 + 2 && y < HW0 + 4) mat[k] = PANE;

      // the windpump: a tapering lattice tower
      const py = y - PUMP_Y;
      if (py > 2 && y < hb + 0.5) {
        const half = 0.4 + py * 0.11;
        const dx = x - PUMP_X;
        if (Math.abs(Math.abs(dx) - half) < 0.36) mat[k] = PUMP;
        if (Math.abs(dx) < half && py % 4 < 0.6) mat[k] = PUMP;
      }
    }
  }

  // the road: from the yard to the bottom edge, a leading line
  const roadC = (p: number) => 57 + 62 * Math.pow(p, 1.25);
  const roadW = (p: number) => 0.6 + 12 * p;
  for (let r = 0; r < H; r++) {
    const y = YD[r];
    if (y < HZ + 3) continue;
    const p = (y - HZ) / FD;
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox, x = XD[ox];
      if (mat[k] !== FIELD) continue;
      if (Math.abs(x - roadC(p)) < roadW(p) + 0.6 * (noise(x * 0.3, (y - 0.5) * 0.3, 0) - 0.5)) mat[k] = ROAD;
    }
  }
  // the first output row of land, for the per-row tables below
  let R0 = 0;
  while (YD[R0] < HZ) R0++;

  // Aerial perspective over the land: the far rows fade into the haze, which
  // takes the colour of the sky just above them; the near rows keep their own
  // colour under a dim blue skylight. fK scales a cell's own light, fR/fG/fB
  // is what the haze, the skylight and the afterglow's sheen on the far wheat
  // add to it.
  const fK = new Float32Array(N), fR = new Float32Array(N), fG = new Float32Array(N), fB = new Float32Array(N);
  for (let r = R0; r < H; r++) {
    const y = YD[r];
    const p = Math.max(0, (y - HZ) / FD);
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox, x = XD[ox];
      const haze = 0.88 * Math.exp(-p * 9);
      const sheen = glowSun(x, HZ + 1) * Math.exp(-(y - HZ) / 3.2);
      fK[k] = 1 - haze;
      fR[k] = 0.03 * (1 - haze) + 0.8 * hzR[ox] * haze + 0.5 * sheen;
      fG[k] = 0.032 * (1 - haze) + 0.8 * hzG[ox] * haze + 0.27 * sheen;
      fB[k] = 0.048 * (1 - haze) + 0.8 * hzB[ox] * haze + 0.08 * sheen;
    }
  }
  // The silhouettes: the house, its tree, the pump and the far shelterbelts,
  // all back-lit, so nearly black, with a thin rim of the sky behind them
  // glowing through their edges. The belts are far enough to be hazed: dark
  // against the afterglow, slate grey where they stand in the rain.
  for (let r = 0; r < H; r++) {
    const y = YD[r];
    for (let ox = 0; ox < W; ox++) {
      const k = r * W + ox, m = mat[k], x = XD[ox];
      if (m !== TREE && m !== HOUSE && m !== ROOF && m !== PUMP && m !== BELT) continue;
      let ar = 0, ag = 0, ab = 0, wt = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const rr = r + dy;
        if (rr < 0 || rr >= H) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = ox + dx;
          if ((!dx && !dy) || xx < 0 || xx >= W) continue;
          const w = 1 / (dx * dx + dy * dy);
          wt += w;
          const n = rr * W + xx;
          if (mat[n] === SKY) (ar += sr[n] * w), (ag += sg[n] * w), (ab += sb[n] * w);
        }
      }
      const tex = 0.8 + 0.4 * noise(x * 0.9, y * 0.9, 0);
      let br = 0.03 * tex, bg = 0.027 * tex, bb = 0.034 * tex;
      if (m === ROOF) (br *= 1.3), (bg *= 1.4), (bb *= 1.6); // facing the sky overhead
      if (m === BELT) {
        const a = mix(0.3, 0.72, smooth(120, 190, x)) * smooth(HZ + 3, HZ - 2, y);
        (br = mix(br, hzR[ox] * 0.8, a)), (bg = mix(bg, hzG[ox] * 0.8, a)), (bb = mix(bb, hzB[ox] * 0.8, a));
      }
      const rim = (m === TREE ? 0.7 : 0.45) / wt;
      sr[k] = br + ar * rim, sg[k] = bg + ag * rim, sb[k] = bb + ab * rim;
      floorOf[k] = 0.03;
    }
  }

  // wheat: stalks in perspective, their columns converging on the farmhouse,
  // tall strokes up close and a fine grain toward the horizon
  const VX = 57;
  const TW = 512;
  const wheat = new Float32Array(H * TW);
  const persp = new Float32Array(N); // each cell's column in the wheat texture
  for (let r = R0; r < H; r++) {
    const y = YD[r];
    const p = (y - HZ) / FD;
    for (let u = 0; u < TW; u++) wheat[r * TW + u] = fbm(u * 0.55, (y - 0.5) * (0.5 - 0.42 * p), 3, TW * 0.55);
    for (let ox = 0; ox < W; ox++) persp[r * W + ox] = ((XD[ox] - VX) * 24) / (y + 1.5 - HZ) + 256;
  }
  // how much light the field holds: the sun side, the far rows, not the east
  // or the foreground, which sink into the storm's shadow
  const fieldLight = new Float32Array(N);
  for (let r = R0; r < H; r++) {
    const y = YD[r];
    const p = (y - HZ) / FD;
    for (let ox = 0; ox < W; ox++) {
      const x = XD[ox];
      const sunW = Math.exp(-(((x - SUN[0]) / 100) ** 2));
      const east = smooth(80, 130, x + 10 * p);
      const fore = 1 - 0.6 * smooth(YB - 24, YB - 2, y);
      fieldLight[r * W + ox] = (0.72 + 0.45 * sunW) * (1 - 0.35 * east) * fore;
    }
  }
  // gusts: soft patches of bent, brighter wheat rolling across the field,
  // tabled per output cell, wrapping every 640 design units
  const GW = 1024;
  const gust = new Float32Array(GW * H);
  for (let r = R0; r < H; r++)
    for (let u = 0; u < GW; u++) gust[r * GW + u] = smooth(0.4, 0.7, fbm((u / S) * 0.025, (YD[r] - 0.5) * 0.16, 3, (GW / S) * 0.025));

  // thin glowing streaks of altostratus in the clear western sky
  const CW = 400;
  const streak = new Float32Array(CW * H);
  for (let r = 0; r < H && YD[r] < HZ; r++) {
    const ry = YD[r] - 0.5;
    const band = smooth(40, 46, ry) * smooth(HZ - 3, 52, ry);
    if (band <= 0) continue;
    for (let u = 0; u < CW; u++) streak[r * CW + u] = smooth(0.64, 0.8, fbm(u * 0.02, ry * 0.2, 4, CW * 0.02)) * band;
  }

  // stars in the darkest part of the sky, each a single fine point
  const stars: [number, number, number, number][] = [];
  for (let r = 0; r < H && YD[r] < 28; r++)
    for (let ox = 0; ox < W && XD[ox] < 120; ox++) {
      const k = r * W + ox, x = XD[ox], y = YD[r];
      if (hash(ox, r * 5 + 3) > 0.9945 && cloud[k] < 0.05)
        stars.push([k, hash(ox, r) * 6.28, 1 + hash(r, ox) * 2.5, 0.85 * Math.min(1.15, 1 - y / 28) * Math.max(0, 1 - x / 130)]);
    }
  const star = new Float32Array(N);

  // wheat ears right in front of us, bowing with the wind:
  // [x, stalk height, phase, foot below the frame, head length], design units
  const ears: [number, number, number, number, number][] = [];
  for (let x = 2; x < 200; x += 5 + hash(x | 0, 60) * 4) ears.push([x, 8 + hash(x * 3, 61) * 12, hash(x * 7, 62) * 6.28, hash(x * 5, 63) * 6, 5 + (hash(x, 64) > 0.5 ? 1 : 0)]);
  const ear = new Float32Array(N); // > 0: a lit grain head; < 0: a dark stalk
  const touched: number[] = [];
  const setEar = (k: number, v: number) => {
    if (v > ear[k]) (ear[k] = v), touched.push(k);
  };

  // rain: one envelope of shafts that drifts, and falling streaks inside it
  const RW = 256;
  const shafts = new Float32Array(RW);
  for (let u = 0; u < RW; u++) shafts[u] = smooth(0.47, 0.57, fbm(u * 0.09375, 0.5, 2, 24));
  const RC = 512; // streak columns, one per output cell across
  const colPhase = new Float32Array(RC), colSpeed = new Float32Array(RC);
  for (let c = 0; c < RC; c++) (colPhase[c] = hash(c, 77) * 40), (colSpeed[c] = 22 + hash(c, 78) * 14);
  const rainTop = new Float32Array(W), rainOn = new Float32Array(W);
  for (let ox = 0; ox < W; ox++) (rainTop[ox] = shelfBot(XD[ox]) - 1.5), (rainOn[ox] = smooth(106, 118, XD[ox]) * smooth(198, 186, XD[ox]));

  // lightning: a fixed schedule of flashes, some carrying a bolt
  const PERIOD = 3.1;
  const bolts: { x: number; field: Float32Array }[] = [];
  for (let i = 0; i < 4; i++) {
    const segs: [number, number, number, number, number][] = [];
    const walk = (x: number, y: number, len: number, lean: number, depth: number) => {
      for (let s = 0; s < len && y < HZ + 2; s++) {
        const nx = x + (hash(i * 97 + s, depth * 13 + 41) - 0.5) * 3.2 + lean;
        const ny = y + 0.9 + hash(i * 31 + s, depth + 42) * 1.3;
        segs.push([x, y, nx, ny, depth]);
        if (depth === 0 && hash(i * 7 + s, 43) > 0.84) walk(nx, ny, 3 + hash(s, i) * 5, (hash(s, i + 9) - 0.5) * 2.4, 1);
        (x = nx), (y = ny);
      }
    };
    walk(122 + hash(i, 40) * 34, BASE - 4, 40, (hash(i, 44) - 0.5) * 0.8, 0);
    const field = new Float32Array(N).fill(99);
    for (let r = 0; r < H; r++) {
      const y = YD[r];
      if (y < 25 || y >= HZ + 4) continue;
      for (let ox = 0; ox < W; ox++) {
        const x = XD[ox];
        if (x < 80) continue;
        let m = 99;
        for (const [ax, ay, bx, by, dep] of segs) {
          if (Math.abs(x - ax) > 14 && Math.abs(x - bx) > 14) continue;
          const d = segDist(x, y, ax, ay, bx, by) + dep * 0.5;
          if (d < m) m = d;
        }
        field[r * W + ox] = m;
      }
    }
    bolts.push({ x: segs[0][0], field });
  }
  const flashAt = (t: number) => {
    const n = Math.floor(t / PERIOD);
    if (n > 0 && hash(n, 50) < 0.25) return null; // some periods stay dark
    const start = n === 0 ? -0.08 : n * PERIOD + 0.2 + hash(n, 51) * 1.6;
    const l = t - start;
    if (l < 0 || l > 0.9) return null;
    // a stroke and its restrikes, each a sharp rise and a fast decay
    let I = 0;
    const strikes = [0, 0.09 + hash(n, 52) * 0.06, 0.32 + hash(n, 53) * 0.2];
    for (let j = 0; j < 3; j++) if (l >= strikes[j]) I += Math.exp(-(l - strikes[j]) / (j === 0 ? 0.09 : 0.06)) * (j === 0 ? 1 : 0.7 - j * 0.15);
    const bolt = n === 0 || hash(n, 54) > 0.55 ? bolts[n % 4] : null;
    const cx = bolt ? bolt.x : 115 + hash(n, 55) * 45;
    const cy = bolt ? BASE - 8 : 14 + hash(n, 56) * 24;
    return { I: Math.min(1.3, I), bolt, cx, cy, boltOn: bolt && l < 0.5 ? Math.min(1, I * 1.4) : 0, inside: 0 };
  };
  // between the big flashes, the storm keeps flickering inside itself
  const FL = 1.6;
  const flickerAt = (t: number) => {
    const n0 = Math.floor(t / FL);
    for (let n = n0; n >= n0 - 1 && n >= 0; n--) {
      const l = t - (n * FL + 0.35 + hash(n, 70) * 0.75);
      if (l < 0 || l > 0.6) continue;
      let I = 0;
      const pulses = [0, 0.08 + hash(n, 71) * 0.1, 0.26 + hash(n, 72) * 0.18];
      for (let j = 0; j < 3; j++) if (l >= pulses[j]) I += Math.exp(-(l - pulses[j]) / 0.07) * (j === 1 ? 0.7 : j === 2 ? 0.45 : 1);
      return { I: Math.min(1, I) * (0.25 + 0.2 * hash(n, 73)), bolt: null, cx: 120 + hash(n, 74) * 38, cy: 15 + hash(n, 75) * 25, boltOn: 0, inside: 1 };
    }
    return null;
  };

  return (t, px) => {
    let f = flashAt(t);
    const fl = flickerAt(t);
    if (fl && (!f || f.I < fl.I)) f = fl;
    const I = f ? f.I : 0;
    const inside = f ? f.inside : 0;
    const drift = t * 1.2;
    const shaftOff = t * 0.9;
    const gOff = t * 9;

    for (const [k, ph, sp, a] of stars) star[k] = a * (0.55 + 0.45 * Math.sin(t * sp + ph));

    // the near ears: each stalk bends from its foot, more at the tip, and the
    // gusts that roll across the field push them further; drawn in output
    // cells, a one-cell stalk under a plump head of alternating grains
    for (const k of touched) ear[k] = 0;
    touched.length = 0;
    for (const [ex, eh, ph, foot, hl] of ears) {
      const gu = gust[(H - 1) * GW + ((Math.floor((ex - gOff * 1.5) * S) % GW) + GW) % GW];
      // the inflow blows toward the storm, so every ear bows a little east
      const lean = (0.7 + 0.7 * Math.sin(t * 1.7 + ph) + 1.8 * gu) * S;
      const sh0 = Math.round(eh * S), hd = Math.round(hl * S), tall = sh0 + hd;
      for (let i = 0; i < tall; i++) {
        const y = Math.round(H + foot * S - i);
        if (y >= H) continue;
        const q = i / tall;
        const x = Math.round(ex * S + lean * q * q);
        if (x < 1 || x + 2 >= W) continue;
        const k = y * W + x;
        if (i < sh0) {
          // the stalk: a thin dark line against the field
          if (ear[k] === 0) (ear[k] = -1), touched.push(k);
        } else {
          // the head: widest in the middle, tapering at both ends, the
          // grains alternating side to side
          const j = i - sh0;
          const tip = j === hd - 1;
          const odd = (j >> 1) & 1;
          const v = tip ? 0.55 : j === 0 ? 0.7 : 1 - 0.12 * odd;
          setEar(k, v);
          if (!tip && j > 0) setEar(k + 1, v * (odd ? 0.9 : 0.72));
          if (j > 1 && j < hd - 2) setEar(k - 1, v * (odd ? 0.6 : 0.8));
          // a whisker of awns past the tip
          if (tip && y > 1) {
            const a = k - W + (lean > 0.5 * S ? 1 : 0);
            if (ear[a] < 0.3) (ear[a] = 0.3), touched.push(a);
            const b = a - W + (lean > 0.5 * S ? 1 : 0);
            if (ear[b] < 0.24) (ear[b] = 0.24), touched.push(b);
          }
        }
      }
    }

    for (let r = 0; r < H; r++) {
      const y = YD[r];
      const p = (y - HZ) / FD;
      for (let ox = 0; ox < W; ox++) {
        const k = r * W + ox;
        const x = XD[ox];
        const m = mat[k];
        let cr = sr[k], cg = sg[k], cb = sb[k];
        let floor = floorOf[k], fade = 1, rain = 0;

        if (m === SKY) {
          const c = cloud[k];
          if (c < 0.98 && y < HZ) {
            // the altostratus: lit gold-orange toward the sun, a dusky
            // mauve-grey away from it
            const sx = x + drift, ix = Math.floor(sx), fx = sx - ix;
            const s0 = streak[r * CW + (ix % CW)], s1 = streak[r * CW + ((ix + 1) % CW)];
            const s = (s0 + (s1 - s0) * fx) * (1 - c) * smooth(105, 55, x) * 0.75;
            if (s > 0.005) {
              const sun = Math.exp(-(((x - SUN[0]) / 70) ** 2));
              cr = mix(cr, 0.28 + 0.78 * sun, s);
              cg = mix(cg, 0.19 + 0.46 * sun, s);
              cb = mix(cb, 0.22 + 0.1 * sun, s);
            }
            if (star[k]) {
              const v = star[k] * (1 - c);
              cr = Math.max(cr, v * 0.92), cg = Math.max(cg, v * 0.94), cb = Math.max(cb, v);
            }
          }
          // rain curtains hanging from the shelf to the ground
          const on = rainOn[ox];
          if (on > 0 && y > rainTop[ox]) {
            const u = x + (y - BASE) * 0.42 - shaftOff;
            const uf = Math.floor(u), ua = ((uf % RW) + RW) % RW;
            const sv = shafts[ua] + (shafts[(ua + 1) % RW] - shafts[ua]) * (u - uf);
            const env = sv * on * smooth(rainTop[ox], rainTop[ox] + 3, y) * (1 - c * 0.7);
            if (env > 0.01) {
              // falling streaks, slanted with the shafts, each a soft dash
              const col = ((Math.floor(ox + 0.5 + (y - BASE) * 0.42 * S) % RC) + RC) % RC;
              const fall = (y * 0.4 - t * colSpeed[col] * 0.1 + colPhase[col] + 1000) % 4;
              const lit = fall < 1.6 ? Math.sin((fall / 1.6) * Math.PI) : 0;
              rain = env;
              // a grey veil: paler than the black under the base, darker
              // than the distance it hides
              const veil = env * 0.9;
              cr = mix(cr, 0.05 + 0.055 * lit, veil);
              cg = mix(cg, 0.056 + 0.058 * lit, veil);
              cb = mix(cb, 0.074 + 0.072 * lit, veil);
            }
          }
        } else if (m === FIELD || m === PLAIN) {
          const gi = r * GW + ((Math.floor((x - Math.floor(gOff * (0.5 + p))) * S) % GW) + GW) % GW;
          const gu = gust[gi];
          // stalks lean with the gust and spring back
          const sway = 0.5 * Math.sin(t * 2.1 + x * 0.05 + (y - 0.5) * 0.17) + 2.2 * gu;
          const u = persp[k] + sway;
          const ui = Math.floor(u), uf = u - ui;
          const a0 = wheat[r * TW + (ui & 511)], a1 = wheat[r * TW + ((ui + 1) & 511)];
          const tex = a0 + (a1 - a0) * uf;
          const v = clamp(0.55 + (tex - 0.5) * (0.9 + 1.4 * Math.max(0, p)));
          // ripe wheat in the warm light from the west, hazed with distance
          const L = (v * 0.7 + 0.4 * gu) * fieldLight[k] * fK[k];
          cr = 0.6 * L + fR[k];
          cg = 0.41 * L + fG[k];
          cb = 0.2 * L + fB[k];
          if (m === FIELD) fade = smooth(YB + 10, YB - 8, y);
        } else if (m === ROAD) {
          // packed dirt, greyer than the wheat, with darker ruts
          const sun = 0.5 + 0.5 * Math.exp(-(((x - SUN[0]) / 110) ** 2));
          const rut = 1 - 0.4 * smooth(0.5 + p * 0.9, 0.1 + p * 0.3, Math.abs(Math.abs(x - roadC(p)) - roadW(p) * 0.45));
          const L = (0.6 + 0.3 * noise(x * 0.5, (y - 0.5) * 0.5, 0)) * sun * rut * (1 - 0.5 * p) * fK[k];
          cr = 0.38 * L + fR[k], cg = 0.31 * L + fG[k], cb = 0.27 * L + fB[k];
          fade = smooth(YB + 10, YB - 8, y);
        } else if (m === PANE) {
          // lamplight, warm and a little unsteady; upstairs a dimmer room
          const g = 0.9 + 0.1 * Math.sin(t * 2.3 + Math.floor(x)) * Math.sin(t * 3.7);
          const small = x < 46 ? 0.5 : 1;
          cr = g * small, cg = (x < 46 ? 0.56 : 0.66) * g * small, cb = (x < 46 ? 0.24 : 0.32) * g * small;
          floor = 0.3;
        }

        const e = ear[k];
        if (e > 0) {
          // a grain head in the storm's shade, back-lit from the west: dull
          // gold, brighter toward the sun
          const sunW = Math.exp(-(((x - SUN[0]) / 120) ** 2));
          const L = e * (0.32 + 0.4 * sunW);
          (cr = 0.86 * L), (cg = 0.63 * L), (cb = 0.33 * L), (fade = 1), (floor = 0.08);
        }

        // the windpump's wheel, turning slowly, and its tail vane
        const wx = x - PUMP_X, wy = y - PUMP_Y;
        if (wx > -4 && wx < 7 && wy > -4 && wy < 4) {
          const wd = Math.sqrt(wx * wx + wy * wy);
          if (wd < 3.6 && wd > 0.4 && (Math.cos((Math.atan2(wy, wx) - t * 1.6) * 8) > 0.2 || wd < 1)) (cr = 0.03), (cg = 0.027), (cb = 0.034), (floor = 0.03);
          if (wy > -0.9 && wy < 0.4 && wx > 2) (cr = 0.03), (cg = 0.027), (cb = 0.034), (floor = 0.03);
        }

        // the lit pane's glow on the yard and the wall around it, lamp-warm
        const lx = x - 50.5, ly = y - (HW0 + 3.5);
        if (m !== PANE && lx * lx + ly * ly < 200) {
          const lg = Math.exp(-Math.sqrt(lx * lx + ly * ly * 2) / 3) * 0.45;
          cr += lg, cg += lg * 0.6, cb += lg * 0.26;
        }

        // lightning: the cloud glows from inside; the base and the rain are
        // lit from behind; a full flash reaches the land as well
        if (I > 0.01) {
          const dx = x - f!.cx, dy = (y - f!.cy) * 1.3;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const c = m === SKY ? cloud[k] : 0;
          const inner = inside ? Math.exp(-dist / 14) * c * I * 2 : Math.exp(-dist / 16) * (0.3 + 0.7 * c) * I * 1.3;
          const back = m === SKY ? (dark[k] * 0.5 + rain * 0.8) * Math.exp(-Math.abs(dx) / 34) * I * (inside ? 0.5 : 1) : 0;
          const amb = inside ? 0 : I * (m === SKY ? 0.08 : 0.05);
          const lw = inner + back;
          cr += 0.75 * lw + amb * 0.8, cg += 0.72 * lw + amb * 0.8, cb += 1.0 * lw + amb;
          if (f!.boltOn) {
            const d = f!.bolt!.field[k];
            if (d < 12 && (c < 0.6 || y > BASE - 1)) {
              // a core about one cell wide, haloed
              const core = smooth(0.8, 0.28, d) * f!.boltOn;
              const glow = (Math.exp(-d / 2) * 0.55 + Math.exp(-d / 7) * 0.2) * f!.boltOn;
              cr += core + glow * 0.75, cg += core + glow * 0.72, cb += core + glow;
            }
          }
        }

        if (e < 0) {
          // a stalk: a thin line darker than the wheat behind it
          (cr *= 0.35), (cg *= 0.3), (cb *= 0.28), (floor = 0.08), (fade = 1);
        }

        // the brightest light burns toward white instead of clipping to a
        // flat hue; every cell keeps a faint grain of its own
        const pk = Math.max(cr, cg, cb);
        if (pk > 0.9) {
          const w = (pk - 0.9) * 0.45;
          (cr += w), (cg += w), (cb += w);
        }
        const gr = grain[k];
        dot(px, k, cr * gr, cg * gr, cb * gr, floor, fade);
      }
    }
  };
}
