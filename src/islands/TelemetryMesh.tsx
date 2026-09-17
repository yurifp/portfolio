import { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface MeshNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  radius: number;
  pulse: number;
  col: number;
  row: number;
}

const CURSOR_RADIUS = 140;

/**
 * Hero background mesh: a regular spring-mass grid that leans away from the
 * cursor. Decorative by contract — client:idle (never competes with LCP),
 * pointer-events: none, aria-hidden, paused while the tab is hidden or the
 * hero is offscreen. One frame source in the whole project: gsap.ticker,
 * the same one driving Lenis. prefers-reduced-motion renders a single
 * static frame; the physics never run.
 */
export default function TelemetryMesh({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Astro wraps islands in <astro-island> (display: contents — it measures
    // 0x0 and receives no pointer events). The real host is the nearest
    // positioned ancestor: the hero section.
    const host = canvas.offsetParent as HTMLElement | null;
    if (!host) return;
    const hostEl: HTMLElement = host;

    // Token colors — no hex in component code (triplets live in global.css)
    const styles = getComputedStyle(document.documentElement);
    const nodeRGB = styles.getPropertyValue('--color-node-rgb').trim() || '233, 238, 244';
    const amberRGB = styles.getPropertyValue('--color-amber-rgb').trim() || '242, 180, 65';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let spacing = 60;
    let nodes: MeshNode[] = [];
    const mouse = { x: -9999, y: -9999 };

    const indexOf = (i: number, j: number) => i * rows + j;

    function init() {
      const rect = hostEl.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      spacing = window.innerWidth < 768 ? 90 : 60;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(width / spacing) + 1;
      rows = Math.ceil(height / spacing) + 1;
      nodes = [];
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * spacing;
          const y = j * spacing;
          nodes.push({
            x,
            y,
            vx: 0,
            vy: 0,
            baseX: x,
            baseY: y,
            radius: 1.2,
            pulse: Math.random() * Math.PI * 2,
            col: i,
            row: j,
          });
        }
      }
    }

    function drawStatic() {
      ctx!.clearRect(0, 0, width, height);
      for (const n of nodes) {
        for (const [ni, nj] of neighborIndices(n)) {
          if (ni >= cols || nj >= rows) continue;
          const n2 = nodes[indexOf(ni, nj)];
          if (!n2) continue;
          ctx!.strokeStyle = `rgba(${nodeRGB}, 0.12)`;
          ctx!.lineWidth = 0.6;
          ctx!.beginPath();
          ctx!.moveTo(n.x, n.y);
          ctx!.lineTo(n2.x, n2.y);
          ctx!.stroke();
        }
      }
      for (const n of nodes) {
        ctx!.fillStyle = `rgba(${nodeRGB}, 0.25)`;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    // Right/down/diagonal neighbors only — O(n), never every-node-vs-every-node
    function neighborIndices(n: MeshNode): [number, number][] {
      return [
        [n.col + 1, n.row],
        [n.col, n.row + 1],
        [n.col + 1, n.row + 1],
      ];
    }

    const handleMove = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const handleLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    init();

    if (reduceMotion) {
      drawStatic();
      const onResizeStatic = () => {
        init();
        drawStatic();
      };
      window.addEventListener('resize', onResizeStatic);
      return () => window.removeEventListener('resize', onResizeStatic);
    }

    window.addEventListener('resize', init);
    hostEl.addEventListener('mousemove', handleMove);
    hostEl.addEventListener('mouseleave', handleLeave);

    // Two independent pause switches: hidden tab, hero scrolled out of view
    let pageVisible = !document.hidden;
    let heroInView = true;
    const onVisibility = () => {
      pageVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver(([entry]) => {
      heroInView = entry.isIntersecting;
    });
    io.observe(hostEl);

    let lastMs = performance.now();

    function frame(nowMs: number) {
      if (!pageVisible || !heroInView) {
        lastMs = nowMs;
        return;
      }
      const dt = Math.min((nowMs - lastMs) / 1000, 0.05);
      lastMs = nowMs;

      ctx!.clearRect(0, 0, width, height);

      const SPRING = 18;
      const DAMPING = 0.82;
      for (const n of nodes) {
        n.pulse += dt * 2;
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.hypot(dx, dy);
        if (dist < CURSOR_RADIUS && dist > 0) {
          const force = (1 - dist / CURSOR_RADIUS) * 900;
          const angle = Math.atan2(dy, dx);
          n.vx -= Math.cos(angle) * force * dt;
          n.vy -= Math.sin(angle) * force * dt;
        }
        n.vx += (n.baseX - n.x) * SPRING * dt;
        n.vy += (n.baseY - n.y) * SPRING * dt;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx * dt * 60;
        n.y += n.vy * dt * 60;
      }

      for (const n of nodes) {
        for (const [ni, nj] of neighborIndices(n)) {
          if (ni >= cols || nj >= rows) continue;
          const n2 = nodes[indexOf(ni, nj)];
          if (!n2) continue;
          const d = Math.hypot(n.x - n2.x, n.y - n2.y);
          const alpha = Math.max(0, 1 - d / (spacing * 1.6)) * 0.15;
          if (alpha <= 0) continue;
          ctx!.strokeStyle = `rgba(${nodeRGB}, ${alpha})`;
          ctx!.lineWidth = 0.6;
          ctx!.beginPath();
          ctx!.moveTo(n.x, n.y);
          ctx!.lineTo(n2.x, n2.y);
          ctx!.stroke();
        }
      }

      for (const n of nodes) {
        const near = Math.hypot(mouse.x - n.x, mouse.y - n.y) < CURSOR_RADIUS;
        // Amber marks confirmed interaction (cursor proximity) — never ambient
        ctx!.fillStyle = near
          ? `rgba(${amberRGB}, 0.9)`
          : `rgba(${nodeRGB}, ${0.2 + Math.sin(n.pulse) * 0.08})`;
        const r = near ? n.radius * 2 : n.radius;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    const tick = (timeSec: number) => frame(timeSec * 1000);
    gsap.ticker.add(tick);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('resize', init);
      hostEl.removeEventListener('mousemove', handleMove);
      hostEl.removeEventListener('mouseleave', handleLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    />
  );
}
