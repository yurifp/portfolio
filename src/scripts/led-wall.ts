/*
  LED WALL v2 — the matrix page, rebuilt for the reference look.

  Pipeline (WebGL2, linear light, HDR before tone mapping):
    PASS A  scene  -> FBO1 (RGBA16F): per-cell simulation, rounded-rect
            SDF with inner gradient + bevel, square hot core, ignition
            wave (alpha), lime sweep (alpha=2 flag bypasses tonemap),
            UI luminance mask. Output is PREMULTIPLIED HDR.
    PASS B  bloom H -> FBO2 (half res, 13-tap gaussian)
    PASS C  bloom V -> FBO3 (half res)  [run twice for a wide skirt]
    PASS D  composite -> screen: scene + bloom, vignette, triangular
            dither, tone map 1-exp(-x), sRGB encode.

  Simulation per cell (all in the shader, zero per-frame CPU work):
    organic fBm with domain warp + slow downward drift (blobs of a few
    cells), matrix rain on ~30% of the columns (exponential trail, hot
    head as a SQUARE core), fixed ±10% per-cell variance, low-amp
    flicker, soft 8-level PWM quantization. Energy budget target:
    ~40% off / ~30% weak / ~22% mid-high / ~8% peaks.

  Quality tiers, auto-switched on sustained frame time:
    0 bloom (float FBOs) · 1 analytic 5-tap glow · 2 no glow.
  Fallback: WebGL2 missing or context lost -> one static 2D frame.
*/

/* ---------- tuning: grid ---------- */
const COLUMNS_PER_WIDTH = 17;  /* ~113 columns at 1920px (spec 90–120) */
const COLUMNS_MIN = 36;        /* mobile floor (spec 36–48 @ ≤700px) */
const COLUMNS_MAX = 120;
const GAP_RATIO = 0.16;        /* gap between cells / pitch */
const CORNER_RADIUS = 0.12;    /* fraction of the cell */
const BEVEL = 0.14;            /* top-light/bottom-dark tilt */
const CORE_INSET = 0.30;       /* hot core = inner square */

/* ---------- tuning: organic field ---------- */
const CLUSTER_SCALE = 0.22;    /* noise freq in cell units (blobs ~4-6 cells) */
const WARP_AMOUNT = 0.50;      /* domain warp amplitude */
const DRIFT_CELLS_S = 0.9;     /* blobs drift down, slowly */
const LIT_DENSITY = 0.58;      /* blob coverage — density vs peak-budget tradeoff */

/* ---------- tuning: rain ---------- */
const COL_ACTIVE = 0.40;       /* fraction of columns with a live thread */
const COL_CYCLE_S = 3.2;       /* re-decide active columns every… */
const FALL_SPEED = 16;         /* cells/s at the fastest columns */
const TRAIL_MIN = 8;           /* cells */
const TRAIL_MAX = 28;
const TRAIL_SHARP = 1.9;       /* exponential decay rate along the trail */
const HEAD_POP = 1.0;          /* head cell intensity */
const TRAIL_MAX_I = 0.72;      /* trail ceiling — heads must pop */

/* ---------- tuning: levels / finish ---------- */
const QUANT_LEVELS = 8;        /* PWM steps */
const QUANT_MIX = 0.75;        /* soft transition between steps */
const CELL_VARIANCE = 0.10;    /* fixed ±10% per cell */
const FLICKER = 0.04;          /* low-amp, ~3 Hz */
const EXPOSURE = 2.1;          /* HDR -> tone map */
const VIGNETTE = 0.16;
const BLOOM_GAIN = 0.55;

/* ---------- tuning: ignition wave + lime sweep ---------- */
const WAVE_JITTER = 3.0;       /* per-column front irregularity (cells) */
const WAVE_CREST_GAIN = 3.0;   /* crest super-exposure */
const SWEEP_JITTER = 4.0;
const SWEEP_CREST = 2.5;       /* pre-front super-exposure */
const SWEEP_ACCEL = 0.6;       /* rain speeds up while sweeping */

/* ---------- tuning: UI luminance mask ---------- */
/* WCAG 4.5:1 against light ink (L≈0.94) needs bg L≤0.17 — saturated
   green sits right in that band, so UI zones cap CELL INTENSITY at
   UI_FLOOR, not just dim it. Long falloffs keep it box-free. */
const UI_FLOOR = 0.08;         /* intensity ceiling inside UI zones */
const UI_TOP_PX = 76;          /* hud strip (logo/sound/menu) */
const UI_TOP_FALL = 240;
const UI_RIGHT_PX = 104;       /* rail lane (gutter + rail) */
const UI_RIGHT_FALL = 260;
const UI_CORNER_PX = 230;      /* bottom corners */
const UI_CORNER_FALL = 220;

/* ---------- colors (sRGB hex; converted to linear at mount) ---------- */
const COLOR_OFF = '#050f06';   /* unlit body — barely green */
const COLOR_BODY = '#0fd21a';  /* saturated body */
const COLOR_VIVID = '#2cff2c'; /* bright live green */
const COLOR_PEAK = '#d6ffd6';  /* greenish white — peaks only */
const COLOR_LIME = '#9df133';  /* the lime scene's exact backdrop */
const COLOR_VOID = '#070210';  /* the hero's void token */

/* ---------- perf ---------- */
const REDUCED_SPEED = 0.10;
const FRAME_BUDGET_MS = 20;
const FRAME_GOOD_MS = 11;

function srgbToLin(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/* PASS A — the cell simulation (HDR, premultiplied) */
const FRAG_SCENE = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uCell;
uniform float uSpeed;        /* cells/s base */
uniform float uCols;         /* column count */
uniform float uIgnite;
uniform float uSweep;
uniform float uSpeedMul;
uniform float uUITop, uUITopF, uUIRight, uUIRightF, uUICorner, uUICornerF;
uniform vec3 uOff, uBody, uVivid, uPeak, uLime, uVoid;
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

/* matrix rain: ~COL_ACTIVE of the columns hold a live thread */
float rain(vec2 cell, float rows, float t) {
  float col = cell.x;
  float slot = floor(t / ${COL_CYCLE_S.toFixed(2)} + h12(vec2(col, 4.7)) * 10.0);
  float rnd = h12(vec2(col, slot * 0.731 + 9.1));
  if (rnd > ${COL_ACTIVE.toFixed(2)}) return 0.0;
  float len = mix(float(${TRAIL_MIN}), float(${TRAIL_MAX}), h12(vec2(col, slot + 2.3)));
  float spd = uSpeed * (0.55 + 0.9 * h12(vec2(col, slot + 5.9))) * uSpeedMul;
  float period = rows + len + rows * 0.9;
  float head = mod(t * spd + h12(vec2(col, slot + 7.7)) * period * 3.0, period);
  float rowTop = rows - 1.0 - cell.y;
  float d = head - rowTop;                       /* >0: head already passed */
  if (d < -1.0 || d > len) return 0.0;
  if (d < 1.0) return ${HEAD_POP.toFixed(2)};    /* the head cell pops */
  return exp(-(d - 1.0) / len * ${TRAIL_SHARP.toFixed(1)}) * ${TRAIL_MAX_I.toFixed(2)};
}

void main() {
  vec2 grid = gl_FragCoord.xy / uCell;
  vec2 cell = floor(grid);
  vec2 inCell = fract(grid);
  float rows = uRes.y / uCell;

  /* ---- organic blobs: warped fBm drifting down ---- */
  vec2 np = cell * ${CLUSTER_SCALE.toFixed(3)};
  np += (vec2(fbm(np * 0.7 + 4.2), fbm(np * 0.9 + 8.5)) - 0.5) * ${WARP_AMOUNT.toFixed(2)};
  float f = fbm(np + vec2(0.0, uTime * ${DRIFT_CELLS_S.toFixed(2)} * ${CLUSTER_SCALE.toFixed(3)}));
  float thLo = 0.62 - ${LIT_DENSITY.toFixed(2)} * 0.20;
  float thHi = thLo + 0.16;
  float blob = smoothstep(thLo, thHi, f);
  float blobI = pow(blob, 1.1) * (0.35 + 0.55 * h12(cell * 1.7 + 5.0)); /* mid levels, never peaks */

  /* ---- rain + combine + per-cell variance + flicker ---- */
  float I = max(rain(cell, rows, uTime), blobI * 0.85);
  I *= 0.9 + 0.2 * h12(cell + 1.3);                                  /* ±10% fixed */
  I *= 1.0 + ${FLICKER.toFixed(2)} * sin(uTime * 18.0 + h12(cell) * 40.0);

  /* soft 8-level PWM */
  float Iq = mix(I, floor(I * ${QUANT_LEVELS}.0 + 0.5) / ${QUANT_LEVELS}.0, ${QUANT_MIX.toFixed(2)});
  Iq = clamp(Iq, 0.0, 1.0);

  /* ---- ignition wave (hero -> led): alpha-developed film ---- */
  float colJit = (h12(vec2(cell.x, 9.13)) - 0.5) * 2.0 * ${WAVE_JITTER.toFixed(1)}
               + (vnoise(vec2(cell.x * 0.35, uTime * 0.25)) - 0.5) * ${WAVE_JITTER.toFixed(1)};
  float rowTop = rows - 1.0 - cell.y;
  float front = uIgnite * (rows + 2.0 * ${WAVE_JITTER.toFixed(1)} + 6.0) - (${WAVE_JITTER.toFixed(1)} + 3.0);
  float fd = front - rowTop + colJit;
  float wave = smoothstep(0.0, 2.5, fd);
  float crest = exp(-abs(fd) * 0.9) * ${WAVE_CREST_GAIN.toFixed(1)} * step(0.0001, uIgnite);
  Iq = Iq * wave + min(crest, 1.0) * wave;

  /* ---- lime sweep (led -> verde): quantized bottom-up front ---- */
  float rowBot = cell.y;
  float sj = (h12(vec2(cell.x, 3.3)) - 0.5) * 2.0 * ${SWEEP_JITTER.toFixed(1)}
           + (vnoise(vec2(cell.x * 0.30, uSweep * 6.0 + 3.0)) - 0.5) * ${SWEEP_JITTER.toFixed(1)};
  float sFront = uSweep * (rows + 2.0 * ${SWEEP_JITTER.toFixed(1)} + 6.0) - (${SWEEP_JITTER.toFixed(1)} + 3.0);
  float sfd = sFront - rowBot + sj;
  float swept = smoothstep(0.0, 2.0, sfd);          /* 1 = flat lime region */
  float sCrest = exp(-abs(sfd) * 0.55) * ${SWEEP_CREST.toFixed(1)} * step(0.0001, uSweep) * (1.0 - swept);

  /* ---- UI luminance mask (never over the flat lime) ----
     gl_FragCoord.y = 0 at the BOTTOM. Plateau (full dim) across the
     UI zone itself, then a long smooth falloff — no boxes */
  vec2 px = gl_FragCoord.xy;
  float mTop = 1.0 - smoothstep(uUITop, uUITop + uUITopF, uRes.y - px.y);
  float mRight = 1.0 - smoothstep(uUIRight, uUIRight + uUIRightF, uRes.x - px.x);
  float dBL = length(vec2(px.x, px.y));
  float dBR = length(vec2(uRes.x - px.x, px.y));
  float mBL = 1.0 - smoothstep(uUICorner, uUICorner + uUICornerF, dBL);
  float mBR = 1.0 - smoothstep(uUICorner, uUICorner + uUICornerF, dBR);
  float zone = clamp(mTop + mRight + mBL + mBR, 0.0, 1.0);
  float uiK = mix(1.0, ${UI_FLOOR.toFixed(2)}, zone);
  uiK = mix(1.0, uiK, 1.0 - swept);

  /* ---- cell geometry: rounded rect + gradient + bevel + square core ---- */
  vec2 p = (inCell - 0.5);
  float gap = ${GAP_RATIO.toFixed(2)};
  float rad = ${CORNER_RADIUS.toFixed(2)};
  vec2 half2 = vec2(0.5 * (1.0 - gap));
  vec2 q = abs(p) - half2 + rad;
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;  /* cell units */
  float aa = 1.25 / uCell;
  float inMask = 1.0 - smoothstep(-aa, aa, sdf);
  float grad = 1.0 - 0.28 * smoothstep(0.0, 0.85, length(p) / 0.7);  /* center brighter */
  float bevel = ${BEVEL.toFixed(2)} * (p.y / half2.y);               /* top lit, bottom dark */
  float rim = 0.85 + 0.15 * smoothstep(-rad, -0.02, sdf);            /* darker at the rim */
  vec2 c2 = abs(p) - half2 * (1.0 - ${CORE_INSET.toFixed(2)} * 2.0) + rad * 0.6;
  float coreSdf = length(max(c2, 0.0)) + min(max(c2.x, c2.y), 0.0);
  float core = 1.0 - smoothstep(-aa, aa, coreSdf - rad * 0.4);

  /* ---- color ramp in LINEAR light ---- */
  float e = Iq * uiK * uiK * grad * mix(1.0, rim + bevel, 0.8);
  vec3 col = mix(uOff, uBody, smoothstep(0.0, 0.45, Iq));
  col = mix(col, uVivid, smoothstep(0.62, 0.95, Iq));
  col = mix(col, uPeak, smoothstep(0.88, 1.0, Iq) * core);  /* peaks only, square core */
  col *= e * 2.2;                                           /* HDR headroom */
  col += uLime * sCrest * 0.8;                              /* pre-front super-exposure */

  /* ---- output: premultiplied HDR; alpha 2.0 = flat-lime flag ---- */
  vec3 limeFlat = uLime * 1.35;
  vec3 rgb = mix(col * wave, limeFlat, swept);
  float a = mix(wave, 2.0, swept);
  frag = vec4(rgb, a);
}
`;

/* PASS B/C — separable gaussian (direction via uniform) */
const FRAG_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;      /* uv step per tap */
uniform vec2 uSize;     /* TARGET size — uv must normalize by it */
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 s = vec4(0.0);
  float w[7];
  w[0]=0.1963; w[1]=0.1740; w[2]=0.1210; w[3]=0.0655; w[4]=0.0275; w[5]=0.0090; w[6]=0.0023;
  s += texture(uTex, uv) * w[0];
  for (int i = 1; i < 7; i++) {
    s += texture(uTex, uv + uDir * float(i)) * w[i];
    s += texture(uTex, uv - uDir * float(i)) * w[i];
  }
  frag = s;
}`;

/* PASS D — composite: bloom + vignette + dither + tonemap + sRGB */
const FRAG_POST = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomGain;   /* 0 = analytic/none tier */
uniform float uTime;
uniform float uExposure;
uniform float uVignette;
uniform vec3 uLimeSRGB;
uniform vec2 uPx;           /* scene texel size */
out vec4 frag;
vec3 srgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uScene, 0));
  vec4 sc = texture(uScene, uv);
  vec3 hdr = sc.rgb;
  /* analytic tier: 4 diagonal taps stand in for the blur chain */
  if (uBloomGain < -0.5) {
    vec3 g = vec3(0.0);
    vec2 d = uPx * 1.5;
    g += texture(uScene, uv + vec2(d.x, d.y)).rgb;
    g += texture(uScene, uv + vec2(-d.x, d.y)).rgb;
    g += texture(uScene, uv + vec2(d.x, -d.y)).rgb;
    g += texture(uScene, uv + vec2(-d.x, -d.y)).rgb;
    hdr += g * 0.22;
  } else {
    hdr += texture(uBloom, uv).rgb * uBloomGain;
  }
  float a = sc.a;
  if (a >= 1.5) {
    /* flat-lime flag: EXACT lime, bypass everything (seamless handoff) */
    frag = vec4(uLimeSRGB, 1.0);
    return;
  }
  vec2 c2 = uv - 0.5;
  hdr *= 1.0 - uVignette * dot(c2, c2) * 2.2;
  vec3 tm = vec3(1.0) - exp(-hdr * uExposure);
  /* triangular dither against banding */
  float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453);
  tm += (n - 0.5) * (1.5 / 255.0);
  frag = vec4(srgb(tm) * a, a);   /* premultiplied out */
}`;

export interface LedWallHandle {
  setIgnite(p: number): void;
  setSweep(p: number): void;
  setActive(on: boolean): void;
  setTier(t: number): void;
  histogram(): number[];
  destroy(): void;
}

let wall: LedWallHandle | null = null;
export function activeWall(): LedWallHandle | null { return wall; }

export function mountLedWall(canvas: HTMLCanvasElement): LedWallHandle {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });

  let ignite = 1;          /* static/no-film default: fully developed */
  let sweep = 0;
  let filmActive = false;
  let ioVisible = true;
  let hidden = document.hidden;
  let disposed = false;
  let raf = 0;
  let t0 = performance.now();
  let tier = 0;            /* 0 bloom · 1 analytic · 2 none */
  let resScale = 1;
  let frameEMA = 16, slowFrames = 0, fastFrames = 0, fps = 0, frameCount = 0;
  let mode: 'webgl2' | '2d' = gl ? 'webgl2' : '2d';

  const LIN = {
    off: srgbToLin(COLOR_OFF), body: srgbToLin(COLOR_BODY), vivid: srgbToLin(COLOR_VIVID),
    peak: srgbToLin(COLOR_PEAK), lime: srgbToLin(COLOR_LIME), void: srgbToLin(COLOR_VOID),
  };

  let cssW = 1, cssH = 1, cell = 24;
  function metrics() {
    const r = canvas.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    const cols = Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(cssW / COLUMNS_PER_WIDTH)));
    cell = cssW / cols;
  }

  /* ---- 2D static fallback ---- */
  function fallbackFrame() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOR_VOID; ctx.fillRect(0, 0, cssW, cssH);
    const cols = Math.round(cssW / cell), rows = Math.ceil(cssH / cell);
    const inner = cell * (1 - GAP_RATIO);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const v = Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1);
      ctx.fillStyle = v > 0.94 ? COLOR_VIVID : v > 0.6 ? COLOR_BODY : v > 0.25 ? COLOR_OFF : COLOR_VOID;
      const x = i * cell + (cell - inner) / 2, y = j * cell + (cell - inner) / 2;
      ctx.beginPath(); ctx.roundRect(x, y, inner, inner, cell * CORNER_RADIUS); ctx.fill();
    }
  }

  /* ---- GL objects ---- */
  type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
  let pScene: Prog, pBlur: Prog, pPost: Prog;
  let buf: WebGLBuffer | null = null;
  let fboScene: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let fboA: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let fboB: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let floatOK = false;

  function compile(type: number, src: string) {
    const sh = gl!.createShader(type)!;
    gl!.shaderSource(sh, src); gl!.compileShader(sh);
    if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) throw new Error('[led-wall] ' + gl!.getShaderInfoLog(sh));
    return sh;
  }
  function makeProg(fs: string, names: string[]): Prog {
    const p = gl!.createProgram()!;
    gl!.attachShader(p, compile(gl!.VERTEX_SHADER, VERT));
    gl!.attachShader(p, compile(gl!.FRAGMENT_SHADER, fs));
    gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error('[led-wall] ' + gl!.getProgramInfoLog(p));
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) u[n] = gl!.getUniformLocation(p, n);
    return { p, u };
  }
  function makeTarget(w: number, h: number, float: boolean) {
    const tex = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    if (float) gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA16F, w, h, 0, gl!.RGBA, gl!.HALF_FLOAT, null);
    else gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    const fb = gl!.createFramebuffer()!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
    return { fb, tex };
  }
  function delTarget(t: { fb: WebGLFramebuffer; tex: WebGLTexture } | null) {
    if (!t || !gl) return;
    gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex);
  }

  function setupGL() {
    if (!gl) return;
    floatOK = !!gl.getExtension('EXT_color_buffer_float');
    if (!floatOK) tier = 1;                       /* no HDR targets -> analytic */
    pScene = makeProg(FRAG_SCENE, ['uRes','uTime','uCell','uSpeed','uCols','uIgnite','uSweep','uSpeedMul',
      'uUITop','uUITopF','uUIRight','uUIRightF','uUICorner','uUICornerF',
      'uOff','uBody','uVivid','uPeak','uLime','uVoid']);
    pBlur = makeProg(FRAG_BLUR, ['uTex','uDir','uSize']);
    pPost = makeProg(FRAG_POST, ['uScene','uBloom','uBloomGain','uTime','uExposure','uVignette','uLimeSRGB','uPx']);
    buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  let drawW = 2, drawH = 2;
  function sizeGL() {
    if (!gl) return;
    const dpr = Math.min(devicePixelRatio || 1, 2) * resScale;
    drawW = Math.max(2, Math.round(cssW * dpr));
    drawH = Math.max(2, Math.round(cssH * dpr));
    canvas.width = drawW; canvas.height = drawH;
    delTarget(fboScene); delTarget(fboA); delTarget(fboB);
    fboScene = makeTarget(drawW, drawH, floatOK);
    fboA = makeTarget(Math.max(2, drawW >> 1), Math.max(2, drawH >> 1), floatOK);
    fboB = makeTarget(Math.max(2, drawW >> 1), Math.max(2, drawH >> 1), floatOK);
  }

  const pxScale = () => drawW / cssW;

  function drawScene(now: number) {
    if (!gl || !fboScene) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboScene.fb);
    gl.viewport(0, 0, drawW, drawH);
    gl.useProgram(pScene.p);
    const px = pxScale(), t = ((now - t0) / 1000) * (reduced ? REDUCED_SPEED : 1);
    gl.uniform2f(pScene.u.uRes!, drawW, drawH);
    gl.uniform1f(pScene.u.uTime!, t);
    gl.uniform1f(pScene.u.uCell!, cell * px);
    gl.uniform1f(pScene.u.uSpeed!, FALL_SPEED);
    gl.uniform1f(pScene.u.uCols!, Math.round(cssW / cell));
    gl.uniform1f(pScene.u.uIgnite!, ignite);
    gl.uniform1f(pScene.u.uSweep!, sweep);
    gl.uniform1f(pScene.u.uSpeedMul!, 1 + SWEEP_ACCEL * (sweep > 0 && sweep < 1 ? sweep : 0));
    gl.uniform1f(pScene.u.uUITop!, UI_TOP_PX * px); gl.uniform1f(pScene.u.uUITopF!, UI_TOP_FALL * px);
    gl.uniform1f(pScene.u.uUIRight!, UI_RIGHT_PX * px); gl.uniform1f(pScene.u.uUIRightF!, UI_RIGHT_FALL * px);
    gl.uniform1f(pScene.u.uUICorner!, UI_CORNER_PX * px); gl.uniform1f(pScene.u.uUICornerF!, UI_CORNER_FALL * px);
    gl.uniform3fv(pScene.u.uOff!, LIN.off); gl.uniform3fv(pScene.u.uBody!, LIN.body);
    gl.uniform3fv(pScene.u.uVivid!, LIN.vivid); gl.uniform3fv(pScene.u.uPeak!, LIN.peak);
    gl.uniform3fv(pScene.u.uLime!, LIN.lime); gl.uniform3fv(pScene.u.uVoid!, LIN.void);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawBlur(from: WebGLTexture, to: { fb: WebGLFramebuffer }, dirX: number, dirY: number, w: number, h: number) {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pBlur.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform1i(pBlur.u.uTex!, 0);
    gl.uniform2f(pBlur.u.uDir!, dirX / w, dirY / h);
    gl.uniform2f(pBlur.u.uSize!, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawPost(now: number) {
    if (!gl || !fboScene) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, drawW, drawH);
    gl.useProgram(pPost.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboScene.tex);
    gl.uniform1i(pPost.u.uScene!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fboB ? fboB.tex : fboScene.tex);
    gl.uniform1i(pPost.u.uBloom!, 1);
    gl.uniform1f(pPost.u.uBloomGain!, tier === 0 ? BLOOM_GAIN : tier === 1 ? -1 : 0);
    gl.uniform1f(pPost.u.uTime!, now / 1000);
    gl.uniform1f(pPost.u.uExposure!, EXPOSURE);
    gl.uniform1f(pPost.u.uVignette!, VIGNETTE);
    const lr = parseInt(COLOR_LIME.slice(1, 3), 16) / 255, lg = parseInt(COLOR_LIME.slice(3, 5), 16) / 255, lb = parseInt(COLOR_LIME.slice(5, 7), 16) / 255;
    gl.uniform3f(pPost.u.uLimeSRGB!, lr, lg, lb);
    gl.uniform2f(pPost.u.uPx!, 1 / drawW, 1 / drawH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(now: number) {
    drawScene(now);
    if (tier === 0 && fboA && fboB && fboScene) {
      const w = Math.max(2, drawW >> 1), h = Math.max(2, drawH >> 1);
      drawBlur(fboScene.tex, fboA.fb, 1, 0, w, h);
      drawBlur(fboA.tex, fboB.fb, 0, 1, w, h);
    }
    drawPost(now);
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
      if (frameEMA > FRAME_BUDGET_MS) {
        if (++slowFrames > 90) {
          if (tier < 2) { tier++; if (tier === 1 && resScale === 1) resScale = 0.75, sizeGL(); }
          else if (resScale > 0.5) { resScale = 0.5; sizeGL(); }
          slowFrames = 0;
        }
      } else slowFrames = 0;
      if (frameEMA < FRAME_GOOD_MS && tier === 0 && resScale === 1) { if (++fastFrames > 240) fastFrames = 0; }
    }
    render(now);
    if (filmActive && ioVisible && !hidden) raf = requestAnimationFrame(tick);
  }
  (tick as unknown as { last: number }).last = 0;

  function kick() {
    if (!raf && mode === 'webgl2' && filmActive && ioVisible && !hidden && !disposed) raf = requestAnimationFrame(tick);
  }

  /* ---- wiring ---- */
  const io = new IntersectionObserver(([e]) => { ioVisible = e.isIntersecting; kick(); }, { rootMargin: '100% 0%' });
  io.observe(canvas);
  const ro = new ResizeObserver(() => { metrics(); if (mode === 'webgl2') sizeGL(); else fallbackFrame(); });
  ro.observe(canvas);
  const onVis = () => { hidden = document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVis);
  const onLost = (e: Event) => {
    e.preventDefault(); mode = '2d';
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    metrics(); fallbackFrame();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  metrics();
  if (gl) {
    try {
      setupGL(); sizeGL();
      const warm = () => { metrics(); sizeGL(); render(performance.now()); };
      if ('requestIdleCallback' in window) (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(warm);
      else setTimeout(warm, 200);
    } catch (err) {
      console.error(String(err));
      mode = '2d'; fallbackFrame();
    }
  } else fallbackFrame();

  /* ---- probe ---- */
  (window as unknown as { __ledwall?: Record<string, unknown> }).__ledwall = {
    get mode() { return mode; },
    get ignite() { return +ignite.toFixed(3); },
    get sweep() { return +sweep.toFixed(3); },
    get active() { return filmActive && ioVisible && !hidden; },
    get tier() { return tier; },
    get resScale() { return resScale; },
    get cell() { return +cell.toFixed(1); },
    get cols() { return Math.round(cssW / cell); },
    get fps() { return Math.round(fps); },
    get frames() { return frameCount; },
    get cssSize() { return Math.round(cssW) + 'x' + Math.round(cssH); },
    histogram: () => (wall ? wall.histogram() : [-1, -1, -1, -1]),
    setTier: (t: number) => { if (wall) wall.setTier(t); },
  };

  wall = {
    setIgnite(p) { ignite = Math.min(1, Math.max(0, p)); kick(); },
    setSweep(p) { sweep = Math.min(1, Math.max(0, p)); kick(); },
    setActive(on) { filmActive = on; kick(); },
    setTier(t) { tier = Math.min(2, Math.max(0, t)); },
    /* measured cell-intensity histogram: off / weak / mid / peak (%)
       — reads the CENTER region (readPixels origin is bottom-left,
       and the bottom corners are UI-masked on purpose) */
    histogram() {
      if (mode !== 'webgl2' || !gl) return [-1, -1, -1, -1];
      render(performance.now());
      const w = 240, h = Math.max(2, Math.round(240 * drawH / drawW));
      const x0 = Math.round((drawW - w) / 2), y0 = Math.round((drawH - h) / 2);
      const data = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const buckets = [0, 0, 0, 0];
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
        n++;
        if (lum < 0.045) buckets[0]++;
        else if (lum < 0.30) buckets[1]++;
        else if (lum < 0.62) buckets[2]++;
        else buckets[3]++;
      }
      return buckets.map((b) => Math.round((b / n) * 1000) / 10);
    },
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (gl) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        delTarget(fboScene); delTarget(fboA); delTarget(fboB);
        if (buf) gl.deleteBuffer(buf);
        for (const pr of [pScene, pBlur, pPost]) if (pr) gl.deleteProgram(pr.p);
      }
      if (wall === this) wall = null;
    },
  };
  return wall;
}
