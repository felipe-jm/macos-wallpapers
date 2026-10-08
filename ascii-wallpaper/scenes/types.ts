/*
 * The scene contract. A scene module exports `meta` and a default function
 * that builds the scene once and returns `frame(t, px)`, which paints the
 * picture at `t` seconds into `px`: one RGBA quad per cell, row by row, where
 * RGB is the dot's colour (sRGB) and A how much of its cell the dot covers.
 * The same `px` is passed every frame, so a scene may repaint only what moved.
 * Use `dot()` from ./dot.ts to turn a light value into a cell.
 */

export interface Meta {
  /** Lowercase display name: "night coast". */
  name: string;
  /** Grid size in square cells. */
  cols: number;
  rows: number;
  /** Frames a second. */
  fps: number;
  /** The colour behind the dots, #rrggbb. */
  ground: string;
}

/** Paints the picture at `t` seconds of play time into `px` (cols * rows * 4 bytes). */
export type Frame = (t: number, px: Uint8ClampedArray) => void;

export interface Piece {
  meta: Meta;
  default(): Frame;
}
