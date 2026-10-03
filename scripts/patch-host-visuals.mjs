/* one-off host patcher (quoting-safe) */
import fs from 'fs';
const path = 'src/scripts/game-host.ts';
let s = fs.readFileSync(path, 'utf8');

s = s.replace('function setLabel(t: string) { if (labelEl) labelEl.textContent = t; }',
`function setLabel(t: string) {
  if (labelEl) labelEl.textContent = t;
  if (winEl) winEl.dataset.stateText = t;
}`);

if (!s.includes('dropSeries')) {
  s = s.replace('const frameTimes: number[] = [];', 'const frameTimes: number[] = [];\nconst dropSeries: number[] = [];\nconst scrollSeries: number[] = [];');
  s = s.replace(`function telemetryFrame(now: number) {
  frameTimes.push(now - (lastTelem || now - 16));
  if (frameTimes.length > 120) frameTimes.shift();
  lastTelem = now;
}`, `function telemetryFrame(now: number) {
  frameTimes.push(now - (lastTelem || now - 16));
  if (frameTimes.length > 120) frameTimes.shift();
  lastTelem = now;
  const drops = (window as unknown as { __panel?: { drops(): unknown[] } }).__panel?.drops?.length ?? 0;
  dropSeries.push(drops);
  if (dropSeries.length > 120) dropSeries.shift();
  const total = document.documentElement.scrollHeight - innerHeight;
  scrollSeries.push(total > 0 ? +(window.scrollY / total).toFixed(3) : 0);
  if (scrollSeries.length > 120) scrollSeries.shift();
}`);
}

/* replace the framesCv block with a 3-chart panel */
const start = s.indexOf('  if (framesCv) {');
const endMarker = 'function mountGameHost';
const end = s.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) throw new Error('framesCv block not found');
const fresh = `  if (framesCv) {
    /* 3 stacked mini-charts: FRAME MS / DROPS / SCROLL % — line L4/lime,
       area L2 wash, grid L1, current value highlighted */
    const c = framesCv;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (w < 4 || h < 4) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d')!;
    x.fillStyle = '#020a04';
    x.fillRect(0, 0, w, h);
    const third = Math.floor(h / 3);
    const series = [
      { data: frameTimes, max: 40, fmt: (v: number) => String(Math.round(v)), label: 'MS', color: '#d6ffd9' },
      { data: dropSeries, max: Math.max(8, ...dropSeries), fmt: (v: number) => String(v), label: 'DRP', color: '#2cff4a' },
      { data: scrollSeries, max: 1, fmt: (v: number) => Math.round(v * 100) + '%', label: 'SCR', color: '#9df133' },
    ];
    series.forEach((sr, k) => {
      const y0 = k * third;
      x.fillStyle = '#07240d';
      for (let gy = y0 + 4; gy < y0 + third - 4; gy += 6) x.fillRect(0, gy, w, 1);
      const n = sr.data.length;
      if (n > 1) {
        const px = Math.max(1, Math.floor(w / 120));
        x.fillStyle = 'rgba(15, 122, 42, 0.35)';
        x.beginPath();
        x.moveTo(0, y0 + third - 4);
        for (let i = 0; i < n; i++) x.lineTo(i * px, y0 + third - 4 - Math.min(1, sr.data[i] / sr.max) * (third - 10));
        x.lineTo((n - 1) * px, y0 + third - 4);
        x.closePath();
        x.fill();
        x.fillStyle = sr.color;
        for (let i = 1; i < n; i++) x.fillRect(i * px, y0 + third - 4 - Math.min(1, sr.data[i] / sr.max) * (third - 10), Math.max(1, px - 1), 2);
        x.fillRect((n - 1) * px, y0 + third - 4 - Math.min(1, sr.data[n - 1] / sr.max) * (third - 10) - 2, Math.max(1, px), 5);
      }
      x.fillStyle = '#2cff4a';
      x.font = (9 * dpr) + 'px monospace';
      x.fillText(sr.label + ' ' + sr.fmt(sr.data[sr.data.length - 1] ?? 0), 4 * dpr, y0 + 11 * dpr);
    });
  }

`;
s = s.slice(0, start) + fresh + s.slice(end);
fs.writeFileSync(path, s);
console.log('host patched');
