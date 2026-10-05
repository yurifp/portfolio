/*
  SHAFT RUNNER — the GameModule (Part 1 contract). A vertical cave
  shooter on a 216×384 LED cell grid.

  GEOMETRY: the shaft DESCENDS the screen — new content enters at the
  top and flows down past the ship. The world stays 108×192 units; each
  world unit renders as 2×2 cells. Screen cells of world row wy:
      sy = FB - (wy - scroll) * 2      →  wy = scroll + (FB - sy) / 2
  Terrain (fixed wy) flows down at v. Drones descend at v+22 (wy -= 22/s).
  Bullets live in SCREEN space. Deterministic: (seed, input script).

  HUD: three bands from layout.ts (top 30 / field 310 / bottom 44) —
  no fixed HUD inside the field; plates separate the bands.
*/
import type { GameModule, HostContext, InputState } from '../../scripts/game-host';
import { F35, F57, F79, SPR_SHIP, SPR_DRONE, SPR_TOWER, SPR_MINE, SPR_TANK } from './data';
import { Shaft, mulberry32, stageOf, stageCfg, checkWorld } from './world';
import { LOGICAL, BANDS, HUD, calcScale } from './layout';

/* phosphor ramp v2 (the game screen's own closed palette, one place):
   L0 floor · L1/L2 decoration · L3/L4 INFORMATION · ACC lime · VIO rare */
const GAME_PAL = ['#020a04', '#07240d', '#0f7a2a', '#2cff4a', '#d6ffd9'];
const ACC = '#9df133';
const VIO = '#905cff';
const PAL = [0, 1, 2, 3, 4]; /* level indices into GAME_PAL */
const BG = 0;
/* RGB tuples precomputed once — the blit must not parse hex per pixel */
const PAL_RGB: number[][] = [...GAME_PAL, ACC, VIO].map((hx) => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)]);

const W = LOGICAL.w, H = LOGICAL.h;
const FT = BANDS.field.y0, FB = BANDS.field.y1;         /* field in cells */
const SHIP_SY_MIN = FT + 150, SHIP_SY_MAX = FB - 10;    /* ship band (cells) */
const FIELD_UNITS = (FB - FT) / 2;                      /* 155 world rows visible */

type GState = 'attract' | 'menu' | 'play' | 'pause' | 'gameover' | 'hiscores';

interface Ent {
  type: 'drone' | 'tower' | 'mine' | 'tank';
  x: number; y: number;       /* world coords */
  hp: number;
  phase?: number; amp?: number; per?: number; baseX?: number;
  cool?: number;
  warp?: number; flash?: number;
}
interface Bullet { x: number; sy: number; vx: number; vy: number; foe: boolean; trail: number[] }
interface Boom { x: number; sy: number; t: number; big: boolean }

export function createShaftRunner(): GameModule {
  let ctx: HostContext | null = null;
  let state: GState = 'attract';
  let tick = 0;
  let seed = 0;
  let rnd = mulberry32(0);
  let shaft = new Shaft(0);
  let scroll = 0;                    /* world rows */
  let ship = { x: 54, sy: 300 };     /* x in world units, sy in cells */
  let lives = 3, fuel = 100, bombs = 3, score = 0, dispScore = 0, stage = 1;
  let invuln = 0;
  let nextExtra = 10000, extraStep = 20000, nextBombScore = 5000;
  let ents: Ent[] = [];
  let bullets: Bullet[] = [];
  let booms: Boom[] = [];
  let bombWave = -1, bombX = 0, bombSY = 0;
  let fireCool = 0;
  let menuIdx = 0;
  let banner = 0;
  let autopilot = true;
  let hiscores: number[] = [];
  let runs = 0;
  let savedOk = true;
  let lowFuelBeeped = false;
  let deathCauses: string[] = [];
  let tanksSpawned = 0, tanksGot = 0;
  let script: Array<Partial<InputState>> | null = null;
  let seedBase = 0x5157;
  let nextDroneRow = 40, nextTowerRow = 200, nextTankRow = 90, chamberArmed = -1;

  const buf = new Uint8Array(W * H);
  const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const offCtx = (off as HTMLCanvasElement).getContext('2d')!;
  let img = offCtx.createImageData(W, H);
  /* measured boxes of everything drawn this frame (layout lint) */
  let meas: Array<{ n: string; x: number; y: number; w: number; h: number; band: string }> = [];

  let ac: AudioContext | null = null;
  let voices = 0;
  const SFX: Record<string, [number, number, string]> = {
    shoot: [880, 0.05, 'sq'], boomS: [900, 0.15, 'no'], boomB: [300, 0.3, 'no'],
    pick: [660, 0.09, 'sq'], bomb: [200, 0.35, 'no'], hurt: [110, 0.22, 'sq'],
    stage: [523, 0.16, 'sq'], low: [1046, 0.05, 'sq'], tick: [1320, 0.03, 'sq'],
  };

  /* ---------- coordinate helpers (world units ↔ cells) ---------- */
  const cfg = () => stageCfg(stage);
  const wallAt = (row: number) => shaft.at(Math.max(0, Math.round(row)));
  const syOf = (wy: number) => FB - (wy - scroll) * 2;
  const rowAt = (sy: number) => scroll + (FB - sy) / 2;
  const bandOf = (y: number) => (y < BANDS.top.y1 ? 'top' : y >= BANDS.bottom.y0 ? 'bot' : state === 'play' ? 'field' : 'screen');

  function rec(n: string, x: number, y: number, w: number, h: number) {
    meas.push({ n, x, y, w, h, band: bandOf(y) });
  }

  function playSfx(name: string) {
    if (!ctx?.audio.enabled) return;
    try {
      if (!ac) ac = new AudioContext();
      if (ac.state === 'suspended') void ac.resume();
      if (voices >= 8) return;
      const [f, dur, kind] = SFX[name];
      voices++;
      const t = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      g.connect(ac.destination);
      if (kind === 'sq') {
        const o = ac.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(30, f * 0.5), t + dur);
        o.connect(g);
        o.start(t); o.stop(t + dur);
      } else {
        const len = Math.floor(ac.sampleRate * dur);
        const b2 = ac.createBuffer(1, len, ac.sampleRate);
        const d = b2.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ac.createBufferSource();
        src.buffer = b2;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = f * 6;
        src.connect(lp); lp.connect(g);
        src.start(t);
      }
      setTimeout(() => voices--, dur * 1000 + 30);
    } catch { /* audio unavailable */ }
  }

  function resetRun(s: number) {
    seed = s;
    rnd = mulberry32(s);
    shaft = new Shaft(s);
    scroll = 0;
    ship = { x: 54, sy: 300 };
    lives = 3; fuel = 100; bombs = 3; score = 0; dispScore = 0; stage = 1;
    invuln = 0; nextExtra = 10000; nextBombScore = 5000;
    ents = []; bullets = []; booms = []; bombWave = -1;
    banner = 90; lowFuelBeeped = false;
    deathCauses = []; tanksSpawned = 0; tanksGot = 0;
    nextDroneRow = 40; nextTowerRow = 200; nextTankRow = 90; chamberArmed = -1;
    tick = 0;
  }

  function loadScores() {
    const raw = ctx!.storage.get('sr.hiscores');
    try { hiscores = JSON.parse(raw || '[]'); if (!Array.isArray(hiscores)) hiscores = []; } catch { hiscores = []; }
    savedOk = raw !== null || ctx!.storage.get('sr.runs') !== null;
    const r = ctx!.storage.get('sr.runs');
    runs = r ? parseInt(r, 10) || 0 : 0;
  }
  function saveScore(v: number) {
    hiscores.push(v);
    hiscores.sort((a, b) => b - a);
    hiscores = hiscores.slice(0, 5);
    ctx!.storage.set('sr.hiscores', JSON.stringify(hiscores));
  }

  /* ---------- spawning (world units; horizon just above the field) ---------- */
  function spawnSchedule() {
    const c = cfg();
    const v = c.v;
    const horizon = scroll + FIELD_UNITS + 6;
    while (nextDroneRow <= horizon) {
      if (rnd() < 0.9 && ents.length < 64) {
        const n = 3 + Math.floor(rnd() * 3);
        const w = wallAt(nextDroneRow);
        const cx = (w.l + w.r) / 2 + (rnd() - 0.5) * Math.max(0, w.r - w.l - 30);
        const amp = Math.min(10 + rnd() * 10, Math.max(2, (w.r - w.l) / 2 - 8)), per = 1.2 + rnd() * 0.8;
        for (let k = 0; k < n && ents.length < 64; k++) {
          ents.push({ type: 'drone', x: cx, y: nextDroneRow + k * 20, hp: 1, phase: rnd() * 6.28, amp, per, baseX: cx, warp: 12 });
        }
      }
      nextDroneRow += (v * 60) / c.dronesMin * (0.7 + rnd() * 0.6);
    }
    while (nextTowerRow <= horizon) {
      const w = wallAt(nextTowerRow);
      const side: -1 | 1 = rnd() < 0.5 ? -1 : 1;
      if (ents.length < 64) ents.push({ type: 'tower', x: side < 0 ? w.l + 4 : w.r - 4, y: nextTowerRow, hp: 3, side, cool: 0.5, warp: 12 });
      nextTowerRow += c.towerIv * v * (0.75 + rnd() * 0.5);
    }
    while (nextTankRow <= horizon) {
      const w = wallAt(nextTankRow);
      const onWall = rnd() < 0.55;
      let x = onWall ? (rnd() < 0.5 ? w.l + 4 : w.r - 4) : w.l + 6 + rnd() * Math.max(1, w.r - w.l - 12);
      if (Math.abs(x - ship.x) < 24) {
        const cand = x <= ship.x ? ship.x - 24 : ship.x + 24;
        x = cand >= w.l + 3 && cand <= w.r - 3 ? cand : (x <= ship.x ? w.l + 3 : w.r - 3);
      }
      if (ents.length < 64) { ents.push({ type: 'tank', x, y: nextTankRow, hp: 1, warp: 12 }); tanksSpawned++; }
      nextTankRow += 0.9 * 25 * v / c.drain * (0.75 + rnd() * 0.5);
    }
    const aheadW = wallAt(Math.round(scroll + FIELD_UNITS));
    if (aheadW.chamber > 0 && chamberArmed < 0) {
      chamberArmed = Math.round(scroll) + FIELD_UNITS;
      for (let k = 0; k < cfg().minesChamber && ents.length < 64; k++) {
        const row = chamberArmed + 10 + rnd() * 40;
        const wr = wallAt(Math.round(row));
        const x = wr.l + 5 + rnd() * Math.max(1, wr.r - wr.l - 10);
        ents.push({ type: 'mine', x, y: row, hp: 2, warp: 12 });
      }
    } else if (aheadW.chamber <= 0) chamberArmed = -1;
  }

  /* ---------- bot (world units; survival-first) ---------- */
  function autopilotInputs(): Partial<InputState> {
    const inp: Partial<InputState> = {};
    const shipRow = rowAt(ship.sy);
    const ahead = wallAt(Math.round(shipRow + 28));
    let target = (ahead.l + ahead.r) / 2;
    /* fuel lean: nearest REACHABLE tank (min intercept time) */
    if (fuel < 82) {
      let best: Ent | null = null, bestT = 1e9;
      for (const e of ents) {
        if (e.type !== 'tank' || e.hp <= 0) continue;
        const dsy = ship.sy - syOf(e.y);
        if (dsy <= 0 || dsy > 140) continue;
        const t = dsy / (cfg().v * 2) + Math.abs(e.x - ship.x) / 70;
        if (t < bestT) { bestT = t; best = e; }
      }
      if (best && Math.abs(best.x - ship.x) / 70 < (ship.sy - syOf(best.y)) / (cfg().v * 2) + 0.4) target = best.x;
    }
    target = Math.max(ahead.l + 8, Math.min(ahead.r - 8, target));
    /* bullet dodge: predict each bullet's crossing of the ship line,
       aggregate pushes, steer to the side with room */
    let push = 0, threats = 0;
    for (const b of bullets) {
      if (!b.foe) continue;
      if (Math.abs(b.vy) < 0.06) {
        if (Math.abs(b.sy - ship.sy) < 32 && Math.abs(b.x - ship.x * 2) < 60) { push += ship.x * 2 >= b.x ? 1 : -1; threats++; }
        continue;
      }
      const tCross = (ship.sy - b.sy) / b.vy;
      if (tCross < 0 || tCross > 100) continue;
      const xAt = b.x + b.vx * tCross;
      if (Math.abs(xAt - ship.x * 2) < 26) { push += ship.x * 2 >= xAt ? 1 : -1; threats++; }
    }
    if (threats > 0) {
      const now = wallAt(Math.round(shipRow));
      const dir = push >= 0 ? 1 : -1;
      const room = dir > 0 ? (now.r - 6) - ship.x : ship.x - (now.l + 6);
      const step = Math.min(Math.max(12, threats * 8), Math.max(4, room));
      target = Math.max(now.l + 6, Math.min(now.r - 6, ship.x + dir * step));
    } else if (fuel >= 55) {
      for (const e of ents) {
        if (e.hp <= 0 || e.type === 'tank') continue;
        const dsy = ship.sy - syOf(e.y);
        if (dsy > 0 && dsy < 88 && Math.abs(e.x - ship.x) < 14) {
          const now = wallAt(Math.round(shipRow));
          target = Math.max(now.l + 6, Math.min(now.r - 6, ship.x + (ship.x >= e.x ? 19 : -19)));
          break;
        }
      }
    }
    const nowW = wallAt(Math.round(shipRow));
    const lo = Math.max(nowW.l, ahead.l) + 7, hi = Math.min(nowW.r, ahead.r) - 7;
    if (hi > lo) target = Math.max(lo, Math.min(hi, target));
    if (Math.abs(target - ship.x) > 2) { inp.right = target > ship.x; inp.left = target < ship.x; }
    inp.up = ship.sy < 288;
    inp.down = ship.sy > 296;
    const inCol = (e: Ent) => e.hp > 0 && (e.warp || 0) <= 0 && Math.abs(e.x - ship.x) <= 12 && ship.sy - syOf(e.y) > 0 && ship.sy - syOf(e.y) < 260;
    if (ents.some((e) => e.type === 'tank' && inCol(e))) inp.fire = true;
    else if (ents.some(inCol)) inp.fire = true;
    const closeB = bullets.filter((b) => b.foe && Math.hypot(b.x - ship.x * 2, b.sy - ship.sy) < 72).length;
    const closeE = ents.some((e) => e.hp > 0 && e.type !== 'tank' && (e.warp || 0) <= 0 && Math.hypot(e.x * 2 - ship.x * 2, syOf(e.y) - ship.sy) < 48);
    inp.bomb = (closeB >= 3 || closeE) && bombs > 0;
    return inp;
  }

  /* ---------- core ---------- */
  function die(cause: string) {
    if (invuln > 0) return;
    lives--;
    deathCauses.push(cause);
    booms.push({ x: ship.x * 2, sy: ship.sy, t: 0, big: true });
    playSfx('hurt');
    ctx?.emit('death', { cause, lives });
    ctx?.setActivity?.(1);
    if (lives <= 0) {
      state = 'gameover';
      const isHi = score > 0 && (hiscores.length < 5 || score > hiscores[hiscores.length - 1]);
      if (isHi && !autopilot) { saveScore(score); ctx?.emit('hiscore', { score }); }
      ctx?.emit('game-over', { score });
      return;
    }
    invuln = 90;
    const w = wallAt(Math.round(rowAt(SHIP_SY_MAX)));
    ship = { x: (w.l + w.r) / 2, sy: SHIP_SY_MAX - 4 };
  }

  function hitEnt(e: Ent, dmg: number) {
    e.hp -= dmg;
    if (e.hp > 0) { e.flash = 4; return; }
    const pts = e.type === 'drone' ? 100 : e.type === 'tower' ? 250 : e.type === 'mine' ? 150 : 50;
    if (!autopilot) score += pts;
    booms.push({ x: e.x * 2, sy: syOf(e.y), t: 0, big: false });
    playSfx(e.type === 'tank' ? 'pick' : 'boomS');
    ctx?.setActivity?.(0.8);
    if (e.type === 'tank') { fuel = Math.min(100, fuel + 25); tanksGot++; }
    if (e.type === 'mine') {
      for (const [dx, dy] of [[1.8, 1.8], [1.8, -1.8], [-1.8, 1.8], [-1.8, -1.8]]) {
        bullets.push({ x: e.x * 2, sy: syOf(e.y), vx: dx, vy: dy, foe: true, trail: [] });
      }
    }
  }

  function startRun() {
    runs++;
    ctx!.storage.set('sr.runs', String(runs));
    resetRun((seedBase + runs * 7919) & 0xffff);
    autopilot = false;
    state = 'play';
    ctx?.setLabel?.('PLAYING');
    ctx?.emit('start', { run: runs, seed });
  }

  function onEsc() {
    if (state === 'play') { state = 'pause'; ctx?.setLabel?.('PAUSED'); }
    else if (state === 'pause') { state = 'attract'; ctx?.setLabel?.('DEMO'); ctx!.release(); }
    else if (state === 'gameover' || state === 'hiscores') { state = 'menu'; ctx?.setLabel?.('MENU'); }
  }

  function update() {
    const live = ctx!.input;
    const inp: InputState & { px?: number } = { ...live };
    if (script && script[tick]) Object.assign(inp, script[tick]);
    if (inp.esc) { live.esc = false; onEsc(); }
    if (inp.quit) { live.quit = false; if (state === 'menu') ctx!.release(); }

    if (state === 'menu' || state === 'hiscores' || state === 'gameover') {
      if (inp.up || inp.down) { menuIdx ^= 1; playSfx('tick'); live.up = false; live.down = false; }
      if (inp.ok || inp.fire) {
        live.ok = false; live.fire = false;
        playSfx('tick');
        if (state === 'menu') { if (menuIdx === 0) startRun(); else state = 'hiscores'; }
        else if (state === 'hiscores') state = 'menu';
        else startRun();
      }
      return;
    }
    if (state === 'pause') {
      if (inp.ok || inp.fire) { live.ok = false; live.fire = false; state = 'play'; ctx?.setLabel?.('PLAYING'); }
      return;
    }

    /* play / attract */
    const dt = 1 / 60;
    if (inp.autopilot) {
      live.autopilot = false;
      inp.autopilot = false;
      autopilot = !autopilot;
      ctx?.setLabel?.(autopilot ? 'AUTOPILOT' : 'PLAYING');
    }
    const eff: typeof inp = state === 'attract' || autopilot ? { ...inp, ...autopilotInputs() } : inp;

    const newStage = stageOf(Math.round(scroll));
    if (newStage !== stage) { stage = newStage; banner = 90; playSfx('stage'); ctx?.emit('stage', { stage }); }
    const prevRows = Math.floor(scroll);
    scroll += cfg().v * dt;
    score += Math.floor((Math.floor(scroll) - prevRows) / 4);

    fuel -= cfg().drain * dt;
    if (fuel < 20 && !lowFuelBeeped) { lowFuelBeeped = true; playSfx('low'); ctx?.emit('low-fuel', { pct: Math.round(fuel) }); }
    if (fuel > 20) lowFuelBeeped = false;
    if (fuel <= 0) { fuel = 60; die('fuel'); if (state === 'gameover') return; }

    /* ship (speeds in world units → ×2 cells) */
    const sx = 70 * dt, sy = 48 * dt;
    if (eff.left) ship.x -= sx;
    if (eff.right) ship.x += sx;
    if (eff.up) ship.sy -= sy * 2;
    if (eff.down) ship.sy += sy * 2;
    if (typeof eff.px === 'number') ship.x = eff.px / 2;
    ship.x = Math.max(2, Math.min(105, ship.x));
    ship.sy = Math.max(SHIP_SY_MIN, Math.min(SHIP_SY_MAX, ship.sy));

    /* fire */
    fireCool--;
    if (eff.fire && fireCool <= 0 && bullets.filter((b) => !b.foe).length < 6) {
      bullets.push({ x: ship.x * 2, sy: ship.sy - 10, vx: 0, vy: -170 / 60 * 2, foe: false, trail: [] });
      fireCool = 60 / 8;
      playSfx('shoot');
      ctx?.setActivity?.(0.5);
    }
    /* bomb */
    if (eff.bomb && bombs > 0 && bombWave < 0) {
      bombs--;
      bombWave = tick; bombX = ship.x * 2; bombSY = ship.sy;
      playSfx('bomb');
    }
    if (bombWave >= 0) {
      const half = ((tick - bombWave) / 30) * 108;
      bullets = bullets.filter((b) => !b.foe || Math.abs(b.x - bombX) > half || Math.abs(b.sy - bombSY) > half);
      for (const e of ents) {
        if (e.hp > 0 && Math.abs(e.x * 2 - bombX) <= half && Math.abs(syOf(e.y) - bombSY) <= half) hitEnt(e, 5);
      }
      if (tick - bombWave >= 30) bombWave = -1;
    }

    /* wall collision (3×3 world-unit hitbox = 6×6 cells) */
    if (invuln > 0) invuln--;
    else {
      const w = wallAt(Math.round(rowAt(ship.sy)));
      if (ship.x - 1.5 <= w.l || ship.x + 1.5 >= w.r) die('wall');
      if (state === 'gameover') return;
    }

    spawnSchedule();

    /* entities */
    for (const e of ents) {
      if (e.hp <= 0) continue;
      if (e.warp! > 0) { e.warp!--; continue; }
      if (e.flash! > 0) e.flash!--;
      if (e.type === 'drone') {
        e.y -= 22 * dt;
        const ph = (e.phase || 0) + dt * 6.283 / (e.per || 1.5);
        e.phase = ph;
        e.x = (e.baseX || e.x) + Math.sin(ph) * (e.amp || 12);
        const dw = wallAt(Math.round(e.y));
        e.x = Math.max(dw.l + 2, Math.min(dw.r - 2, e.x));
      } else if (e.type === 'tower') {
        const tsy = syOf(e.y);
        if (tsy >= FT + 2 && tsy <= FT + 200) {
          e.cool = (e.cool || 0) - dt;
          if (e.cool <= 0 && bullets.filter((b) => b.foe).length < 24) {
            e.cool = cfg().towerIv;
            const dx = ship.x * 2 - e.x * 2, dy = ship.sy - tsy;
            const d = Math.hypot(dx, dy) || 1;
            const sp = 52 / 60 * 2;
            bullets.push({ x: e.x * 2, sy: tsy, vx: (dx / d) * sp, vy: (dy / d) * sp, foe: true, trail: [] });
          }
        }
      } else if (e.type === 'mine') {
        if (Math.hypot(e.x * 2 - ship.x * 2, syOf(e.y) - ship.sy) < 28) hitEnt(e, 99);
      }
    }

    /* bullets (screen space, cells) */
    for (const b of bullets) {
      b.trail.push(b.x, b.sy);
      if (b.trail.length > 6) b.trail.splice(0, b.trail.length - 6);
      b.x += b.vx; b.sy += b.vy;
    }
    /* player bullets × entities */
    for (const b of bullets) {
      if (b.foe) continue;
      for (const e of ents) {
        if (e.hp <= 0 || e.warp! > 0) continue;
        const sprW = (e.type === 'tower' || e.type === 'tank' ? 9 : 7) * 2;
        const sprH = e.type === 'tower' ? 12 : 16;
        if (Math.abs(b.x - e.x * 2) <= sprW / 2 && Math.abs(b.sy - syOf(e.y)) <= sprH / 2) {
          hitEnt(e, 1);
          b.sy = -9999;
          break;
        }
      }
    }
    /* foe bullets × ship */
    if (invuln <= 0) {
      for (const b of bullets) {
        if (b.foe && Math.abs(b.x - ship.x * 2) <= 6 && Math.abs(b.sy - ship.sy) <= 6) { die('bullet'); break; }
      }
      if (state === 'gameover') return;
    }
    /* entities × ship: tanks PICK UP, others kill */
    for (const e of ents) {
      if (e.hp <= 0 || e.warp! > 0) continue;
      if (e.type === 'tank') {
        if (Math.abs(e.x - ship.x) <= 5 && Math.abs(syOf(e.y) - ship.sy) <= 10) hitEnt(e, 99);
      } else if (invuln <= 0 && Math.abs(e.x - ship.x) <= 4 && Math.abs(syOf(e.y) - ship.sy) <= 8) { die('enemy'); break; }
    }
    if (state === 'gameover') return;

    bullets = bullets.filter((b) => b.x > -8 && b.x < W + 8 && b.sy > -12 && b.sy < H + 12 && b.sy > -9000);
    ents = ents.filter((e) => e.hp > 0 && syOf(e.y) > FT - 24 && syOf(e.y) < FB + 24);
    for (const bm of booms) bm.t++;
    booms = booms.filter((bm) => bm.t < 22);

    if (score >= nextExtra) { lives++; nextExtra += extraStep; ctx?.emit('extra-life', { lives }); }
    if (score >= nextBombScore) { bombs = Math.min(5, bombs + 1); nextBombScore += 5000; }
    if (dispScore < score) dispScore = Math.min(score, dispScore + Math.max(1, Math.ceil((score - dispScore) / 10)));
    else dispScore = score;
  }

  /* ---------- render primitives ---------- */
  function text3(s: string, x: number, y: number, lv: number, k = 1) {
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
  }
  function text5(s: string, x: number, y: number, lv: number, k = 1) {
    s = s.toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = F57[s[i]] || F57[' '];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (g[r][c] !== '1') continue;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
          const px = x + (i * 6 + c) * k + dx, py = y + r * k + dy;
          if (py >= 0 && py < H && px >= 0 && px < W) buf[py * W + px] = lv;
        }
      }
    }
  }
  function num(s: string, x: number, y: number, lvSig: number, lvZero = 2) {
    for (let i = 0; i < s.length; i++) {
      const g = F79[s[i]] || F79[' '];
      const lv = i < s.length - String(parseInt(s, 10) || 0).length ? lvZero : lvSig;
      for (let r = 0; r < 9; r++) for (let c = 0; c < 7; c++) {
        const px = x + i * 8 + c, py = y + r;
        if (g[r][c] === '1' && py >= 0 && py < H && px >= 0 && px < W) buf[py * W + px] = lv;
      }
    }
  }
  function spr(map: string[], cx: number, cy: number) {
    /* draws a sprite centered at cell (cx, cy); each bit = 2×2 cells */
    const w2 = map[0].length, h2 = map.length;
    const x0 = Math.round(cx - w2), y0 = Math.round(cy - h2);
    for (let r = 0; r < h2; r++) for (let c = 0; c < w2; c++) {
      const ch = map[r][c];
      if (ch === '0') continue;
      const lv = ch === '4' ? 9 : PAL[Math.min(4, parseInt(ch, 10))];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const px = x0 + c * 2 + dx, py = y0 + r * 2 + dy;
        if (px >= 0 && px < W && py >= 0 && py < H) buf[py * W + px] = lv;
      }
    }
  }
  function plate(x0: number, y0: number, x1: number, y1: number) {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      buf[y * W + x] = y === y0 || y === y1 || x === x0 || x === x1 ? PAL[2] : BG;
    }
  }
  function box(x0: number, y0: number, x1: number, y1: number, lv: number) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) { if (y0 >= 0 && y0 < H) buf[y0 * W + x] = lv; if (y1 >= 0 && y1 < H) buf[y1 * W + x] = lv; }
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) { if (x0 >= 0 && x0 < W) buf[y * W + x0] = lv; if (x1 >= 0 && x1 < W) buf[y * W + x1] = lv; }
  }
  function square(cx: number, cy: number, half: number, lv: number) {
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      if (x < 0 || x >= W) continue;
      const yt = Math.round(cy - half), yb = Math.round(cy + half);
      if (yt >= 0 && yt < H) buf[yt * W + x] = lv;
      if (yb >= 0 && yb < H) buf[yb * W + x] = lv;
    }
    for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++) {
      if (y < 0 || y >= H) continue;
      const xl = Math.round(cx - half), xr = Math.round(cx + half);
      if (xl >= 0) buf[y * W + xl] = lv;
      if (xr < W) buf[y * W + xr] = lv;
    }
  }
  function textW(t: string, k = 1) { return Math.max(0, t.length * 6 * k - k); }
  function fitText(t: string, maxW: number, k: number): number {
    while (k > 1 && textW(t, k) > maxW) k--;
    return k;
  }

  /* ---------- HUD (bands own their pixels; field stays clean) ---------- */
  function renderHUD() {
    meas.length = 0;
    /* ===== TOP band (0..30) ===== */
    plate(0, 0, W - 1, BANDS.top.y1);
    text3('SCORE', HUD.top.scoreLabel.x, HUD.top.scoreLabel.y, 3);
    rec('score.label', HUD.top.scoreLabel.x, HUD.top.scoreLabel.y, HUD.top.scoreLabel.w, HUD.top.scoreLabel.h);
    const sstr = String(dispScore).padStart(6, '0');
    num(sstr, HUD.top.scoreValue.x, HUD.top.scoreValue.y, 4, 2);
    rec('score.value', HUD.top.scoreValue.x, HUD.top.scoreValue.y, HUD.top.scoreValue.w, HUD.top.scoreValue.h);
    const stStr = 'ST ' + String(stage).padStart(2, '0');
    text3(stStr, HUD.top.stageLabel.x, HUD.top.stageLabel.y, 3);
    rec('stage', HUD.top.stageLabel.x, HUD.top.stageLabel.y, HUD.top.stageLabel.w, HUD.top.stageLabel.h);
    /* combo slot (reserved: multiplier mechanic not in the engine yet) */
    num('X1', HUD.top.comboValue.x, HUD.top.comboValue.y, 2, 2);
    box(HUD.top.comboBar.x, HUD.top.comboBar.y, HUD.top.comboBar.x + HUD.top.comboBar.w - 1, HUD.top.comboBar.y, PAL[1]);
    rec('combo.reserved', HUD.top.comboValue.x, HUD.top.comboValue.y, 15, 13);
    const hiVal = Math.max(score, hiscores[0] || 0);
    const beaten = score > (hiscores[0] || 0) && hiscores.length > 0 && score > 0;
    text3('HI', 196, HUD.top.hiLabel.y, 3);
    rec('hi.label', 196, HUD.top.hiLabel.y, 11, 7);
    const hstr = String(hiVal).padStart(6, '0');
    num(hstr, HUD.top.hiValue.x, HUD.top.hiValue.y, beaten && (tick >> 3) % 2 === 0 ? 9 : 4, 2);
    rec('hi.value', HUD.top.hiValue.x, HUD.top.hiValue.y, HUD.top.hiValue.w, HUD.top.hiValue.h);
    box(0, BANDS.top.y1, W - 1, BANDS.top.y1, PAL[2]);

    /* ===== BOTTOM band (340..384) ===== */
    box(0, BANDS.bottom.y0, W - 1, BANDS.bottom.y0, PAL[2]);
    plate(0, BANDS.bottom.y0 + 1, W - 1, H - 1);
    text3('FUEL', HUD.bottom.fuelLabel.x, HUD.bottom.fuelLabel.y, 3);
    rec('fuel.label', HUD.bottom.fuelLabel.x, HUD.bottom.fuelLabel.y, HUD.bottom.fuelLabel.w, HUD.bottom.fuelLabel.h);
    const low = fuel < 25;
    const blink = !low || (tick >> 3) % 2 === 0;
    const segW = 6, segs = 20;
    for (let i = 0; i < segs; i++) {
      const x0 = HUD.bottom.fuelBar.x + i * segW;
      const fill = fuel / 100 * segs > i + 0.5;
      const lv = fill ? (i < segs / 2 ? PAL[2] : PAL[3]) : PAL[1];
      box(x0, HUD.bottom.fuelBar.y, x0 + segW - 2, HUD.bottom.fuelBar.y + HUD.bottom.fuelBar.h - 1, low && blink ? 9 : lv);
    }
    rec('fuel.bar', HUD.bottom.fuelBar.x, HUD.bottom.fuelBar.y, HUD.bottom.fuelBar.w, HUD.bottom.fuelBar.h);
    const pct = String(Math.max(0, Math.round(fuel)));
    num(pct, HUD.bottom.fuelPct.x + (24 - numW(pct)), HUD.bottom.fuelPct.y, low && blink ? 9 : 4);
    rec('fuel.pct', HUD.bottom.fuelPct.x, HUD.bottom.fuelPct.y, HUD.bottom.fuelPct.w, HUD.bottom.fuelPct.h);
    text3('BOMB', HUD.bottom.bombLabel.x, HUD.bottom.bombLabel.y, 3);
    rec('bomb.label', HUD.bottom.bombLabel.x, HUD.bottom.bombLabel.y, HUD.bottom.bombLabel.w, HUD.bottom.bombLabel.h);
    for (let i = 0; i < 5; i++) {
      const x0 = HUD.bottom.bombIcons.x + i * 8;
      if (i < bombs) { box(x0 + 1, HUD.bottom.bombIcons.y + 3, x0 + 5, HUD.bottom.bombIcons.y + 8, PAL[3]); buf[(HUD.bottom.bombIcons.y + 1) * W + x0 + 3] = 4; }
      else box(x0 + 1, HUD.bottom.bombIcons.y + 3, x0 + 5, HUD.bottom.bombIcons.y + 8, PAL[1]);
    }
    rec('bomb.icons', HUD.bottom.bombIcons.x, HUD.bottom.bombIcons.y, HUD.bottom.bombIcons.w, HUD.bottom.bombIcons.h);
    text3('LIFE', HUD.bottom.lifeLabel.x, HUD.bottom.lifeLabel.y, 3);
    rec('life.label', HUD.bottom.lifeLabel.x, HUD.bottom.lifeLabel.y, HUD.bottom.lifeLabel.w, HUD.bottom.lifeLabel.h);
    for (let i = 0; i < Math.min(lives, 4); i++) {
      spr(SPR_SHIP, HUD.bottom.lifeIcons.x + 4 + i * 16, HUD.bottom.lifeIcons.y + 4);
    }
    rec('life.icons', HUD.bottom.lifeIcons.x, HUD.bottom.lifeIcons.y, HUD.bottom.lifeIcons.w, HUD.bottom.lifeIcons.h);
    const res: Array<[string, { x: number; y: number; w: number; h: number }]> = [
      ['DSH', HUD.bottom.resDash], ['GRZ', HUD.bottom.resGraze], ['WPN', HUD.bottom.resWpn],
    ];
    for (const [nm, r] of res) {
      box(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, PAL[1]);
      text3(nm, r.x + Math.floor((r.w - textW(nm, 1)) / 2), r.y + Math.floor((r.h - 5) / 2), PAL[1]);
    }
  }

  /* ---------- screens (plates over the darkened demo) ---------- */
  function dimField() {
    for (let y = FT; y < FB; y++) for (let x = 0; x < W; x++) {
      if ((x + y) % 2 === 0) buf[y * W + x] = BG;
    }
  }
  function centerText5(t: string, y: number, lv: number, k = 1) {
    const w = textW(t, k);
    const x = Math.round((W - w) / 2);
    text5(t, x, y, lv, k);
    rec('text:' + t, x, y, w, 7 * k);
  }
  function centerNum(t: string, y: number, lv: number) {
    const w = numW(t);
    const x = Math.round((W - w) / 2);
    num(t, x, y, lv);
    rec('num:' + t, x, y, w, 9);
  }
  function numW(t: string) { return Math.max(0, t.length * 8 - 1); }

  function render() {
    meas.length = 0;
    buf.fill(BG);
    /* ===== FIELD (30..340) ===== */
    for (let sy = FT; sy < FB; sy++) {
      const row = Math.round(rowAt(sy));
      const w = wallAt(row);
      const stripe = (row % 2 === 0) ? PAL[1] : PAL[2];
      for (let x = 0; x < W; x++) buf[sy * W + x] = (x <= w.l * 2 || x >= w.r * 2) ? stripe : BG;
      buf[sy * W + w.l * 2] = PAL[3];
      buf[sy * W + w.l * 2 + 1] = PAL[3];
      buf[sy * W + w.r * 2 - 1] = PAL[3];
      buf[sy * W + w.r * 2] = PAL[3];
    }
    /* dust: 2 parallax layers (0.3×, 0.6×) */
    for (let i = 0; i < 40; i++) {
      const h1 = (i * 71 + 11) % W, h2 = (i * 97 + 29) % W;
      const y1 = FT + ((i * 47 + Math.round(scroll * 0.6)) % (FB - FT) + (FB - FT)) % (FB - FT);
      const y2 = FT + ((i * 83 + Math.round(scroll * 1.2)) % (FB - FT) + (FB - FT)) % (FB - FT);
      const w1 = wallAt(Math.round(rowAt(y1))), w2 = wallAt(Math.round(rowAt(y2)));
      if (h1 > w1.l * 2 + 4 && h1 < w1.r * 2 - 4) buf[y1 * W + h1] = PAL[1];
      if (h2 > w2.l * 2 + 4 && h2 < w2.r * 2 - 4) buf[y2 * W + h2] = PAL[2];
    }

    if (state === 'play' || state === 'pause' || state === 'attract') {
      for (const e of ents) {
        const sy = Math.round(syOf(e.y));
        const sx = Math.round(e.x * 2);
        const hw = e.type === 'tower' || e.type === 'tank' ? 9 : 7;
        if (sy < FT - 16 || sy > FB + 16) continue;
        if (e.warp! > 0) { square(sx, sy, hw * 2 * (1 - e.warp! / 12) + 2, PAL[3]); continue; }
        if (e.type === 'drone') spr(SPR_DRONE, sx, sy);
        else if (e.type === 'tower') spr(SPR_TOWER, sx, sy);
        else if (e.type === 'mine') spr(SPR_MINE, sx, sy);
        else if (e.type === 'tank') spr(SPR_TANK, sx, sy);
        box(sx - hw, sy - hw + (e.type === 'tower' ? -2 : 0), sx + hw, sy + hw + (e.type === 'tower' ? -2 : 0), 4);
        const core = (tick >> 3) % 2 === 0 ? 4 : 3;
        buf[sy * W + sx] = e.flash! > 0 ? 4 : core;
        if (e.flash! > 0) square(sx, sy, hw - 1, 4);
        rec('ent:' + e.type, sx - hw, sy - hw, hw * 2, hw * 2);
        if (e.type === 'tower' && (e.cool || 0) < 0.3) buf[sy * W + sx] = (tick >> 2) % 2 === 0 ? 9 : 3;
        if (e.type === 'mine' && Math.hypot(e.x * 2 - ship.x * 2, sy - ship.sy) < 60) buf[sy * W + sx] = (tick >> 2) % 2 === 0 ? 9 : 3;
      }
      for (const b of bullets) {
        const sy = Math.round(b.sy), bx = Math.round(b.x);
        if (b.foe) {
          const hot = (tick >> 2) % 2 === 0;
          if (sy >= FT && sy < FB && bx >= 0 && bx < W) buf[sy * W + bx] = 4;
          for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
            const px = bx + dx, py = sy + dy;
            if (px >= 0 && px < W && py >= FT && py < FB) buf[py * W + px] = hot ? 4 : 3;
          }
          rec('shot.foe', bx - 2, sy - 2, 5, 5);
        } else {
          for (let k = 0; k < 6; k++) {
            const yy = sy + k;
            if (yy >= FT && yy < FB && bx >= 0 && bx < W) buf[yy * W + bx] = k === 0 ? 4 : k < 3 ? 3 : 2;
          }
          rec('shot.ship', bx, sy, 1, 6);
        }
      }
      for (const bm of booms) square(bm.x, bm.sy, (bm.t / 22) * (bm.big ? 28 : 16), 4);
      if (bombWave >= 0) square(bombX, bombSY, ((tick - bombWave) / 30) * 108, 4);
      if (invuln <= 0 || (tick >> 2) % 2 === 0) {
        spr(SPR_SHIP, Math.round(ship.x * 2), Math.round(ship.sy));
        rec('ship', Math.round(ship.x * 2) - 7, Math.round(ship.sy) - 8, 14, 16);
        const tr = (tick >> 1) % 2 === 0 ? PAL[2] : PAL[1];
        if (Math.round(ship.sy) + 9 < FB) { buf[(Math.round(ship.sy) + 9) * W + Math.round(ship.x * 2)] = tr; buf[(Math.round(ship.sy) + 10) * W + Math.round(ship.x * 2)] = PAL[1]; }
      }
      if (banner > 0) {
        banner--;
        plate(48, 150, 167, 190);
        centerText5('STAGE ' + String(stage).padStart(2, '0'), 162, 4);
      }
    }
    /* ===== screens (plates over the darkened demo) ===== */
    if (state === 'attract') {
      dimField();
      plate(56, 60, 159, 138);
      centerText5('SHAFT', 72, 4, 2);
      centerText5('RUNNER', 88, 3, 2);
      if ((tick >> 4) % 2 === 0) centerText5('PRESS ANY KEY', 118, 9);
    } else if (state === 'menu') {
      dimField();
      plate(38, 44, 177, 250);
      centerText5('SHAFT', 56, 4, 2);
      centerText5('RUNNER', 74, 3, 2);
      const items = ['START NEW RUN', 'HIGH SCORES'];
      items.forEach((it, i) => {
        const sel = menuIdx === i;
        const y = 116 + i * 16;
        if (sel) { box(46, y - 2, 169, y + 8, PAL[3]); text3((tick >> 3) % 2 === 0 ? '▶' : ' ', 50, y, BG); }
        text3(it, 58, y, sel ? BG : 3);
        rec('menu:' + it, 58, y, textW(it, 1), 7);
      });
      text3('ARROWS SELECT', 12, 200, 3); rec('menu.help1', 12, 200, textW('ARROWS SELECT', 1), 7);
      text3('SPACE OK', 12, 210, 3); rec('menu.help2', 12, 210, textW('SPACE OK', 1), 7);
      text3('P AUTOPILOT', 132, 200, 3); rec('menu.help3', 132, 200, textW('P AUTOPILOT', 1), 7);
      text3('CREDIT 01', 132, 210, 3); rec('menu.help4', 132, 210, textW('CREDIT 01', 1), 7);
      text3('Q BACK TO TERMINAL', 40, 226, 3); rec('menu.q', 40, 226, textW('Q BACK TO TERMINAL', 1), 7);
    } else if (state === 'hiscores') {
      dimField();
      plate(48, 60, 167, 200);
      centerText5('HIGH SCORES', 72, 3);
      hiscores.slice(0, 5).forEach((v, i) => {
        const t = String(i + 1) + ' ' + String(v).padStart(6, '0');
        const w = textW(t, 1);
        text3(t, Math.round((W - w) / 2), 96 + i * 14, i === 0 ? 4 : 3);
        rec('hiscore.' + i, Math.round((W - w) / 2), 96 + i * 14, w, 7);
      });
      if (!savedOk) centerText5('SCORES NOT SAVED', 170, 3);
      centerText5('SPACE BACK', 186, 3);
    } else if (state === 'gameover') {
      dimField();
      plate(40, 100, 175, 230);
      centerText5('GAME OVER', 116, 4);
      centerNum(String(score).padStart(6, '0'), 140, 4);
      if (score > 0 && hiscores.includes(score) && !autopilot && (tick >> 3) % 2 === 0) centerText5('NEW HIGH SCORE', 160, 9);
      centerText5('SPACE RETRY', 186, 3);
      centerText5('ESC EXIT', 200, 3);
    } else if (state === 'pause') {
      plate(58, 150, 157, 220);
      centerText5('PAUSED', 164, 4);
      centerText5('SPACE RESUME', 186, 3);
      centerText5('ESC EXIT', 200, 3);
    }
    renderHUD();
    blit();
  }

  function blit() {
    const d = img.data;
    for (let i = 0; i < W * H; i++) {
      const v = buf[i];
      const rgb = v === 9 ? PAL_RGB[5] : v === 8 ? PAL_RGB[6] : PAL_RGB[v];
      const p = i * 4;
      d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    const c = ctx!.ctx2d;
    c.imageSmoothingEnabled = false;
    const sc = ctx!.scale;
    c.clearRect(0, 0, W * sc, H * sc);
    c.drawImage(off as unknown as CanvasImageSource, 0, 0, W, H, 0, 0, W * sc, H * sc);
    if (sc >= 4) {
      c.fillStyle = GAME_PAL[0];
      for (let x = 1; x < W; x++) c.fillRect(x * sc, 0, 1, H * sc);
      for (let y = 1; y < H; y++) c.fillRect(0, y * sc, W * sc, 1);
    }
  }

  /* ---------- probe ---------- */
  function hash(): number {
    let h = 2166136261;
    const mix = (v: number) => { h ^= Math.round(v * 100); h = Math.imul(h, 16777619); };
    mix(scroll); mix(ship.x); mix(ship.sy); mix(score); mix(fuel); mix(lives); mix(bombs); mix(stage); mix(ents.length); mix(bullets.length);
    for (const e of ents) { mix(e.x); mix(e.y); mix(e.hp); }
    for (const b of bullets) { mix(b.x); mix(b.sy); }
    return h >>> 0;
  }
  (window as unknown as { __game?: Record<string, unknown> }).__game = {
    get state() { return state; },
    get tick() { return tick; },
    get seed() { return seed; },
    get score() { return score; },
    get lives() { return lives; },
    get fuel() { return fuel; },
    get stage() { return stage; },
    get bombs() { return bombs; },
    get ship() { return { x: +ship.x.toFixed(2), y: +ship.sy.toFixed(1) }; },
    entities: () => ents.map((e) => ({ type: e.type, x: +e.x.toFixed(1), y: +e.y.toFixed(1), sy: +syOf(e.y).toFixed(1), hp: e.hp })),
    bullets: () => bullets.map((b) => ({ x: +b.x.toFixed(1), sy: +b.sy.toFixed(1), foe: b.foe })),
    wall: (row: number) => { const w = wallAt(row); return { l: w.l, r: w.r }; },
    hash,
    step: (n: number) => { for (let i = 0; i < n; i++) { tick++; update(); } },
    setInputs: (s2: Array<Partial<InputState>> | null) => { script = s2; },
    autopilot: (on?: boolean) => {
      if (typeof on === 'boolean') { autopilot = on; if (state === 'play' || state === 'attract') ctx?.setLabel?.(autopilot ? 'AUTOPILOT' : 'PLAYING'); }
      return autopilot;
    },
    reset: (s: number) => resetRun(s & 0xffff),
    start: (s: number) => { resetRun(s & 0xffff); autopilot = false; state = 'play'; },
    font5: (t: string) => t.toUpperCase().split('').map((ch) => F57[ch] || F57[' ']),
    font3: (t: string) => t.toUpperCase().split('').map((ch) => F35[ch] || F35[' ']),
    frame: () => buf.slice(),
    stats: () => ({ runs, hiscores: [...hiscores], savedOk, deaths: [...deathCauses], tanksSpawned, tanksGot }),
    checkWorld: (seeds: number, rows: number) => checkWorld(seeds, rows),
    cfg: () => { const c = stageCfg(stage); return { v: c.v, gapBase: c.gapBase, dronesMin: c.dronesMin, towerIv: c.towerIv, minesChamber: c.minesChamber, drain: c.drain }; },
    cfgFor: (n: number) => { const c = stageCfg(Math.min(6, Math.max(1, n))); return { v: c.v, gapBase: c.gapBase, dronesMin: c.dronesMin, towerIv: c.towerIv, minesChamber: c.minesChamber, drain: c.drain }; },
    hudBoxes: () => ({ W, H, bands: BANDS, boxes: meas.map((m) => ({ ...m })) }),
  };

  /* ---------- module ---------- */
  return {
    id: 'shaft-runner',
    logical: { w: W, h: H },
    capturesEsc: true,
    mount(c) {
      ctx = c;
      img = offCtx.createImageData(W, H);
      loadScores();
      seedBase = (c.seed ^ 0x5157) & 0xffff;
      resetRun(seedBase);
      state = 'attract';
      autopilot = true;
      c.setLabel?.('DEMO');
    },
    update() { tick++; update(); },
    render,
    setMode(m) {
      if (m === 'focused') {
        if (state === 'attract' || state === 'gameover' || state === 'hiscores') { state = 'menu'; menuIdx = 0; autopilot = false; ctx?.setLabel?.('MENU'); }
      } else if (m === 'attract') {
        state = 'attract';
        autopilot = true;
        resetRun(seedBase);
        ctx?.setLabel?.('DEMO');
      } else if (m === 'paused' && state === 'play') {
        state = 'pause';
        ctx?.setLabel?.('PAUSED');
      }
    },
    destroy() {
      try { ac?.close(); } catch { /* closed */ }
      ac = null;
      ctx = null;
    },
  };
}


