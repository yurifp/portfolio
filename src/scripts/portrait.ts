/*
  Dithered portrait — ordered (Bayer 8×8) dithering over a generative
  value-noise field, rendered to 2D canvas. Reads like a halftone photo
  treatment from the print world; swap `imageUrl` for a real portrait
  and the same pipeline applies.
*/
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* classic Bayer 8x8 threshold matrix */
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => (v + 0.5) / 64));

/* deterministic hash noise — smooth enough after fbm passes */
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  let f = 0;
  let amp = 0.5;
  for (let o = 0; o < 4; o++) {
    f += amp * vnoise(x, y);
    x *= 2.1;
    y *= 2.1;
    amp *= 0.5;
  }
  return f;
}

export function mountPortrait(canvas: HTMLCanvasElement, opts?: { imageUrl?: string }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = (canvas.width = 320);
  const H = (canvas.height = 420);

  const luminance = (x: number, y: number) => {
    /* radial bust-like mass + fbm terrain: bright core, dark ground */
    const dx = (x / W - 0.5) * 1.6;
    const dy = (y / H - 0.44) * 1.05;
    const r = Math.sqrt(dx * dx + dy * dy);
    const mass = Math.max(0, 1 - r * 1.35);
    const terrain = fbm(x / 46 + 9, y / 46 + 7);
    return mass * 0.82 + terrain * 0.34 - 0.12;
  };

  const draw = (phase: number) => {
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--color-lime').trim() || '#9df133';
    ctx.fillStyle = '#070210';
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const l = luminance(x + phase, y);
        const b = BAYER[y & 7][x & 7];
        if (l > b) {
          ctx.fillStyle = ink;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  };

  draw(0);

  if (opts?.imageUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const octx = off.getContext('2d')!;
      octx.drawImage(img, 0, 0, W, H);
      const data = octx.getImageData(0, 0, W, H).data;
      ctx.fillStyle = '#070210';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-lime').trim() || '#9df133';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          if (l > BAYER[y & 7][x & 7]) ctx.fillRect(x, y, 1, 1);
        }
      }
    };
    img.src = opts.imageUrl;
    return;
  }

  /* slow shimmer when motion is welcome */
  if (!prefersReduced) {
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (visible && Math.floor(t / 90) % 2 === 0) draw(Math.sin(t / 2600) * 26);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }
}
