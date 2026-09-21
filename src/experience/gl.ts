import * as THREE from 'three';
import { experience } from './core';
import { getQuality, type Quality } from './settings';

/**
 * GL stage — the persistent WebGL layer that lives OUTSIDE the router.
 *
 * Rendering rules:
 *  - the ONLY render call happens inside experience.onFrame (single ticker);
 *  - reduced-motion → the stage never initializes (CSS gradient already covers);
 *  - quality 'low' → renders exactly ONE frame and stops (a static backdrop);
 *  - tab hidden → the frame callback early-returns, zero GPU work;
 *  - quality change → full dispose() and rebuild at the new budget.
 *
 * The shader below is step (a) of the plan: a fullscreen plane whose gradient
 * is driven by the shared scroll progress. The signal-field points (step b+)
 * will be added to this same scene later — the plumbing is already there.
 */

let disposeFns: Array<() => void> = [];

export function initGL() {
  if (experience.reducedMotion || disposeFns.length) return;

  const host = document.getElementById('gl-host');
  if (!host) return;

  // WebGL2 é o piso: sem ele, saímos em silêncio e o gradiente CSS do story
  // continua servindo de fundo (fallback declarado nos inegociáveis nº 5).
  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2', { antialias: false, alpha: true, powerPreference: 'high-performance' });
  if (!gl2) return;
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  // Câmera ortográfica em clip-space (-1..1): o plano cobre a tela exata,
  // então o shader trabalha em coordenadas de tela, não de mundo.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ── Uniforms compartilhados ────────────────────────────────────────────────
  // uTime       → relógio do ticker único (segundos)
  // uProgress   → o "uma variável": progresso 0→1 do storytelling
  // uVelocity   → |velocidade| do scroll suavizada (o Lenis alimenta isto)
  // uMouse      → cursor em -1..1 (y invertido: GL cresce para cima)
  // uRes        → resolução em px do buffer
  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uVelocity: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uRes: { value: new THREE.Vector2(1, 1) },
  };

  // ── Vertex shader ─────────────────────────────────────────────────────────
  // Passa a posição do plano direto para clip-space e entrega o uv ao fragment.
  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  // ── Fragment shader (passo a: gradiente vivo) ─────────────────────────────
  // Fundo abissal que respira: gradiente vertical profundo, um brilho âmbar
  // que percorre a tela conforme o progresso do storytelling, e um shimmer
  // sutil acoplado à VELOCIDADE do scroll (a assinatura do motion).
  const fragmentShader = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uProgress;
    uniform float uVelocity;
    uniform vec2  uMouse;
    uniform vec2  uRes;

    // hash 1D barato: ruído determinístico para variar o shimmer por coluna
    float hash(float n) { return fract(sin(n) * 43758.5453123); }

    void main() {
      // uv com aspecto corrigido (0..1 em x, proporção real em y)
      float aspect = uRes.x / uRes.y;
      vec2 uv = vec2(vUv.x * aspect, vUv.y);

      // 1) gradiente vertical: abissal no topo → azul-sinal embaixo,
      //    escurecendo levemente conforme o progresso avança (descida narrativa)
      vec3 top = vec3(0.047, 0.078, 0.125);
      vec3 bottom = vec3(0.031, 0.063, 0.11) + uProgress * 0.012;
      vec3 col = mix(top, bottom, vUv.y);

      // 2) brilho âmbar de sinal: orbita a tela com o progresso, pulsa devagar
      //    no tempo — é o "farol" da estação atual da narrativa
      float gx = 0.3 + uProgress * 0.4 + sin(uTime * 0.21) * 0.05;
      float gy = 0.72 - uProgress * 0.5;
      float d = distance(uv, vec2(gx * aspect, gy));
      float glow = exp(-d * 3.2) * (0.16 + 0.05 * sin(uTime * 0.7));
      col += vec3(0.95, 0.71, 0.25) * glow;

      // 3) shimmer acoplado ao scroll: faixas horizontais fracas que se acendem
      //    quando o usuário rola rápido (uVelocity ~0..1) — dado vivo, não decoração
      float band = sin(vUv.y * 90.0 + uTime * 2.0) * 0.5 + 0.5;
      col += vec3(0.95, 0.71, 0.25) * band * uVelocity * 0.05;

      // 4) mouse: um halo discreto segue o cursor (a malha 2D atual, em versão GL)
      float md = distance(uv, vec2(uMouse.x * aspect, uMouse.y));
      col += vec3(0.91, 0.93, 0.96) * exp(-md * 5.0) * 0.035;

      // 5) leve granulado para evitar banding em gradientes escuros
      float grain = (hash(vUv.x * uRes.x + uTime) - 0.5) * 0.012;
      col += grain;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(mesh);

  // ── Quality → DPR ─────────────────────────────────────────────────────────
  function applyQuality(q: Quality) {
    const dpr = q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : q === 'medium' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
    renderer.setPixelRatio(dpr);
    resize();
  }

  function resize() {
    const w = host!.clientWidth || window.innerWidth;
    const h = host!.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }

  // ── Mouse suavizado (mesma inércia do velocity) ───────────────────────────
  const mouseTarget = new THREE.Vector2(-10, -10);
  function onMouse(e: MouseEvent) {
    mouseTarget.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      1 - (e.clientY / window.innerHeight) * 2,
    );
  }
  window.addEventListener('mousemove', onMouse, { passive: true });

  // ── Frame: a única render call do site ────────────────────────────────────
  let hidden = document.hidden;
  let quality = getQuality();
  let staticFrameDone = false;
  const onVis = () => { hidden = document.hidden; };
  document.addEventListener('visibilitychange', onVis);

  const unframe = experience.onFrame((dt, t) => {
    if (hidden) return; // aba oculta → zero GPU
    if (quality === 'low' && staticFrameDone) return; // low = 1 frame e para

    uniforms.uTime.value = t;
    uniforms.uProgress.value = experience.state.progress;
    uniforms.uVelocity.value = experience.velocity;
    uniforms.uMouse.value.lerp(mouseTarget, 0.08); // suavização do cursor
    renderer.render(scene, camera);
    staticFrameDone = true;
  });

  function rebuild(q: Quality) {
    quality = q;
    staticFrameDone = false;
    applyQuality(q);
  }
  const onQuality = (e: Event) => rebuild((e as CustomEvent<Quality>).detail);
  window.addEventListener('qualitychange', onQuality);

  const onResize = () => resize();
  window.addEventListener('resize', onResize, { passive: true });

  applyQuality(quality);
  resize();

  // ── dispose(): geometria, material, listeners, renderer — nada vaza ──────
  disposeFns = [
    () => unframe(),
    () => window.removeEventListener('mousemove', onMouse),
    () => document.removeEventListener('visibilitychange', onVis),
    () => window.removeEventListener('qualitychange', onQuality),
    () => window.removeEventListener('resize', onResize),
    () => {
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  ];
}

/** Full teardown — usado no rebuild de qualidade e (futuro) unmount de HMR */
export function disposeGL() {
  disposeFns.forEach((fn) => fn());
  disposeFns = [];
}
