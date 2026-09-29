/*
  Dither engine (lime scene) — pointillism from text/glyph coverage.
  Renders the source (a word or monogram) to a small offscreen canvas,
  samples an NxN grid and draws circles whose radius is proportional
  to local coverage. Resolution is driven by SCROLL (scrub): coarse
  (6×6, big dots) → fine (28×28). Integer res changes only — cheap.
*/
export interface DitherHandle {
  draw(res: number): void;
}

export function mountDither(
  canvas: HTMLCanvasElement,
  source: string,
  opts: { ink: string; weight?: number; max?: number },
): DitherHandle {
  return mountDitherShape(canvas, (ctx, W, H) => {
    const weight = opts.weight ?? 800;
    let fs = 90;
    ctx.font = `${weight} ${fs}px Rajdhani, sans-serif`;
    const m = ctx.measureText(source);
    fs = 90 * Math.min((W * 0.86) / m.width, (H * 0.86) / 90);
    ctx.font = `${weight} ${fs}px Rajdhani, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(source, W / 2, H / 2);
  }, opts);
}

/* icon dither: renders a simple-icons SVG path (24×24 viewBox) and
   samples coverage — real logos, not letters */
export function mountDitherIcon(
  canvas: HTMLCanvasElement,
  svgPath: string,
  opts: { ink: string },
): DitherHandle {
  return mountDitherShape(canvas, (ctx, W, H) => {
    if (!svgPath) return;
    const p = new Path2D(svgPath);
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / 26, H / 26); /* 24 viewBox + margin */
    ctx.fill(p);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, opts);
}

function mountDitherShape(
  canvas: HTMLCanvasElement,
  drawShape: (ctx: CanvasRenderingContext2D, W: number, H: number) => void,
  opts: { ink: string },
): DitherHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { draw: () => {} };
  const W = (canvas.width = 240);
  const H = (canvas.height = 240);

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.fillStyle = '#fff';
  drawShape(octx, W, H);
  const src = octx.getImageData(0, 0, W, H).data;

  const sample = (x: number, y: number, w: number, h: number) => {
    /* average alpha coverage of the cell */
    let sum = 0;
    let n = 0;
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(W, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(H, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy += 2) {
      for (let xx = x0; xx < x1; xx += 2) {
        sum += src[(yy * W + xx) * 4 + 3];
        n++;
      }
    }
    return n ? sum / n / 255 : 0;
  };

  let lastRes = -1;
  const draw = (res: number) => {
    const R = Math.max(3, Math.min(28, Math.round(res)));
    if (R === lastRes) return;
    lastRes = R;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = opts.ink;
    const cell = W / R;
    const rMax = cell * 0.62;
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const cov = sample(i * cell, j * cell, cell, cell);
        if (cov < 0.06) continue;
        const r = rMax * Math.sqrt(cov);
        ctx.beginPath();
        ctx.arc((i + 0.5) * cell, (j + 0.5) * cell, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  draw(6);
  return { draw };
}
