/*
 * marine drive: the queen's necklace seen from malabar hill at night. A string
 * of sodium lamps sweeps round the bay to the towers at nariman point, cars
 * trail light along the road beneath them, and the bay carries their long
 * wavering reflections. Ships ride at anchor on the horizon.
 *
 * Every cell is shaded as light in true colour and drawn as a halftone dot of
 * that light: a hazy city sky, clouds lit from beneath by the city and
 * silvered by the moon, plaster and glass in lamplight, and a bay that mirrors
 * the haze toward the horizon and breaks the lamps into glints near us.
 * Everything along the curve is placed by distance along it, so buildings,
 * lamps and cars shrink together toward the point.
 */
import { dot } from "./dot.ts";
import type { Frame, Meta } from "./types.ts";

export const meta = {
  name: "marine drive",
  cols: 320,
  rows: 180,
  fps: 15,
  ground: "#07080f",
} satisfies Meta;

// The picture is designed on a 200 x 100 grid of square cells and sampled
// 1.6 times finer onto 320 x 180: output cell (ox, oy) sits at design point
// ((ox + 0.5) / S, (oy + 0.5) / S - Y0). The 16:9 frame shows Y0 more rows of
// sky above the design and YB more rows of bay below it.
const W = 320, H = 180;
const S = 1.6, Y0 = 8, YB = 4.5;
const DH = 100 + YB; // the bottom of the frame, in design rows
const dX = (ox: number) => (ox + 0.5) / S;
const dY = (oy: number) => (oy + 0.5) / S - Y0;
const oX = (x: number) => Math.floor(x * S); // the output column holding design x
const oY = (y: number) => Math.floor((y + Y0) * S);
const HZ = 40; // the sea horizon
const TIP = 176; // nariman point, where the necklace ends
const MOON = [189, 13];
const MOON_R = 4.5;
// darker seas on the moon's face: [dx, dy, radius]
const MARIA = [[-1.4, -1.2, 1.6], [1.3, 0.8, 1.4], [-0.6, 2, 1.1]];
// high-pressure sodium: the lamps' golden light, and the white heat of their cores
const SODIUM = [1, 0.6, 0.24];
const HOT = [1, 0.92, 0.76];
// art deco plaster as it is by day: cream, stone, faded pink, butter, grey
const PLASTER = [[1, 0.93, 0.8], [0.93, 0.92, 0.9], [1, 0.86, 0.8], [1, 0.95, 0.75], [0.88, 0.91, 0.93]];

const SKY = 0, WATER = 1, FAR = 2, TOWER = 3, FRONT = 4, ROAD = 5, WALL = 6, POLE = 7, SHIP = 8, FACE = 9;

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

// The shoreline: steep and near at the left, flat and far toward the point.
const shoreF = (x: number) => 50 + 34 * Math.pow(Math.max(0, 1 - x / TIP), 2.2);
// How large one unit of distance along the drive looks at column x.
const scF = (x: number) => 0.5 + 1.9 * Math.pow(Math.max(0, 1 - x / TIP), 1.5);
const seaTop = (x: number) => (x <= TIP ? shoreF(x) : Math.max(HZ, 50 - (x - TIP) * 1.6));
const wallTopF = (x: number) => shoreF(x) - Math.max(1, scF(x));
const roadTopF = (x: number) => wallTopF(x) - Math.max(1, 1.5 * scF(x));
// The city's sodium glow in the sky, weaker out over the open sea.
const glowF = (x: number, y: number) => {
  const over = 0.45 + 0.55 * smooth(TIP + 24, TIP - 16, x);
  const h = Math.max(0, HZ - y);
  return over * (Math.exp(-h / 4) * 0.5 + Math.exp(-h / 12) * 0.14);
};

// The night sky at design point (x, y), left in SKYC: deep indigo overhead
// paling to a grey haze at the horizon, the city's sodium glow heaped on the
// land and brightest behind the point, the moonlit haze of the open sea, and
// the moon's halo. `veil` adds the faint unevenness of the haze.
const SKYC = new Float64Array(3);
function skyAt(x: number, y: number, veil: boolean) {
  const hd = Math.max(0, HZ - y);
  const k = Math.pow(1 - clamp(hd / (HZ + Y0)), 2.6);
  const vl = veil ? 0.9 + 0.2 * fbm((x - 0.5) * 0.05, (y - 0.5) * 0.08, 3, 0) : 1;
  let r = mix(0.02, 0.085, k) * vl, g = mix(0.034, 0.115, k) * vl, b = mix(0.095, 0.2, k) * vl;
  const pt = smooth(84, 98, x) * smooth(186, 174, x);
  const gl = glowF(x, y) * (1 + 0.5 * pt) + 0.16 * Math.exp(-hd / 14) * smooth(84, 104, x) * smooth(188, 172, x);
  r += gl * 0.3, g += gl * 0.19, b += gl * 0.12;
  const sea = Math.exp(-hd / 3.5) * smooth(172, 186, x) * 0.13;
  r += sea * 0.7, g += sea * 0.8, b += sea * 0.95;
  const dmx = x - MOON[0], dmy = y - MOON[1];
  const dm = Math.sqrt(dmx * dmx + dmy * dmy);
  const halo = Math.exp(-dm / 26) * 0.06 + Math.exp(-dm / 8) * 0.13 + Math.exp(-dm / 2.6) * 0.3;
  r += halo * 0.86, g += halo * 0.88, b += halo * 0.92;
  SKYC[0] = r, SKYC[1] = g, SKYC[2] = b;
}

interface Building {
  u0: number;
  u1: number;
  floors: number;
  tone: number;
  crown: boolean;
  al: number[];
}

export default function marineDrive(): Frame {
  const N = W * H;

  // --- distance along the drive -----------------------------------------
  const STEP = 0.25;
  const nU = Math.ceil((TIP + 4) / STEP) + 2;
  const Utab = new Float32Array(nU);
  for (let i = 1; i < nU; i++) {
    const x = (i - 0.5) * STEP;
    const sl = (shoreF(x + 0.05) - shoreF(x - 0.05)) / 0.1;
    Utab[i] = Utab[i - 1] + (Math.sqrt(1 + sl * sl) * STEP) / scF(x);
  }
  const Uof = (x: number) => {
    const f = Math.max(0, Math.min(nU - 1.001, x / STEP));
    const i = f | 0;
    return Utab[i] + (Utab[i + 1] - Utab[i]) * (f - i);
  };
  const xOfU = (u: number) => {
    let lo = 0, hi = TIP;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (Uof(m) < u) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const UEND = Uof(TIP);

  // --- the lamps --------------------------------------------------------
  const lamps: [number, number, number][] = [];
  for (let u = 0.6; u < UEND - 0.4; u += 3.75) {
    const lx = xOfU(u), s = scF(lx);
    lamps.push([lx, wallTopF(lx) - 2.4 * s, s]);
  }
  const FLICK = 6; // one lamp near us is failing

  // --- the front row: art deco blocks along the drive ---------------------
  const blds: Building[] = [];
  for (let u = -4; u < UEND; ) {
    const i = blds.length;
    const w = 7 + 7 * hash(i, 21);
    // art deco blocks of five to eight storeys, and towers at the near, hilly end
    const tall = Math.round(7 * smooth(26, 2, u) * (0.6 + 0.4 * hash(i, 26)));
    blds.push({
      u0: u,
      u1: u + w,
      floors: 5 + Math.floor(hash(i, 22) * 4) + tall,
      tone: 0.8 + 0.4 * hash(i, 23),
      crown: hash(i, 24) > 0.45,
      al: PLASTER[Math.floor(hash(i, 27) * PLASTER.length)],
    });
    u += w + 0.4 + 1.8 * hash(i, 25);
  }
  const colU = new Float32Array(W);
  const bldAt = new Int16Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    colU[x] = Uof(dX(x));
    if (dX(x) > TIP) continue;
    for (let i = 0; i < blds.length; i++) if (colU[x] >= blds[i].u0 && colU[x] < blds[i].u1) bldAt[x] = i;
  }

  // --- towers behind, a cluster at the point --------------------------------
  // [centre, half width, top row, warm light]
  const towers: [number, number, number, number][] = [
    [24, 4.5, 21, 0],
    [97, 2.5, 27, 1], [107, 2, 22, 0], [118, 3, 30, 0], [126, 2, 25, 1],
    [136, 3, 23, 0], [142.5, 2, 15, 1], [149, 3.5, 27, 0], [156, 2.5, 19, 0], [162, 3, 12, 1], [168.5, 2.5, 21, 0], [173, 2, 28, 1],
  ];

  // How close the street lamps stand to each column, for the scallops of
  // their light along the facades; and the haze between us and the drive,
  // thicker toward the point, with its colour (the horizon's glow).
  const near = new Float32Array(W);
  const hzA = new Float32Array(W), hzR = new Float32Array(W), hzG = new Float32Array(W), hzB = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const xc = dX(x);
    let n = 0;
    for (const [lx, , s] of lamps) n += Math.exp(-(((xc - lx) / (1.1 * s + 0.35)) ** 2));
    near[x] = Math.min(1.4, n);
    hzA[x] = 0.03 + 0.2 * Math.pow(1 - clamp((scF(xc) - 0.5) / 1.9), 2);
    skyAt(xc, HZ - 1, false);
    (hzR[x] = SKYC[0]), (hzG[x] = SKYC[1]), (hzB[x] = SKYC[2]);
  }

  // --- the static picture -------------------------------------------------
  const mat = new Uint8Array(N);
  const sR = new Float32Array(N), sG = new Float32Array(N), sB = new Float32Array(N);
  const flo = new Float32Array(N);
  const lane = new Uint8Array(N); // 1 far lane, 2 near lane, 3 both
  const winR = new Float32Array(N), winG = new Float32Array(N), winB = new Float32Array(N); // window light, to spill round them
  const flick: [number, number, number, number, number, number, number][] = []; // rooms whose light changes: [cell, r, g, b, kind, rate, phase]
  const beacons: [number, number][] = []; // red lights on the tallest towers: [cell, phase]

  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      const xc = dX(x), y = dY(r);
      if (y >= seaTop(xc)) {
        mat[k] = WATER;
        continue;
      }
      let m = SKY, cr = 0, cg = 0, cb = 0, fl = 0.12;
      let wr = 0, wg = 0, wb = 0; // the light of a window in this cell
      let fk = -1; // a room whose light will change

      const xd = xc - 0.5;
      const blk = Math.floor((xd + 40 * fbm(xd * 0.02, 5, 2, 0)) / 3);
      const farTop = HZ - 0.4 - (0.4 + 5 * hash(blk, 7) ** 3) * (0.5 + 0.5 * fbm(xd * 0.05, 2, 2, 0));
      if (xc < TIP + 7 && y >= farTop) {
        // the far city: low blocks half lost in the haze, pricked with tiny lights
        m = FAR;
        skyAt(xc, y, false);
        // hazy on the horizon; below it the gaps show the dark streets behind the drive
        const aH = (0.26 + 0.24 * smooth(farTop, HZ, y)) * (1 - 0.8 * smooth(HZ + 1, HZ + 8, y));
        cr = mix(0.016, SKYC[0], aH), cg = mix(0.017, SKYC[1], aH), cb = mix(0.024, SKYC[2], aH);
        if (hash(x * 3 + 1, r * 7 + 2) < 0.03) {
          const v = (0.16 + 0.4 * hash(x, r * 5 + 9) ** 2) * (1 - 0.4 * aH);
          const cool = hash(x * 5, r) < 0.3;
          (wr = v * (cool ? 0.82 : 1)), (wg = v * (cool ? 0.88 : 0.68)), (wb = v * (cool ? 1 : 0.38));
        }
        fl = 0.07;
      }

      for (let ti = 0; ti < towers.length; ti++) {
        const [tx, hw, top, warm] = towers[ti];
        const dx = xc - tx;
        if (Math.abs(dx) > hw || y < top) continue;
        m = TOWER;
        // dark glass in vertical panels, mirroring a little of the city's glow low down
        const panel = (x - oX(tx - hw)) % 3 === 0 ? 0.72 : 1;
        cr = 0.011 * panel, cg = 0.013 * panel, cb = 0.02 * panel;
        const g = glowF(xc, y) * 0.24;
        cr += g * 0.46, cg += g * 0.3, cb += g * 0.17;
        if (dx > hw - 1 / S) (cr += 0.03), (cg += 0.036), (cb += 0.05); // the moonward edge
        (wr = 0), (wg = 0), (wb = 0);
        // storeys three output rows apart, one row of window to each
        const fr = r - oY(top);
        const fi = (fr / 3) | 0;
        if (fr === 0) (cr += 0.045), (cg += 0.05), (cb += 0.064); // the rooftop's edge
        else if (fr > 0 && fr % 3 === 1 && Math.abs(dx) < hw - 0.4) {
          const seg = Math.floor((xc - tx + hw) / 2);
          const h = hash(ti * 17 + seg, fi * 13 + 3);
          const office = hash(ti * 3 + 1, fi * 29 + 7) < 0.1; // a whole floor still at work
          if (h < 0.5 || office) {
            const v = (0.3 + 0.4 * hash(ti * 7 + seg, fi)) * (0.88 + 0.24 * hash(x, r * 3 + 1));
            const cool = office || (warm ? h < 0.1 : h > 0.1);
            (wr = v * (cool ? 0.78 : 1)), (wg = v * (cool ? 0.88 : 0.74)), (wb = v * (cool ? 1 : 0.46));
          }
        }
        if (fr === 0 && x === oX(tx) && top < 20) beacons.push([k - W, ti * 1.7]);
        // the haze between us and the towers, thicker near the ground
        skyAt(xc, y, false);
        const aH = (ti === 0 ? 0.04 : 0.13) * (0.55 + 0.45 * Math.exp(-(HZ - y) / 10));
        cr = mix(cr, SKYC[0], aH), cg = mix(cg, SKYC[1], aH), cb = mix(cb, SKYC[2], aH);
        (wr *= 1 - aH), (wg *= 1 - aH), (wb *= 1 - aH);
        fl = 0.04;
      }

      if (xc <= TIP) {
        const s = scF(xc), wt = wallTopF(xc), rt = roadTopF(xc);
        const bi = bldAt[x];
        let drive = false;
        if (bi >= 0 && y < rt) {
          const b = blds[bi];
          const uu = colU[x] - b.u0, bw = b.u1 - b.u0;
          const f = (rt - y) / s; // height above the road, in storeys of 1.7
          let hgt = b.floors * 1.7 + 1.1;
          if (b.crown && uu > bw * 0.32 && uu < bw * 0.68) hgt += 1.6;
          if (f < hgt) {
            m = FRONT;
            drive = true;
            (wr = 0), (wg = 0), (wb = 0);
            const al = b.al, t0 = b.tone * (uu < 0.5 || uu > bw - 0.5 ? 1.2 : 1);
            // weathered plaster: a fine mottle, and the monsoon's stains running down it
            const tex =
              (0.86 + 0.28 * fbm(colU[x] * 0.9 + bi * 13, f * 0.9, 2, 0)) *
              (1 - 0.2 * smooth(0.55, 0.85, noise(colU[x] * 2.2 + bi * 7, f * 0.25, 0)));
            // the night sky's faint light, and the street lamps' glow from below
            const up = Math.exp(-f / 3.2) * (0.04 + 0.09 * near[x]);
            let lr = 0.026 + up * SODIUM[0], lg = 0.028 + up * SODIUM[1], lb = 0.038 + up * SODIUM[2];
            const cornice = f > hgt - 0.6 / s || (f > b.floors * 1.7 + 0.6 && f < b.floors * 1.7 + 0.6 + 0.5 / s);
            if (cornice) (lr += 0.05), (lg += 0.056), (lb += 0.072); // moonlit
            else if (f > hgt - 1.2 / s && f < hgt) (lr *= 0.7), (lg *= 0.7), (lb *= 0.72); // its shadow
            if (uu > bw - 0.7 / s - 0.2) (lr += 0.022), (lg += 0.026), (lb += 0.034); // the corner toward the moon
            cr = lr * al[0] * t0 * tex, cg = lg * al[1] * t0 * tex, cb = lb * al[2] * t0 * tex;
            const fi = Math.floor((f - 0.9) / 1.7);
            const ff = f - 0.9 - fi * 1.7;
            const col = Math.floor((uu - 0.3) / 1.5);
            const cu = uu - 0.3 - col * 1.5;
            const fine = s * 1.7 * S >= 4;
            const inWin = fi >= 0 && fi < b.floors && uu > 0.7 && uu < bw - 0.7 && (fine ? ff > 0.45 && ff < 1.35 && cu > 0.35 && cu < 1.15 : true);
            if (inWin && !fine) {
              // too far to count rooms: each storey reads as a band of light
              // between dark floor slabs, broken where rooms are dark
              const pitch = s * 1.7 * S;
              const band = pitch < 2.2 ? 0.5 : smooth(0.3, 0.55, ff) * smooth(1.5, 1.25, ff);
              const seg = Math.floor(uu / 3.2);
              const v = (0.02 + 0.26 * hash(bi * 13 + seg, fi * 7 + 1) ** 2) * band;
              const cool = hash(bi * 5 + seg, fi * 3 + 2) < 0.25;
              (wr = v * (cool ? 0.8 : 1)), (wg = v * (cool ? 0.88 : 0.76)), (wb = v * (cool ? 1 : 0.48));
              if (hash(x * 7 + 3, r * 11) < 0.025) (wr += 0.36), (wg += 0.32), (wb += 0.26);
            } else if (inWin) {
              const h = hash(bi * 97 + col, fi * 31 + 5);
              if (h < 0.3) {
                let v = 0.32 + 0.34 * hash(bi * 13 + col, fi);
                const kind = hash(bi * 7 + col, fi * 3 + 1);
                let lr2 = 1, lg2 = 0.8, lb2 = 0.52; // tungsten, paler than the lamps
                if (kind < 0.22) (lr2 = 0.8), (lg2 = 0.9), (lb2 = 1); // tube light
                else if (kind < 0.32) (lr2 = 0.95), (lg2 = 0.95), (lb2 = 0.9); // a white led
                else if (kind < 0.46) (lr2 = 1), (lg2 = 0.6), (lb2 = 0.34), (v *= 0.65); // behind a curtain
                v *= 0.9 + 0.2 * hash(x * 3 + 5, r * 5 + 1); // brighter near the lamp in the room
                (wr = v * lr2), (wg = v * lg2), (wb = v * lb2);
                const fq = hash(bi * 5 + col, fi * 11 + 7);
                if (fq < 0.07) fk = fq;
              } else {
                // dark glass, a little of the sky in it
                (cr = cr * 0.45 + 0.004), (cg = cg * 0.45 + 0.006), (cb = cb * 0.45 + 0.012);
              }
            }
            fl = 0.05;
          }
        }
        if (y >= rt && y < wt) {
          m = ROAD;
          drive = true;
          (wr = 0), (wg = 0), (wb = 0), (fk = -1);
          const tx = 0.85 + 0.3 * noise(xc * 1.7, y * 3.1, 0);
          (cr = 0.03 * tx), (cg = 0.028 * tx), (cb = 0.029 * tx);
          fl = 0.08;
          const lf = (y - rt) / (wt - rt);
          lane[k] = (wt - rt) * S < 2.4 ? 3 : lf < 0.5 ? 1 : 2;
        } else if (y >= wt) {
          drive = true;
          (wr = 0), (wg = 0), (wb = 0), (fk = -1);
          const wf = (y - wt) / (shoreF(xc) - wt);
          if (wf < 0.45) {
            // the promenade's paving along the top of the sea wall
            m = WALL;
            const tx = 0.85 + 0.3 * noise(xc * 2.3, y * 2.3, 0);
            (cr = 0.05 * tx), (cg = 0.047 * tx), (cb = 0.047 * tx);
          } else {
            // the wall's face and the tumble of tetrapods at its foot
            m = FACE;
            const n = noise(xc * 2.4 + 3, y * 2.4, 0);
            const v = 0.014 + 0.03 * smooth(0.45, 0.8, n) * (0.6 + 0.4 * wf);
            (cr = v), (cg = v * 0.96), (cb = v * 1.04);
          }
          fl = 0.08;
        }
        for (const [lx, ly, ls] of lamps) {
          if (ls > 0.8 && Math.abs(xc - lx) < 0.5 / S && y > ly && y < wt) {
            (m = POLE), (drive = true), (wr = 0), (wg = 0), (wb = 0), (fk = -1);
            (cr = 0.035), (cg = 0.033), (cb = 0.035), (fl = 0.08);
          }
        }
        if (drive) {
          // the haze between us and the drive
          const aH = hzA[x];
          cr = mix(cr, hzR[x], aH), cg = mix(cg, hzG[x], aH), cb = mix(cb, hzB[x], aH);
          (wr *= 1 - aH), (wg *= 1 - aH), (wb *= 1 - aH);
        }
      }

      if (m === SKY) {
        skyAt(xc, y, true);
        (cr = SKYC[0]), (cg = SKYC[1]), (cb = SKYC[2]);
        const dmx = xc - MOON[0], dmy = y - MOON[1];
        const dm = Math.sqrt(dmx * dmx + dmy * dmy);
        if (dm < MOON_R) {
          // the moon: grey seas on a cream face, darkening toward the limb
          let face = 0.84 + 0.16 * fbm(xd * 0.6, (y - 0.5) * 0.6, 3, 0);
          for (const [mx, my, mr] of MARIA) {
            const d2 = ((dmx - mx) ** 2 + (dmy - my) ** 2) / (mr * mr);
            if (d2 < 1) face -= 0.32 * (1 - d2) * (1 - d2 * 0.4);
          }
          face *= 1 - 0.18 * (dm / MOON_R) ** 2;
          const a = smooth(MOON_R, MOON_R - 0.8, dm);
          cr = mix(cr, face, a), cg = mix(cg, face * 0.96, a), cb = mix(cb, face * 0.87, a);
        }
        fl = 0.1;
      }
      mat[k] = m;
      sR[k] = cr + wr, sG[k] = cg + wg, sB[k] = cb + wb, flo[k] = fl;
      if (m === FRONT || m === TOWER) (winR[k] = wr), (winG[k] = wg), (winB[k] = wb);
      if (fk >= 0) flick.push([k, wr, wg, wb, fk < 0.025 ? 1 : 0, 0.3 + fk * 9, fk * 400]);
    }
  }

  // the light of the windows spills a little onto the walls around them
  {
    const tmp = new Float32Array(N);
    for (const a of [winR, winG, winB]) {
      for (let pass = 0; pass < 2; pass++) {
        for (let r = 0; r < H; r++)
          for (let x = 1; x < W - 1; x++) tmp[r * W + x] = (a[r * W + x - 1] + a[r * W + x] + a[r * W + x + 1]) / 3;
        for (let r = 1; r < H - 1; r++)
          for (let x = 0; x < W; x++) a[r * W + x] = (tmp[(r - 1) * W + x] + tmp[r * W + x] + tmp[(r + 1) * W + x]) / 3;
      }
    }
    for (let k = 0; k < N; k++) {
      if (mat[k] !== FRONT && mat[k] !== TOWER) continue;
      (sR[k] += winR[k] * 0.4), (sG[k] += winG[k] * 0.4), (sB[k] += winB[k] * 0.4);
    }
  }

  // ships riding at anchor beyond the point
  // [x, row, r, g, b]: white mastheads, warm deck and cabin lights, a red port light
  // a long freighter with its bridge aft, and a smaller boat further out
  const shipLights: [number, number, number, number, number][] = [
    [184, 35, 1, 1, 0.96], [190, 34, 1, 1, 0.96], [185, 37, 1, 0.76, 0.44], [187, 37, 1, 0.78, 0.48], [189, 36, 1, 0.8, 0.5], [191, 36, 1, 0.78, 0.48],
    [197, 36, 1, 1, 0.96], [196, 38, 1, 0.76, 0.44], [199, 38, 0.95, 0.18, 0.12],
  ];
  // the light positions are design cells; each lands on one output cell
  for (const l of shipLights) (l[0] = oX(l[0] + 0.5)), (l[1] = oY(l[1] + 0.5));
  // the hulls in design units: a raked bow, a deckhouse aft, a fore mast
  const hull = (x: number, y: number, ox: number) =>
    (y >= 38 && x >= 182 && x < 193 + 0.6 * (y - 38)) || (y >= 37 && y < 38 && x >= 183 && x < 193) || (y >= 35 && y < 37 && x >= 189 && x < 192) ||
    (y >= 34.6 && y < 37 && ox === oX(184.5)) || (y >= 34.2 && y < 35 && ox === oX(190.5)) ||
    (y >= 38 && x >= 195 && x < 200) || (y >= 37 && y < 38 && x >= 196 && x < 198);
  for (let r = oY(34); r < oY(40); r++) {
    for (let x = oX(180); x < W; x++) {
      if (!hull(dX(x), dY(r), x)) continue;
      const k = r * W + x;
      // dark steel, a little veiled by the sea haze
      mat[k] = SHIP, (sR[k] = sR[k] * 0.14 + 0.004), (sG[k] = sG[k] * 0.14 + 0.004), (sB[k] = sB[k] * 0.14 + 0.006), (flo[k] = 0.02);
    }
  }
  for (const [x, r, cr, cg, cb] of shipLights) {
    // each light hangs in the haze with a faint glow round it
    for (let dr = -3; dr <= 3; dr++) {
      for (let dx = -3; dx <= 3; dx++) {
        const q = (r + dr) * W + x + dx;
        if (x + dx >= W || mat[q] === WATER) continue;
        const g = Math.exp(-Math.sqrt(dr * dr + dx * dx) / 1.1) * 0.12;
        (sR[q] += g * cr), (sG[q] += g * cg), (sB[q] += g * cb);
      }
    }
  }
  for (const [x, r, cr, cg, cb] of shipLights) {
    const k = r * W + x;
    mat[k] = SHIP, (sR[k] = cr), (sG[k] = cg), (sB[k] = cb), (flo[k] = 0.1);
  }

  // --- the bay -----------------------------------------------------------------
  // Seen at a glance toward the horizon the water mirrors most of the sky
  // (Fresnel); looked down into near us it is dark. Each water cell sees,
  // mirrored about the waterline, whatever stands on the shore in its column,
  // or past it the sky mirrored about the horizon, blurred more the further
  // the bounce is from the shore.
  const fres = new Float32Array(H);
  const waveZ = new Float32Array(H), waveQ = new Float32Array(H), wobA = new Float32Array(H), fadeR = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const yy = Math.max(0, dY(r) - HZ);
    const v = clamp(yy / (DH - HZ));
    fres[r] = 0.14 + 0.55 * Math.pow(1 - v, 4);
    // the waves in perspective: rows of ripples crowding toward the horizon
    waveZ[r] = 56 * Math.log(yy + 21);
    waveQ[r] = 4.4 / (yy + 21);
    wobA[r] = (0.4 + 2 * v) * S;
    fadeR[r] = smooth(DH + 6, DH - 8, dY(r)); // the bottom rows thin out into the ground
  }
  const mR = new Float32Array(N), mG = new Float32Array(N), mB = new Float32Array(N); // the mirror image
  const bR = new Float32Array(N), bG = new Float32Array(N), bB = new Float32Array(N); // the water's own dim light
  const refl = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]; // lights to break into glints
  const reflFl = new Float32Array(N);
  const gC = new Float32Array(N), gG = new Float32Array(N); // how the glints gather: steady part, sparkling part
  const moonE = new Float32Array(N);
  const foam = new Float32Array(N);
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      if (mat[k] !== WATER) continue;
      const xc = dX(x), y = dY(r), sy = seaTop(xc), d = y - sy;
      const F = fres[r];
      let ar = 0, ag = 0, ab = 0, er = 0, eg = 0, eb = 0;
      const spread = 0.3 + d * 0.06;
      for (let o = -1; o <= 1; o++) {
        const yo = sy - d - 0.4 + o * spread;
        const ro = oY(yo);
        const q = ro * W + x;
        const mq = ro >= 0 && ro < H ? mat[q] : SKY;
        if (mq !== SKY && mq !== WATER) {
          // the shore's front: dark walls, and the lit windows, which sparkle
          const lr = sR[q], lg = sG[q], lb = sB[q];
          (ar += Math.min(lr, 0.1)), (ag += Math.min(lg, 0.1)), (ab += Math.min(lb, 0.1));
          (er += Math.max(0, lr - 0.1)), (eg += Math.max(0, lg - 0.1)), (eb += Math.max(0, lb - 0.1));
        } else {
          // the sky, with the city-lit cloud deck that hangs over most of it
          const ym = Math.max(-Y0 + 0.4, 2 * HZ - y + o * spread);
          skyAt(xc, ym, false);
          const cd = 0.45 * smooth(32, 12, ym);
          (ar += SKYC[0] + cd * 0.15), (ag += SKYC[1] + cd * 0.12), (ab += SKYC[2] + cd * 0.12);
        }
      }
      (mR[k] = (ar / 3) * F), (mG[k] = (ag / 3) * F), (mB[k] = (ab / 3) * F);
      const fe = 0.5 * (0.08 + F);
      (refl[0][k] += (er / 3) * fe), (refl[1][k] += (eg / 3) * fe), (refl[2][k] += (eb / 3) * fe);
      // deep water, a warm sheen of the lit shore close in, and the horizon's haze far out
      const sh = (0.03 * Math.exp(-d / 6) + 0.012 * Math.exp(-d / 20)) * smooth(TIP + 4, TIP - 6, xc);
      const hz = Math.exp(-(y - HZ) / 2.2) * 0.5;
      skyAt(xc, HZ - 0.5, false);
      bR[k] = 0.009 + sh * SODIUM[0] + hz * SKYC[0];
      bG[k] = 0.017 + sh * SODIUM[1] + hz * SKYC[1];
      bB[k] = 0.03 + sh * SODIUM[2] + hz * SKYC[2];
      // right under the shore the reflections hold together; further out they break up
      const hold = Math.exp(-d / 2.5);
      (gC[k] = 0.18 + 0.5 * hold), (gG[k] = 2.3 * (1 - 0.4 * hold));
      // the moon's road on the open water, brightest where the calm mirror would show it
      const yy = y - HZ;
      moonE[k] = Math.exp(-(((xc - MOON[0]) / (0.5 + yy * 0.1)) ** 2)) * (0.45 + 0.55 * Math.exp(-(((y - (2 * HZ - MOON[1])) / 22) ** 2)));
      // and a wider, fainter silvering of the ripples round it
      const ms = Math.exp(-(((xc - MOON[0]) / (4 + yy * 0.35)) ** 2)) * 0.06;
      (mR[k] += ms * 0.8), (mG[k] += ms * 0.84), (mB[k] += ms * 0.92);
      // the wash against the tetrapods along the wall
      if (xc <= TIP) foam[k] = smooth(1.2 / Math.max(1, scF(xc)), 0, d) * (0.3 + 0.7 * near[x]) * (0.5 + 0.5 * scF(xc) / 2.4);
    }
  }

  // --- lamp light: a hot core, a halo, a wide warm spill, pools on the ground ---
  const lampI = new Float32Array(N);
  const lampW = new Float32Array(N); // the white-hot cores
  const flickI = new Float32Array(N);
  const flickW = new Float32Array(N);
  lamps.forEach(([lx, ly, s], j) => {
    const core = 0.34 + 0.3 * s, halo = 0.45 + 0.45 * s, spill = 1.3 + 1.6 * s, pool = 1.3 * s + 0.35;
    const R = Math.ceil(spill * 3.2);
    const into = j === FLICK ? flickI : lampI;
    const hot = j === FLICK ? flickW : lampW;
    for (let r = Math.max(0, oY(ly - R)); r < Math.min(H, oY(ly + R) + 1); r++) {
      for (let x = Math.max(0, oX(lx - R)); x < Math.min(W, oX(lx + R) + 1); x++) {
        const k = r * W + x;
        const mk = mat[k];
        if (mk === WATER) continue;
        const dx = dX(x) - lx, dy = dY(r) - ly;
        const d = Math.sqrt(dx * dx + dy * dy);
        const c = Math.exp(-((d / core) ** 2)) * 2.2;
        let v = c * 0.7 + Math.exp(-d / halo) * 0.24 + Math.exp(-d / spill) * 0.03;
        // the pool of light it throws on the road and the promenade below
        if (dy > 0 && (mk === ROAD || mk === WALL || mk === FACE || mk === POLE)) v += Math.exp(-((dx / pool) ** 2)) * (mk === FACE ? 0.04 : mk === ROAD ? 0.08 : 0.14);
        into[k] += v;
        hot[k] += c * 0.3;
      }
    }
    // its reflection: a long column broken by the swell, reaching toward us
    // and spreading as the waves that catch it tilt further
    const sy = shoreF(lx);
    const len = 2 + 8 * s;
    for (let r = Math.max(0, oY(sy)); r < H; r++) {
      const dy = dY(r) - sy;
      if (dy < 0) continue;
      const a = Math.exp(-dy / (len * 1.7)) * (0.3 + 0.15 * s) * smooth(-0.5, 1.5, dy);
      if (a < 0.004) break;
      const wj = (0.35 + 0.45 * s) * (1 + 0.03 * dy);
      for (let x = Math.max(0, oX(lx - 3 * wj - 1)); x < Math.min(W, oX(lx + 3 * wj + 1) + 1); x++) {
        const k = r * W + x;
        if (mat[k] !== WATER) continue;
        const g = (a * Math.exp(-(((dX(x) - lx) / wj) ** 2))) / (1 + 0.04 * dy);
        if (j === FLICK) reflFl[k] += g;
        else (refl[0][k] += g * SODIUM[0]), (refl[1][k] += g * SODIUM[1]), (refl[2][k] += g * SODIUM[2]);
      }
    }
  });
  for (let k = 0; k < N; k++) {
    const m = mat[k];
    if (m === WATER || m === SKY) continue;
    sR[k] += lampI[k] * SODIUM[0] + lampW[k] * HOT[0];
    sG[k] += lampI[k] * SODIUM[1] + lampW[k] * HOT[1];
    sB[k] += lampI[k] * SODIUM[2] + lampW[k] * HOT[2];
  }

  // the ships' lights stretch down the water too
  for (const [x, , cr, cg, cb] of shipLights) {
    for (let r = oY(HZ); r < oY(HZ + 14); r++) {
      const a = Math.exp(-(dY(r) - HZ) / 5) * 0.3;
      for (let dx = -2; dx <= 2; dx++) {
        const k = r * W + x + dx;
        if (x + dx >= W || mat[k] !== WATER) continue;
        const g = a * Math.exp(-((dx / S) ** 2) * 2.5);
        refl[0][k] += g * cr, refl[1][k] += g * cg, refl[2][k] += g * cb;
      }
    }
  }

  // --- clouds: low stratus lit from beneath by the city, wrapping -----------
  // a band 800 design columns round, sampled at the output resolution; each
  // texel keeps its cover, its thickness, how lit it is from below, and the
  // slope of its density, to shade it toward the moon as the band drifts
  const CW = 800 * S, CH = oY(HZ), CX = CH + 4;
  const dens = new Float32Array(CW * CX);
  for (let r = 0; r < CX; r++) {
    for (let x = 0; x < CW; x++) {
      const xd = dX(x) - 0.5, y = dY(r);
      const q = fbm(xd * 0.01, y * 0.05, 3, 8);
      const d = fbm(xd * 0.025 + q * 2.6, y * 0.07 + q * 1.3, 5, 20);
      const yb = y + 14 * (fbm(xd * 0.005 + 3, 7, 2, 4) - 0.5); // the bank's edge rises and falls
      dens[r * CW + x] = d + 0.05 * smooth(2 - Y0, 14 - Y0, yb) - 0.1 * smooth(6 - Y0, -Y0, y) - 0.1 * smooth(22, HZ - 4, yb);
    }
  }
  const cover = new Float32Array(CW * CH);
  const thick = new Float32Array(CW * CH);
  const under = new Float32Array(CW * CH);
  const slX = new Float32Array(CW * CH), slY = new Float32Array(CW * CH);
  for (let r = 0; r < CH; r++) {
    for (let x = 0; x < CW; x++) {
      const i = r * CW + x;
      const d = dens[i];
      cover[i] = smooth(0.45, 0.65, d) * 0.92;
      thick[i] = smooth(0.52, 0.76, d);
      under[i] = clamp(0.5 + (d - dens[(r + 3) * CW + x]) * 9);
      slX[i] = dens[r * CW + ((x + 2) % CW)] - dens[r * CW + ((x + CW - 2) % CW)];
      slY[i] = dens[(r + 2) * CW + x] - dens[Math.max(0, r - 2) * CW + x];
    }
  }

  // per sky cell: where the moon lies, how strongly it lights a cloud there,
  // how much of the city's glow reaches up to it, and how much cloud it may
  // hold (none on the moon's face, little low over the horizon, and the sky
  // behind the towers at the point kept clear, so the dark glass reads against
  // the city's haze)
  const mLx = new Float32Array(N), mLy = new Float32Array(N), mNear = new Float32Array(N), mSil = new Float32Array(N);
  const cityL = new Float32Array(N), cloudA = new Float32Array(N), star = new Float32Array(N), grain = new Float32Array(N);
  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const k = r * W + x;
      grain[k] = 0.95 + 0.1 * hash(x * 13 + 7, r * 17 + 3);
      if (mat[k] !== SKY) continue;
      const xc = dX(x), y = dY(r);
      const dmx = MOON[0] - xc, dmy = MOON[1] - y;
      const dm = Math.max(0.01, Math.sqrt(dmx * dmx + dmy * dmy));
      (mLx[k] = dmx / dm), (mLy[k] = dmy / dm);
      mNear[k] = 0.08 + 0.3 * Math.exp(-dm / 14) + 0.16 * Math.exp(-dm / 50);
      mSil[k] = 0.55 * Math.exp(-dm / 7);
      cityL[k] = (0.3 + 0.7 * smooth(-Y0, HZ - 6, y)) * (0.3 + 0.7 * smooth(TIP + 20, TIP - 10, xc)) * 1.1;
      const clear = 1 - 0.9 * smooth(84, 96, xc) * smooth(186, 176, xc) * smooth(20, 28, y);
      cloudA[k] = clear * smooth(MOON_R - 0.5, MOON_R + 2.5, dm) * (1 - 0.8 * smooth(27, 37, y));
      // the few stars the city's light leaves
      if (y < HZ - 12 && dm > 18 && hash(x, r * 3 + 11) > 0.9982) star[k] = (0.16 + 0.3 * hash(x * 7, r + 5)) * smooth(HZ - 12, HZ - 24, y);
    }
  }

  // --- cars ------------------------------------------------------------------
  const BIN = 0.2;
  const U0 = -6, NB = Math.ceil((UEND + 12) / BIN);
  const laneA = new Float32Array(NB), laneB = new Float32Array(NB);
  const cars: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) cars.push([hash(i, 51) * (UEND + 12), 4.2 + 1.6 * hash(i, 52), i & 1]);
  const binLo = new Int32Array(W), binHi = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    binLo[x] = Math.max(0, Math.floor((Uof(x / S) - U0) / BIN));
    binHi[x] = Math.min(NB - 1, Math.max(binLo[x], Math.floor((Uof((x + 1) / S) - U0) / BIN)));
  }
  const colA = new Float32Array(W), colB = new Float32Array(W);

  return (t, px) => {
    const drift = t * 1.3 * S;
    // cars: tail lights heading out to the point, headlights coming home
    laneA.fill(0), laneB.fill(0);
    const span = UEND + 12;
    for (const [p0, v, dir] of cars) {
      const p = (((p0 + (dir ? -v : v) * t) % span) + span) % span;
      const into = dir ? laneB : laneA;
      const head = Math.floor(p / BIN);
      for (let i = 0; i < 26; i++) {
        const b = dir ? head + i : head - i;
        if (b < 0 || b >= NB) continue;
        const e = Math.exp(-i / 7) * (i < 2 ? 1.3 : 0.85);
        if (e > into[b]) into[b] = e;
      }
    }
    for (let x = 0; x < W; x++) {
      let a = 0, b = 0;
      for (let i = binLo[x]; i <= binHi[x]; i++) (a = Math.max(a, laneA[i])), (b = Math.max(b, laneB[i]));
      colA[x] = a, colB[x] = b;
    }
    // the failing lamp
    const sputter = Math.sin(t * 0.7) > 0.45;
    const lampOn = sputter ? (hash(Math.floor(t * 9), 77) > 0.45 ? 1 : 0.15) : 1;

    for (let r = 0; r < H; r++) {
      const y = dY(r);
      const Z = waveZ[r], q = waveQ[r], wa = wobA[r], fd = fadeR[r];
      for (let x = 0; x < W; x++) {
        const k = r * W + x;
        const m = mat[k];

        if (m === WATER) {
          // the swell and a cross chop over it, in perspective
          const X = (x - 160) * q;
          const w = 0.6 * noise(X + t * 0.12, Z - t * 0.8, 0) + 0.4 * noise(X * 2.3 + 5 - t * 0.25, Z * 1.9 + 3 + t * 0.55, 0);
          // wave faces tipped toward the horizon mirror the brighter sky
          const tilt = 0.45 + 1.1 * w;
          let cr = bR[k] + mR[k] * tilt, cg = bG[k] + mG[k] * tilt, cb = bB[k] + mB[k] * tilt;
          // the lights, pushed sideways by each passing ripple and gathered into glints
          let sx = x + (noise(X * 0.6 + 9, Z * 0.9 - t * 0.7, 0) - 0.5) * wa;
          if (sx < 0) sx = 0;
          if (sx > W - 1.001) sx = W - 1.001;
          const i0 = r * W + (sx | 0), fx = sx - (sx | 0);
          const gl = smooth(0.48, 0.7, w);
          const pk = gC[k] + gG[k] * gl * gl;
          const fl = (reflFl[i0] + (reflFl[i0 + 1] - reflFl[i0]) * fx) * lampOn;
          const e0 = refl[0][i0] + (refl[0][i0 + 1] - refl[0][i0]) * fx + fl * SODIUM[0];
          const e1 = refl[1][i0] + (refl[1][i0 + 1] - refl[1][i0]) * fx + fl * SODIUM[1];
          const e2 = refl[2][i0] + (refl[2][i0 + 1] - refl[2][i0]) * fx + fl * SODIUM[2];
          cr += e0 * pk, cg += e1 * pk, cb += e2 * pk;
          const me = moonE[k];
          if (me > 0.002) {
            // the moon's road, a scatter of cold sparks
            const sp = smooth(0.5, 0.8, 0.5 * w + 0.5 * noise(X * 1.7 + t * 0.3, Z * 2.2 - t * 1.3, 0));
            const v = me * (0.04 + 1.2 * sp * sp);
            cr += v * 0.93, cg += v * 0.93, cb += v * 0.9;
          }
          const fo = foam[k];
          if (fo > 0) {
            const n = smooth(0.5, 0.85, noise(x * 0.5 + t * 0.25, r * 0.9 - t * 0.9, 0));
            const v = fo * n * 0.14;
            cr += v * 0.95, cg += v * 0.8, cb += v * 0.62;
          }
          expose(px, k, cr, cg, cb, 0.13, fd);
          continue;
        }

        let cr = sR[k], cg = sG[k], cb = sB[k];
        if (m === SKY) {
          const sx = x + drift, ix = Math.floor(sx), fx = sx - ix;
          const i0 = r * CW + (ix % CW), i1 = r * CW + ((ix + 1) % CW);
          const c = (cover[i0] + (cover[i1] - cover[i0]) * fx) * cloudA[k];
          if (c > 0.01) {
            const th = thick[i0] + (thick[i1] - thick[i0]) * fx;
            const un = under[i0] + (under[i1] - under[i0]) * fx;
            const gx = slX[i0] + (slX[i1] - slX[i0]) * fx, gy = slY[i0] + (slY[i1] - slY[i0]) * fx;
            // facing the moon or in the shadow of denser cloud between
            const lm = clamp(0.5 - (gx * mLx[k] + gy * mLy[k]) * 5);
            const dark = 1 - 0.45 * th;
            const cl = cityL[k] * (0.2 + 0.8 * un);
            const mo = mNear[k] * (0.15 + 0.85 * lm);
            const si = mSil[k] * (1 - th);
            const kr = (0.036 + cl * 0.28 + mo * 0.6) * dark + si * 0.85;
            const kg = (0.042 + cl * 0.21 + mo * 0.63) * dark + si * 0.86;
            const kb = (0.066 + cl * 0.18 + mo * 0.7) * dark + si * 0.9;
            const a = Math.min(1, c * 1.15);
            cr = mix(cr, kr, a), cg = mix(cg, kg, a), cb = mix(cb, kb, a);
          } else if (star[k]) {
            const tw = star[k] * (0.75 + 0.25 * Math.sin(t * (1.3 + hash(x, r) * 2.5) + hash(r, x) * 6.28));
            const warm = hash(r * 3, x * 5);
            cr = Math.max(cr, tw * (0.85 + 0.15 * warm)), cg = Math.max(cg, tw * 0.9), cb = Math.max(cb, tw * (1 - 0.15 * warm));
          }
          const li = lampI[k], lw = lampW[k];
          cr += li * SODIUM[0] + lw * HOT[0], cg += li * SODIUM[1] + lw * HOT[1], cb += li * SODIUM[2] + lw * HOT[2];
        } else if (m === ROAD) {
          const L = lane[k];
          const a = L & 1 ? colA[x] : 0, b = L & 2 ? colB[x] : 0;
          cr += a * 0.9 + b * 1.0, cg += a * 0.08 + b * 0.9, cb += a * 0.05 + b * 0.76;
        }
        const f = flickI[k] * lampOn, fw = flickW[k] * lampOn;
        if (f) cr += f * SODIUM[0] + fw * HOT[0], cg += f * SODIUM[1] + fw * HOT[1], cb += f * SODIUM[2] + fw * HOT[2];
        const gn = grain[k];
        expose(px, k, cr * gn, cg * gn, cb * gn, flo[k], 1);
      }
    }

    // rooms whose light changes, and the aviation lights
    for (const [k, wr, wg, wb, kind, rate, ph] of flick) {
      if (kind) {
        // a television: cold light that jumps
        const f = 0.5 + 0.5 * Math.sin(t * 11 + ph) * Math.sin(t * 4.3 + ph * 2);
        expose(px, k, sR[k] - wr + f * wr * 0.45, sG[k] - wg + f * wr * 0.6, sB[k] - wb + f * wr, 0.05, 1);
      } else {
        // a light switched off for a while, then on again
        const f = Math.sin(t * rate * 0.5 + ph) > -0.6 ? 1 : 0;
        expose(px, k, sR[k] - wr * (1 - f), sG[k] - wg * (1 - f), sB[k] - wb * (1 - f), 0.05, 1);
      }
    }
    for (const [k, ph] of beacons) {
      if (k < 0) continue;
      const on = Math.sin(t * 2.4 + ph) > 0.3;
      expose(px, k, on ? 1 : sR[k] + 0.06, on ? 0.16 : sG[k] + 0.01, on ? 0.1 : sB[k] + 0.008, 0.1, 1);
    }
  };

  // Light brighter than the dot can show burns toward white, as it does in
  // the eye and on film: the lamps' cores and the brightest glints go white-hot.
  function expose(px: Uint8ClampedArray, k: number, cr: number, cg: number, cb: number, floor: number, fade: number) {
    cr = Math.max(0, cr), cg = Math.max(0, cg), cb = Math.max(0, cb);
    const pk = Math.max(cr, cg, cb);
    if (pk > 1) {
      const e = Math.min(1, (pk - 1) * 0.5);
      cr = mix(cr / pk, 1, e), cg = mix(cg / pk, 1, e), cb = mix(cb / pk, 1, e);
    }
    dot(px, k, cr, cg, cb, floor, fade);
  }
}
