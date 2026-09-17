import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Generates public/og.png (1200x630) — the social card, drawn in the site's
// own token palette. Re-run after changing copy: `npm run og`.
const W = 1200;
const H = 630;

let grid = '';
for (let x = 0; x <= W; x += 48) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
for (let y = 0; y <= H; y += 48) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#0C1420"/>
  <g stroke="#2A4055" stroke-opacity="0.35" stroke-width="1">${grid}</g>

  <text x="84" y="130" font-family="'Segoe UI', Arial, sans-serif" font-size="27" fill="#8FA3B8">Yuri Ferreira Paulo, front-end engineer, Salvador BR</text>
  <rect x="84" y="158" width="1032" height="2" fill="#2A4055"/>

  <text x="84" y="298" font-family="'Segoe UI', Arial, sans-serif" font-weight="600" font-size="78" fill="#E9EEF4">Front-end engineer,</text>
  <text x="84" y="392" font-family="'Segoe UI', Arial, sans-serif" font-weight="600" font-size="78" fill="#E9EEF4">going full-stack.</text>

  <circle cx="96" cy="480" r="7" fill="#F2B441"/>
  <text x="120" y="489" font-family="'IBM Plex Mono', Consolas, monospace" font-size="23" fill="#8FA3B8">view counters in Redis, typed server actions, one codebase, two deploys</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL('../public/og.png', import.meta.url)));
console.log('og.png generated');
