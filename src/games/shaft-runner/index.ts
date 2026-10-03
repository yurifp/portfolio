/*
  SHAFT RUNNER — the GameModule (Part 1 contract). A vertical cave
  shooter on a 108×192 LED cell grid.

  GEOMETRY (fixed): the shaft DESCENDS the screen — new content enters
  at the top and flows down past the ship. Screen y of world row wy:
      sy = 180 - (wy - scroll)      → wy = scroll + 180 - sy
  Terrain (fixed wy) flows down at v. Drones descend at v+22 (wy -= 22/s).
  Bullets live in SCREEN space. Deterministic: (seed, input script).
*/
import type { GameModule, HostContext, InputState } from '../../scripts/game-host';
import { F35, F57, SPR_SHIP, SPR_DRONE, SPR_TOWER, SPR_MINE, SPR_TANK, STAGE_ROWS, FIELD_Y0 } from './data';
import { Shaft, mulberry32, stageOf, stageCfg } from './world';

/* PHOSPHOR RAMP — the game screen's own closed palette (hex, one place):
   L0 floor, L1/L2 decoration only, L3/L4 = INFORMATION (HUD, ship,
   shots, enemies, text), ACC = lime (pickups/CTA/alerts), VIO = rare */
const GAME_PAL = ['#020a04', '#07240d', '#0f7a2a', '#2cff4a', '#d6ffd9'];
const ACC = '#9df133';
const VIO = '#905cff';
const PAL = [0, 1, 2, 3, 4]; /* level indices into GAME_PAL */
const BG = 0;

type GState = 'attract' | 'menu' | 'play' | 'pause' | 'gameover' | 'hiscores';

interface Ent {
  type: 'drone' | 'tower' | 'mine' | 'tank';
  x: number; y: number;       /* world coords */
  hp: number;
  phase?: number; amp?: number; per?: number; baseX?: number;
  cool?: number;
}
interface Bullet { x: number; sy: number; vx: number; vy: number; foe: boolean } /* screen space */
interface Boom { x: number; sy: number; t: number; big: boolean }

const W = 108, H = 192;
const SHIP_Y_MIN = 112, SHIP_Y_MAX = 170;
const FIELD_TOP = FIELD_Y0, FIELD_BOT = 180;
import * as worldMod from './world';

export function createShaftRunner(): GameModule {
  let ctx: HostContext | null = null;
  let state: GState = 'attract';
  let tick = 0;
  let seed = 0;
  let rnd = mulberry32(0);
  let shaft = new Shaft(0);
  let scroll = 0;
  let ship = { x: 54, y: 150 };      /* y = SCREEN y */
  let lives = 3, fuel = 100, bombs = 3, score = 0, stage = 1;
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

  let ac: AudioContext | null = null;
  let voices = 0;
  const SFX: Record<string, [number, number, string]> = {
    shoot: [880, 0.05, 'sq'], boomS: [900, 0.15, 'no'], boomB: [300, 0.3, 'no'],
    pick: [660, 0.09, 'sq'], bomb: [200, 0.35, 'no'], hurt: [110, 0.22, 'sq'],
    stage: [523, 0.16, 'sq'], low: [1046, 0.05, 'sq'], tick: [1320, 0.03, 'sq'],
  };

  /* ---------- coordinate helpers ---------- */
  const cfg = () => stageCfg(stage);
  const wallAt = (row: number) => shaft.at(Math.max(0, Math.round(row)));
  /* screen y of world row wy (terrain flows DOWN) */
  const syOf = (wy: number) => FIELD_BOT - (wy - scroll);
  /* world row currently at screen y sy */
  const rowAt = (sy: number) => scroll + FIELD_BOT - sy;

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
    ship = { x: 54, y: 150 };
    lives = 3; fuel = 100; bombs = 3; score = 0; stage = 1;
    invuln = 0; nextExtra = 10000; nextBombScore = 5000;
    ents = []; bullets = []; booms = []; bombWave = -1;
    banner = 0; lowFuelBeeped = false;
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

  /* ---------- spawning ---------- */
  function spawnSchedule() {
    const c = cfg();
    const v = c.v;
    const horizon = scroll + 170; /* world rows ~at screen top */
    while (nextDroneRow <= horizon) {
      if (rnd() < 0.9 && ents.length < 64) {
        const n = 3 + Math.floor(rnd() * 3);
        const w = wallAt(nextDroneRow);
        const cx = (w.l + w.r) / 2 + (rnd() - 0.5) * Math.max(0, w.r - w.l - 30);
        const amp = Math.min(10 + rnd() * 10, Math.max(2, (w.r - w.l) / 2 - 16)), per = 1.2 + rnd() * 0.8;
        for (let k = 0; k < n && ents.length < 64; k++) {
          ents.push({ type: 'drone', x: cx, y: nextDroneRow + k * 20, hp: 1, phase: rnd() * 6.28, amp, per, baseX: cx });
        }
      }
      nextDroneRow += (v * 60) / c.dronesMin * (0.7 + rnd() * 0.6);
    }
    while (nextTowerRow <= horizon) {
      const w = wallAt(nextTowerRow);
      const side: -1 | 1 = rnd() < 0.5 ? -1 : 1;
      if (ents.length < 64) ents.push({ type: 'tower', x: side < 0 ? w.l + 4 : w.r - 4, y: nextTowerRow, hp: 3, side, cool: 0.5 });
      nextTowerRow += c.towerIv * v * (0.75 + rnd() * 0.5);
    }
    while (nextTankRow <= horizon) {
      const w = wallAt(nextTankRow);
      const onWall = rnd() < 0.55;
      let x = onWall ? (rnd() < 0.5 ? w.l + 4 : w.r - 4) : w.l + 6 + rnd() * Math.max(1, w.r - w.l - 12);
      /* never within 24px of the ship: nudge along the shaft (never skip) */
      if (Math.abs(x - ship.x) < 24) {
        const cand = x <= ship.x ? ship.x - 24 : ship.x + 24;
        x = cand >= w.l + 3 && cand <= w.r - 3 ? cand : (x <= ship.x ? w.l + 3 : w.r - 3);
      }
      if (ents.length < 64) { ents.push({ type: 'tank', x, y: nextTankRow, hp: 1 }); tanksSpawned++; }
      nextTankRow += 0.9 * 25 * v / c.drain * (0.75 + rnd() * 0.5);
    }
    /* mines per chamber */
    const aheadW = wallAt(Math.round(scroll + 40));
    if (aheadW.chamber > 0 && chamberArmed < 0) {
      chamberArmed = Math.round(scroll) + 40;
      for (let k = 0; k < cfg().minesChamber && ents.length < 64; k++) {
        const row = chamberArmed + 10 + rnd() * 40;
        const wr = wallAt(Math.round(row));
        const x = wr.l + 5 + rnd() * Math.max(1, wr.r - wr.l - 10);
        ents.push({ type: 'mine', x, y: row, hp: 2 });
      }
    } else if (aheadW.chamber <= 0) chamberArmed = -1;
  }

  /* ---------- bot ---------- */
  function autopilotInputs(): Partial<InputState> {
    const inp: Partial<InputState> = {};
    const ahead = wallAt(Math.round(rowAt(ship.y) + 28));
    let target = (ahead.l + ahead.r) / 2;
    /* fuel lean: nearest REACHABLE tank (min intercept time) */
    if (fuel < 82) {
      let best: Ent | null = null, bestT = 1e9;
      for (const e of ents) {
        if (e.type !== 'tank' || e.hp <= 0) continue;
        const dsy = ship.y - syOf(e.y); /* tank above: positive */
        if (dsy <= 0 || dsy > 70) continue;
        const t = dsy / cfg().v + Math.abs(e.x - ship.x) / 70;
        if (t < bestT) { bestT = t; best = e; }
      }
      if (best && Math.abs(best.x - ship.x) / 70 < (ship.y - syOf(best.y)) / cfg().v + 0.4) target = best.x;
    }
    target = Math.max(ahead.l + 8, Math.min(ahead.r - 8, target));
    /* bullet dodge — predict EACH bullet's crossing of the ship line
       over the next ~100 ticks (they are slow and aimed); aggregate the
       pushes of all threats and steer to the side with room */
    let push = 0, threats = 0;
    for (const b of bullets) {
      if (!b.foe) continue;
      if (Math.abs(b.vy) < 0.05) { /* horizontal: dodge now */
        if (Math.abs(b.sy - ship.y) < 16 && Math.abs(b.x - ship.x) < 30) { push += ship.x >= b.x ? 1 : -1; threats++; }
        continue;
      }
      const tCross = (ship.y - b.sy) / b.vy;
      if (tCross < 0 || tCross > 100) continue;
      const xAt = b.x + b.vx * tCross;
      if (Math.abs(xAt - ship.x) < 13) { push += ship.x >= xAt ? 1 : -1; threats++; }
    }
    if (threats > 0) {
      const now = wallAt(Math.round(rowAt(ship.y)));
      const dir = push >= 0 ? 1 : -1;
      const room = dir > 0 ? now.r - 6 - ship.x : ship.x - (now.l + 6);
      const step = Math.min(Math.max(12, threats * 8), Math.max(4, room));
      target = Math.max(now.l + 6, Math.min(now.r - 6, ship.x + dir * step));
    }
    /* enemy dodge — ONLY when no bullet threat (bullets have priority) */
    if (threats === 0 && fuel >= 55) {
      for (const e of ents) {
        if (e.hp <= 0 || e.type === 'tank') continue;
        const dsy = ship.y - syOf(e.y);
        if (dsy > 0 && dsy < 44 && Math.abs(e.x - ship.x) < 14) {
          const now = wallAt(Math.round(rowAt(ship.y)));
          target = Math.max(now.l + 6, Math.min(now.r - 6, ship.x + (ship.x >= e.x ? 19 : -19)));
          break;
        }
      }
    }
    /* final safety: intersection of current and ahead safe ranges */
    const nowW = wallAt(Math.round(rowAt(ship.y)));
    const lo = Math.max(nowW.l, ahead.l) + 7, hi = Math.min(nowW.r, ahead.r) - 7;
    if (hi > lo) target = Math.max(lo, Math.min(hi, target));
    if (Math.abs(target - ship.x) > 2) { inp.right = target > ship.x; inp.left = target < ship.x; }
    inp.up = ship.y < 150;
    inp.down = ship.y > 158;
    /* fire: tanks first, then enemies — column ±8 above */
    const inCol = (e: Ent) => e.hp > 0 && Math.abs(e.x - ship.x) <= 12 && ship.y - syOf(e.y) > 0 && ship.y - syOf(e.y) < 130;
    if (ents.some((e) => e.type === 'tank' && inCol(e))) inp.fire = true;
    else if (ents.some(inCol)) inp.fire = true;
    /* bomb: ≥3 close bullets or enemy within 18px */
    const closeB = bullets.filter((b) => b.foe && Math.hypot(b.x - ship.x, b.sy - ship.y) < 36).length;
    const closeE = ents.some((e) => e.hp > 0 && e.type !== 'tank' && Math.hypot(e.x - ship.x, syOf(e.y) - ship.y) < 24);
    inp.bomb = (closeB >= 3 || closeE) && bombs > 0;
    return inp;
  }

  /* ---------- core ---------- */
  let lastDeathCtx: unknown = null;
  function die(cause: string) {
    if (invuln > 0) return;
    lastDeathCtx = { cause, ship: { ...ship }, invuln, near: bullets.filter((b) => b.foe && Math.hypot(b.x - ship.x, b.sy - ship.y) < 25).map((b) => ({ x: +b.x.toFixed(1), sy: +b.sy.toFixed(1), vx: +b.vx.toFixed(2), vy: +b.vy.toFixed(2) })), nearEnts: ents.filter((e) => e.hp > 0 && Math.hypot(e.x - ship.x, syOf(e.y) - ship.y) < 20).map((e) => ({ t: e.type, x: +e.x.toFixed(1), sy: +syOf(e.y).toFixed(1) })) };
    lives--;
    deathCauses.push(cause);
    booms.push({ x: ship.x, sy: ship.y, t: 0, big: true });
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
    const w = wallAt(Math.round(rowAt(164)));
    ship = { x: (w.l + w.r) / 2, y: 164 };
  }

  function hitEnt(e: Ent, dmg: number) {
    e.hp -= dmg;
    if (e.hp > 0) return;
    const pts = e.type === 'drone' ? 100 : e.type === 'tower' ? 250 : e.type === 'mine' ? 150 : 50;
    if (!autopilot) score += pts;
    booms.push({ x: e.x, sy: syOf(e.y), t: 0, big: false });
    playSfx(e.type === 'tank' ? 'pick' : 'boomS');
    ctx?.setActivity?.(0.8);
    if (e.type === 'tank') { fuel = Math.min(100, fuel + 25); tanksGot++; }
    if (e.type === 'mine') {
      for (const [dx, dy] of [[0.9, 0.9], [0.9, -0.9], [-0.9, 0.9], [-0.9, -0.9]]) {
        bullets.push({ x: e.x, sy: syOf(e.y), vx: dx, vy: dy, foe: true });
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
    else if (state === 'pause') { state = 'attract'; ctx?.setLabel?.('AUTOPILOT'); ctx!.release(); }
    else if (state === 'gameover' || state === 'hiscores') state = 'menu';
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
        else startRun(); /* gameover retry */
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

    /* ship */
    const sx = 70 * dt, sy = 48 * dt;
    if (eff.left) ship.x -= sx;
    if (eff.right) ship.x += sx;
    if (eff.up) ship.y -= sy;
    if (eff.down) ship.y += sy;
    if (typeof eff.px === 'number') ship.x = eff.px;
    ship.x = Math.max(2, Math.min(105, ship.x));
    ship.y = Math.max(SHIP_Y_MIN, Math.min(SHIP_Y_MAX, ship.y));

    /* fire */
    fireCool--;
    if (eff.fire && fireCool <= 0 && bullets.filter((b) => !b.foe).length < 6) {
      bullets.push({ x: ship.x, sy: ship.y - 5, vx: 0, vy: -170 / 60, foe: false });
      fireCool = 60 / 8;
      playSfx('shoot');
      ctx?.setActivity?.(0.5);
    }
    /* bomb */
    if (eff.bomb && bombs > 0 && bombWave < 0) {
      bombs--;
      bombWave = tick; bombX = ship.x; bombSY = ship.y;
      playSfx('bomb');
    }
    if (bombWave >= 0) {
      const half = ((tick - bombWave) / 30) * 54;
      bullets = bullets.filter((b) => !b.foe || Math.abs(b.x - bombX) > half || Math.abs(b.sy - bombSY) > half);
      for (const e of ents) {
        if (e.hp > 0 && Math.abs(e.x - bombX) <= half && Math.abs(syOf(e.y) - bombSY) <= half) hitEnt(e, 5);
      }
      if (tick - bombWave >= 30) bombWave = -1;
    }

    /* wall collision (3×3 hitbox) */
    if (invuln > 0) invuln--;
    else {
      const w = wallAt(Math.round(rowAt(ship.y)));
      const hx = Math.round(ship.x);
      if (hx - 1 <= w.l || hx + 1 >= w.r) die('wall');
      if (state === 'gameover') return;
    }

    spawnSchedule();

    /* entities */
    for (const e of ents) {
      if (e.hp <= 0) continue;
      if (e.type === 'drone') {
        e.y -= 22 * dt; /* screen descends at v+22 */
        const ph = (e.phase || 0) + dt * 6.283 / (e.per || 1.5);
        e.phase = ph;
        e.x = (e.baseX || e.x) + Math.sin(ph) * (e.amp || 12);
        /* the shaft narrows as the drone descends: clamp to the wall of
           the drone's OWN row so it never enters the rock */
        const dw = wallAt(Math.round(e.y));
        e.x = Math.max(dw.l + 2, Math.min(dw.r - 2, e.x));
      } else if (e.type === 'tower') {
        const tsy = syOf(e.y);
        if (tsy >= 14 && tsy <= 120) { /* spec firing window */
          e.cool = (e.cool || 0) - dt;
          if (e.cool <= 0 && bullets.filter((b) => b.foe).length < 24) {
            e.cool = cfg().towerIv;
            const dx = ship.x - e.x, dy = ship.y - tsy;
            const d = Math.hypot(dx, dy) || 1;
            const sp = 52 / 60;
            bullets.push({ x: e.x, sy: tsy, vx: (dx / d) * sp, vy: (dy / d) * sp, foe: true });
          }
        }
      } else if (e.type === 'mine') {
        if (Math.hypot(e.x - ship.x, syOf(e.y) - ship.y) < 14) hitEnt(e, 99);
      }
    }

    /* bullets (screen space) */
    for (const b of bullets) { b.x += b.vx; b.sy += b.vy; }
    /* player bullets × entities */
    for (const b of bullets) {
      if (b.foe) continue;
      for (const e of ents) {
        if (e.hp <= 0) continue;
        const sprW = e.type === 'tower' || e.type === 'tank' ? 9 : 7;
        if (Math.abs(b.x - e.x) <= sprW / 2 && Math.abs(b.sy - syOf(e.y)) <= 4) {
          hitEnt(e, 1);
          b.sy = -999;
          break;
        }
      }
    }
    /* foe bullets × ship */
    if (invuln <= 0) {
      for (const b of bullets) {
        if (b.foe && Math.abs(b.x - ship.x) <= 1 && Math.abs(b.sy - ship.y) <= 1) { die('bullet'); break; }
      }
      if (state === 'gameover') return;
    }
    /* entities × ship: tanks PICK UP, others kill */
    for (const e of ents) {
      if (e.hp <= 0) continue;
      if (e.type === 'tank') {
        if (Math.abs(e.x - ship.x) <= 5 && Math.abs(syOf(e.y) - ship.y) <= 5) hitEnt(e, 99);
      } else if (invuln <= 0 && Math.abs(e.x - ship.x) <= 4 && Math.abs(syOf(e.y) - ship.y) <= 4) { die('enemy'); break; }
    }
    if (state === 'gameover') return;

    bullets = bullets.filter((b) => b.x > -4 && b.x < 112 && b.sy > -6 && b.sy < 196 && b.sy > -900);
    ents = ents.filter((e) => e.hp > 0 && syOf(e.y) > -12 && syOf(e.y) < 210);
    for (const bm of booms) bm.t++;
    booms = booms.filter((bm) => bm.t < 22);

    if (score >= nextExtra) { lives++; nextExtra += extraStep; ctx?.emit('extra-life', { lives }); }
    if (score >= nextBombScore) { bombs = Math.min(5, bombs + 1); nextBombScore += 5000; }
  }

  /* ---------- render ---------- */
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
  function text5(s: string, x: number, y: number, lv: number) {
    s = s.toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = F57[s[i]] || F57[' '];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        const px = x + i * 6 + c, py = y + r;
        if (g[r][c] === '1' && py >= 0 && py < H && px >= 0 && px < W) buf[py * W + px] = lv;
      }
    }
  }
  function spr(map: string[], x: number, y: number) {
    for (let r = 0; r < map.length; r++) for (let c = 0; c < map[r].length; c++) {
      const ch = map[r][c];
      if (ch === '0') continue;
      const px = Math.round(x) + c, py = Math.round(y) + r;
      if (px >= 0 && px < W && py >= 0 && py < H) buf[py * W + px] = PAL[Math.min(3, parseInt(ch, 10))];
    }
  }
  function plate(x0: number, y0: number, x1: number, y1: number) {
    /* placa: L0 fill, 1px L2 border — separates from the field */
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (y < 0 || y >= H || x < 0 || x >= W) continue;
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

  function renderWorld() {
    for (let sy = FIELD_TOP; sy < FIELD_BOT; sy++) {
      const row = Math.round(rowAt(sy));
      const w = wallAt(row);
      const stripe = (row % 2 === 0) ? PAL[1] : PAL[2];
      for (let x = 0; x < W; x++) buf[sy * W + x] = (x <= w.l || x >= w.r) ? stripe : BG;
      buf[sy * W + w.l] = PAL[3]; /* border = L3 (information edge) */
      buf[sy * W + w.r] = PAL[3];
    }
    /* dust: 2 parallax layers (0.3×, 0.6×) */
    for (let i = 0; i < 26; i++) {
      const h1 = (i * 37 + 11) % W, h2 = (i * 53 + 29) % W;
      const y1 = FIELD_TOP + ((i * 23 + Math.round(scroll * 0.3)) % 168 + 168) % 168;
      const y2 = FIELD_TOP + ((i * 41 + Math.round(scroll * 0.6)) % 168 + 168) % 168;
      const w1 = wallAt(Math.round(rowAt(y1))), w2 = wallAt(Math.round(rowAt(y2)));
      if (h1 > w1.l + 2 && h1 < w1.r - 2) buf[y1 * W + h1] = PAL[1];
      if (h2 > w2.l + 2 && h2 < w2.r - 2) buf[y2 * W + h2] = PAL[2];
    }
  }

  function renderHUD() {
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

  function render() {
    buf.fill(BG);
    renderWorld();
    if (state === 'play' || state === 'pause' || state === 'attract') {
      for (const e of ents) {
        const sy = Math.round(syOf(e.y));
        if (sy < -8 || sy > 190) continue;
        const ex = Math.round(e.x);
        if (e.type === 'drone') spr(SPR_DRONE, ex - 3, sy - 3);
        else if (e.type === 'tower') spr(SPR_TOWER, ex - 4, sy - 2);
        else if (e.type === 'mine') spr(SPR_MINE, ex - 3, sy - 3);
        else if (e.type === 'tank') spr(SPR_TANK, ex - 4, sy - 3);
      }
      for (const b of bullets) {
        const sy = Math.round(b.sy), bx = Math.round(b.x);
        if (b.foe) {
          /* diamond (plus-shape) L4 + pulsing L3 halo — distinct from the
             ship streaks by SHAPE and motion */
          const hot = (tick >> 2) % 2 === 0;
          if (sy >= 0 && sy < H && bx >= 0 && bx < W) buf[sy * W + bx] = 4;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const px = bx + dx, py = sy + dy;
            if (px >= 0 && px < W && py >= 0 && py < H) buf[py * W + px] = hot ? 4 : 3;
          }
        } else {
          /* ship shot: 1×3 streak, L4 head + L3 tail */
          for (let k = 0; k < 3; k++) { const yy = sy + k; if (yy >= 0 && yy < H && bx >= 0 && bx < W) buf[yy * W + bx] = k === 0 ? 4 : 3; }
        }
      }
      for (const bm of booms) square(bm.x, bm.sy, (bm.t / 22) * (bm.big ? 14 : 8), 4);
      if (bombWave >= 0) square(bombX, bombSY, ((tick - bombWave) / 30) * 54, 4);
      if (invuln <= 0 || (tick >> 2) % 2 === 0) spr(SPR_SHIP, Math.round(ship.x) - 3, Math.round(ship.y) - 4);
      renderHUD();
      if (banner > 0) {
        banner--;
        plate(24, 80, 83, 100);
        text5('STAGE ' + String(stage).padStart(2, '0'), 27, 86, 4);
      }
      if (state === 'pause') {
        plate(16, 78, 91, 104);
        text5('PAUSED', 36, 83, 4);
        text3('SPACE RESUME   ESC EXIT', 8, 96, 3);
      }
    }
    if (state === 'attract') {
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
    }
    blit();
  }

  function blit() {
    const d = img.data;
    /* inline level colors (one place: GAME_PAL) + accent at slot 9 */
    const L0 = GAME_PAL[0], L1 = GAME_PAL[1], L2 = GAME_PAL[2], L3 = GAME_PAL[3], L4 = GAME_PAL[4];
    const put = (p: number, hx: string) => { d[p] = parseInt(hx.slice(1, 3), 16); d[p + 1] = parseInt(hx.slice(3, 5), 16); d[p + 2] = parseInt(hx.slice(5, 7), 16); d[p + 3] = 255; };
    for (let i = 0; i < W * H; i++) {
      const v = buf[i];
      put(i * 4, v === 9 ? ACC : v === 8 ? VIO : GAME_PAL[Math.min(4, v)]);
    }
    void L0; void L1; void L2; void L3; void L4;
    offCtx.putImageData(img, 0, 0);
    const c = ctx!.ctx2d;
    c.imageSmoothingEnabled = false;
    const s = ctx!.scale;
    c.clearRect(0, 0, W * s, H * s);
    c.drawImage(off as unknown as CanvasImageSource, 0, 0, W, H, 0, 0, W * s, H * s);
    if (s >= 4) {
      c.fillStyle = GAME_PAL[0];
      for (let x = 1; x < W; x++) c.fillRect(x * s, 0, 1, H * s);
      for (let y = 1; y < H; y++) c.fillRect(0, y * s, W * s, 1);
    }
  }

  /* ---------- probe ---------- */
  function hash(): number {
    let h = 2166136261;
    const mix = (v: number) => { h ^= Math.round(v * 100); h = Math.imul(h, 16777619); };
    mix(scroll); mix(ship.x); mix(ship.y); mix(score); mix(fuel); mix(lives); mix(bombs); mix(stage); mix(ents.length); mix(bullets.length);
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
    get ship() { return { x: +ship.x.toFixed(2), y: +ship.y.toFixed(2) }; },
    entities: () => ents.map((e) => ({ type: e.type, x: +e.x.toFixed(1), y: +e.y.toFixed(1), sy: +syOf(e.y).toFixed(1), hp: e.hp })),
    bullets: () => bullets.map((b) => ({ ...b })),
    wall: (row: number) => { const w = wallAt(row); return { l: w.l, r: w.r }; },
    hash,
    step: (n: number) => { for (let i = 0; i < n; i++) { tick++; update(); } },
    setInputs: (s2: Array<Partial<InputState>> | null) => { script = s2; },
    autopilot: (on?: boolean) => {
      if (typeof on === 'boolean') { autopilot = on; if (state === 'play' || state === 'attract') ctx?.setLabel?.(on ? 'AUTOPILOT' : 'PLAYING'); }
      return autopilot;
    },
    reset: (s: number) => resetRun(s & 0xffff),
    start: (s: number) => { resetRun(s & 0xffff); autopilot = false; state = 'play'; },
    font5: (t: string) => t.toUpperCase().split('').map((ch) => F57[ch] || F57[' ']),
    font3: (t: string) => t.toUpperCase().split('').map((ch) => F35[ch] || F35[' ']),
    frame: () => buf.slice(),
    stats: () => ({ runs, hiscores: [...hiscores], savedOk, deaths: [...deathCauses], tanksSpawned, tanksGot, lastDeathCtx }),
    checkWorld: (seeds: number, rows: number) => worldMod.checkWorld(seeds, rows),
    cfg: () => { const c = stageCfg(stage); return { v: c.v, gapBase: c.gapBase, dronesMin: c.dronesMin, towerIv: c.towerIv, minesChamber: c.minesChamber, drain: c.drain }; },
    cfgFor: (n: number) => { const c = stageCfg(Math.min(6, Math.max(1, n))); return { v: c.v, gapBase: c.gapBase, dronesMin: c.dronesMin, towerIv: c.towerIv, minesChamber: c.minesChamber, drain: c.drain }; },
  };

  /* ---------- module ---------- */
  return {
    id: 'shaft-runner',
    logical: { w: 108, h: 192 },
    capturesEsc: true,
    mount(c) {
      ctx = c;
      img = offCtx.createImageData(W, H);
      loadScores();
      seedBase = (c.seed ^ 0x5157) & 0xffff;
      resetRun(seedBase);
      state = 'attract';
      autopilot = true;
      c.setLabel?.('AUTOPILOT');
    },
    update() { tick++; update(); },
    render,
    setMode(m) {
      if (m === 'focused') {
        if (state === 'attract' || state === 'gameover' || state === 'hiscores') { state = 'menu'; menuIdx = 0; autopilot = false; }
      } else if (m === 'attract') {
        state = 'attract';
        autopilot = true;
        resetRun(seedBase);
        ctx?.setLabel?.('AUTOPILOT');
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
