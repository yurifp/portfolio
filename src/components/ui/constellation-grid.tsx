import React, { useEffect, useRef } from 'react';

/*
  ConstellationGrid — spring-mass mesh that lives behind the hero.
  Adapted for the field design system:
  - transparent canvas (no bg fill) layered over the void
  - reveal-by-activity: nearly invisible when idle, blooms while the
    pointer moves — the reference behavior
  - denser grid (spacing 38) with O(n) neighbor links instead of O(n²)
  - accent follows the lime signal; ink nodes; hex readouts near cursor
  - pauses offscreen / hidden tab; single static frame under
    prefers-reduced-motion
*/

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  label: string;
  pulse: number;
}

interface Props {
  /** grid spacing in px — smaller = more pixels */
  density?: number;
  /** rgb triple for the cursor accent */
  accent?: string;
  /** rgb triple for idle nodes */
  ink?: string;
}

export default function ConstellationGrid({
  density = 38,
  accent = '157, 241, 51', // --color-lime
  ink = '245, 240, 235', // --color-ink
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let visible = true;
    let nodes: Node[] = [];
    let cols = 0;
    let rows = 0;

    const mouse = {
      x: -1000,
      y: -1000,
      prevX: -1000,
      prevY: -1000,
      vx: 0,
      vy: 0,
      radius: 230,
    };

    /* reveal-by-activity: 0 = almost hidden, 1 = full constellation */
    let activity = 0;

    const resize = () => {
      const host = canvas.parentElement;
      if (!host) return;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes();
    };

    const initNodes = () => {
      nodes = [];
      cols = Math.ceil(width / density) + 1;
      rows = Math.ceil(height / density) + 1;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * density;
          const y = j * density;
          nodes.push({
            x,
            y,
            vx: 0,
            vy: 0,
            baseX: x,
            baseY: y,
            radius: Math.random() * 1.1 + 1.1,
            label: `${(i * 7).toString(16).toUpperCase()}:${(j * 11).toString(16).toUpperCase()}`,
            pulse: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const toLocal = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onMouseMove = (e: MouseEvent) => {
      const p = toLocal(e);
      mouse.x = p.x;
      mouse.y = p.y;
    };
    const onMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height);

      const speed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);
      const reveal = 0.05 + activity * 0.95;

      /* spring constants — Hooke + damping */
      const SPRING_K = 18;
      const DAMPING = 0.82;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.pulse += dt * 3;

        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.hypot(dx, dy);

        if (dist < mouse.radius && dist > 0.001) {
          const power = 1 - dist / mouse.radius;
          const force = power * (1500 + speed * 150);
          const angle = Math.atan2(dy, dx);
          n.vx -= Math.cos(angle) * force * dt;
          n.vy -= Math.sin(angle) * force * dt;
        }

        n.vx += (n.baseX - n.x) * SPRING_K * dt;
        n.vy += (n.baseY - n.y) * SPRING_K * dt;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx * dt * 60;
        n.y += n.vy * dt * 60;
      }

      /* neighbor links only (grid topology): right, down, both diagonals */
      ctx.lineWidth = 0.7;
      const LINK_MAX = density * 1.55;
      const idx = (i: number, j: number) => i * rows + j;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const a = nodes[idx(i, j)];
          if (!a) continue;
          const neighbors: Array<[number, number]> = [
            [i + 1, j],
            [i, j + 1],
            [i + 1, j + 1],
            [i - 1, j + 1],
          ];
          for (const [ni, nj] of neighbors) {
            if (ni < 0 || ni >= cols || nj >= rows) continue;
            const b = nodes[idx(ni, nj)];
            if (!b) continue;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > LINK_MAX) continue;
            const alpha = (1 - d / LINK_MAX) * 0.2 * reveal;
            if (alpha < 0.004) continue;
            ctx.strokeStyle = `rgba(${ink}, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      /* nodes + proximity highlights */
      ctx.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const dist = Math.hypot(mouse.x - n.x, mouse.y - n.y);
        const isNear = dist < mouse.radius;

        const baseAlpha = isNear
          ? 0.55 * (0.15 + activity * 0.85)
          : (0.16 + Math.sin(n.pulse) * 0.06) * reveal;

        const r = isNear ? n.radius * 2.1 : n.radius + Math.sin(n.pulse) * 0.3;
        ctx.fillStyle = isNear
          ? `rgba(${accent}, ${baseAlpha})`
          : `rgba(${ink}, ${baseAlpha})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();

        if (isNear && dist < 90 && activity > 0.15) {
          const ring = ((n.pulse * 20) % 30) + 4;
          const ringAlpha = (1 - ring / 34) * 0.4 * activity;
          ctx.strokeStyle = `rgba(${accent}, ${ringAlpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, ring, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = `rgba(${accent}, ${0.85 * activity})`;
          ctx.fillText(n.label, n.x + 10, n.y - 10);
        }
      }
    };

    let lastTime = performance.now();
    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      if (!visible) {
        lastTime = now;
        return;
      }
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      mouse.vx = (mouse.x - mouse.prevX) / (dt * 1000 || 1);
      mouse.vy = (mouse.y - mouse.prevY) / (dt * 1000 || 1);
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;

      const speed = Math.hypot(mouse.vx, mouse.vy);
      activity = Math.min(1, activity + speed * 0.0016 + 0.05);
      activity *= Math.exp(-dt * 1.7);

      draw(dt);
    };

    const onActivity = (e: MouseEvent) => {
      /* any movement anywhere on the page wakes the field */
      activity = Math.min(1, activity + 0.12);
      void e;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousemove', onActivity);
    document.addEventListener('mouseleave', onMouseLeave);

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), {
      threshold: 0,
    });
    io.observe(canvas);

    const onVis = () => (visible = !document.hidden);
    document.addEventListener('visibilitychange', onVis);

    if (prefersReduced) {
      activity = 0.6;
      draw(0.016);
    } else {
      raf = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousemove', onActivity);
      document.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [density, accent, ink]);

  return <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />;
}
