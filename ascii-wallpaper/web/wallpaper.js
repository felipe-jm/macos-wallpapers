// Plays one scene full screen (the renderer scales it to cover the display; the
// 16:9 scenes fill a 16:9 screen exactly) and cross-fades on `wallpaper.show(name)`.
import { play } from "./render.js";

const FADE_MS = 1200;

export function start(scenes) {
  let current = null;
  let stop = null;
  let canvas = null;

  function show(name) {
    if (!(name in scenes)) name = Object.keys(scenes)[0];
    if (name === current) return;
    current = name;

    const piece = scenes[name];
    const next = document.createElement("canvas");
    document.body.append(next);
    document.body.style.backgroundColor = piece.meta.ground;
    const nextStop = play(next, piece);

    const prev = canvas, prevStop = stop;
    canvas = next;
    stop = nextStop;
    requestAnimationFrame(() => requestAnimationFrame(() => (next.style.opacity = "1")));
    if (prev) {
      prev.style.opacity = "0";
      setTimeout(() => {
        prevStop();
        prev.remove();
      }, FADE_MS);
    }
  }

  window.wallpaper = { show };
  show(window.wallpaperScene);
}
