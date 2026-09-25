import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Generates public/og.png (1200x630) — the social card, drawn in the
// field design language: void ground, blueprint grid, corner ticks,
// signal dots. Re-run after changing copy: `npm run og`.
const W = 1200;
const H = 630;

let grid = '';
for (let x = 0; x <= W; x += 48) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
for (let y = 0; y <= H; y += 48) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;

/* scattered signal dust */
let dust = '';
for (let i = 0; i < 60; i++) {
  const x = Math.round(((i * 197) % 1140) + 30);
  const y = Math.round(((i * 331) % 570) + 30);
  const r = 1 + ((i * 7) % 3);
  const c = ['#9df133', '#905cff', '#64e8ff', '#f75049'][i % 4];
  dust += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" fill-opacity="${0.25 + ((i * 13) % 50) / 100}"/>`;
}

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#070210"/>
  <g stroke="#f5f0eb" stroke-opacity="0.05" stroke-width="1">${grid}</g>
  ${dust}

  <path d="M 24 24 h 20 M 24 24 v 20" stroke="#f5f0eb" stroke-opacity="0.8" stroke-width="2" fill="none"/>
  <path d="M ${W - 24} ${H - 24} h -20 M ${W - 24} ${H - 24} v -20" stroke="#f5f0eb" stroke-opacity="0.8" stroke-width="2" fill="none"/>

  <text x="72" y="98" font-family="Consolas, monospace" font-size="20" fill="#b0b4c0" letter-spacing="4">YURI.FERREIRA — PORTFOLIO ©2026</text>

  <text x="68" y="270" font-family="Arial Narrow, Arial, sans-serif" font-weight="600" font-size="150" fill="#f5f0eb" letter-spacing="-4">YURI</text>
  <text x="180" y="390" font-family="Arial Narrow, Arial, sans-serif" font-weight="600" font-size="150" fill="#9df133" letter-spacing="-4">FERREIRA</text>

  <text x="72" y="470" font-family="Consolas, monospace" font-size="21" fill="#b0b4c0">software engineer — where engineering meets graphic art</text>

  <circle cx="82" cy="540" r="5" fill="#f75049"/>
  <text x="100" y="547" font-family="Consolas, monospace" font-size="19" fill="#747785">Salvador, BR — 12°58'S 38°31'W</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL('../public/og.png', import.meta.url)));
console.log('og.png generated');
