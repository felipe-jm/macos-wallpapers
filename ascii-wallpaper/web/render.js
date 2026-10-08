// Draws a scene's cells with WebGL2: each cell is a round, antialiased dot of
// its own colour and size over the scene's ground, scaled to cover the canvas,
// with a soft bloom spreading from the bright cells around it (read from the
// mipmaps of the cell texture, so it costs a few texture reads a pixel).

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D cells;
uniform vec2 grid;    // cols, rows
uniform vec2 view;    // canvas size in pixels
uniform vec3 ground;
out vec4 outColor;

// A full dot (area 1) reaches a little past its cell's edge, so bright areas close up.
const float RMAX = 0.56;

void main() {
  float scale = max(view.x / grid.x, view.y / grid.y);           // pixels per cell
  vec2 pix = vec2(gl_FragCoord.x, view.y - gl_FragCoord.y);
  vec2 c = (pix - (view - grid * scale) * 0.5) / scale;           // position in cells
  float aa = 0.7 / scale;

  vec3 col = ground;
  ivec2 home = ivec2(floor(c));
  ivec2 hi = ivec2(grid) - 1;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 ci = clamp(home + ivec2(dx, dy), ivec2(0), hi);
      vec4 d = texelFetch(cells, ci, 0);
      float r = RMAX * sqrt(d.a);
      float m = smoothstep(r + aa, r - aa, length(c - vec2(ci) - 0.5));
      col = mix(col, d.rgb, m);
    }
  }

  // Bloom: the light of the cells around, wider and fainter at each level.
  vec2 uv = c / grid;
  vec3 glow = vec3(0.0);
  float w = 0.5;
  for (int l = 2; l <= 5; l++) {
    vec4 s = textureLod(cells, uv, float(l));
    glow += w * max(s.rgb * s.a - 0.42, 0.0);
    w *= 0.75;
  }
  outColor = vec4(col + glow * 0.7, 1.0);
}`;

export function createRenderer(canvas, meta) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const { cols, rows } = meta;
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texStorage2D(gl.TEXTURE_2D, 1 + Math.floor(Math.log2(Math.max(cols, rows))), gl.RGBA8, cols, rows);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(prog, "cells"), 0);
  gl.uniform2f(gl.getUniformLocation(prog, "grid"), cols, rows);
  const g = meta.ground ?? "#000000";
  gl.uniform3f(gl.getUniformLocation(prog, "ground"), ...[1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16) / 255));
  const viewLoc = gl.getUniformLocation(prog, "view");

  return (px) => {
    const w = Math.round(canvas.clientWidth * devicePixelRatio);
    const h = Math.round(canvas.clientHeight * devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) (canvas.width = w), (canvas.height = h);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(viewLoc, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

// Plays `piece` on `canvas` at its frame rate while the page is visible; returns a stop function.
export function play(canvas, piece) {
  const { meta } = piece;
  const frame = piece.default();
  const draw = createRenderer(canvas, meta);
  const px = new Uint8ClampedArray(meta.cols * meta.rows * 4);
  let t = 0, last = 0, raf = 0;
  const show = () => {
    frame(t, px);
    draw(px);
  };
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = now - last;
    if (dt < 1000 / meta.fps - 2) return;
    last = now;
    t += Math.min(dt, 100) / 1000;
    show();
  };
  const run = () => {
    if (!document.hidden && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    } else if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  show();
  run();
  document.addEventListener("visibilitychange", run);
  return () => {
    cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener("visibilitychange", run);
  };
}
