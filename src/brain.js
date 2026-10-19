// Hero specimen: a procedural brain made of neuron points and synapse lines, with firing pulses.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const REGIONS = 12;
export function mountBrain({ canvas, handle }) {
  const lowEnd = matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Budget: ~1,500 neurons on phones / weak CPUs, 3,200 on desktop. DPR capped at 1 (mobile) / 1.5 (desktop).
  const N = lowEnd ? 1500 : 3200;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1 : 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0.6, 0.5, 5.4);
  const group = new THREE.Group(); scene.add(group);
  const tilt = new THREE.Group(); group.add(tilt);

  // ---- neuron positions ----
  const pos = new Float32Array(N * 3); const region = new Uint8Array(N); const seed = new Float32Array(N);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gyri = (x, y, z) => 0.055 * Math.sin(9.1 * x + 2.0 * Math.sin(5 * z)) * Math.sin(10.3 * y + 1.3) * Math.sin(8.2 * z + 3.1 * x) + 0.03 * Math.sin(17 * x + 13 * z);
  for (let i = 0; i < N; i++) {
    let x, y, z; const part = rnd();
    let u = rnd() * 2 - 1, th = rnd() * Math.PI * 2; let px = Math.sqrt(1 - u * u) * Math.cos(th), py = u, pz = Math.sqrt(1 - u * u) * Math.sin(th);
    if (part < 0.86) {
      const shell = rnd() < 0.84 ? 0.93 + rnd() * 0.07 : 0.35 + rnd() * 0.55;
      const r = shell * (1 + gyri(px, py, pz));
      const side = px >= 0 ? 1 : -1;
      x = side * (0.07 + Math.abs(px) * 0.92) * r; y = py * (py < 0 ? 0.66 : 0.92) * r; z = pz * 1.32 * r;
      if (y < -0.25 && Math.abs(z) < 0.5) y = -0.25 + (y + 0.25) * 0.4;           // flatten the base
      if (z > 0.6) y *= 0.92;                                                        // frontal lobe slope
    } else if (part < 0.96) {                                                        // cerebellum
      const r = 0.9 + rnd() * 0.1; const fol = 0.04 * Math.sin(40 * py);
      x = px * 0.62 * r; y = -0.52 + py * 0.27 * r + fol; z = -0.92 + pz * 0.38 * r;
    } else {                                                                         // brain stem
      const t = rnd(); const a = rnd() * Math.PI * 2; const rr = 0.13 * (1 - t * 0.3);
      x = Math.cos(a) * rr; z = -0.42 + Math.sin(a) * rr - t * 0.12; y = -0.45 - t * 0.7;
    }
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; seed[i] = rnd();
    const lon = Math.atan2(z, x) + Math.PI; region[i] = (Math.floor(lon / (Math.PI * 2) * 6) % 6) + (y > 0 ? 0 : 6);
  }

  // ---- synapses: link each neuron to its 2 nearest neighbours (spatial hash) ----
  const cell = lowEnd ? 0.22 : 0.18; const grid = new Map(); const key = (a, b, c) => a + ',' + b + ',' + c;
  for (let i = 0; i < N; i++) { const k = key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), Math.floor(pos[i * 3 + 2] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  const edges = []; const adj = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const cx = Math.floor(pos[i * 3] / cell), cy = Math.floor(pos[i * 3 + 1] / cell), cz = Math.floor(pos[i * 3 + 2] / cell);
    const best = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const j of grid.get(key(cx + a, cy + b, cz + c)) || []) {
        if (j <= i) continue; const dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz; if (d < cell * cell) best.push([d, j]);
      }
    }
    best.sort((p, q) => p[0] - q[0]);
    for (const [, j] of best.slice(0, lowEnd ? 1 : 2)) { edges.push(i, j); adj[i].push(j); adj[j].push(i); }
  }
  const linePos = new Float32Array(edges.length * 3);
  edges.forEach((n, k) => { linePos[k * 3] = pos[n * 3]; linePos[k * 3 + 1] = pos[n * 3 + 1]; linePos[k * 3 + 2] = pos[n * 3 + 2]; });
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  tilt.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1a17, transparent: true, opacity: lowEnd ? 0.16 : 0.12, depthWrite: false })));

  // ---- neurons ----
  const fire = new Float32Array(N); const active = new Int32Array(N); let nActive = 0; const isActive = new Uint8Array(N);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('fire', new THREE.BufferAttribute(fire, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const dotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() }, uDim: { value: 1 } },
    vertexShader: `attribute float fire; attribute float seed; uniform float uTime; uniform float uPx; varying float vF; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vF = fire;
        float tw = 0.55 + 0.45*sin(uTime*1.3 + seed*40.0); vA = tw;
        gl_PointSize = (1.5 + seed*1.3 + fire*4.0) * uPx * (3.2 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vF; varying float vA; uniform float uDim;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; float core = 1.0 - smoothstep(0.42, 0.5, d);
        vec3 base = vec3(0.10,0.10,0.09); vec3 hot = vec3(0.26,0.62,0.13);
        float f = clamp(vF,0.0,1.0); vec3 col = mix(base, hot, step(0.25, f)); float a = core * mix(0.42 + 0.3*vA, 1.0, f) * uDim; gl_FragColor = vec4(col, a); }`,
  });
  tilt.add(new THREE.Points(g, dotMat));

  // ---- pulses travelling along synapses ----
  const P = lowEnd ? 40 : 90; const pp = new Float32Array(P * 3); pp.fill(-99);
  const pa = new Int32Array(P), pb = new Int32Array(P), ph = new Int8Array(P), pt = new Float32Array(P), psp = new Float32Array(P); let nP = 0;
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage));
  const pulseMat = new THREE.PointsMaterial({ color: 0x3f9a1e, size: lowEnd ? 0.045 : 0.035, transparent: true, opacity: 1, depthWrite: false });
  tilt.add(new THREE.Points(pg, pulseMat));
  const spawn = (from, hops) => { if (nP >= P || !adj[from].length) return; const k = nP++; pa[k] = from; pb[k] = adj[from][(Math.random() * adj[from].length) | 0]; ph[k] = hops; pt[k] = 0; psp[k] = 2.2 + Math.random() * 2; };
  const ignite = (i, amt = 1) => { fire[i] = Math.min(1.4, fire[i] + amt); if (!isActive[i]) { isActive[i] = 1; active[nActive++] = i; } fireDirty = true; };
  let fireDirty = false; let fireAcc = 0;


  // ---- controls: drag to rotate (only on the hero handle), damping, auto-rotate ----
  const controls = new OrbitControls(camera, handle);
  controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enableZoom = false; controls.enablePan = false;
  controls.autoRotate = !reduce; controls.autoRotateSpeed = 0.55; controls.rotateSpeed = 0.6;
  controls.minPolarAngle = 0.5; controls.maxPolarAngle = 2.4;
  handle.style.touchAction = 'pan-y';

  const mouse = { x: 0, y: 0 }; let scroll = 0;
  addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; }, { passive: true });
  addEventListener('scroll', () => { scroll = Math.min(1, scrollY / innerHeight); }, { passive: true });
  let W = innerWidth, H = innerHeight; const resize = () => { const w = W = innerWidth, h = H = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  // pause when the tab is hidden or the canvas is off screen
  let onScreen = true; let visible = !document.hidden;
  new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; wake(); }).observe(canvas);

  let last = performance.now(); let ambient = 0; let spin = 0; let raf = 0; const v3 = new THREE.Vector3();
  function wake() { if (visible && onScreen && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; wake(); });
  function frame(t) {
    raf = 0; if (!visible || !onScreen) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    dotMat.uniforms.uTime.value = t / 1000;
    // random spontaneous firing
    ambient += dt; if (ambient > (lowEnd ? 0.12 : 0.07)) { ambient = 0; const i = (Math.random() * N) | 0; ignite(i, 0.8); spawn(i, 3 + ((Math.random() * 4) | 0)); }
    // firing decay: only touched neurons, uploaded at ~30 Hz
    fireAcc += dt;
    if (fireAcc >= 1 / 30 && (nActive || fireDirty)) {
      for (let j = nActive - 1; j >= 0; j--) { const i = active[j]; fire[i] -= fireAcc * 1.6; if (fire[i] <= 0) { fire[i] = 0; isActive[i] = 0; active[j] = active[--nActive]; } }
      g.attributes.fire.needsUpdate = true; fireDirty = false; fireAcc = 0;
    } else if (fireAcc >= 1 / 30) fireAcc = 0;
    // pulses: swap-remove in a fixed pool
    for (let k = nP - 1; k >= 0; k--) {
      pt[k] += dt * psp[k];
      if (pt[k] >= 1) { const b = pb[k], h = ph[k]; ignite(b, 0.9); const L = --nP; pa[k] = pa[L]; pb[k] = pb[L]; ph[k] = ph[L]; pt[k] = pt[L]; psp[k] = psp[L]; pp[L * 3 + 2] = -99; pp[L * 3] = pp[L * 3 + 1] = 0; if (h > 0) spawn(b, h - 1); }
    }
    for (let k = 0; k < nP; k++) { const a = pa[k] * 3, b = pb[k] * 3, q = pt[k]; pp[k * 3] = pos[a] + (pos[b] - pos[a]) * q; pp[k * 3 + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * q; pp[k * 3 + 2] = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * q; }
    pg.attributes.position.needsUpdate = true;
    // parallax + scroll choreography: the specimen drifts right and recedes as you read
    tilt.rotation.x += ((mouse.y * 0.25) - tilt.rotation.x) * 0.05; tilt.rotation.z += ((-mouse.x * 0.12) - tilt.rotation.z) * 0.05;
    const wide = W > 900; const T = api.target;
    const tx = T ? T.x : (wide ? 1.15 : 0) + scroll * (wide ? 0.9 : 0);
    const ty = T ? T.y : (wide ? 0 : 0.55) - scroll * 0.4;
    const ts = T ? T.s : (wide ? 1 : 0.78) * (1 - scroll * 0.18);
    const k = reduce ? 1 : 0.07;
    group.position.x += (tx - group.position.x) * k; group.position.y += (ty - group.position.y) * k;
    group.scale.setScalar(group.scale.x + (ts - group.scale.x) * k);
    if (T && T.spin != null) { spin += (T.spin - spin) * k; tilt.rotation.y = spin; }
    dotMat.uniforms.uDim.value += ((T ? T.dim : 1 - scroll * 0.45) - dotMat.uniforms.uDim.value) * 0.08;
    controls.update(); renderer.render(scene, camera);
    if (api.onFrame) {
      tilt.updateMatrixWorld();
      for (let n = 0; n < api.anchors.length; n++) { const i = api.anchors[n]; const o = api.points[n] || (api.points[n] = { x: 0, y: 0, front: true }); v3.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(tilt.matrixWorld).project(camera); o.x = (v3.x + 1) / 2 * W; o.y = (1 - v3.y) / 2 * H; o.front = v3.z < 1; }
      api.onFrame(api.points);
    }
    raf = requestAnimationFrame(frame);
  }
  // anchor neurons for callouts: one surface neuron per requested region, outermost first
  const anchorFor = (r) => {
    let cx = 0, cy = 0, cz = 0, n = 0; for (let i = 0; i < N; i++) if (region[i] === r) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; n++; }
    const L = Math.hypot(cx, cy, cz) || 1; cx /= L; cy /= L; cz /= L; let best = -1, bd = -2;
    for (let i = 0; i < N; i++) if (region[i] === r) { const l = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); if (l < 0.85) continue; const d = (pos[i * 3] * cx + pos[i * 3 + 1] * cy + pos[i * 3 + 2] * cz) / l; if (d > bd) { bd = d; best = i; } }
    return best;
  };
  const api = {
    target: null, onFrame: null, anchors: [], points: [],
    setAnchors(regions) { api.anchors = regions.map(anchorFor).filter((i) => i >= 0); },
    // light up one region (a preset / vote / steer) with a burst of pulses
    light(r, strength = 1) {
      const idx = []; for (let i = 0; i < N; i += 1) if (region[i] === ((r % REGIONS) + REGIONS) % REGIONS) idx.push(i);
      const n = Math.min(idx.length, Math.round(60 * strength));
      for (let k = 0; k < n; k++) { const i = idx[(Math.random() * idx.length) | 0]; ignite(i, 1.2); if (k % 3 === 0) spawn(i, 4); }
    },
    stats: { neurons: N, synapses: edges.length / 2 },
    reduce,
  };
  wake();
  return api;
}
export const regionFor = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % REGIONS; };
