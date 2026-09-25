/*
  Hero signal field — Three.js Points with a drift shader.
  Lime/violet/cyan dust over the void, breathing with time,
  parallaxed by pointer, scrubbed by scroll.
*/
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const COUNT = 7000;
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountHeroField(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
  camera.position.z = 11;

  /* positions on 4 shells — depth banding reads as a field, not fog */
  const pos = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  const shell = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const s = i % 4;
    const r = 2.6 + s * 2.1 + Math.random() * 1.4;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.62;
    pos[i * 3 + 2] = r * Math.cos(ph);
    seed[i] = Math.random();
    shell[i] = s / 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uLime: { value: new THREE.Color('#9df133') },
      uViolet: { value: new THREE.Color('#905cff') },
      uCyan: { value: new THREE.Color('#64e8ff') },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aShell;
      uniform float uTime;
      uniform float uScroll;
      uniform vec2 uPointer;
      varying float vSeed;
      varying float vShell;
      varying float vFade;
      void main() {
        vSeed = aSeed;
        vShell = aShell;
        vec3 p = position;
        float t = uTime * (0.12 + aShell * 0.22);
        p.x += sin(t + aSeed * 6.2831) * 0.35;
        p.y += cos(t * 1.3 + aSeed * 4.1) * 0.35 + uScroll * (1.5 + aShell * 2.0);
        p.z += sin(t * 0.7 + aSeed * 9.4) * 0.3;
        p.x += uPointer.x * (0.4 + aShell * 0.8);
        p.y += uPointer.y * (0.4 + aShell * 0.8);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        gl_PointSize = (1.6 + aSeed * 2.6) * (9.0 / dist);
        vFade = smoothstep(26.0, 6.0, dist);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLime;
      uniform vec3 uViolet;
      uniform vec3 uCyan;
      varying float vSeed;
      varying float vShell;
      varying float vFade;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float disc = smoothstep(0.5, 0.12, d);
        vec3 col = mix(uLime, uViolet, vShell);
        col = mix(col, uCyan, step(0.82, vSeed));
        float alpha = disc * (0.25 + vSeed * 0.55) * vFade;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  /* resize */
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  /* pointer parallax */
  const pointer = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    pointer.x = (e.clientX / innerWidth - 0.5) * 2;
    pointer.y = -(e.clientY / innerHeight - 0.5) * 2;
  };
  addEventListener('pointermove', onMove, { passive: true });

  /* scroll scrub */
  const st = ScrollTrigger.create({
    trigger: canvas.closest('section') ?? canvas,
    start: 'top top',
    end: 'bottom top',
    onUpdate(self) {
      mat.uniforms.uScroll.value = self.progress * 2.2;
    },
  });

  /* render loop */
  let raf = 0;
  const clock = new THREE.Clock();
  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 });
  io.observe(canvas);
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    const px = mat.uniforms.uPointer.value as THREE.Vector2;
    px.lerp(new THREE.Vector2(pointer.x, pointer.y), 0.05);
    if (!prefersReduced) mat.uniforms.uTime.value = clock.getElapsedTime();
    points.rotation.y = mat.uniforms.uTime.value * 0.024 + px.x * 0.1;
    points.rotation.x = px.y * 0.08;
    renderer.render(scene, camera);
  };
  loop();

  /* first frame marks the preloader's WebGL milestone */
  dispatchEvent(new CustomEvent('field:gl-frame'));

  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    removeEventListener('resize', resize);
    removeEventListener('pointermove', onMove);
    st.kill();
    geo.dispose();
    mat.dispose();
    renderer.dispose();
  };
}
