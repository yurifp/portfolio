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
  const ctx = canvas.getContext('2d');
  if (!ctx) return { draw: () => {} };
  const W = (canvas.width = 240);
  const H = (canvas.height = 240);
  const weight = opts.weight ?? 800;

  /* source coverage map: text rendered offscreen */
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  const font = (px: number) => `${weight} ${px}px Rajdhani, sans-serif`;
  octx.font = font(90);
  const m = octx.measureText(source);
  const scale = Math.min((W * 0.86) / m.width, (H * 0.86) / 90);
  octx.font = font(90 * scale);
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillStyle = '#fff';
  octx.fillText(source, W / 2, H / 2);
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
