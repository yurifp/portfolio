/*
  LED WALL — the matrix-rain page. WebGL2, one fullscreen triangle,
  everything per-pixel in the fragment shader: cell grid, rounded-rect
  SDF, per-column rain with hot heads + fading trails, organic fbm
  clusters, soft-quantized intensity levels, flicker, two-term bloom,
  and a scroll-scrubbed IGNITION WAVE (top→down front with per-column
  irregularity) that also drives the canvas alpha — before the wave the
  pixels are transparent, so the hero reads through; the crest of the
  wave is the first rain.

  Look calibrated to the references (REF-1: long trails + heads,
  REF-2: short clumps + varied brightness): both layers combined,
  ~45% coverage, greenish near-black gaps via bloom spill.

  Fallback: WebGL2 missing or context lost → one static 2D frame.
  Zero allocation per frame; adaptive resolution if frames get heavy.
*/

/* ---------- tuning: grid ---------- */
const COLUMNS_PER_WIDTH = 26;  /* ≈74 columns at 1920px, per the refs */
const COLUMNS_MIN = 30;        /* mobile floor (spec: 30–40 @ ≤700px) */
const COLUMNS_MAX = 90;        /* desktop ceiling (spec: 70–90 @ 1920) */
const GAP_RATIO = 0.22;        /* gap between cells / pitch (refs 20–25%) */
const CORNER_RADIUS = 0.16;    /* slight rounding, fraction of cell */

/* ---------- tuning: rain & clusters ---------- */
const FALL_SPEED = 26;         /* cells/s at the fastest columns */
const TRAIL_MIN = 3;           /* shortest dash (REF-2 clumps) */
const TRAIL_MAX = 20;          /* longest trail (REF-1 streaks) */
const CLUSTER_SCALE = 0.16;    /* noise frequency in cell units */
const CLUSTER_DRIFT = 1.6;     /* clusters fall too, cells/s */
const LIT_DENSITY = 0.47;      /* fraction of cells lit at rest */
const FLICKER = 0.06;          /* ±6% per-cell brightness wobble */
const OFF_LEVEL = 0.055;       /* dim body level of unlit cells */

/* ---------- tuning: glow ---------- */
const GLOW_TIGHT = 0.55;       /* fast bloom falloff (adjacent spill) */
const GLOW_WIDE = 0.10;        /* slow halo falloff (whole-grid wash) */
const GLOW_STRENGTH = 0.85;

/* ---------- tuning: ignition wave (scroll-scrubbed) ---------- */
const WAVE_JITTER = 3.0;       /* per-column front irregularity (cells) */
const WAVE_CREST_GAIN = 1.6;   /* brightness boost at the crest */

/* ---------- colors (refs default; shift toward site lime later) ---------- */
const COLOR_BASE: [number, number, number] = [0.18, 1.0, 0.28];  /* #2eff47 */
const COLOR_CORE: [number, number, number] = [0.85, 1.0, 0.84];  /* #d9ffd6 */
const COLOR_OFF: [number, number, number] = [0.045, 0.11, 0.06]; /* #0b1c0f */
const COLOR_BG: [number, number, number] = [0.027, 0.008, 0.063];/* #070210 — the hero's void token */

/* ---------- perf / robustness ---------- */
const REDUCED_SPEED = 0.12;    /* prefers-reduced-motion multiplier */
const FRAME_BUDGET_MS = 20;    /* sustained over this → drop resolution */
const RES_STEPS = [1, 0.75, 0.5];

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;       /* canvas px */
uniform float uTime;     /* seconds */
uniform float uCell;     /* cell pitch in canvas px (square) */
uniform float uSpeed;    /* fall speed, cells/s */
uniform float uTrailMin;
uniform float uTrailMax;
uniform float uClusterK;
uniform float uDrift;
uniform float uDensity;
uniform float uFlicker;
uniform float uOff;
uniform float uGlowTight;
uniform float uGlowWide;
uniform float uGlow;
uniform float uJitter;
uniform float uCrestGain;
uniform float uIgnite;   /* scroll wave, 0..1 */
uniform vec3 uColBase;
uniform vec3 uColCore;
uniform vec3 uColOff;
uniform vec3 uColBg;
out vec4 frag;

float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 443.897); q += dot(q, q.yzx + 19.19); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h12(i), b = h12(i + vec2(1.0, 0.0));
  float c = h12(i + vec2(0.0, 1.0)), d = h12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float f = 0.0, a = 0.55;
  for (int o = 0; o < 3; o++) { f += a * vnoise(p); p *= 2.13; a *= 0.5; }
  return f;
}

/* one rain layer: per-column phase/speed/length, duty-cycled */
float rainLayer(vec2 cell, float rows, float seed, float t) {
  float colRnd = h12(vec2(cell.x, seed));
  float spd = uSpeed * (0.45 + 0.9 * h12(vec2(cell.x, seed + 7.31)));
  float trail = mix(uTrailMin, uTrailMax, h12(vec2(cell.x, seed + 3.77)));
  float period = rows + trail + rows * 0.8;
  float head = mod(t * spd + colRnd * period * 4.0, period);
  float rowTop = rows - 1.0 - cell.y;
  float d = head - rowTop;                 /* >0 = head already passed */
  float body = clamp(1.0 - d / trail, 0.0, 1.0);
  body *= body;                             /* ease-out fade */
  float hot = exp(-max(d, 0.0) * 1.6) * step(0.0, d); /* bright head */
  return max(body * 0.85, hot * 1.15);
}

void main() {
  vec2 grid = gl_FragCoord.xy / uCell;
  vec2 cell = floor(grid);
  vec2 inCell = fract(grid);
  float rows = uRes.y / uCell;

  /* intensity: rain (two layers) ∪ organic clusters */
  float r = max(rainLayer(cell, rows, 1.0, uTime),
                rainLayer(cell, rows, 2.0, uTime + 37.0) * 0.8);
  float cl = fbm(cell * uClusterK + vec2(0.0, -uTime * uDrift * uClusterK));
  float cluster = smoothstep(0.62 - uDensity * 0.34, 0.78 - uDensity * 0.2, cl);
  /* brightness variety inside clusters (refs: uneven dashes) */
  cluster *= 0.25 + 0.75 * h12(cell * 1.7 + 5.0);
  float I = max(r, cluster * 0.85);

  /* flicker on lit cells only, 8 Hz, per-cell phase */
  I *= 1.0 + uFlicker * (h12(vec2(cell.x, cell.y * 1.3 + floor(uTime * 8.0))) - 0.5) * 2.0
       * smoothstep(0.05, 0.3, I);

  /* soft 5-level quantization — apagado/fraco/médio/forte/pico */
  float Iq = mix(I, floor(I * 5.0 + 0.5) / 5.0, 0.6);
  Iq = clamp(Iq, uOff, 1.0);

  /* ignition wave: front travels top→down, jittered per column */
  float colJit = (h12(vec2(cell.x, 9.13)) - 0.5) * 2.0 * uJitter
               + (vnoise(vec2(cell.x * 0.35, uTime * 0.25)) - 0.5) * uJitter;
  float rowTop = rows - 1.0 - cell.y;
  float front = uIgnite * (rows + 2.0 * uJitter + 6.0) - (uJitter + 3.0);
  float fd = front - rowTop + colJit;
  float wave = smoothstep(0.0, 2.5, fd);          /* 0 ahead, 1 behind */
  float crest = exp(-abs(fd) * 0.9) * uCrestGain * step(0.0001, uIgnite);
  Iq = Iq * wave + min(crest, 1.0) * wave;        /* the wave IS the first rain */

  /* rounded-square cell SDF in px */
  vec2 p = (inCell - 0.5) * uCell;
  float half_ = uCell * 0.5 * (1.0 - 0.22);       /* GAP_RATIO baked via uniform below */
  vec2 q = abs(p) - vec2(half_) + uCell * 0.16;   /* + CORNER_RADIUS */
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCell * 0.16;
  float aa = 1.25;                                /* px of edge softness */
  float inMask = 1.0 - smoothstep(-aa, aa, sdf);

  /* body: off tint → base → hot core at the cell center */
  vec3 body = mix(uColOff, uColBase, smoothstep(uOff, 1.0, Iq));
  float coreK = smoothstep(0.72, 1.0, Iq) * (1.0 - smoothstep(uCell * 0.14, uCell * 0.34, length(p)));
  body = mix(body, uColCore, coreK);

  /* bloom: spills into the gaps and onto neighbours */
  float dd = max(sdf, 0.0);
  vec3 bloom = uColBase * max(Iq - uOff, 0.0) * uGlow
             * (exp(-dd * uGlowTight) + 0.45 * exp(-dd * uGlowWide));

  vec3 rgb = body * inMask + bloom + uColBg * 0.5;
  frag = vec4(rgb * wave, wave);                  /* premultiplied alpha */
}
`;

export interface LedWallHandle {
  setIgnite(p: number): void;
  setActive(on: boolean): void;
  destroy(): void;
}

let wall: LedWallHandle | null = null;
export function activeWall(): LedWallHandle | null { return wall; }

export function mountLedWall(canvas: HTMLCanvasElement): LedWallHandle {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });

  let ignite = 1;          /* static/no-film default: fully developed */
  let filmActive = false;  /* the flipbook's window */
  let ioVisible = true;    /* near the viewport (rootMargin 1 viewport) */
  let hidden = document.hidden;
  let disposed = false;
  let raf = 0;
  let t0 = performance.now();
  let resIdx = 0;
  let frameEMA = 16;
  let slowFrames = 0;
  let fastFrames = 0;
  let fps = 0;
  let mode: 'webgl2' | '2d' = gl ? 'webgl2' : '2d';

  /* ---- shared sizing ---- */
  let cssW = 1, cssH = 1, cell = 24;
  function metrics() {
    const r = canvas.getBoundingClientRect();
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    const cols = Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(cssW / COLUMNS_PER_WIDTH)));
    cell = cssW / cols;
  }

  /* ---- 2D fallback: one static frame, dim grid + a few lit dashes ---- */
  function fallbackFrame() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgb(${COLOR_BG.map((c) => Math.round(c * 255)).join(',')})`;
    ctx.fillRect(0, 0, cssW, cssH);
    const cols = Math.round(cssW / cell);
    const rows = Math.ceil(cssH / cell);
    const inner = cell * (1 - GAP_RATIO);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const lit = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1;
        const v = Math.abs(lit);
        ctx.fillStyle = v > 0.93 ? 'rgba(46,255,71,0.9)' : v > 0.62 ? 'rgba(11,28,15,1)' : 'rgba(7,14,9,1)';
        const x = i * cell + (cell - inner) / 2;
        const y = j * cell + (cell - inner) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, inner, inner, cell * CORNER_RADIUS);
        ctx.fill();
      }
    }
  }

  /* ---- WebGL2 setup ---- */
  let prog: WebGLProgram | null = null;
  let buf: WebGLBuffer | null = null;
  const U: Record<string, WebGLUniformLocation | null> = {};
  const hex = (c: [number, number, number]) => c;

  function compile(type: number, src: string) {
    const sh = gl!.createShader(type)!;
    gl!.shaderSource(sh, src);
    gl!.compileShader(sh);
    if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) {
      throw new Error('[led-wall] shader: ' + gl!.getShaderInfoLog(sh));
    }
    return sh;
  }

  function setupGL() {
    if (!gl) return;
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('[led-wall] link: ' + gl.getProgramInfoLog(prog));
    }
    buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    for (const k of ['uRes', 'uTime', 'uCell', 'uSpeed', 'uTrailMin', 'uTrailMax', 'uClusterK',
      'uDrift', 'uDensity', 'uFlicker', 'uOff', 'uGlowTight', 'uGlowWide', 'uGlow',
      'uJitter', 'uCrestGain', 'uIgnite', 'uColBase', 'uColCore', 'uColOff', 'uColBg']) {
      U[k] = gl.getUniformLocation(prog, k);
    }
  }

  function sizeGL() {
    if (!gl) return;
    const dpr = Math.min(devicePixelRatio || 1, 2) * RES_STEPS[resIdx];
    canvas.width = Math.max(2, Math.round(cssW * dpr));
    canvas.height = Math.max(2, Math.round(cssH * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(now: number) {
    if (!gl || !prog) return;
    const px = canvas.width / cssW;                 /* device px per CSS px */
    const t = ((now - t0) / 1000) * (reduced ? REDUCED_SPEED : 1);
    gl!.uniform2f(U.uRes!, canvas.width, canvas.height);
    gl!.uniform1f(U.uTime!, t);
    gl!.uniform1f(U.uCell!, cell * px);
    gl!.uniform1f(U.uSpeed!, FALL_SPEED);
    gl!.uniform1f(U.uTrailMin!, TRAIL_MIN);
    gl!.uniform1f(U.uTrailMax!, TRAIL_MAX);
    gl!.uniform1f(U.uClusterK!, CLUSTER_SCALE);
    gl!.uniform1f(U.uDrift!, CLUSTER_DRIFT);
    gl!.uniform1f(U.uDensity!, LIT_DENSITY);
    gl!.uniform1f(U.uFlicker!, reduced ? 0 : FLICKER);
    gl!.uniform1f(U.uOff!, OFF_LEVEL);
    gl!.uniform1f(U.uGlowTight!, GLOW_TIGHT / (cell * px)); /* decay in px⁻¹ */
    gl!.uniform1f(U.uGlowWide!, GLOW_WIDE / (cell * px));
    gl!.uniform1f(U.uGlow!, GLOW_STRENGTH);
    gl!.uniform1f(U.uJitter!, WAVE_JITTER);
    gl!.uniform1f(U.uCrestGain!, WAVE_CREST_GAIN);
    gl!.uniform1f(U.uIgnite!, ignite);
    gl!.uniform3fv(U.uColBase!, COLOR_BASE);
    gl!.uniform3fv(U.uColCore!, COLOR_CORE);
    gl!.uniform3fv(U.uColOff!, COLOR_OFF);
    gl!.uniform3fv(U.uColBg!, hex(COLOR_BG));
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function tick(now: number) {
    raf = 0;
    if (disposed || mode !== 'webgl2') return;
    frameCount++;
    const dt = now - (tick.last || now);
    tick.last = now;
    if (dt > 0 && dt < 100) {
      frameEMA = frameEMA * 0.9 + dt * 0.1;
      fps = 1000 / Math.max(frameEMA, 0.1);
      if (frameEMA > FRAME_BUDGET_MS) { if (++slowFrames > 90 && resIdx < RES_STEPS.length - 1) { resIdx++; slowFrames = 0; sizeGL(); } }
      else slowFrames = 0;
      if (frameEMA < 11) { if (++fastFrames > 240 && resIdx > 0) { resIdx--; fastFrames = 0; sizeGL(); } }
      else fastFrames = 0;
    }
    draw(now);
    if (filmActive && ioVisible && !hidden) raf = requestAnimationFrame(tick);
  }
  (tick as unknown as { last: number }).last = 0;

  function kick() {
    if (!raf && mode === 'webgl2' && filmActive && ioVisible && !hidden && !disposed) {
      raf = requestAnimationFrame(tick);
    }
  }

  /* ---- wiring ---- */
  const io = new IntersectionObserver(([e]) => { ioVisible = e.isIntersecting; kick(); }, { rootMargin: '100% 0%' });
  io.observe(canvas);
  const ro = new ResizeObserver(() => { metrics(); if (mode === 'webgl2') sizeGL(); else fallbackFrame(); });
  ro.observe(canvas);
  const onVis = () => { hidden = document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVis);
  const onLost = (e: Event) => {
    e.preventDefault();
    mode = '2d';
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    metrics();
    fallbackFrame();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  metrics();
  if (gl) {
    try {
      setupGL();
      sizeGL();
      /* warm up: compile + one frame BEFORE the scene can be visible */
      const warm = () => { metrics(); sizeGL(); draw(performance.now()); };
      if ('requestIdleCallback' in window) (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(warm);
      else setTimeout(warm, 200);
    } catch (err) {
      console.error(String(err));
      mode = '2d';
      fallbackFrame();
    }
  } else {
    fallbackFrame();
  }

  /* probe for the test harness */
  let frameCount = 0;
  (window as unknown as { __ledwall?: Record<string, unknown> }).__ledwall = {
    get mode() { return mode; },
    get ignite() { return +ignite.toFixed(3); },
    get active() { return filmActive && ioVisible && !hidden; },
    get filmActive() { return filmActive; },
    get ioVisible() { return ioVisible; },
    get hidden() { return hidden; },
    get frames() { return frameCount; },
    get cell() { return +cell.toFixed(1); },
    get fps() { return Math.round(fps); },
    get resScale() { return RES_STEPS[resIdx]; },
    get cssSize() { return Math.round(cssW) + 'x' + Math.round(cssH); },
  };

  wall = {
    setIgnite(p) { ignite = Math.min(1, Math.max(0, p)); kick(); },
    setActive(on) { filmActive = on; kick(); },
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (gl) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        if (buf) gl.deleteBuffer(buf);
        if (prog) gl.deleteProgram(prog);
      }
      if (wall === this) wall = null;
    },
  };
  return wall;
}
