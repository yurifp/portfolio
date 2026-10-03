/* one-off patcher for the visual rebuild (quoting-safe) */
import fs from 'fs';
const path = 'src/games/shaft-runner/index.ts';
let s = fs.readFileSync(path, 'utf8');

/* plate() helper before box() */
if (!s.includes('function plate(')) {
  s = s.replace('  function box(x0: number, y0: number, x1: number, y1: number, lv: number) {', `  function plate(x0: number, y0: number, x1: number, y1: number) {
    /* placa: L0 fill, 1px L2 border — separates from the field */
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (y < 0 || y >= H || x < 0 || x >= W) continue;
      buf[y * W + x] = y === y0 || y === y1 || x === x0 || x === x1 ? PAL[2] : BG;
    }
  }
  function box(x0: number, y0: number, x1: number, y1: number, lv: number) {`);
}

/* text3 with pixel-scale k */
s = s.replace(`  function text3(s: string, x: number, y: number, lv: number) {
    s = s.toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = F35[s[i]] || F35[' '];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        const px = x + i * 4 + c, py = y + r;
        if (g[r][c] === '1' && py >= 0 && py < H && px >= 0 && px < W) buf[py * W + px] = lv;
      }
    }
  }`, `  function text3(s: string, x: number, y: number, lv: number, k = 1) {
    s = s.toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = F35[s[i]] || F35[' '];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r][c] !== '1') continue;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
          const px = x + (i * 4 + c) * k + dx, py = y + r * k + dy;
          if (py >= 0 && py < H && px >= 0 && px < W) buf[py * W + px] = lv;
        }
      }
    }
  }`);

/* HUD rebuild: top/bottom placa, big SCORE/HI, FUEL gradient bar + icons */
s = s.replace(/  function renderHUD\(\) \{[\s\S]*?\n  \}\n\n  function render\(\) \{/, `  function renderHUD() {
    /* top placa 0–11 */
    plate(0, 0, 107, 11);
    /* big numbers L4 (2x), labels L3 */
    text3('SCORE', 2, 1, 3);
    text3(String(score).padStart(6, '0'), 2, 6, 4, 2);
    text3('HI', 66, 1, 3);
    text3(String(Math.max(score, hiscores[0] || 0)).padStart(6, '0'), 60, 6, 4, 2);
    text3('ST ' + stage, 92, 6, 3);
    /* bottom placa 181–191 */
    plate(0, 181, 107, 191);
    const fy = 184;
    text3('FUEL', 2, fy - 2, 3);
    /* wide bar with L2→L3 gradient fill; blink accent below 25% */
    const low = fuel < 25;
    const blink = !low || (tick >> 3) % 2 === 0;
    box(2, fy + 4, 56, fy + 7, PAL[2]);
    const fw = Math.round((Math.max(0, fuel) / 100) * 53);
    for (let x = 3; x < 3 + fw; x++) {
      const lv = x < 3 + fw * 0.5 ? PAL[2] : PAL[3];
      for (let y = fy + 5; y <= fy + 6; y++) buf[y * W + x] = low && blink ? 9 : lv;
    }
    if (low && blink) { /* alert icon (square exclamation) */
      box(59, fy, 61, fy + 7, 9);
    }
    /* BOMBS: bomb pips (2×3 body + spark) */
    text3('BOMB', 66, fy - 2, 3);
    for (let i = 0; i < 5; i++) {
      const x0 = 66 + i * 6;
      if (i < bombs) { box(x0, fy + 2, x0 + 3, fy + 6, PAL[3]); buf[(fy + 1) * W + x0 + 1] = 4; }
      else box(x0, fy + 2, x0 + 3, fy + 6, PAL[1]);
    }
    /* LIVES: mini ships */
    for (let i = 0; i < Math.min(lives, 4); i++) {
      const x0 = 92 + i * 5;
      box(x0, fy + 2, x0 + 2, fy + 6, PAL[3]);
      buf[fy * W + x0 + 1] = 4;
    }
    text3(String(lives), 104, fy + 2, 4);
  }

  function render() {`);

/* title/menu/hiscores/gameover: placa behind text, CTA blinking lime */
s = s.replace(`    if (state === 'attract') {
      text5('SHAFT', 30, 48, PAL[6]);
      text5('RUNNER', 24, 60, PAL[5]);
      text3('AUTOPILOT', 36, 72, PAL[3]);
    } else if (state === 'menu') {
      text5('SHAFT', 30, 30, PAL[6]);
      text5('RUNNER', 24, 42, PAL[5]);
      text3((menuIdx === 0 ? '▶' : ' ') + ' START NEW RUN', 16, 76, menuIdx === 0 ? PAL[6] : PAL[4]);
      text3((menuIdx === 1 ? '▶' : ' ') + ' HIGH SCORES', 16, 88, menuIdx === 1 ? PAL[6] : PAL[4]);
      text3('ARROWS SELECT  SPACE OK', 4, 122, PAL[3]);
      text3('P AUTOPILOT', 28, 132, PAL[3]);
      text3('CREDIT 01', 34, 142, PAL[3]);
      text3('Q RETURN', 34, 152, PAL[3]);
    } else if (state === 'hiscores') {
      text5('HIGH SCORES', 12, 30, PAL[5]);
      hiscores.slice(0, 5).forEach((v, i) => text3(String(i + 1) + '  ' + String(v).padStart(6, '0'), 34, 52 + i * 12, PAL[4]));
      if (!savedOk) text3('SCORES NOT SAVED', 24, 118, PAL[3]);
      text3('SPACE BACK', 32, 140, PAL[4]);
    } else if (state === 'gameover') {
      text5('GAME OVER', 21, 60, PAL[6]);
      text3('SCORE ' + String(score).padStart(6, '0'), 30, 80, PAL[5]);
      if (score > 0 && hiscores.includes(score) && !autopilot) text3('NEW HIGH SCORE', 24, 92, PAL[6]);
      text3('SPACE RETRY   ESC EXIT', 8, 110, PAL[4]);
    }`, `    if (state === 'attract') {
      plate(18, 42, 89, 80);
      text5('SHAFT', 30, 46, 4);
      text5('RUNNER', 24, 56, 3);
      if ((tick >> 4) % 2 === 0) text3('AUTOPILOT', 36, 70, 9);
    } else if (state === 'menu') {
      plate(18, 24, 89, 160);
      text5('SHAFT', 30, 30, 4);
      text5('RUNNER', 24, 40, 3);
      text3((menuIdx === 0 ? '▶' : ' ') + ' START NEW RUN', 16, 76, menuIdx === 0 ? 4 : 3);
      text3((menuIdx === 1 ? '▶' : ' ') + ' HIGH SCORES', 16, 88, menuIdx === 1 ? 4 : 3);
      text3('ARROWS SELECT  SPACE OK', 4, 122, 3);
      text3('P AUTOPILOT', 28, 132, 3);
      text3('CREDIT 01', 34, 142, 3);
      text3('Q RETURN', 34, 152, 3);
    } else if (state === 'hiscores') {
      plate(14, 24, 93, 150);
      text5('HIGH SCORES', 12, 30, 3);
      hiscores.slice(0, 5).forEach((v, i) => text3(String(i + 1) + '  ' + String(v).padStart(6, '0'), 34, 52 + i * 12, i === 0 ? 4 : 3));
      if (!savedOk) text3('SCORES NOT SAVED', 24, 118, 3);
      text3('SPACE BACK', 32, 140, 3);
    } else if (state === 'gameover') {
      plate(14, 54, 93, 116);
      text5('GAME OVER', 21, 60, 4);
      text3('SCORE ' + String(score).padStart(6, '0'), 30, 80, 4);
      if (score > 0 && hiscores.includes(score) && !autopilot) text3('NEW HIGH SCORE', 24, 92, 9);
      text3('SPACE RETRY   ESC EXIT', 8, 106, 3);
    }`);

fs.writeFileSync(path, s);
console.log('patched: plate, scaled text3, HUD rebuild, screens');
