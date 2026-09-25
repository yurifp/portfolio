import * as THREE from 'three';
import { experience } from './core';
import { getQuality, type Quality } from './settings';

/**
 * GL stage — persistent WebGL layer, mounted OUTSIDE the router.
 *
 * Two passes share the single ticker (experience.onFrame):
 *   pass 1  fullscreen gradient plane  (orthographic, clip-space)
 *   pass 2  signal-field points        (perspective, camera driven by progress)
 *
 * Rules honored here:
 *  - ONE render loop for the whole site (the shared gsap ticker);
 *  - reduced-motion → stage never boots (CSS gradient covers);
 *  - quality 'low' → one static frame, points hidden;
 *  - hidden tab → zero GPU work;
 *  - quality change → full dispose() + rebuild at the new density.
 */

let disposeFns: Array<() => void> = [];

export function initGL() {
  if (experience.reducedMotion || disposeFns.length) return;
  const host = document.getElementById('gl-host');
  if (!host) return;

  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2', { antialias: false, alpha: true, powerPreference: 'high-performance' });
  if (!gl2) return; // no WebGL2 → silent exit, CSS gradient stays as backdrop
  host.appendChild(canvas);

  // Context registry — browsers cap simultaneous WebGL contexts (~8-16).
  // window.__webglContexts must stay at 1 for the whole site; the regression
  // test toggles Quality repeatedly and asserts exactly that.
  const W = window as typeof window & { __webglContexts?: number };
  W.__webglContexts = (W.__webglContexts ?? 0) + 1;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  const sceneBG = new THREE.Scene();
  const camBG = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sceneField = new THREE.Scene();
  const camField = new THREE.PerspectiveCamera(42, 1, 0.1, 20);

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uVelocity: { value: 0 },
    uMouse: { value: new THREE.Vector2(-10, -10) },
    uRes: { value: new THREE.Vector2(1, 1) },
    // 0 inside the story, →1 past it: the field stays alive behind the body,
    // sparser (smaller, dimmer points) so content stays readable.
    uBody: { value: 0 },
  };

  // ───────────────────────── PASS 1: gradient plane ─────────────────────────
  const quadVert = /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;
  // Fundo abissal + farol âmbar que desce com o progresso + shimmer pela
  // velocidade do scroll + halo do mouse + grão anti-banding.
  const quadFrag = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime, uProgress, uVelocity;
    uniform vec2 uMouse, uRes;
    float hash(float n) { return fract(sin(n) * 43758.5453123); }
    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 uv = vec2(vUv.x * aspect, vUv.y);

      vec3 top = vec3(0.047, 0.078, 0.125);
      vec3 bottom = vec3(0.031, 0.063, 0.11) + uProgress * 0.012;
      vec3 col = mix(top, bottom, vUv.y);

      float gx = 0.3 + uProgress * 0.4 + sin(uTime * 0.21) * 0.05;
      float gy = 0.72 - uProgress * 0.5;
      float d = distance(uv, vec2(gx * aspect, gy));
      col += vec3(0.95, 0.71, 0.25) * exp(-d * 3.2) * (0.16 + 0.05 * sin(uTime * 0.7));

      float band = sin(vUv.y * 90.0 + uTime * 2.0) * 0.5 + 0.5;
      col += vec3(0.95, 0.71, 0.25) * band * uVelocity * 0.05;

      float md = distance(uv, vec2(uMouse.x * aspect, uMouse.y));
      col += vec3(0.91, 0.93, 0.96) * exp(-md * 5.0) * 0.035;

      col += (hash(vUv.x * uRes.x + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  const quadMat = new THREE.ShaderMaterial({ uniforms, vertexShader: quadVert, fragmentShader: quadFrag, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  sceneBG.add(quad);

  // ───────────────────────── PASS 2: signal field ───────────────────────────
  // Densidade por qualidade: high 130² ≈ 17k pontos, medium 80² ≈ 6.4k.
  const quality = getQuality();
  const N = quality === 'high' ? 130 : 80;
  const COUNT = N * N;

  // Grade em XZ (x,z ∈ ~[-1.4, 1.4]); a elevação é 100% procedural no shader.
  const positions = new Float32Array(COUNT * 3);
  const rands = new Float32Array(COUNT);
  let i = 0;
  for (let ix = 0; ix < N; ix++) {
    for (let iz = 0; iz < N; iz++) {
      positions[i * 3] = (ix / (N - 1)) * 2.8 - 1.4;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = (iz / (N - 1)) * 2.8 - 1.4;
      rands[i] = Math.random();
      i++;
    }
  }
  const fieldGeo = new THREE.BufferGeometry();
  fieldGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  fieldGeo.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));

  const fieldUniforms = {
    ...uniforms,
    uSize: { value: quality === 'high' ? 2.2 : 2.7 },
    uPixelRatio: { value: 1 },
  };

  // VERTEX — as quatro "estações" do signal field. Cada função devolve a
  // elevação y para um ponto (x,z); o progresso do storytelling (0→1,
  // escalado para 0→4) mistura as formas com sinos sobrepostos: é o morph.
  const fieldVert = /* glsl */ `
    attribute float aRand;
    uniform float uTime, uProgress, uVelocity, uSize, uPixelRatio, uBody;
    uniform vec2 uMouse;
    varying float vCrest;   // crista da onda → realce âmbar no fragment
    varying float vNear;    // proximidade do cursor → âmbar de interação
    varying float vFade;    // atenuação por distância de câmera

    // Peso da estação k: sino triangular — estações vizinhas se cruzam,
    // então o morph é contínuo, sem degrau.
    float stationW(float k, float t) { return clamp(1.0 - abs(t - k), 0.0, 1.0); }

    // Estação 0/1 — CAMPO: ondas suaves + anel viajando do centro
    float fieldY(float x, float z) {
      float w = 0.05 * sin(x * 6.0 + uTime * 0.8)
              + 0.05 * cos(z * 5.0 - uTime * 0.6);
      float r = length(vec2(x, z));
      w += 0.09 * sin(r * 8.0 - uTime * 2.0) * exp(-r * 1.1);
      return w;
    }

    // Estação 2 — ARCO (Impacts): crista exponencial sobre a trajetória
    // parabólica de um asteroide z = 0.45 − 0.5x²; tudo fora do curso
    // assenta no chão — é o "rastro" do impacto.
    float arcY(float x, float z) {
      float zc = 0.45 - 0.5 * x * x;
      float d2 = (z - zc) * (z - zc);
      float ridge = 1.05 * exp(-d2 * 34.0);
      ridge *= exp(-x * x * 1.1);              // afinamento nas pontas
      ridge *= 1.0 + 0.08 * sin(uTime * 3.0 + x * 10.0); // vibração do vínculo
      return ridge;
    }

    // Estação 3 — OCEANO (GlobeExplorers): três senos direcionais
    // sobrepostos, como uma superfície de água vista de cima.
    float oceanY(float x, float z) {
      return 0.11 * sin(x * 7.0 + uTime)
           + 0.09 * sin(z * 9.0 - uTime * 1.3)
           + 0.05 * sin((x + z) * 5.0 + uTime * 0.7);
    }

    // Estação 4 — GRID (servidor): células discretas com alturas fixas por
    // hash — um piso de racks; o topo de cada célula pulsa devagar.
    float gridY(float x, float z) {
      float c = floor((x + 1.4) / 2.8 * 9.0);
      float r = floor((z + 1.4) / 2.8 * 9.0);
      float h = fract(sin(c * 127.1 + r * 311.7) * 43758.5453);
      return 0.1 + h * 0.28 + 0.03 * sin(uTime * 1.5 + h * 6.2831);
    }

    void main() {
      // 3 beats, 4 shapes em t = 0..3: campo (beat 1), arco→oceano (beat NASA,
      // o morph acontece no meio), e o GRID de chips no beat final — o look
      // de placa de circuito mora exatamente na última estação.
      float t = uProgress * 3.0;               // 0..3 em unidades de estação
      float wF = stationW(0.0, t);
      float wA = stationW(1.0, t);
      float wO = stationW(2.0, t);
      float wG = stationW(3.0, t);

      // Velocidade do scroll "agita" o meio: ondas mais altas quando rola
      float amp = 1.0 + uVelocity * 0.9;

      float x = position.x, z = position.z;
      float elev = fieldY(x, z) * wF * amp
                 + arcY(x, z)  * wA
                 + oceanY(x, z) * wO * amp
                 + gridY(x, z) * wG;

      // Cursor: ondulação local (sempre ativa) — o "dedo na água"
      vec2 mw = vec2(uMouse.x * 1.4, -uMouse.y * 1.0);
      float dm = distance(vec2(x, z), mw);
      float ripple = 0.16 * exp(-dm * dm * 16.0) * sin(dm * 14.0 - uTime * 3.0);
      elev += ripple;
      vNear = exp(-dm * dm * 9.0);

      vec3 p = vec3(x, elev, z);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;

      // Tamanho do ponto: atenuação por profundidade + destaque em crista/
      // proximidade (o âmbar "acende" maior antes mesmo da cor mudar)
      vCrest = smoothstep(0.06, 0.4, elev);
      float s = uSize * (1.0 + vNear * 1.4 + vCrest * 0.7);
      s *= mix(1.0, 0.55, uBody); // sparser behind the body sections
      gl_PointSize = s * uPixelRatio * (2.6 / -mv.z);
      vFade = clamp(1.6 - (-mv.z) * 0.32, 0.15, 1.0);

      // jitter sutil por ponto (aRand) evita padrão de grade mecânico
      gl_PointSize *= 0.85 + aRand * 0.3;
    }
  `;

  // FRAGMENT — círculo macio; tinta neutra por padrão; âmbar APENAS em
  // crista (dado) ou perto do cursor (interação confirmada) — a regra
  // semântica da paleta, aplicada no shader.
  const fieldFrag = /* glsl */ `
    precision highp float;
    uniform float uBody;
    varying float vCrest, vNear, vFade;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;                    // sprite circular, sem quadradinho
      float soft = smoothstep(0.5, 0.12, d);

      vec3 ink = vec3(0.914, 0.933, 0.957);    // --color-ink
      vec3 amber = vec3(0.949, 0.706, 0.255);  // --color-signal

      float hot = max(vCrest, vNear);
      vec3 col = mix(ink, amber, hot);
      float alpha = soft * vFade * (0.32 + hot * 0.6);
      alpha *= mix(1.0, 0.35, uBody); // dimmer, never fighting the content
      gl_FragColor = vec4(col, alpha);
    }
  `;

  const fieldMat = new THREE.ShaderMaterial({
    uniforms: fieldUniforms,
    vertexShader: fieldVert,
    fragmentShader: fieldFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(fieldGeo, fieldMat);
  points.visible = quality !== 'low';
  sceneField.add(points);

  // ───────────────────────── sizing / quality ───────────────────────────────
  function applyQuality(q: Quality) {
    const dpr = q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : q === 'medium' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
    renderer.setPixelRatio(dpr);
    fieldUniforms.uPixelRatio.value = dpr;
    resize();
  }

  function resize() {
    const w = host!.clientWidth || window.innerWidth;
    const h = host!.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camField.aspect = w / h;
    camField.updateProjectionMatrix();
    uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }

  // ───────────────────────── input ──────────────────────────────────────────
  const mouseTarget = new THREE.Vector2(-10, -10);
  function onMouse(e: MouseEvent) {
    mouseTarget.set((e.clientX / window.innerWidth) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2);
  }
  window.addEventListener('mousemove', onMouse, { passive: true });

  // ───────────────────────── the single render loop ─────────────────────────
  let hidden = document.hidden;
  let staticDone = false;
  const onVis = () => { hidden = document.hidden; };
  document.addEventListener('visibilitychange', onVis);
  // No viewport IntersectionObserver anymore: the field is the site's
  // persistent backdrop (bodyFade dims it past the story), so it renders
  // wherever the user is. Hidden-tab pause still applies.

  // Câmera governada pelo MESMO progresso: leve órbita + arco de altura que
  // mergulha no campo no meio da narrativa e recua para encarar o grid final.
  function cameraFor(p: number) {
    const yaw = p * 0.6;
    const dist = 3.4 - Math.sin(p * Math.PI) * 0.7;
    const height = 1.95 - Math.sin(p * Math.PI) * 1.05;
    camField.position.set(Math.sin(yaw) * dist, height, Math.cos(yaw) * dist);
    camField.lookAt(0, 0.32, 0);
  }

  const unframe = experience.onFrame((dt, t) => {
    if (hidden) return;
    if (quality === 'low' && staticDone) return;

    uniforms.uTime.value = t;
    uniforms.uProgress.value = experience.state.progress;
    uniforms.uVelocity.value = experience.velocity;
    uniforms.uBody.value = experience.state.bodyFade;
    uniforms.uMouse.value.lerp(mouseTarget, 0.08);
    cameraFor(experience.state.progress);

    renderer.autoClear = true;
    renderer.render(sceneBG, camBG);      // pass 1: gradiente
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(sceneField, camField); // pass 2: pontos
    renderer.autoClear = true;
    if (!staticDone) window.dispatchEvent(new Event('gl:firstframe')); // preloader signal
    staticDone = true;
  });

  const onQuality = () => { disposeGL(); initGL(); }; // rebuild at new density
  window.addEventListener('qualitychange', onQuality);
  const onResize = () => resize();
  window.addEventListener('resize', onResize, { passive: true });

  applyQuality(quality);
  resize();

  disposeFns = [
    () => unframe(),
    () => window.removeEventListener('mousemove', onMouse),
    () => document.removeEventListener('visibilitychange', onVis),
    () => window.removeEventListener('qualitychange', onQuality),
    () => window.removeEventListener('resize', onResize),
    () => {
      quad.geometry.dispose();
      quadMat.dispose();
      fieldGeo.dispose();
      fieldMat.dispose();
      // traverse visits the Scene itself (no material) — guard before .map
      const disposeTextures = (root: THREE.Object3D) => {
        root.traverse((obj) => {
          const mat = (obj as THREE.Mesh).material as
            | (THREE.Material & { map?: THREE.Texture })
            | undefined;
          mat?.map?.dispose();
        });
      };
      disposeTextures(sceneBG);
      disposeTextures(sceneField);
      renderer.dispose();
      canvas.remove();
      const W = window as typeof window & { __webglContexts?: number };
      if (W.__webglContexts) W.__webglContexts -= 1;
    },
  ];
}

export function disposeGL() {
  disposeFns.forEach((fn) => fn());
  disposeFns = [];
}
