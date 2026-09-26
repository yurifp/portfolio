/*
  Dithered portrait — ordered (Bayer 8×8) dithering over a generative
  value-noise field, rendered to 2D canvas via ImageData (bulk writes —
  per-pixel fillRect was a 91s TBT bomb). Terrain is precomputed once;
  the shimmer only re-evaluates the cheap mass term, at most once per
  second. Swap `imageUrl` for a real portrait and the same dither
  pipeline applies.
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

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* black-and-white ink — matches the reference's low-key portrait
   treatment: neutral white dots on the void, no color tint */
const INK: [number, number, number] = [222, 218, 212];

export function mountPortrait(canvas: HTMLCanvasElement, opts?: { imageUrl?: string }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const W = (canvas.width = 320);
  const H = (canvas.height = 420);
  const img = ctx.createImageData(W, H);
  const data = img.data;

  /* terrain precomputed once — the expensive part never re-runs */
  const terrain = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) terrain[y * W + x] = fbm(x / 46 + 9, y / 46 + 7);

  const BASE = hexToRgb('#070210');
  const ink: [number, number, number] = INK;

  const draw = (phase: number) => {
    const [r0, g0, b0] = BASE;
    const [ri, gi, bi] = ink;
    for (let y = 0; y < H; y++) {
      const rowT = y * W;
      const dy = (y / H - 0.44) * 1.05;
      for (let x = 0; x < W; x++) {
        const i = (rowT + x) * 4;
        const dx = (x / W - 0.5) * 1.6;
        const mass = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.35) * 0.82;
        const l = mass + terrain[rowT + x] * 0.34 - 0.12 + phase * 0.08;
        const on = l > BAYER[y & 7][x & 7];
        data[i] = on ? ri : r0;
        data[i + 1] = on ? gi : g0;
        data[i + 2] = on ? bi : b0;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  draw(0);

  if (opts?.imageUrl) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const octx = off.getContext('2d')!;
      octx.drawImage(image, 0, 0, W, H);
      const src = octx.getImageData(0, 0, W, H).data;
      const [r0, g0, b0] = BASE;
      const [ri, gi, bi] = ink;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const s = (y * W + x) * 4;
          const l = (src[s] * 0.299 + src[s + 1] * 0.587 + src[s + 2] * 0.114) / 255;
          const on = l > BAYER[y & 7][x & 7];
          const i = s;
          data[i] = on ? ri : r0;
          data[i + 1] = on ? gi : g0;
          data[i + 2] = on ? bi : b0;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    image.src = opts.imageUrl;
    return;
  }

  /* slow shimmer — one redraw per second at most, skipped offscreen */
  if (!prefersReduced) {
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    const tick = (t: number) => {
      if (visible && t - last > 1000) {
        last = t;
        draw(Math.sin(t / 2600));
      }
      raf = requestAnimationFrame(tick);
    };
    let last = 0;
    let raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }
}
