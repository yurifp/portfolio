/*
  Placeholder artboards — generative covers for each project card.
  Abstract geometry in each project's signal color over the void,
  with the grid + corner-tick motifs of the design system.
  Replace the webp files in public/images/work with real shots later.
*/
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const PROJECTS = [
  { slug: 'impacts', accent: '#64e8ff', w: 920, h: 660, motif: 'orbits' },
  { slug: 'globeexplorers', accent: '#905cff', w: 600, h: 840, motif: 'globe' },
  { slug: 'this-site', accent: '#9df133', w: 760, h: 560, motif: 'grid' },
  { slug: 'aurora-terminal', accent: '#f75049', w: 640, h: 480, motif: 'wave' },
  { slug: 'tidepool', accent: '#64e8ff', w: 560, h: 760, motif: 'tide' },
  { slug: 'nordwind', accent: '#905cff', w: 840, h: 600, motif: 'wind' },
  { slug: 'paper-lantern', accent: '#f75049', w: 600, h: 800, motif: 'lantern' },
  { slug: 'sandbar', accent: '#9df133', w: 880, h: 620, motif: 'sand' },
  { slug: 'static-bloom', accent: '#64e8ff', w: 680, h: 500, motif: 'bloom' },
  { slug: 'driftwood', accent: '#905cff', w: 720, h: 540, motif: 'wave' },
  { slug: 'paloma', accent: '#f75049', w: 600, h: 800, motif: 'bloom' },
  { slug: 'cortex-analytics', accent: '#9df133', w: 840, h: 600, motif: 'grid' },
];

/* deterministic pseudo-random per slug */
function rng(seed) {
  let s = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function motifSvg(m, r, W, H, A) {
  const parts = [];
  const cx = W / 2;
  const cy = H / 2;
  switch (m) {
    case 'orbits': {
      for (let i = 0; i < 5; i++) {
        const rad = 60 + i * 62 + r() * 18;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${A}" stroke-opacity="${0.14 + i * 0.05}" stroke-width="1.4"/>`);
      }
      parts.push(`<circle cx="${cx + 120}" cy="${cy - 70}" r="14" fill="${A}"/>`);
      parts.push(`<circle cx="${cx - 150}" cy="${cy + 90}" r="8" fill="${A}" fill-opacity="0.6"/>`);
      break;
    }
    case 'globe': {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${Math.min(W, H) * 0.34}" fill="none" stroke="${A}" stroke-width="1.6"/>`);
      for (let i = 1; i < 6; i++) {
        const ry = (Math.min(W, H) * 0.34) * Math.cos((i / 6) * Math.PI * 0.5);
        parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${Math.min(W, H) * 0.34}" ry="${Math.abs(ry)}" fill="none" stroke="${A}" stroke-opacity="0.22" stroke-width="1"/>`);
        parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(ry)}" ry="${Math.min(W, H) * 0.34}" fill="none" stroke="${A}" stroke-opacity="0.16" stroke-width="1"/>`);
      }
      break;
    }
    case 'grid': {
      const cols = 7;
      const rows = 5;
      for (let x = 0; x < cols; x++)
        for (let y = 0; y < rows; y++) {
          if (r() > 0.62)
            parts.push(`<rect x="${(x + 0.5) * (W / cols)}" y="${(y + 0.5) * (H / rows)}" width="${W / cols - 8}" height="${H / rows - 8}" fill="${A}" fill-opacity="${0.1 + r() * 0.5}"/>`);
          else
            parts.push(`<rect x="${(x + 0.5) * (W / cols)}" y="${(y + 0.5) * (H / rows)}" width="${W / cols - 8}" height="${H / rows - 8}" fill="none" stroke="${A}" stroke-opacity="0.25" stroke-width="1"/>`);
        }
      break;
    }
    case 'wave': {
      let d = `M 0 ${cy}`;
      for (let x = 0; x <= W; x += 12) d += ` L ${x} ${cy + Math.sin(x / 90 + r() * 0.2) * 110}`;
      parts.push(`<path d="${d}" fill="none" stroke="${A}" stroke-width="1.8"/>`);
      for (let k = 1; k < 4; k++) {
        let d2 = `M 0 ${cy + k * 34}`;
        for (let x = 0; x <= W; x += 12) d2 += ` L ${x} ${cy + k * 34 + Math.sin(x / 90 + k + r() * 0.2) * 110}`;
        parts.push(`<path d="${d2}" fill="none" stroke="${A}" stroke-opacity="${0.4 / k}" stroke-width="1.2"/>`);
      }
      break;
    }
    case 'tide': {
      for (let i = 0; i < 9; i++) {
        const y = 60 + i * ((H - 120) / 8);
        parts.push(`<path d="M 40 ${y} q ${W / 4} ${r() * 60 - 30} ${W / 2} 0 t ${W / 2 - 80} 0" fill="none" stroke="${A}" stroke-opacity="${0.2 + r() * 0.5}" stroke-width="1.3"/>`);
      }
      break;
    }
    case 'wind': {
      for (let i = 0; i < 12; i++) {
        const y = 50 + r() * (H - 100);
        const x = r() * W * 0.5;
        const len = W * 0.25 + r() * W * 0.4;
        parts.push(`<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y + (r() - 0.5) * 30}" stroke="${A}" stroke-opacity="${0.15 + r() * 0.55}" stroke-width="${1 + r() * 2}"/>`);
      }
      parts.push(`<circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="${A}" stroke-width="2"/>`);
      break;
    }
    case 'lantern': {
      for (let i = 0; i < 6; i++) {
        const rad = 30 + i * 34;
        parts.push(`<path d="M ${cx - rad} ${cy} a ${rad} ${rad * 1.25} 0 0 0 ${rad * 2} 0" fill="none" stroke="${A}" stroke-opacity="${0.5 - i * 0.06}" stroke-width="1.4"/>`);
      }
      parts.push(`<circle cx="${cx}" cy="${cy}" r="9" fill="${A}"/>`);
      break;
    }
    case 'sand': {
      for (let i = 0; i < 8; i++) {
        const y = H * 0.3 + i * (H * 0.07);
        let d = `M 0 ${y}`;
        for (let x = 0; x <= W; x += W / 8) d += ` Q ${x + W / 16} ${y + (r() - 0.5) * 70} ${x + W / 8} ${y}`;
        parts.push(`<path d="${d}" fill="none" stroke="${A}" stroke-opacity="${0.18 + i * 0.07}" stroke-width="1.3"/>`);
      }
      break;
    }
    case 'bloom': {
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const rad = 40 + r() * Math.min(W, H) * 0.32;
        parts.push(`<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * rad}" y2="${cy + Math.sin(a) * rad}" stroke="${A}" stroke-opacity="${0.2 + r() * 0.5}" stroke-width="1"/>`);
      }
      for (let i = 0; i < 3; i++)
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${30 + i * 44}" fill="none" stroke="${A}" stroke-opacity="0.3" stroke-width="1.2"/>`);
      break;
    }
  }
  return parts.join('\n');
}

function svgFor(p) {
  const r = rng(p.slug);
  const { w: W, h: H, accent: A } = p;
  /* faint blueprint grid */
  let grid = '';
  for (let x = 0; x <= W; x += 40) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#f5f0eb" stroke-opacity="0.05"/>`;
  for (let y = 0; y <= H; y += 40) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#f5f0eb" stroke-opacity="0.05"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#070210"/>
  ${grid}
  ${motifSvg(p.motif, r, W, H, A)}
  <text x="24" y="${H - 22}" font-family="monospace" font-size="19" fill="#f5f0eb" fill-opacity="0.5" letter-spacing="4">${p.slug.toUpperCase()}</text>
  <text x="24" y="40" font-family="monospace" font-size="15" fill="${A}" letter-spacing="3">PLACEHOLDER — SWAP ME</text>
  <path d="M 12 12 h 16 M 12 12 v 16" stroke="#f5f0eb" stroke-opacity="0.7" stroke-width="1.5" fill="none"/>
  <path d="M ${W - 12} ${H - 12} h -16 M ${W - 12} ${H - 12} v -16" stroke="#f5f0eb" stroke-opacity="0.7" stroke-width="1.5" fill="none"/>
</svg>`;
}

const outDir = new URL('../public/images/work/', import.meta.url);
await mkdir(outDir, { recursive: true });
for (const p of PROJECTS) {
  const buf = await sharp(Buffer.from(svgFor(p))).webp({ quality: 82 }).toBuffer();
  await writeFile(new URL(`${p.slug}.webp`, outDir), buf);
  console.log(`✓ ${p.slug}.webp (${p.w}x${p.h})`);
}
console.log('done.');
