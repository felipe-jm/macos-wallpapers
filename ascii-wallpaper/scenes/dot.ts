/*
 * dot: turns the light a cell should give off into a halftone dot.
 *
 * The dot's area grows with the light's brightness (never below `floor`, so
 * the dark parts still show the grain of the dots), and its colour is the
 * light's own hue, as bright as it needs to be for area times colour to give
 * back the light asked for. `fade` shrinks the dot toward nothing, for edges
 * that thin out into the ground.
 */

export function dot(px: Uint8ClampedArray, k: number, r: number, g: number, b: number, floor = 0.15, fade = 1): void {
  const peak = Math.max(r, g, b, 1e-4);
  const area = Math.min(1, floor + (1 - floor) * Math.pow(peak, 0.85)) * Math.max(0, fade);
  // Never drawn darker than 30% of the hue: a dim dot reads as a smaller dot, not a muddy one.
  const v = Math.max(0.3, Math.min(1, peak / Math.max(area, 1e-3)));
  const s = (255 * v) / peak;
  const i = k * 4;
  px[i] = r * s;
  px[i + 1] = g * s;
  px[i + 2] = b * s;
  px[i + 3] = area * 255;
}
