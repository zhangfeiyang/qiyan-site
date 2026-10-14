import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const W = 1080, H = 1920;
const QS = new URLSearchParams(location.search);
const SCALE = parseFloat(QS.get('scale') || '1');

// ------------------------------------------------------------------ utils
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutBack = (x) => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBounce = (x) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// monotone cubic (Fritsch–Carlson) through [x, y] keys: smooth, no overshoot
function mono(keys) {
  const n = keys.length, xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const C = (h) => new THREE.Color(h);
const mixC = (a, b, t) => new THREE.Color().copy(a).lerp(b, clamp(t));
function tri(day, dusk, night, u) { return u <= 1 ? mixC(day, dusk, sstep(0, 1, u)) : mixC(dusk, night, sstep(1, 2, u)); }
function seasonal(q, cols) { // cols at season midpoints 0.5,1.5,2.5,3.5 (cyclic)
  const x = q - 0.5 + 4, i = Math.floor(x) % 4, f = x - Math.floor(x);
  return mixC(cols[i], cols[(i + 1) % 4], sstep(0, 1, f));
}

// ------------------------------------------------------------------ timeline
// video time t (0..60). 0–1.8s hook (golden tree), 1.8–3.0 rewind, then story time T = t - 3.
const HOOK_HOLD = 1.8, HOOK_END = 3.0, T_HERO = 42.0, HOOK_RATE = 0.35;
function storyTime(t) {
  if (t < HOOK_HOLD) return T_HERO + t * HOOK_RATE;
  if (t < HOOK_END) return lerp(T_HERO + HOOK_HOLD * HOOK_RATE, 0, easeInOutCubic((t - HOOK_HOLD) / (HOOK_END - HOOK_HOLD)));
  return t - HOOK_END;
}
const yearF = mono([[0, 1925], [5.5, 1925], [15, 1952], [17.5, 1952], [21, 1958], [27, 1979], [28, 1980], [33, 1980], [39, 2010], [40.5, 2024], [45, 2024], [46.5, 2025], [57, 2025]]);
const seasonF = mono([[0, 0.08], [6, 0.5], [15, 12.6], [21, 13.3], [27, 21.3], [33, 21.75], [39, 29.75], [45, 31.0], [51, 31.55], [57, 31.8]]);
const growF = mono([[0, 0], [5.6, 0], [6.6, 0.03], [15, 0.34], [21, 0.5], [27, 0.62], [33, 0.68], [39, 0.87], [41, 0.95], [57, 1]]);
const todF = mono([[0, 0], [27, 0], [28.2, 1], [29.1, 2], [32.2, 2], [33.3, 0.9], [34.2, 0], [45, 0], [46.0, 1], [47.0, 2], [57, 2]]);
const tiltF = mono([[0, 7.5], [5, 7], [9, 4], [15, 3.2], [27, 4.5], [38, 4.5], [41, 2.4], [44, 1.6], [46, 2.6], [57, 3.6]]);

const CK = [ // T, r, y, ty, theta(deg), fov
  [0, 2.1, 0.55, 0.12, -40, 36], [4, 2.6, 0.75, 0.3, -30, 38], [7, 5.5, 1.7, 1.4, -16, 42], [11, 12, 4.6, 3.3, 0, 45],
  [15, 21, 8, 4.6, 15, 46], [18, 29, 11.5, 5, 25, 46], [22, 41, 22, 5, 40, 46], [27, 58, 36, 3, 58, 46],
  [30, 52, 28, 4, 70, 46], [33, 50, 30, 5, 80, 46], [38, 46, 26, 7, 95, 46], [41, 31, 8.5, 10, 108, 48],
  [43.5, 23, 2.4, 10.5, 122, 54], [46, 28, 8, 9.5, 138, 50], [50, 46, 19, 13, 155, 50], [54, 62, 30, 12, 168, 50], [57, 80, 44, 10, 178, 50],
];
const camF = [1, 2, 3, 4, 5].map((j) => mono(CK.map((k) => [k[0], k[j]])));
const storyCam = (T) => ({ r: camF[0](T), y: camF[1](T), ty: camF[2](T), th: camF[3](T), fov: camF[4](T) });
const HOOK_CAM = { r: 31, y: 6.5, ty: 10.5, th: 96, fov: 50 };
function camAt(t) {
  if (t < HOOK_END) {
    const a = { ...HOOK_CAM, th: HOOK_CAM.th + Math.min(t, HOOK_HOLD) * 3, r: HOOK_CAM.r - Math.min(t, HOOK_HOLD) * 1.2 };
    if (t < HOOK_HOLD) return a;
    const b = storyCam(0), u = easeInOutCubic((t - HOOK_HOLD) / (HOOK_END - HOOK_HOLD));
    const pa = Math.atan2(a.y - a.ty, a.r), pb = Math.atan2(b.y - b.ty, b.r);
    const r = Math.exp(lerp(Math.log(a.r), Math.log(b.r), u)), ty = lerp(a.ty, b.ty, u);
    return { r, ty, y: ty + r * Math.tan(lerp(pa, pb, u)), th: lerp(a.th, b.th, u), fov: lerp(a.fov, b.fov, u) };
  }
  return storyCam(t - HOOK_END);
}
function camPos(c) { const th = (c.th * Math.PI) / 180; return new THREE.Vector3(c.r * Math.sin(th), c.y, c.r * Math.cos(th)); }

function stateAt(T) {
  const st = { T, year: yearF(T), p: seasonF(T), g: growF(T), u: todF(T) };
  const q = ((st.p % 4) + 4) % 4, s = Math.floor(q), f = q - s;
  Object.assign(st, { q, s, f });
  st.L = s === 0 ? sstep(0.05, 0.75, f) : s === 1 ? 1 : s === 2 ? 1 - sstep(0.5, 0.97, f) : 0;
  st.gold = s === 2 ? sstep(0.0, 0.42, f) : 0;
  st.fresh = s === 0 ? 1 - sstep(0.3, 1.0, f) : 0;
  st.fall = s === 2 ? (sstep(0.2, 0.36, f) * 0.3 + sstep(0.46, 0.6, f) * 0.7) * (1 - sstep(0.93, 1.0, f)) : 0;
  st.snowFall = s === 3 ? sstep(0, 0.12, f) * (1 - sstep(0.8, 0.97, f)) : 0;
  st.snow = s === 3 ? sstep(0.02, 0.3, f) * (1 - sstep(0.82, 1.0, f)) : 0;
  st.carpet = s === 2 ? sstep(0.45, 0.95, f) : s === 3 ? 1 - sstep(0.0, 0.5, f) : 0;
  st.night = sstep(0.9, 1.8, st.u);
  st.dusk = 1 - Math.abs(clamp(st.u, 0, 2) - 1);
  return st;
}

// ------------------------------------------------------------------ renderer / scene
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(SCALE);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdfe7ee, 120, 640);
const camera = new THREE.PerspectiveCamera(45, W / H, 0.05, 2600);

function canvasTex(size, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function wrapBlob(x, s, cx, cy, r) { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { x.beginPath(); x.arc(cx + ox, cy + oy, r, 0, 7); x.fill(); } }

const grassTex = canvasTex(512, (x, s) => {
  const R = rng(11);
  x.fillStyle = '#dcdcdc'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 90; i++) { const v = (165 + R() * 70) | 0; x.globalAlpha = 0.22; x.fillStyle = `rgb(${v},${v},${v})`; wrapBlob(x, s, R() * s, R() * s, 12 + R() * 46); }
  x.globalAlpha = 1;
  for (let i = 0; i < 14000; i++) { const v = (160 + R() * 95) | 0; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(R() * s, R() * s, 1 + R() * 2, 2 + R() * 5); }
}, { repeat: true });
grassTex.repeat.set(110, 110);

const dirtTex = canvasTex(256, (x, s) => {
  const R = rng(5);
  x.fillStyle = '#b39a76'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 5000; i++) { const v = R(); x.fillStyle = v < 0.5 ? 'rgba(90,70,50,0.35)' : 'rgba(230,215,190,0.35)'; x.fillRect(R() * s, R() * s, 1 + R() * 3, 1 + R() * 3); }
  x.strokeStyle = 'rgba(80,60,40,0.25)'; x.lineWidth = 3;
  for (const px of [0.3, 0.7]) { x.beginPath(); x.moveTo(px * s, 0); x.lineTo(px * s, s); x.stroke(); }
}, { repeat: true });
const asphaltTex = canvasTex(256, (x, s) => {
  const R = rng(6);
  x.fillStyle = '#56595d'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 6000; i++) { const v = (60 + R() * 70) | 0; x.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; x.fillRect(R() * s, R() * s, 1 + R() * 2, 1 + R() * 2); }
  x.fillStyle = '#e9e6dc'; x.fillRect(s * 0.485, s * 0.08, s * 0.03, s * 0.42);
  x.fillStyle = 'rgba(235,232,222,0.9)'; x.fillRect(s * 0.04, 0, s * 0.02, s); x.fillRect(s * 0.94, 0, s * 0.02, s);
}, { repeat: true });
const concreteTex = canvasTex(256, (x, s) => {
  const R = rng(8);
  x.fillStyle = '#b8b5ae'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 4000; i++) { const v = (150 + R() * 80) | 0; x.fillStyle = `rgba(${v},${v},${v},0.4)`; x.fillRect(R() * s, R() * s, 1 + R() * 2, 1 + R() * 2); }
  x.fillStyle = 'rgba(90,90,90,0.5)'; x.fillRect(0, 0, s, 2);
}, { repeat: true });
const fieldTex = canvasTex(256, (x, s) => {
  const R = rng(9);
  x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#f2f2f2' : '#d6d6d6'; x.fillRect(0, (i * s) / 16, s, s / 16 - 3); }
  for (let i = 0; i < 3000; i++) { const v = (150 + R() * 100) | 0; x.fillStyle = `rgba(${v},${v},${v},0.4)`; x.fillRect(R() * s, R() * s, 1, 3); }
});
const plazaTex = canvasTex(512, (x, s) => {
  const R = rng(10);
  x.fillStyle = '#9d978c'; x.fillRect(0, 0, s, s);
  const n = 8, cs = s / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = (175 + R() * 35) | 0; x.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    x.fillRect(i * cs + 3, j * cs + 3, cs - 6, cs - 6);
  }
}, { repeat: true });
const barkTex = canvasTex(256, (x, s) => {
  const R = rng(12);
  x.fillStyle = '#8d8178'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 260; i++) { const v = (70 + R() * 80) | 0; x.strokeStyle = `rgba(${v},${v - 6},${v - 12},0.55)`; x.lineWidth = 1 + R() * 4; const px = R() * s; x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + (R() - 0.5) * 20, s * 0.3, px + (R() - 0.5) * 20, s * 0.6, px + (R() - 0.5) * 10, s); x.stroke(); }
}, { repeat: true });
const leafTex = canvasTex(128, (x) => {
  x.translate(64, 122);
  x.fillStyle = '#ffffff';
  x.beginPath(); x.moveTo(-2, -10);
  const N = 70;
  for (let i = 0; i <= N; i++) {
    const a = lerp(-1.08, 1.08, i / N);
    let R = 104 + 5 * Math.sin(i * 1.3) + 3 * Math.sin(i * 3.1);
    const ad = Math.abs(a);
    if (ad < 0.1) R -= 26 * (1 - ad / 0.1);
    x.lineTo(Math.sin(a) * R, -10 - Math.cos(a) * R * 0.86);
  }
  x.lineTo(2, -10); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.10)'; x.lineWidth = 1;
  for (let i = 0; i < 22; i++) { const a = lerp(-1.0, 1.0, i / 21); x.beginPath(); x.moveTo(0, -10); x.lineTo(Math.sin(a) * 98, -10 - Math.cos(a) * 84); x.stroke(); }
  x.fillStyle = '#e8e8e8'; x.fillRect(-1.5, -12, 3, 14);
});
const spriteTex = canvasTex(64, (x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
}, { srgb: false });
const smokeTex = canvasTex(64, (x, s) => {
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.6, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
}, { srgb: false });
const soilTex = canvasTex(256, (x, s) => {
  const R = rng(13);
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(92,70,50,1)'); g.addColorStop(0.55, 'rgba(105,82,58,0.9)'); g.addColorStop(1, 'rgba(110,90,60,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 2500; i++) { const a = R() * 6.28, r = Math.sqrt(R()) * s * 0.42; x.fillStyle = R() < 0.5 ? 'rgba(60,45,32,0.5)' : 'rgba(150,125,95,0.45)'; x.fillRect(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 1 + R() * 3, 1 + R() * 3); }
});
const carpetTex = canvasTex(1024, (x, s) => {
  const R = rng(14);
  for (let i = 0; i < 5200; i++) {
    const a = R() * 6.28, rr = Math.pow(R(), 0.8) * 0.48;
    const px = s / 2 + Math.cos(a) * rr * s, py = s / 2 + Math.sin(a) * rr * s;
    const alpha = 0.95 * (1 - sstep(0.3, 0.48, rr));
    const hue = 40 + R() * 12, l = 48 + R() * 14;
    x.fillStyle = `hsla(${hue},92%,${l}%,${alpha})`;
    x.save(); x.translate(px, py); x.rotate(R() * 6.28); x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 7 + R() * 5, -0.9, 0.9); x.closePath(); x.fill(); x.restore();
  }
});

// sky dome
const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, glowDir: { value: new THREE.Vector3(1, 0, 0) }, glowCol: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 bot; uniform vec3 glowDir; uniform vec3 glowCol; varying vec3 vP;
    void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h,0.0,1.0), 0.5)) : mix(hor, bot, clamp(-h*5.0,0.0,1.0));
      float g = max(dot(normalize(vec3(vP.x,0.0,vP.z)), normalize(vec3(glowDir.x,0.0,glowDir.z))), 0.0); c += glowCol * pow(g, 6.0) * (1.0 - clamp(abs(h)*3.0,0.0,1.0));
      gl_FragColor = vec4(c, 1.0); }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 48, 24), skyMat);
sky.renderOrder = -10;
scene.add(sky);
const starGeo = new THREE.BufferGeometry();
{ const R = rng(31), a = []; for (let i = 0; i < 1100; i++) { const th = R() * 6.28, ph = Math.acos(lerp(0.12, 1, R())); a.push(1500 * Math.sin(ph) * Math.cos(th), 1500 * Math.cos(ph), 1500 * Math.sin(ph) * Math.sin(th)); } starGeo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); }
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2 * SCALE, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 500;
scene.add(sun, sun.target);
const bulbLight = new THREE.PointLight(0xffb066, 0, 0, 1.4);
scene.add(bulbLight);

const std = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, ...extra });
const mk = (geo, mat, cast = true, recv = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; return m; };

// ------------------------------------------------------------------ ground
const groundMat = std(0x8db060, { map: grassTex });
const ground = mk(new THREE.PlaneGeometry(1500, 1500), groundMat, false, true);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const decal = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra });
const soil = mk(new THREE.CircleGeometry(1.5, 48), decal(soilTex), false, true);
soil.rotation.x = -Math.PI / 2; soil.position.y = 0.01; scene.add(soil);
const carpetMat = decal(carpetTex, { polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
const carpet = mk(new THREE.CircleGeometry(15, 64), carpetMat, false, true);
carpet.rotation.x = -Math.PI / 2; carpet.position.y = 0.06; scene.add(carpet);

// distant ridges (two layers, unlit, tinted toward the horizon each frame)
function ridge(radius, base, amp, seed) {
  const R = rng(seed), N = 360, pos = [], idx = [];
  const ph = [R() * 6, R() * 6, R() * 6, R() * 6];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const h = base + amp * (0.55 * (0.5 + 0.5 * Math.sin(a * 3 + ph[0])) + 0.3 * (0.5 + 0.5 * Math.sin(a * 7 + ph[1])) + 0.15 * (0.5 + 0.5 * Math.sin(a * 17 + ph[2])) + 0.08 * Math.sin(a * 41 + ph[3]));
    pos.push(Math.cos(a) * radius, -6, Math.sin(a) * radius, Math.cos(a) * radius, h, Math.sin(a) * radius);
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x8899aa, side: THREE.DoubleSide, fog: false }));
  scene.add(m); return m;
}
const ridgeFar = ridge(1150, 60, 210, 41), ridgeNear = ridge(820, 25, 120, 42);
ridgeFar.renderOrder = -9; ridgeNear.renderOrder = -8;

// ------------------------------------------------------------------ roads, lanes, fields
const V3 = (x, z) => new THREE.Vector3(x, 0, z);
const road = new THREE.CatmullRomCurve3([V3(-150, 30), V3(-95, 21), V3(-48, 13), V3(-16, 9.6), V3(0, 9.0), V3(16, 9.6), V3(48, 7), V3(95, -3), V3(150, -18)]);
const lanes = [
  new THREE.CatmullRomCurve3([V3(-31, 11.8), V3(-33, -12), V3(-28, -38), V3(-35, -78)]),
  new THREE.CatmullRomCurve3([V3(33, 8.1), V3(30, -16), V3(37, -42), V3(31, -80)]),
  new THREE.CatmullRomCurve3([V3(9, 9.3), V3(11, 32), V3(5, 58), V3(9, 90)]),
];
const roadPts = road.getSpacedPoints(500), lanePts = lanes.map((l) => l.getSpacedPoints(160));
function distPts(x, z, pts) { let d = 1e9; for (const p of pts) { const dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < d) d = dd; } return Math.sqrt(d); }
function nearestU(curve, pts, x, z) { let best = 0, d = 1e9; pts.forEach((p, i) => { const dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < d) { d = dd; best = i; } }); return best / (pts.length - 1); }

function ribbon(curve, width, u0, u1, n, y) {
  const pos = [], uv = [], idx = [];
  const len = curve.getLength() * Math.abs(u1 - u0);
  for (let i = 0; i <= n; i++) {
    const u = lerp(u0, u1, i / n), p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const nx = -t.z, nz = t.x, l = Math.hypot(nx, nz);
    for (const s of [-1, 1]) { pos.push(p.x + (nx / l) * s * width / 2, y, p.z + (nz / l) * s * width / 2); uv.push(s < 0 ? 0 : 1, (len * i) / n / (width * 1.6)); }
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // ensure upward normals
  const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}
const uTree = nearestU(road, roadPts, 0, 0);
const roadMats = { dirt: decal(dirtTex, { opacity: 1 }), asph: decal(asphaltTex, { opacity: 0 }) };
const roadHalves = [];
for (const [a, b] of [[uTree, 0], [uTree, 1]]) {
  const geo = ribbon(road, 4.6, a, b, 260, 0.03);
  const dirt = mk(geo, roadMats.dirt, false, true), asph = mk(geo, roadMats.asph, false, true);
  scene.add(dirt, asph); roadHalves.push({ geo, dirt, asph, n: geo.index.count });
}
const laneMats = { dirt: decal(dirtTex), conc: decal(concreteTex, { opacity: 0 }) };
const laneMeshes = lanes.map((l) => {
  const geo = ribbon(l, 2.8, 0, 1, 120, 0.025);
  const dirt = mk(geo, laneMats.dirt, false, true), conc = mk(geo, laneMats.conc, false, true);
  scene.add(dirt, conc); return { geo, dirt, conc, n: geo.index.count };
});

const FIELDS = [];
{
  const R = rng(51);
  const blocks = [[64, -50, 3, 4, 13, 9.5, 0.12], [-68, 47, 3, 3, 12, 10, -0.2], [60, 42, 2, 3, 12, 9, 0.35], [-70, -40, 2, 3, 12, 9.5, 0.05]];
  blocks.forEach(([cx, cz, nx, nz, cw, cd, rot], bi) => {
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = (i - (nx - 1) / 2) * (cw + 1.4), lz = (j - (nz - 1) / 2) * (cd + 1.4);
      const x = cx + lx * Math.cos(rot) + lz * Math.sin(rot), z = cz - lx * Math.sin(rot) + lz * Math.cos(rot);
      FIELDS.push({ x, z, w: cw, d: cd, rot: rot + (R() - 0.5) * 0.04, t0: 19.6 + bi * 1.1 + R() * 2.8, v: R() });
    }
  });
}
const fieldMat = std(0xffffff, { map: fieldTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const fieldMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), fieldMat, FIELDS.length);
fieldMesh.receiveShadow = true;
FIELDS.forEach((f, i) => fieldMesh.setColorAt(i, new THREE.Color().setHSL(0, 0, lerp(0.82, 1.0, f.v))));
scene.add(fieldMesh);
function inField(x, z, margin) {
  for (const f of FIELDS) { const dx = x - f.x, dz = z - f.z; const lx = dx * Math.cos(f.rot) - dz * Math.sin(f.rot), lz = dx * Math.sin(f.rot) + dz * Math.cos(f.rot); if (Math.abs(lx) < f.w / 2 + margin && Math.abs(lz) < f.d / 2 + margin) return true; }
  return false;
}

// ------------------------------------------------------------------ tree
const UP = new THREE.Vector3(0, 1, 0);
const TB = []; const TLEAVES = [];
const leaders = [];
{
  const R = rng(20251);
  const add = (parent, level, pos, dir, len, r0, s, span) => {
    s = Math.min(s, 0.965); span = Math.max(0.035, Math.min(span, 1.0 - s));
    TB.push({ parent, level, pos, dir: dir.clone().normalize(), len, r0, s, span, start: new THREE.Vector3(), le: 0, re: 0, gb: 0 });
    return TB.length - 1;
  };
  const fromAngles = (a, az) => new THREE.Vector3(Math.sin(a) * Math.cos(az), Math.cos(a), Math.sin(a) * Math.sin(az));
  const deviate = (d, ang, az) => {
    const up = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(d, up).normalize(), v = new THREE.Vector3().crossVectors(d, u).normalize();
    const perp = u.multiplyScalar(Math.cos(az)).add(v.multiplyScalar(Math.sin(az)));
    return d.clone().multiplyScalar(Math.cos(ang)).add(perp.multiplyScalar(Math.sin(ang))).normalize();
  };
  let p = -1;
  [[6.2, 0.95, 0.0, 0.36], [5.0, 0.56, 0.26, 0.34], [4.4, 0.33, 0.46, 0.32], [3.6, 0.19, 0.63, 0.3]].forEach(([len, r0, s, span]) => {
    p = add(p, 0, 1.0, new THREE.Vector3((R() - 0.5) * 0.1, 1, (R() - 0.5) * 0.1), len, r0, s, span); leaders.push(p);
  });
  let az = R() * 6.28; const l1 = [];
  const counts = [3, 5, 5, 4];
  leaders.forEach((li, k) => {
    const P = TB[li];
    for (let j = 0; j < counts[k]; j++) {
      const pos = k === 0 ? lerp(0.62, 0.97, (j + R() * 0.6) / counts[k]) : lerp(0.08, 0.95, (j + R() * 0.6) / counts[k]);
      az += 2.39996 + (R() - 0.5) * 0.3;
      const a = ((lerp(70, 38, (k + pos) / 4) + (R() - 0.5) * 10) * Math.PI) / 180;
      const len = [7.8, 6.6, 4.9, 3.0][k] * lerp(0.85, 1.12, R()) * lerp(1.05, 0.9, pos);
      const r0 = [0.34, 0.27, 0.19, 0.13][k] * lerp(0.85, 1.1, R());
      l1.push(add(li, 1, pos, fromAngles(a, az), len, r0, P.s + P.span * pos * 0.55 + 0.01, 0.3));
    }
  });
  { const P = TB[leaders[3]]; for (let j = 0; j < 3; j++) { az += 2.39996; l1.push(add(leaders[3], 1, 1.0, fromAngles(((20 + R() * 14) * Math.PI) / 180, az), 2.6 * lerp(0.8, 1.1, R()), 0.1, P.s + P.span * 0.97, 0.12)); } }
  const l2 = [];
  l1.forEach((bi) => {
    const P = TB[bi], n = 3 + (R() < 0.5 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const pos = lerp(0.3, 1.0, (j + R() * 0.7) / n);
      const d = deviate(P.dir, ((28 + R() * 22) * Math.PI) / 180, R() * 6.28); d.y += 0.25; d.normalize();
      l2.push(add(bi, 2, pos, d, P.len * lerp(0.42, 0.6, R()), P.r0 * 0.5, P.s + P.span * pos * 0.5 + 0.02, 0.24));
    }
  });
  l2.forEach((bi) => {
    const P = TB[bi], n = 2 + (R() < 0.6 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const pos = lerp(0.4, 1.0, (j + R() * 0.7) / n);
      const d = deviate(P.dir, ((25 + R() * 25) * Math.PI) / 180, R() * 6.28); d.y += 0.15; d.normalize();
      add(bi, 3, pos, d, P.len * lerp(0.45, 0.62, R()), P.r0 * 0.5, P.s + P.span * pos * 0.5 + 0.02, 0.2);
    }
  });
  const R2 = rng(777);
  const rs = () => { let x, y, z; do { x = R2() * 2 - 1; y = R2() * 2 - 1; z = R2() * 2 - 1; } while (x * x + y * y + z * z > 1); return new THREE.Vector3(x, y, z); };
  TB.forEach((b, bi) => {
    let n = 0, u0 = 0.3, spread = 0.8, sap = 0;
    if (b.level === 1) { n = 10; u0 = 0.3; spread = 0.95; }
    if (b.level === 2) { n = 12; u0 = 0.3; spread = 0.9; }
    if (b.level === 3) { n = 24; u0 = 0.12; spread = 0.8; }
    if (bi === leaders[0]) { n = 70; u0 = 0.3; spread = 0.45; sap = 1; }
    if (bi === leaders[1]) { n = 40; u0 = 0.1; spread = 0.5; sap = 2; }
    for (let i = 0; i < n; i++) {
      TLEAVES.push({ b: bi, u: lerp(u0, 1, R2()), off: rs().multiplyScalar(spread), rx: (R2() - 0.5) * 2.2, ry: R2() * 6.28, rz: (R2() - 0.5) * 2.2, size: lerp(0.5, 0.74, R2()), r: R2(), cv: R2(), ph: R2() * 6.28, sap, pos: new THREE.Vector3() });
      const L_ = TLEAVES[TLEAVES.length - 1]; L_.goldC = new THREE.Color(0xf7c425).lerp(new THREE.Color(0xe9a215), L_.cv);
    }
  });
}
const barkMat = std(0xffffff, { map: barkTex, color: 0x9a8f86 });
const branchMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 1, 1, 9, 1).translate(0, 0.5, 0), barkMat, TB.length);
branchMesh.castShadow = true; branchMesh.receiveShadow = true; branchMesh.frustumCulled = false;
scene.add(branchMesh);
const leafGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.45, 0);
const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, TLEAVES.length);
leafMesh.castShadow = true; leafMesh.receiveShadow = true; leafMesh.frustumCulled = false;
TLEAVES.forEach((l, i) => leafMesh.setColorAt(i, new THREE.Color(1, 1, 1)));
scene.add(leafMesh);
const FALLN = 1100;
const FALL = [];
{ const R = rng(88); for (let i = 0; i < FALLN; i++) FALL.push({ src: Math.floor(R() * TLEAVES.length), off: R() * 9, P: lerp(6.5, 9, R()), v: lerp(1.3, 2.3, R()), ph: R() * 6.28, r: R(), size: lerp(0.5, 0.72, R()), cv: R(), rz: R() * 6.28 }); }
const fallMesh = new THREE.InstancedMesh(leafGeo, leafMat, FALLN);
fallMesh.castShadow = true; fallMesh.frustumCulled = false;
FALL.forEach((l, i) => fallMesh.setColorAt(i, new THREE.Color(1, 1, 1)));
scene.add(fallMesh);

// seed + sprout
const seed = mk(new THREE.SphereGeometry(0.15, 28, 18), std(0xe0a83a, { roughness: 0.5 }), true, false);
scene.add(seed);
const sprout = new THREE.Group();
const sproutLeafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x9fd25a, roughness: 0.6 });
const stem = mk(new THREE.CylinderGeometry(0.012, 0.018, 1, 6).translate(0, 0.5, 0), std(0x7a9a48), true, false);
sprout.add(stem);
const sproutLeaves = [0, 1].map((i) => { const m = mk(leafGeo, sproutLeafMat, true, false); sprout.add(m); return m; });
scene.add(sprout);

// grass tufts near the tree
const GRASSN = 3600;
const grassMat = std(0xffffff, { roughness: 0.9 });
const grassMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.014, 1, 3).translate(0, 0.5, 0), grassMat, GRASSN);
grassMesh.receiveShadow = true; grassMesh.frustumCulled = false;
const GRASS = [];
{
  const R = rng(61);
  for (let i = 0; i < GRASSN; i++) {
    const near = i < 900;
    const a = R() * 6.28, r = near ? lerp(1.05, 2.4, Math.sqrt(R())) : lerp(2.4, 15, Math.sqrt(R()));
    GRASS.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r, h: near ? lerp(0.06, 0.2, R()) * sstep(1.0, 2.2, r) + 0.03 : lerp(0.16, 0.42, R()) * 1.2, tx: (R() - 0.5) * 0.6, tz: (R() - 0.5) * 0.6, ry: R() * 6 });
    grassMesh.setColorAt(i, new THREE.Color().setHSL(0, 0, lerp(0.7, 1.05, R())));
  }
}
scene.add(grassMesh);
const pebbles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std(0x8a8580), 40);
{ const R = rng(62), m = new THREE.Matrix4(), q = new THREE.Quaternion(); for (let i = 0; i < 40; i++) { const a = R() * 6.28, r = lerp(0.3, 2.2, R()), s = lerp(0.02, 0.07, R()); q.setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)); m.compose(new THREE.Vector3(Math.cos(a) * r, s * 0.3, Math.sin(a) * r), q, new THREE.Vector3(s, s * 0.6, s)); pebbles.setMatrixAt(i, m); } }
pebbles.castShadow = true; pebbles.receiveShadow = true;
scene.add(pebbles);

// plaza & tree pool (era 2)
const plaza = mk(new THREE.RingGeometry(3.3, 9.5, 64, 1), new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), false, true);
plazaTex.repeat.set(4, 4);
plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.04; scene.add(plaza);
const pool = mk(new THREE.LatheGeometry([new THREE.Vector2(2.95, 0), new THREE.Vector2(3.35, 0), new THREE.Vector2(3.35, 0.55), new THREE.Vector2(2.95, 0.55), new THREE.Vector2(2.95, 0)], 56), std(0xa29b90));
scene.add(pool);

// ------------------------------------------------------------------ village
const M = {
  mud: std(0xc9a67d), brick: std(0x9d9991), white: std(0xf1efea), band: std(0xb7babf), stone: std(0x8e8a84),
  wood: std(0x8a5631), woodDark: std(0x5e3b22), metal: std(0x80858b), pole: std(0x6d5843),
  glass: new THREE.MeshStandardMaterial({ color: 0xcfe3ef, transparent: true, opacity: 0.38, roughness: 0.1, metalness: 0.1, depthWrite: false }),
};
const roofMats = [0x585c62, 0x41464c, 0x3e5166, 0x8b3b2d].map((c) => std(c, { side: THREE.DoubleSide }));
const roofBase = roofMats.map((m) => m.color.clone());
const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const planeGeo = new THREE.PlaneGeometry(1, 1);
const gableGeo = (() => {
  const A = [-0.5, 0, 0.5], B = [0.5, 0, 0.5], Cc = [0.5, 0, -0.5], D = [-0.5, 0, -0.5], E = [-0.5, 1, 0], F = [0.5, 1, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([A, B, F, A, F, E, Cc, D, E, Cc, E, F, D, A, E, B, Cc, F].flat(), 3));
  g.computeVertexNormals(); return g;
})();
const hipGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0).toNonIndexed();
hipGeo.computeVertexNormals();

const WINS = []; // {house, m(local)}
function winLocal(x, y, z, ry, w, h) { return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(w, h, 1)); }

function makeHut(R) {
  const w = lerp(5.6, 7.0, R()), d = lerp(4.3, 5.0, R()), h = lerp(2.5, 3.0, R()), rh = lerp(1.6, 2.0, R());
  const grp = new THREE.Group(), body = new THREE.Group(), roof = new THREE.Group();
  grp.add(body, roof);
  const wall = mk(boxGeo, R() < 0.62 ? M.mud : M.brick); wall.scale.set(w, h, d); body.add(wall);
  const plinth = mk(boxGeo, M.stone); plinth.scale.set(w + 0.25, 0.35, d + 0.25); body.add(plinth);
  const dx = (R() - 0.5) * w * 0.25;
  const door = mk(planeGeo, M.woodDark, false, true); door.scale.set(1.0, 1.9, 1); door.position.set(dx, 0.95, d / 2 + 0.012); body.add(door);
  const ri = R() < 0.75 ? 0 : 1;
  const rf = mk(gableGeo, roofMats[ri]); rf.scale.set(w + 0.8, rh, d + 1.0); roof.add(rf);
  const chim = mk(boxGeo, M.brick); chim.scale.set(0.5, 1.5, 0.5); chim.position.set(w * 0.3, 0.2, -d * 0.2); roof.add(chim);
  const wins = [winLocal(dx - 1.9, h * 0.58, d / 2 + 0.014, 0, 0.85, 0.8), winLocal(dx + 1.9, h * 0.58, d / 2 + 0.014, 0, 0.85, 0.8), winLocal(-w * 0.22, h * 0.58, -d / 2 - 0.014, Math.PI, 0.8, 0.7), winLocal(w * 0.22, h * 0.58, -d / 2 - 0.014, Math.PI, 0.8, 0.7)];
  return { kind: 'hut', grp, body, roof, h, rh, w, d, wins, chimney: new THREE.Vector3(w * 0.3, rh * 0.2 + 1.7, -d * 0.2), door: new THREE.Vector3(dx, 1.95, d / 2 + 0.3), doorHalf: 0.78 };
}
function makeVilla(R, floors) {
  const w = lerp(7.2, 8.4, R()), d = lerp(6.8, 8.0, R()), fh = 3.1, h = floors * fh, rh = lerp(1.9, 2.5, R());
  const grp = new THREE.Group(), body = new THREE.Group(), roof = new THREE.Group();
  grp.add(body, roof);
  const wall = mk(boxGeo, M.white); wall.scale.set(w, h, d); body.add(wall);
  const plinth = mk(boxGeo, M.stone); plinth.scale.set(w + 0.3, 0.5, d + 0.3); body.add(plinth);
  for (let k = 1; k <= floors; k++) { const b = mk(boxGeo, M.band); b.scale.set(w + (k === floors ? 0.4 : 0.22), k === floors ? 0.32 : 0.2, d + (k === floors ? 0.4 : 0.22)); b.position.y = k * fh - (k === floors ? 0.32 : 0.1); body.add(b); }
  const door = mk(planeGeo, M.wood, false, true); door.scale.set(1.7, 2.45, 1); door.position.set(0, 1.25 + 0.05, d / 2 + 0.012); body.add(door);
  const wins = [];
  for (let k = 0; k < floors; k++) {
    const y0 = k * fh;
    if (k > 0) {
      const slab = mk(boxGeo, M.band); slab.scale.set(2.9, 0.16, 1.25); slab.position.set(0, y0, d / 2 + 0.62); body.add(slab);
      const rail = mk(boxGeo, M.glass, false, false); rail.scale.set(2.9, 0.95, 0.05); rail.position.set(0, y0 + 0.16, d / 2 + 1.22); body.add(rail);
      const top = mk(boxGeo, M.metal); top.scale.set(2.95, 0.06, 0.08); top.position.set(0, y0 + 1.12, d / 2 + 1.22); body.add(top);
      wins.push(winLocal(0, y0 + 1.3, d / 2 + 0.014, 0, 1.5, 2.2));
    }
    wins.push(winLocal(-w * 0.33, y0 + 1.6, d / 2 + 0.014, 0, 1.0, 1.25), winLocal(w * 0.33, y0 + 1.6, d / 2 + 0.014, 0, 1.0, 1.25));
    wins.push(winLocal(-w * 0.25, y0 + 1.6, -d / 2 - 0.014, Math.PI, 1.0, 1.2), winLocal(w * 0.25, y0 + 1.6, -d / 2 - 0.014, Math.PI, 1.0, 1.2));
    wins.push(winLocal(w / 2 + 0.014, y0 + 1.6, 0, Math.PI / 2, 1.0, 1.2), winLocal(-w / 2 - 0.014, y0 + 1.6, 0, -Math.PI / 2, 1.0, 1.2));
  }
  const ri = [0, 1, 2, 2, 3][Math.floor(R() * 5)];
  const rf = mk(hipGeo, roofMats[ri]); rf.scale.set(w + 0.9, rh, d + 0.9); roof.add(rf);
  return { kind: 'villa', grp, body, roof, h, rh, w, d, wins, door: new THREE.Vector3(0, 2.75, d / 2 + 0.32), doorHalf: 1.3 };
}

// slots
const CAMPATH = [];
for (let T = 0; T <= 57; T += 0.05) { const p = camPos(storyCam(T)); if (p.y < 18) CAMPATH.push(p); }
for (let t = 0; t <= HOOK_END; t += 0.02) { const p = camPos(camAt(t)); if (p.y < 18) CAMPATH.push(p); }
const nearCam = (x, z, d) => CAMPATH.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < d * d);
const SLOTS = [];
const firstCam = storyCam(16.6), fc = camPos(firstCam);
const vdir = new THREE.Vector3(-fc.x, 0, -fc.z).normalize(), vperp = new THREE.Vector3(vdir.z, 0, -vdir.x);
const FIRST = new THREE.Vector3().addScaledVector(vdir, 10.5).addScaledVector(vperp, 4.6);
{
  const R = rng(71);
  const ok = (x, z, minGap) => {
    const r = Math.hypot(x, z);
    if (r < 14 || r > 82) return false;
    if (distPts(x, z, roadPts) < 7.2) return false;
    for (const lp of lanePts) if (distPts(x, z, lp) < 6.2) return false;
    if (inField(x, z, 4.5)) return false;
    if (Math.hypot(x - FIRST.x, z - FIRST.z) < 10.5) return false;
    if (nearCam(x, z, 9)) return false;
    for (const s of SLOTS) if (Math.hypot(s.x - x, s.z - z) < minGap) return false;
    return true;
  };
  const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  const along = (curve, offset, step) => {
    const L = curve.getLength();
    for (let s = 0.02; s < 0.98; s += step / L) {
      const p = curve.getPointAt(s), t = curve.getTangentAt(s);
      for (const side of [-1, 1]) {
        const o = offset + R() * 1.2;
        const x = p.x - t.z * side * o + t.x * (R() - 0.5) * 2, z = p.z + t.x * side * o + t.z * (R() - 0.5) * 2;
        if (ok(x, z, 10)) SLOTS.push({ x, z, rot: faceTo(x, z, p.x, p.z) + (R() - 0.5) * 0.08, road: true });
      }
    }
  };
  along(road, 8.8, 10.5);
  lanes.forEach((l) => along(l, 7.8, 10.5));
  for (let i = 0; i < 900 && SLOTS.length < 92; i++) {
    const a = R() * 6.28, r = lerp(16, 80, Math.sqrt(R())), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (ok(x, z, 10.2)) SLOTS.push({ x, z, rot: Math.round(R() * 4) * (Math.PI / 2) + (R() - 0.5) * 0.2, road: false });
  }
}

const HOUSES = [];
const village = new THREE.Group(); scene.add(village);
{
  const R = rng(81);
  const addHouse = (o, x, z, rot) => { o.grp.position.set(x, 0, z); o.grp.rotation.y = rot; o.x = x; o.z = z; o.rot = rot; o.dist = Math.hypot(x, z); village.add(o.grp); HOUSES.push(o); return o; };
  const first = addHouse(makeHut(R), FIRST.x, FIRST.z, Math.atan2(fc.x - FIRST.x, fc.z - FIRST.z) * 0.7 + Math.atan2(0 - FIRST.x, 9 - FIRST.z) * 0.3);
  Object.assign(first, { buildT: 15.35, dur: 2.5, demolishT: null, keep: true, first: true });
  // era 1: huts, growing outward from the first house
  const order = SLOTS.map((s, i) => ({ i, k: Math.hypot(s.x - FIRST.x, s.z - FIRST.z) + R() * 28 })).sort((a, b) => a.k - b.k);
  const N1 = 40;
  const era1 = order.slice(0, N1).map((o) => SLOTS[o.i]);
  era1.forEach((s, k) => {
    const hut = addHouse(makeHut(R), s.x, s.z, s.rot);
    let T;
    if (k < 3) T = 18.45 + k * 0.72;
    else T = 21.15 + 5.4 * Math.pow((k - 3) / (N1 - 4), 0.85);
    Object.assign(hut, { buildT: T, dur: 0.85, slot: s });
    s.hut = hut;
  });
  // era 2: villas replace most huts + fill new slots
  const keepIdx = new Set(); while (keepIdx.size < 6) keepIdx.add(Math.floor(R() * N1));
  const era2 = [];
  era1.forEach((s, k) => { if (!keepIdx.has(k)) era2.push(s); else s.hut.keep = true; });
  order.slice(N1).forEach((o) => era2.push(SLOTS[o.i]));
  const sorted = era2.map((s) => ({ s, k: Math.hypot(s.x, s.z) + R() * 22 })).sort((a, b) => a.k - b.k);
  sorted.forEach(({ s }, k) => {
    const T = 33.5 + 5.1 * (k / (sorted.length - 1));
    if (s.hut) s.hut.demolishT = T - 0.42;
    const floors = s.road ? (R() < 0.75 ? 3 : 2) : R() < 0.45 ? 3 : 2;
    const v = addHouse(makeVilla(R, floors), s.x, s.z, s.rot);
    Object.assign(v, { buildT: T, dur: 0.95, demolishT: null });
  });
  // electricity: lights ripple outward from the tree
  const huts = HOUSES.filter((h) => h.kind === 'hut' && h.buildT < 28).sort((a, b) => a.dist - b.dist);
  huts.forEach((h, k) => { h.onT = h.first ? 29.05 : 29.25 + 1.9 * (k / huts.length) + R() * 0.15; });
  HOUSES.forEach((h) => { if (h.kind === 'villa') h.onT = h.buildT; });
  HOUSES.forEach((h, hi) => h.wins.forEach((m) => WINS.push({ h: hi, m, r1: R(), r2: R(), r3: R() })));
}
const winMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const winMesh = new THREE.InstancedMesh(planeGeo, winMat, WINS.length);
winMesh.frustumCulled = false;
WINS.forEach((w, i) => winMesh.setColorAt(i, new THREE.Color(0, 0, 0)));
scene.add(winMesh);

// electricity poles along the road (north side), first one near the tree carries the first bulb
const POLES = [];
{
  const L = road.getLength();
  for (let k = -6; k <= 6; k++) {
    const u = uTree + (k * 17) / L + 0.012;
    if (u < 0.01 || u > 0.99) continue;
    const p = road.getPointAt(u), t = road.getTangentAt(u);
    const x = p.x - t.z * -3.4, z = p.z + t.x * -3.4;
    const grp = new THREE.Group();
    const pole = mk(new THREE.CylinderGeometry(0.12, 0.17, 7.4, 8).translate(0, 3.7, 0), M.pole); grp.add(pole);
    const arm = mk(boxGeo, M.pole); arm.scale.set(2.2, 0.15, 0.15); arm.position.y = 6.75; grp.add(arm);
    grp.position.set(x, 0, z); grp.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
    scene.add(grp);
    POLES.push({ k, grp, x, z, t0: 27.35 + Math.abs(k) * 0.09, ends: [-1, 1].map((s) => new THREE.Vector3(s * 1.0, 6.85, 0)) });
  }
}
POLES.sort((a, b) => a.k - b.k);
const wireMat = new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0 });
const WIRES = [];
for (let i = 0; i < POLES.length - 1; i++) {
  const A = POLES[i], B = POLES[i + 1];
  for (let e = 0; e < 2; e++) {
    A.grp.updateMatrixWorld(); B.grp.updateMatrixWorld();
    const pa = A.ends[e].clone().applyMatrix4(A.grp.matrixWorld), pb = B.ends[e].clone().applyMatrix4(B.grp.matrixWorld);
    const pts = []; for (let j = 0; j <= 14; j++) { const u = j / 14; const p = pa.clone().lerp(pb, u); p.y -= Math.sin(u * Math.PI) * 0.75; pts.push(p); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat);
    scene.add(line); WIRES.push({ line, t: Math.max(A.t0, B.t0) + 0.25 });
  }
}
const bulbPole = POLES.find((p) => p.k === 0);
const bulbMat = new THREE.MeshBasicMaterial({ color: 0x777777 });
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10), bulbMat);
bulbPole.grp.add(bulb); bulb.position.set(1.05, 6.15, 0);
const bulbWire = mk(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 4), M.metal, false, false); bulbWire.position.set(1.05, 6.5, 0); bulbPole.grp.add(bulbWire);

// street lamps (era 2)
const LAMPS = [];
const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
{
  const L = road.getLength();
  for (let k = -7; k <= 7; k++) {
    const u = uTree + (k * 19 + 9) / L;
    if (u < 0.01 || u > 0.99) continue;
    const p = road.getPointAt(u), t = road.getTangentAt(u), side = k % 2 === 0 ? 1 : -1;
    const x = p.x - t.z * side * 3.1, z = p.z + t.x * side * 3.1;
    const grp = new THREE.Group();
    const pole = mk(new THREE.CylinderGeometry(0.07, 0.1, 6.2, 8).translate(0, 3.1, 0), M.metal); grp.add(pole);
    const arm = mk(boxGeo, M.metal); arm.scale.set(0.08, 0.08, 1.3); arm.position.set(0, 6.1, 0.6); grp.add(arm);
    const head = new THREE.Mesh(boxGeo, lampHeadMat); head.scale.set(0.35, 0.12, 0.7); head.position.set(0, 5.95, 1.15); grp.add(head);
    grp.position.set(x, 0, z); grp.rotation.y = Math.atan2(p.x - x, p.z - z);
    scene.add(grp); LAMPS.push({ grp, t0: 34.0 + Math.abs(k) * 0.06 });
  }
}

// cars (era 2)
const CARS = [];
{
  const R = rng(91), L = road.getLength();
  const cols = [0xf2f2f2, 0xb8221d, 0x1f2a36, 0x9aa3ad, 0xf2f2f2, 0x2f5d8a];
  for (let i = 0; i < 12; i++) {
    const grp = new THREE.Group();
    const cm = std(cols[i % cols.length], { roughness: 0.35, metalness: 0.3 });
    const b = mk(boxGeo, cm); b.scale.set(1.9, 0.8, 4.3); b.position.y = 0.3; grp.add(b);
    const cab = mk(boxGeo, std(0x2a3138, { roughness: 0.2 })); cab.scale.set(1.7, 0.65, 2.2); cab.position.set(0, 1.1, -0.2); grp.add(cab);
    const hl = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })); hl.scale.set(1.5, 0.15, 0.05); hl.position.set(0, 0.75, 2.16); grp.add(hl);
    const tl = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff2020 })); tl.scale.set(1.5, 0.12, 0.05); tl.position.set(0, 0.8, -2.16); grp.add(tl);
    grp.visible = false; scene.add(grp);
    CARS.push({ grp, hl, tl, dir: i % 2 ? 1 : -1, delay: i * 1.55 + R() * 1.2, v: lerp(7, 10, R()) / L, lane: 1.1 });
  }
}

// ribbons + lanterns on the tree
const L1 = TB.map((b, i) => i).filter((i) => TB[i].level === 1);
const RIBBONS = [];
{
  const R = rng(101);
  const mat = new THREE.MeshStandardMaterial({ color: 0xc81d1d, emissive: 0x3a0000, side: THREE.DoubleSide, roughness: 0.6 });
  const geo = new THREE.PlaneGeometry(0.16, 1.15).translate(0, -0.575, 0);
  for (let i = 0; i < 44; i++) {
    const m = mk(geo, mat, true, false); scene.add(m);
    RIBBONS.push({ m, b: L1[Math.floor(R() * Math.min(L1.length, 13))], pos: lerp(0.12, 0.42, R()), ry: R() * 6.28, ph: R() * 6.28, t0: 36.0 + i * 0.045, len: lerp(0.8, 1.2, R()) });
  }
}
const lanternMat = new THREE.MeshStandardMaterial({ color: 0xd52a1c, emissive: 0xff3a16, emissiveIntensity: 0.3, roughness: 0.5 });
const capMat = new THREE.MeshStandardMaterial({ color: 0xd8a640, emissive: 0x6a4410, roughness: 0.4, metalness: 0.4 });
const LANTERNS = [];
{
  const R = rng(111);
  for (let i = 0; i < 26; i++) LANTERNS.push({ tree: true, b: L1[Math.floor(R() * L1.length)], pos: lerp(0.45, 0.85, R()), drop: lerp(0.4, 1.0, R()), s: lerp(0.85, 1.15, R()), ph: R() * 6.28, t0: 45.15 + R() * 1.2 });
  HOUSES.forEach((h, hi) => { if (h.kind === 'villa' || h.keep) for (const sd of [-1, 1]) LANTERNS.push({ tree: false, h: hi, sd, s: 0.85, ph: R() * 6.28, t0: 45.3 + h.dist / 55 + R() * 0.2 }); });
}
const lanternBody = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), lanternMat, LANTERNS.length);
const lanternCap = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), capMat, LANTERNS.length * 2);
lanternBody.frustumCulled = lanternCap.frustumCulled = false;
lanternBody.castShadow = true;
scene.add(lanternBody, lanternCap);

// ------------------------------------------------------------------ background trees
const BGT = [];
{
  const R = rng(121);
  for (let i = 0; i < 1400 && BGT.length < 130; i++) {
    const a = R() * 6.28, r = lerp(15, 140, Math.sqrt(R())), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z) < 13) continue;
    if (distPts(x, z, roadPts) < 4.5) continue;
    if (lanePts.some((lp) => distPts(x, z, lp) < 3.2)) continue;
    if (inField(x, z, 1.5)) continue;
    if (SLOTS.some((s) => Math.hypot(s.x - x, s.z - z) < 6.5) || Math.hypot(FIRST.x - x, FIRST.z - z) < 6.5) continue;
    if (BGT.some((b) => Math.hypot(b.x - x, b.z - z) < 3.2)) continue;
    if (nearCam(x, z, 5)) continue;
    BGT.push({ x, z, con: R() < 0.55, s: lerp(0.8, 1.35, R()), ry: R() * 6 });
  }
}
const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1, 6).translate(0, 0.5, 0), std(0x5d4a3a), BGT.length);
const conGeo = (() => { const a = new THREE.ConeGeometry(1.7, 3.2, 7).translate(0, 2.6, 0), b = new THREE.ConeGeometry(1.25, 2.6, 7).translate(0, 4.2, 0); const pos = [...a.toNonIndexed().attributes.position.array, ...b.toNonIndexed().attributes.position.array]; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; })();
const conMat = std(0x3f6b3c, { flatShading: true });
const roundMat = std(0x6a9a45, { flatShading: true });
const cons = BGT.filter((b) => b.con), rounds = BGT.filter((b) => !b.con);
const conMesh = new THREE.InstancedMesh(conGeo, conMat, cons.length);
const roundMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.7, 1).translate(0, 3.6, 0), roundMat, rounds.length);
{
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  BGT.forEach((b, i) => { q.setFromAxisAngle(UP, b.ry); m.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.s, b.s * (b.con ? 1.6 : 2.4), b.s)); trunkMesh.setMatrixAt(i, m); });
  cons.forEach((b, i) => { q.setFromAxisAngle(UP, b.ry); m.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.s, b.s * 1.15, b.s)); conMesh.setMatrixAt(i, m); });
  rounds.forEach((b, i) => { roundMesh.setColorAt(i, new THREE.Color().setHSL(0, 0, lerp(0.8, 1.05, hash(i)))); });
}
[trunkMesh, conMesh, roundMesh].forEach((m) => { m.castShadow = true; m.receiveShadow = true; scene.add(m); });

// ------------------------------------------------------------------ particles: snow, smoke, firecrackers, fireworks
const SNOWN = 5200;
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SNOWN * 3), 3));
const SNOW = []; { const R = rng(131); for (let i = 0; i < SNOWN; i++) SNOW.push({ x: lerp(-90, 90, R()), z: lerp(-90, 90, R()), y: R() * 60, v: lerp(1.4, 2.6, R()), ph: R() * 6.28 }); }
const snowMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: spriteTex }, uScale: { value: (H * SCALE) / 2 }, opacity: { value: 0 }, pr: { value: SCALE } },
  vertexShader: 'uniform float uScale; uniform float pr; varying float vF; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float d = -mv.z; gl_PointSize = clamp(0.2 * uScale / d, 1.2 * pr, 7.0 * pr); vF = smoothstep(1.5, 5.0, d); gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform sampler2D map; uniform float opacity; varying float vF; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(1.0), t.a * opacity * vF); }',
  transparent: true, depthWrite: false,
});
const snowPts = new THREE.Points(snowGeo, snowMat); snowPts.frustumCulled = false; scene.add(snowPts);

const smokeMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: smokeTex }, uScale: { value: (H * SCALE) / 2 }, color: { value: new THREE.Color(0xe9e6e1) } },
  vertexShader: 'attribute float size; attribute float alpha; varying float vA; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; vA = alpha; }',
  fragmentShader: 'uniform sampler2D map; uniform vec3 color; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, t.a * vA); }',
  transparent: true, depthWrite: false,
});
const SMOKE_HOUSES = HOUSES.filter((h) => h.kind === 'hut').slice(0, 1).concat(HOUSES.filter((h) => h.kind === 'hut' && !h.first).slice(0, 7));
const SMOKEPER = 14, SMOKEN = SMOKE_HOUSES.length * SMOKEPER;
const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SMOKEN * 3), 3));
smokeGeo.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(SMOKEN), 1));
smokeGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(SMOKEN), 1));
const smokePts = new THREE.Points(smokeGeo, smokeMat); smokePts.frustumCulled = false; scene.add(smokePts);

const FW = { bursts: [] };
{
  const R = rng(2025);
  const palette = [[1.0, 0.16, 0.1], [1.0, 0.72, 0.28], [1.0, 0.16, 0.1], [1.0, 0.8, 0.4], [0.95, 0.95, 1.0], [1.0, 0.36, 0.62], [0.35, 1.0, 0.45], [0.35, 0.55, 1.0]];
  let tt = 46.9;
  while (tt < 56.4) {
    const dense = (tt > 49.0 && tt < 51.0) || tt > 54.2 ? 0.55 : 1;
    tt += (0.3 + R() * 0.4) * dense;
    const rise = 0.9 + R() * 0.5, ex = tt + rise;
    const c = storyCam(ex), cp = camPos(c);
    const f = new THREE.Vector3(-cp.x, 0, -cp.z).normalize(), l = new THREE.Vector3(f.z, 0, -f.x);
    const center = new THREE.Vector3().addScaledVector(f, lerp(4, 30, R())).addScaledVector(l, lerp(-16, 16, R()));
    center.y = lerp(17, 33, R());
    const type = R() < 0.22 ? 'willow' : R() < 0.15 ? 'ring' : 'peony';
    const n = type === 'willow' ? 130 : 150;
    const col = type === 'willow' ? [1.0, 0.68, 0.25] : palette[Math.floor(R() * palette.length)];
    const col2 = R() < 0.35 ? palette[Math.floor(R() * palette.length)] : null;
    const dirs = [];
    const ringAxis = new THREE.Vector3(R() - 0.5, R() * 0.6 + 0.4, R() - 0.5).normalize();
    for (let i = 0; i < n; i++) {
      let d;
      if (type === 'ring') { const a = (i / n) * Math.PI * 2; const u = new THREE.Vector3(1, 0, 0).cross(ringAxis).normalize(), v = ringAxis.clone().cross(u); d = u.multiplyScalar(Math.cos(a)).add(v.multiplyScalar(Math.sin(a))); }
      else { const y = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(1 - y * y), a = i * 2.39996; d = new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr); }
      dirs.push({ d, sp: lerp(0.85, 1.05, R()), sd: R() });
    }
    FW.bursts.push({ launch: tt, explode: ex, center, base: new THREE.Vector3(center.x + (R() - 0.5) * 3, 0, center.z + (R() - 0.5) * 3), type, col, col2, dirs, v0: type === 'willow' ? lerp(8, 10, R()) : lerp(10, 14, R()), life: type === 'willow' ? 3.0 : lerp(1.8, 2.4, R()) });
  }
}
const FWMAX = 16000;
const fwGeo = new THREE.BufferGeometry();
fwGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(FWMAX * 3), 3));
fwGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(FWMAX * 3), 3));
const fwMat = new THREE.PointsMaterial({ size: 0.8, map: spriteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
const fwPts = new THREE.Points(fwGeo, fwMat); fwPts.frustumCulled = false; scene.add(fwPts);

const CRACK_SITES = HOUSES.filter((h) => h.kind === 'villa' || h.keep).sort((a, b) => a.dist - b.dist).slice(0, 7).map((h, k) => ({ h, t0: 46.15 + k * 0.22, t1: 47.9 + k * 0.22 }));
const CRACKN = CRACK_SITES.length * 46;
const crGeo = new THREE.BufferGeometry();
crGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(CRACKN * 3), 3));
crGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(CRACKN * 3), 3));
const crPts = new THREE.Points(crGeo, new THREE.PointsMaterial({ size: 0.38, map: spriteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
crPts.frustumCulled = false; scene.add(crPts);

// ------------------------------------------------------------------ post
const composer = new EffectComposer(renderer);
composer.setPixelRatio(SCALE);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.6, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fxaa = new ShaderPass(FXAAShader);
fxaa.uniforms.resolution.value.set(1 / (W * SCALE), 1 / (H * SCALE));
composer.addPass(fxaa);
const tiltH = new ShaderPass(HorizontalTiltShiftShader), tiltV = new ShaderPass(VerticalTiltShiftShader);
composer.addPass(tiltH); composer.addPass(tiltV);
const vig = new ShaderPass(VignetteShader);
vig.uniforms.offset.value = 0.92; vig.uniforms.darkness.value = 1.2;
composer.addPass(vig);

// ------------------------------------------------------------------ per-frame update
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const COLS = {
  sky: { day: C(0x9dbbd9), dayH: C(0xe3eaf0), dusk: C(0x41497a), duskH: C(0xf0a274), night: C(0x060b1e), nightH: C(0x18213f) },
  grass: [C(0x9fc46a), C(0x7ea558), C(0xb0a463), C(0x948d76)],
  blades: [C(0x8fbd55), C(0x6c9a45), C(0xb3a256), C(0x8b8064)],
  fields: [C(0x93c65a), C(0x4f8e35), C(0xdcb44a), C(0x8a7a62)],
  round: [C(0x8cc456), C(0x5a8e3c), C(0xd0782e), C(0x6d5b4a)],
  hill: [C(0x86a07a), C(0x6d8c68), C(0x9a9466), C(0x8d918e)],
  leafSpring: C(0xb2dc5c), leafSummer: C(0x5a9832), gold: C(0xf7c425), gold2: C(0xe9a215),
  white: C(0xf3f5f8), snowWhite: C(0xffffff),
  winDay: C(0x56636e), winNight: C(0x0b0e14), winLit: new THREE.Color(1.9, 1.25, 0.58),
};

function updateEnv(st, t) {
  const u = st.u;
  const winterGray = st.s === 3 ? st.snowFall * 0.6 : 0;
  const skyTop = tri(mixC(COLS.sky.day, C(0xaab4be), winterGray), COLS.sky.dusk, COLS.sky.night, u);
  const skyHor = tri(mixC(COLS.sky.dayH, C(0xd9dde0), winterGray), COLS.sky.duskH, COLS.sky.nightH, u);
  skyMat.uniforms.top.value.copy(skyTop);
  skyMat.uniforms.hor.value.copy(skyHor);
  skyMat.uniforms.bot.value.copy(skyHor).multiplyScalar(0.8);
  skyMat.uniforms.glowCol.value.copy(C(0xffa060)).multiplyScalar(st.dusk * 0.5);
  scene.fog.color.copy(skyHor);
  starMat.opacity = st.night * 0.9;

  const dayDir = new THREE.Vector3(0.55, 0.78, 0.32).normalize(), duskDir = new THREE.Vector3(0.85, 0.16, 0.5).normalize(), moonDir = new THREE.Vector3(-0.35, 0.85, -0.4).normalize();
  const dir = u <= 1 ? dayDir.clone().lerp(duskDir, sstep(0, 1, u)) : duskDir.clone().lerp(moonDir, sstep(1, 2, u));
  dir.normalize();
  skyMat.uniforms.glowDir.value.copy(duskDir);
  const sunCol = tri(C(0xfff0dc), C(0xffa05a), C(0x8ea6ff), u);
  sun.color.copy(sunCol);
  sun.intensity = u <= 1 ? lerp(3.1, 1.6, sstep(0, 1, u)) : lerp(1.6, 0.7, sstep(1, 2, u));
  hemi.color.copy(tri(C(0xdde9f7), C(0xffc8a0), C(0x6c7fc0), u));
  hemi.groundColor.copy(tri(C(0x7f6c4f), C(0x6a4a3a), C(0x232a40), u));
  hemi.intensity = u <= 1 ? lerp(1.25, 0.75, sstep(0, 1, u)) : lerp(0.75, 0.6, sstep(1, 2, u));
  hemi.intensity += st.snow * 0.25 * (1 - st.night);
  renderer.toneMappingExposure = lerp(1.0, 1.2, st.night);

  const cr = camAt(t).r;
  const half = clamp(cr * 1.15, 9, 70);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix();
  sun.target.position.set(0, 0, 0);
  sun.position.copy(dir).multiplyScalar(220);

  // ground & seasonal tints
  const gcol = seasonal(st.q, COLS.grass).lerp(COLS.white, st.snow * 0.9);
  groundMat.color.copy(gcol);
  grassMat.color.copy(seasonal(st.q, COLS.blades).lerp(COLS.white, st.snow * 0.85));
  fieldMat.color.copy(seasonal(st.q, COLS.fields).lerp(COLS.white, st.snow * 0.85));
  roundMat.color.copy(seasonal(st.q, COLS.round).lerp(COLS.white, st.snow * 0.6));
  conMat.color.copy(C(0x3f6b3c).lerp(COLS.white, st.snow * 0.55));
  const ridgeBase = tri(C(0x6d8296), C(0x4a3f5c), C(0x0c1226), u).lerp(COLS.white, st.snow * 0.35 * (1 - st.night));
  ridgeFar.material.color.copy(skyHor).lerp(ridgeBase, 0.38);
  ridgeNear.material.color.copy(skyHor).lerp(ridgeBase, 0.62).lerp(seasonal(st.q, COLS.hill), 0.18 * (1 - st.night));
  roofMats.forEach((m, i) => m.color.copy(roofBase[i]).lerp(COLS.white, st.snow * 0.85));
  roadMats.dirt.color.copy(COLS.snowWhite).lerp(C(0xf0f0f0), st.snow);
  carpetMat.opacity = st.carpet * (1 - st.snow * 0.9);
  carpet.visible = carpetMat.opacity > 0.01;
  carpet.scale.setScalar(0.4 + 0.6 * st.g);
  // round trees lose leaves in winter
  const ws = st.s === 3 ? 1 - sstep(0.0, 0.2, st.f) * (1 - sstep(0.85, 1, st.f)) : 1;
  const m = _m;
  rounds.forEach((b, i) => { _q.setFromAxisAngle(UP, b.ry); const k = b.s * lerp(0.35, 1, ws); m.compose(_p.set(b.x, (1 - lerp(0.35, 1, ws)) * 3.6 * b.s * 0.6, b.z), _q, _s.set(k, k * 1.05, k)); roundMesh.setMatrixAt(i, m); });
  roundMesh.instanceMatrix.needsUpdate = true;
}

function updateTree(st, t) {
  const g = st.g, T = st.T;
  const thick = 0.1 + 0.9 * Math.pow(g, 0.85);
  const lenK = 0.55 + 0.45 * sstep(0, 1, g);
  for (let i = 0; i < TB.length; i++) {
    const b = TB[i];
    b.gb = clamp((g - b.s) / b.span);
    b.le = b.len * b.gb * (b.level === 0 ? 1 : lenK);
    b.re = b.r0 * thick * (0.35 + 0.65 * b.gb);
    if (b.parent < 0) b.start.set(0, -0.05, 0);
    else { const P = TB[b.parent]; b.start.copy(P.start).addScaledVector(P.dir, P.le * b.pos); }
    if (b.gb <= 0.0001) _m.makeScale(0, 0, 0);
    else { _q.setFromUnitVectors(UP, b.dir); _m.compose(b.start, _q, _s.set(b.re, Math.max(b.le, 0.001), b.re)); }
    branchMesh.setMatrixAt(i, _m);
  }
  branchMesh.instanceMatrix.needsUpdate = true;

  const spreadK = 0.35 + 0.65 * sstep(0, 0.6, g);
  for (let i = 0; i < TLEAVES.length; i++) {
    const l = TLEAVES[i], b = TB[l.b];
    let k = l.sap === 1 ? sstep(0.25, 0.9, b.le) : sstep(l.u - 0.05, l.u + 0.1, b.gb);
    if (l.sap === 1) k *= 1 - sstep(0.4, 0.55, g);
    if (l.sap === 2) k *= 1 - sstep(0.6, 0.72, g);
    let ks;
    if (st.s === 0) ks = sstep(l.r * 0.6, l.r * 0.6 + 0.4, st.L) * lerp(0.6, 1, st.L);
    else if (st.s === 2) ks = st.L >= 0.999 ? 1 : sstep(l.r * 0.92 - 0.02, l.r * 0.92 + 0.06, st.L);
    else ks = st.L;
    const sapK = l.sap === 1 ? clamp(b.le / 2.2, 0.35, 1) : 1;
    const sc = l.size * k * ks * sapK;
    l.pos.copy(b.start).addScaledVector(b.dir, b.le * l.u).addScaledVector(l.off, l.sap === 1 ? clamp(b.le / 3, 0.15, 1) : spreadK);
    _e.set(l.rx + Math.sin(t * 2.3 + l.ph) * 0.16, l.ry, l.rz + Math.cos(t * 1.9 + l.ph) * 0.16);
    _q.setFromEuler(_e);
    _m.compose(l.pos, _q, _s.set(sc, sc, sc));
    leafMesh.setMatrixAt(i, _m);
    // colour
    if (st.s === 2) {
      const gk = clamp(st.gold * 1.35 - l.cv * 0.35);
      _c.copy(COLS.leafSummer).lerp(l.goldC, gk);
    } else if (st.s === 0) _c.copy(COLS.leafSpring).lerp(COLS.leafSummer, 1 - st.fresh);
    else _c.copy(COLS.leafSummer);
    _c.multiplyScalar(lerp(0.82, 1.12, l.cv));
    leafMesh.setColorAt(i, _c);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  leafMesh.instanceColor.needsUpdate = true;

  // falling leaves (effects clock = video time t)
  const intensity = st.fall;
  for (let i = 0; i < FALLN; i++) {
    const f = FALL[i];
    const kk = sstep(f.r, f.r + 0.06, intensity);
    if (kk <= 0) { fallMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
    const src = TLEAVES[f.src].pos;
    const age = (t + f.off) % f.P;
    const h0 = Math.max(src.y, 1.5), dur = h0 / f.v;
    let sc = f.size * kk;
    if (age < dur) {
      _p.set(src.x + Math.sin(age * 1.7 + f.ph) * 0.9 + age * 0.45, h0 - f.v * age, src.z + Math.cos(age * 1.3 + f.ph) * 0.7);
      _e.set(age * 2.1 + f.ph, age * 1.3, age * 1.7 + f.rz);
    } else {
      _p.set(src.x + Math.sin(dur * 1.7 + f.ph) * 0.9 + dur * 0.45, 0.07, src.z + Math.cos(dur * 1.3 + f.ph) * 0.7);
      _e.set(-Math.PI / 2, 0, f.rz);
      sc *= 1 - sstep(f.P - 1.2, f.P, age);
    }
    _q.setFromEuler(_e);
    fallMesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(sc, sc, sc)));
    fallMesh.setColorAt(i, _c.copy(mixC(COLS.gold, COLS.gold2, f.cv)).multiplyScalar(lerp(0.85, 1.1, f.cv)));
  }
  fallMesh.instanceMatrix.needsUpdate = true;
  fallMesh.instanceColor.needsUpdate = true;

  // seed & sprout
  let sy;
  if (T < 0.15) sy = 2.6;
  else if (T < 0.75) { const a = (T - 0.15) / 0.6; sy = lerp(2.6, 0.1, a * a); }
  else if (T < 1.25) { const a = (T - 0.75) / 0.5; sy = 0.1 + Math.sin(a * Math.PI) * 0.12 * (1 - a); }
  else sy = lerp(0.1, -0.14, sstep(2.3, 3.4, T));
  seed.position.set(0.02, sy, 0.0);
  seed.visible = T < 3.6 && st.g < 0.01;
  const sg = sstep(3.0, 5.0, T) * (1 - sstep(5.9, 6.8, T));
  sprout.visible = sg > 0.001;
  stem.scale.set(1.4, 0.5 * sg, 1.4);
  const open = sstep(4.0, 5.6, T) * (1 - sstep(5.9, 6.8, T));
  sproutLeaves.forEach((m, i) => { const side = i ? 1 : -1; m.position.set(0, 0.5 * sg, 0); m.rotation.set(0, i * Math.PI + 0.6, side * lerp(0.15, 0.85, open) + Math.sin(t * 2 + i) * 0.04); m.scale.setScalar(0.36 * open + 0.001); });

  // grass blades
  const gh = st.s === 3 ? lerp(1, 0.55, st.snow) : 1;
  const plazaK = sstep(34.2, 35.2, T);
  for (let i = 0; i < GRASSN; i++) {
    const b = GRASS[i];
    let k = gh;
    if (b.r > 3.0 && b.r < 9.8) k *= 1 - plazaK;
    if (b.r > 2.95 && b.r < 3.4) k *= 1 - sstep(34.2, 34.6, T);
    _e.set(b.tx + Math.sin(t * 1.8 + b.ry) * 0.06, b.ry, b.tz);
    _q.setFromEuler(_e);
    grassMesh.setMatrixAt(i, _m.compose(_p.set(b.x, 0, b.z), _q, _s.set(1, b.h * k + 0.0001, 1)));
  }
  grassMesh.instanceMatrix.needsUpdate = true;
  plaza.visible = plazaK > 0.001;
  plaza.scale.setScalar(lerp(0.36, 1, easeOutBack(plazaK)));
  pool.visible = T > 34.2;
  pool.scale.set(1, sstep(34.2, 34.8, T), 1);

  // ribbons
  for (const r of RIBBONS) {
    const k = sstep(r.t0, r.t0 + 0.5, T);
    r.m.visible = k > 0.001;
    if (!r.m.visible) continue;
    const b = TB[r.b];
    r.m.position.copy(b.start).addScaledVector(b.dir, b.le * r.pos);
    r.m.position.y -= 0.05;
    r.m.rotation.set(Math.sin(t * 1.7 + r.ph) * 0.22, r.ry, Math.cos(t * 1.3 + r.ph) * 0.18);
    r.m.scale.set(1, k * r.len, 1);
  }
}

function updateVillage(st, t) {
  const T = st.T;
  for (const h of HOUSES) {
    let a = clamp((T - h.buildT) / h.dur);
    const vis = T >= h.buildT && !(h.demolishT !== null && h.demolishT !== undefined && T > h.demolishT + 0.4);
    h.grp.visible = vis;
    if (!vis) { h.k = 0; continue; }
    let bodyK, roofK, sink = 0;
    if (h.first) { bodyK = easeOutBack(clamp((a - 0.08) / 0.5)); roofK = clamp((a - 0.6) / 0.32); }
    else { bodyK = easeOutBack(clamp(a / 0.6)); roofK = clamp((a - 0.45) / 0.5); }
    if (h.demolishT != null && T > h.demolishT) sink = clamp((T - h.demolishT) / 0.4);
    const k = Math.max(0.0001, bodyK * (1 - sink));
    h.body.scale.set(lerp(0.85, 1, clamp(a * 3)), k, lerp(0.85, 1, clamp(a * 3)));
    h.roof.visible = roofK > 0;
    h.roof.position.y = h.h * k + (1 - easeOutBounce(roofK)) * 7;
    h.roof.scale.set(1, 1 - sink, 1);
    h.k = k * (roofK > 0 ? 1 : 0.999);
  }
  village.updateMatrixWorld(true);
  // windows
  const nightLvl = sstep(0.55, 1.7, st.u);
  const full = T > 45 ? 0.96 : 0.74;
  for (let i = 0; i < WINS.length; i++) {
    const w = WINS[i], h = HOUSES[w.h];
    if (!h.grp.visible || h.k < 0.02) { winMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
    _m.multiplyMatrices(h.body.matrixWorld, w.m);
    winMesh.setMatrixAt(i, _m);
    const lit = h.onT !== undefined && T >= h.onT + w.r1 * 0.3 && nightLvl > w.r2 * 0.6 + 0.04 && w.r3 < full;
    if (lit) _c.copy(COLS.winLit).multiplyScalar(lerp(0.8, 1.15, w.r2) * clamp(nightLvl * 1.5));
    else _c.copy(COLS.winDay).lerp(COLS.winNight, nightLvl).multiplyScalar(lerp(0.7, 1.0, w.r1));
    winMesh.setColorAt(i, _c);
  }
  winMesh.instanceMatrix.needsUpdate = true;
  winMesh.instanceColor.needsUpdate = true;

  // roads, lanes, fields
  const roadK = sstep(18.7, 20.9, T);
  roadHalves.forEach((r) => { const n = Math.floor((roadK * r.n) / 6) * 6; r.geo.setDrawRange(0, n); r.dirt.visible = r.asph.visible = n > 0; });
  const asph = sstep(33.6, 34.5, T);
  roadMats.asph.opacity = asph; roadMats.dirt.opacity = 1 - asph * 0.999;
  laneMeshes.forEach((l, i) => { const k = sstep(21 + i * 0.6, 23.6 + i * 0.6, T); const n = Math.floor((k * l.n) / 6) * 6; l.geo.setDrawRange(0, n); l.dirt.visible = l.conc.visible = n > 0; });
  laneMats.conc.opacity = sstep(34.0, 35.0, T); laneMats.dirt.opacity = 1 - laneMats.conc.opacity * 0.999;
  FIELDS.forEach((f, i) => { const k = sstep(f.t0, f.t0 + 0.6, T); _q.setFromAxisAngle(UP, f.rot); fieldMesh.setMatrixAt(i, _m.compose(_p.set(f.x, 0.02, f.z), _q, _s.set(f.w * k + 0.0001, 1, f.d * k + 0.0001))); });
  fieldMesh.instanceMatrix.needsUpdate = true;

  // poles, wires, bulb
  POLES.forEach((p) => { const k = clamp((T - p.t0) / 0.45); p.grp.visible = k > 0; p.grp.scale.set(1, Math.max(0.001, easeOutBack(k)), 1); });
  wireMat.opacity = 1;
  WIRES.forEach((w) => (w.line.visible = T > w.t));
  const bulbOn = T > 28.95 ? 1 : 0;
  const flick = T > 28.95 && T < 29.25 ? (hash(Math.floor(T * 40)) > 0.35 ? 1 : 0.15) : 1;
  bulbMat.color.setRGB(0.4, 0.4, 0.38);
  if (bulbOn) bulbMat.color.copy(new THREE.Color(3.2, 2.2, 1.0)).multiplyScalar(flick * lerp(0.3, 1, st.night));
  bulbPole.grp.updateMatrixWorld();
  bulbLight.position.copy(bulb.getWorldPosition(_p));
  bulbLight.intensity = bulbOn * flick * st.night * 60;

  LAMPS.forEach((l) => { const k = clamp((T - l.t0) / 0.4); l.grp.visible = k > 0; l.grp.scale.set(1, Math.max(0.001, easeOutBack(k)), 1); });
  lampHeadMat.color.copy(st.night > 0.3 ? new THREE.Color(3.0, 2.3, 1.3).multiplyScalar(st.night) : C(0x9a9a9a));

  // cars
  const roadL = road.getLength();
  CARS.forEach((c) => {
    const tt = T - 34.4 - c.delay;
    let s = c.dir > 0 ? tt * c.v : 1 - tt * c.v;
    const vis = tt > 0 && s > 0.005 && s < 0.995;
    c.grp.visible = vis;
    if (!vis) return;
    const p = road.getPointAt(s), tg = road.getTangentAt(s).multiplyScalar(c.dir);
    c.grp.position.set(p.x - tg.z * -c.lane, 0.05, p.z + tg.x * -c.lane);
    c.grp.rotation.y = Math.atan2(tg.x, tg.z);
    c.hl.material.color.setRGB(1, 1, 1).multiplyScalar(lerp(1, 4, st.night));
    c.tl.material.color.setRGB(1, 0.1, 0.08).multiplyScalar(lerp(0.7, 3, st.night));
  });
  void roadL;

  // lanterns
  lanternMat.emissiveIntensity = lerp(0.25, 2.2, st.night);
  let li = 0, ci = 0;
  for (const L of LANTERNS) {
    const k = easeOutBack(clamp((T - L.t0) / 0.45));
    let pos;
    if (L.tree) { const b = TB[L.b]; pos = _p.copy(b.start).addScaledVector(b.dir, b.le * L.pos); pos.y -= L.drop + Math.sin(t * 1.4 + L.ph) * 0.03; }
    else { const h = HOUSES[L.h]; if (!h.grp.visible || h.k < 0.9) { lanternBody.setMatrixAt(li++, _m.makeScale(0, 0, 0)); lanternCap.setMatrixAt(ci++, _m); lanternCap.setMatrixAt(ci++, _m); continue; } pos = _p.set(h.door.x + L.sd * h.doorHalf, h.door.y, h.door.z).applyMatrix4(h.body.matrixWorld); }
    const s = 0.42 * L.s * Math.max(0, k);
    if (s <= 0.0001) { lanternBody.setMatrixAt(li++, _m.makeScale(0, 0, 0)); lanternCap.setMatrixAt(ci++, _m); lanternCap.setMatrixAt(ci++, _m); continue; }
    _q.identity();
    lanternBody.setMatrixAt(li++, _m.compose(pos, _q, _s.set(s, s * 0.82, s)));
    const top = pos.clone(); top.y += s * 0.82; const bot = pos.clone(); bot.y -= s * 0.82;
    lanternCap.setMatrixAt(ci++, _m.compose(top, _q, _s.set(s * 0.55, s * 0.18, s * 0.55)));
    lanternCap.setMatrixAt(ci++, _m.compose(bot, _q, _s.set(s * 0.55, s * 0.18, s * 0.55)));
  }
  lanternBody.instanceMatrix.needsUpdate = true;
  lanternCap.instanceMatrix.needsUpdate = true;
}

function updateParticles(st, t) {
  const T = st.T;
  // snow
  snowMat.uniforms.opacity.value = st.snowFall * 0.9;
  snowPts.visible = st.snowFall > 0.01;
  if (snowPts.visible) {
    const a = snowGeo.attributes.position.array;
    for (let i = 0; i < SNOWN; i++) { const s = SNOW[i]; const y = 60 - ((s.y + t * s.v) % 60); a[i * 3] = s.x + Math.sin(t * 0.7 + s.ph) * 1.2; a[i * 3 + 1] = y; a[i * 3 + 2] = s.z + Math.cos(t * 0.5 + s.ph) * 1.0; }
    snowGeo.attributes.position.needsUpdate = true;
  }
  // chimney smoke
  {
    const pa = smokeGeo.attributes.position.array, sa = smokeGeo.attributes.size.array, aa = smokeGeo.attributes.alpha.array;
    SMOKE_HOUSES.forEach((h, hi) => {
      const on = h.grp.visible && h.k > 0.95 && T > h.buildT + h.dur + 0.3 ? 1 - st.night : 0;
      const wp = h.chimney.clone(); wp.y += h.h; wp.applyMatrix4(h.grp.matrixWorld);
      for (let j = 0; j < SMOKEPER; j++) {
        const i = hi * SMOKEPER + j, age = (t * 0.32 + j / SMOKEPER + hi * 0.137) % 1;
        pa[i * 3] = wp.x + age * 3.2 + Math.sin(age * 6 + j) * 0.3; pa[i * 3 + 1] = wp.y + age * 5.5; pa[i * 3 + 2] = wp.z + Math.cos(age * 5 + j) * 0.3;
        sa[i] = lerp(0.8, 3.4, age); aa[i] = on * 0.42 * sstep(0, 0.12, age) * (1 - age);
      }
    });
    smokeGeo.attributes.position.needsUpdate = smokeGeo.attributes.size.needsUpdate = smokeGeo.attributes.alpha.needsUpdate = true;
  }
  // firecrackers
  {
    const pa = crGeo.attributes.position.array, ca = crGeo.attributes.color.array;
    let i = 0;
    CRACK_SITES.forEach((cs, si) => {
      const h = cs.h, active = T > cs.t0 && T < cs.t1 && h.grp.visible;
      const base = new THREE.Vector3(h.door.x + 2.2, 0.2, h.door.z + 1.6).applyMatrix4(h.grp.matrixWorld);
      const fr = Math.floor(T * 30);
      for (let j = 0; j < 46; j++, i++) {
        const hs = hash(j * 13.7 + fr * 1.31 + si * 7.7);
        const on = active && hs > 0.62;
        pa[i * 3] = base.x + (hash(j + fr * 0.7 + si) - 0.5) * 1.6; pa[i * 3 + 1] = base.y + hash(j * 3.1 + fr) * 1.4; pa[i * 3 + 2] = base.z + (hash(j * 5.3 + fr * 1.9) - 0.5) * 1.6;
        const b = on ? 3.5 : 0; ca[i * 3] = b; ca[i * 3 + 1] = b * 0.78; ca[i * 3 + 2] = b * 0.45;
      }
    });
    crGeo.attributes.position.needsUpdate = crGeo.attributes.color.needsUpdate = true;
  }
  // fireworks
  const pa = fwGeo.attributes.position.array, ca = fwGeo.attributes.color.array;
  let n = 0, flash = 0;
  const flashCol = new THREE.Color(0, 0, 0);
  const put = (x, y, z, r, g, b) => { if (n >= FWMAX) return; pa[n * 3] = x; pa[n * 3 + 1] = y; pa[n * 3 + 2] = z; ca[n * 3] = r; ca[n * 3 + 1] = g; ca[n * 3 + 2] = b; n++; };
  for (const B of FW.bursts) {
    if (T < B.launch || T > B.explode + B.life + 0.1) continue;
    if (T < B.explode) {
      const u = (T - B.launch) / (B.explode - B.launch);
      for (let j = 0; j < 7; j++) {
        const uj = clamp(u - j * 0.025); const e = 1 - (1 - uj) * (1 - uj);
        const br = (1 - j / 7) * 2.6;
        put(lerp(B.base.x, B.center.x, e) + Math.sin(uj * 20) * 0.08, B.center.y * e, lerp(B.base.z, B.center.z, e), br, br * 0.75, br * 0.4);
      }
      continue;
    }
    const a0 = T - B.explode;
    const fl = Math.exp(-a0 * 5);
    flash += fl; flashCol.r += B.col[0] * fl; flashCol.g += B.col[1] * fl; flashCol.b += B.col[2] * fl;
    const k = B.type === 'willow' ? 1.1 : 2.0, gr = B.type === 'willow' ? 4.5 : 3.0;
    const trails = B.type === 'willow' ? 6 : 4;
    for (let i = 0; i < B.dirs.length; i++) {
      const D = B.dirs[i];
      const col = B.col2 && i % 2 ? B.col2 : B.col;
      for (let j = 0; j < trails; j++) {
        const a = a0 - j * (B.type === 'willow' ? 0.07 : 0.045);
        if (a < 0) break;
        const life = B.life * lerp(0.85, 1.1, D.sd);
        if (a > life) continue;
        let br = Math.pow(1 - a / life, 1.4) * Math.pow(0.6, j) * 3.6;
        if (a > life * 0.55) br *= hash(i * 7.1 + Math.floor(a * 26)) > 0.45 ? 1.5 : 0.25;
        const disp = (B.v0 * D.sp * (1 - Math.exp(-k * a))) / k;
        put(B.center.x + D.d.x * disp, B.center.y + D.d.y * disp - 0.5 * gr * a * a, B.center.z + D.d.z * disp, col[0] * br, col[1] * br, col[2] * br);
      }
    }
  }
  fwGeo.attributes.position.needsUpdate = fwGeo.attributes.color.needsUpdate = true;
  fwGeo.setDrawRange(0, Math.max(n, 1));
  fwPts.visible = n > 0;
  // fireworks flash lights the scene a little
  hemi.intensity += Math.min(flash, 1.5) * 0.35;
  if (flash > 0) hemi.color.lerp(flashCol.multiplyScalar(1 / flash), Math.min(flash, 1) * 0.35);
  return flash;
}

function updateCamera(t) {
  const c = camAt(t);
  camera.position.copy(camPos(c));
  camera.lookAt(0, c.ty, 0);
  camera.fov = c.fov;
  camera.near = clamp(c.r * 0.015, 0.03, 1.5);
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  stars.position.copy(camera.position);
  return c;
}

function updatePost(st, t) {
  const T = st.T;
  const amt = t < HOOK_HOLD ? 2.4 : t < HOOK_END ? lerp(2.4, 7.5, (t - HOOK_HOLD) / (HOOK_END - HOOK_HOLD)) : tiltF(T);
  tiltH.uniforms.h.value = amt / (W * SCALE);
  tiltV.uniforms.v.value = amt / (H * SCALE);
  tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.5;
  bloom.strength = lerp(0.16, 0.6, st.night);
  bloom.radius = lerp(0.4, 0.55, st.night);
  bloom.threshold = 1.0;
}

// ------------------------------------------------------------------ overlay
const CHAPTERS = [[0, '01', '种子', 'SEED'], [6, '02', '生长', 'GROWING'], [15, '03', '第一户人家', 'FIRST HOME'], [21, '04', '村庄', 'VILLAGE'], [27, '05', '通电', 'POWER ON'], [33, '06', '小楼', 'NEW HOMES'], [39, '07', '金秋', 'GOLDEN AUTUMN'], [45, '08', '除夕', "NEW YEAR'S EVE"], [51, '09', '一百年', 'A CENTURY']];
const SUBS = [
  [0.4, 5.5, '1925年，一颗银杏果落进了泥土里', '1925 — a ginkgo seed falls into the soil.'],
  [6.2, 10.0, '银杏，是从恐龙时代活到今天的树', 'Ginkgo has been around since the dinosaurs.'],
  [10.2, 14.8, '它又叫「公孙树」\n爷爷种下，孙子才吃得上果', "Nicknamed the 'grandpa–grandson tree':\ngrandpa plants it, the grandkids get the fruit."],
  [15.4, 18.2, '1952年，有人在树下盖了第一间房', '1952 — someone built the first house beneath it.'],
  [18.5, 20.9, '后来，有了邻居，有了路', 'Then came neighbours. Then came a road.'],
  [21.4, 26.8, '树一年年变粗，村子一年年变大', 'Year by year, the tree grew thicker, the village bigger.'],
  [27.3, 29.4, '1980年的一个晚上……', 'One night in 1980…'],
  [29.6, 32.8, '村里，通电了', '…the power came on.'],
  [33.4, 35.9, '土坯房，一栋栋变成了小楼', 'One by one, mud houses became little villas.'],
  [36.1, 38.9, '老树挂上了红绸，有人来树下许愿', 'Red ribbons on the old tree — people came to make wishes.'],
  [39.4, 41.9, '每年深秋，它会变成一树金黄', 'Every late autumn, it turns pure gold.'],
  [42.1, 44.9, '然后在一两天之内，落光所有叶子', 'Then, within a day or two, it drops every leaf.'],
  [45.4, 48.0, '除夕夜，在外面的人都回来了', "New Year's Eve. Everyone came home."],
  [48.3, 50.9, '这是它见过的，第100个除夕', "Its 100th New Year's Eve."],
  [51.4, 53.9, '银杏能活三千年', 'A ginkgo can live three thousand years.'],
  [54.1, 57.0, '我们来了又走，它一直都在', 'We come and go. It stays.'],
];
const SEASON_CN = ['春', '夏', '秋', '冬'], SEASON_EN = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
const $ = (s) => document.querySelector(s);
const ui = { chapter: $('#chapter'), num: $('#chapter .num'), cn: $('#chapter .cn'), en: $('#chapter .en'), seasonRow: $('#season .row'), seasonEn: $('#season .en'), season: $('#season'), year: $('#year'), fill: $('#timeline .fill'), dot: $('#timeline .dot'), timeline: $('#timeline'), hook: $('#hook'), hookShade: $('#hookShade'), rewind: $('#rewind'), endcard: $('#endcard'), flash: $('#flash') };
const digitStrips = [];
for (let k = 0; k < 4; k++) {
  const d = document.createElement('div'); d.className = 'digit';
  const s = document.createElement('div'); s.className = 'strip';
  for (let i = 0; i <= 10; i++) { const sp = document.createElement('span'); sp.textContent = String(i % 10); s.appendChild(sp); }
  d.appendChild(s); ui.year.appendChild(d); digitStrips.push(s);
}
const subEls = SUBS.map(([, , cn, en]) => {
  const el = document.createElement('div'); el.className = 'sub sh';
  const c = document.createElement('div'); c.className = 'cn';
  const chars = [];
  for (const ch of cn) { if (ch === '\n') { c.appendChild(document.createElement('br')); continue; } const sp = document.createElement('span'); sp.textContent = ch; c.appendChild(sp); chars.push(sp); }
  const e = document.createElement('div'); e.className = 'en'; e.textContent = en;
  el.appendChild(c); el.appendChild(e); $('#subs').appendChild(el);
  return { el, chars, e };
});
let lastChapter = -1, lastSeason = '';
function yearValue(t) {
  if (t < HOOK_HOLD) return 2025;
  if (t < HOOK_END) return lerp(2025, 1925, easeInOutCubic((t - HOOK_HOLD) / (HOOK_END - HOOK_HOLD)));
  return yearF(t - HOOK_END);
}
function updateUI(t, st) {
  const T = st.T, story = t >= HOOK_END;
  const yr = yearValue(t);
  const y = Math.floor(yr) + sstep(0.55, 1.0, yr - Math.floor(yr));
  for (let k = 0; k < 4; k++) {
    const pk = Math.pow(10, k);
    let p;
    if (k === 0) p = y % 10;
    else p = (Math.floor(y / pk) % 10) + Math.max(0, (y % pk) - (pk - 1));
    digitStrips[3 - k].style.transform = `translateY(${-p * 150}px)`;
  }
  const prog = clamp((y - 1925) / 100);
  ui.fill.style.width = `${prog * 100}%`; ui.dot.style.left = `${prog * 100}%`;
  const age = Math.max(0, Math.floor(y - 1925 + 1e-4));
  const sk = `${SEASON_CN[st.s]} · 树龄 ${age} 年|${SEASON_EN[st.s]} · AGE ${age}`;
  if (sk !== lastSeason) { ui.seasonRow.textContent = sk.split('|')[0]; ui.seasonEn.textContent = sk.split('|')[1]; lastSeason = sk; }
  // chapter
  let ci = 0; for (let i = 0; i < CHAPTERS.length; i++) if (T >= CHAPTERS[i][0]) ci = i;
  if (ci !== lastChapter) { ui.num.textContent = CHAPTERS[ci][1]; ui.cn.textContent = CHAPTERS[ci][2]; ui.en.textContent = CHAPTERS[ci][3]; lastChapter = ci; }
  const cStart = CHAPTERS[ci][0], cEnd = ci + 1 < CHAPTERS.length ? CHAPTERS[ci + 1][0] : 999;
  const chO = story ? sstep(cStart, cStart + 0.4, T) * (1 - sstep(cEnd - 0.3, cEnd, T)) : 0;
  ui.chapter.style.opacity = chO;
  ui.chapter.style.transform = `translateX(${(1 - sstep(cStart, cStart + 0.5, T)) * -24}px)`;
  const endK = story ? sstep(54.3, 55.2, T) : 0;
  ui.season.style.opacity = (story ? sstep(HOOK_END, HOOK_END + 0.4, t) : 0) * (1 - endK * 0.0);
  ui.year.style.opacity = 1;
  ui.timeline.style.opacity = 1;
  // hook
  const hk = 1 - sstep(1.62, 1.92, t);
  ui.hook.style.opacity = hk;
  ui.hookShade.style.opacity = hk;
  ui.hook.style.transform = `scale(${1 + sstep(1.62, 1.92, t) * 0.12})`;
  const rw = sstep(1.8, 1.95, t) * (1 - sstep(2.75, 3.0, t));
  ui.rewind.style.opacity = rw * (hash(Math.floor(t * 12)) > 0.25 ? 1 : 0.6);
  ui.flash.style.opacity = 0.45 * Math.exp(-Math.max(0, t - 1.8) * 9) * (t >= 1.8 ? 1 : 0);
  ui.endcard.style.opacity = endK;
  ui.endcard.style.transform = `translateY(${(1 - endK) * 20}px)`;
  // subtitles
  SUBS.forEach(([t0s, t1s], i) => {
    const t0 = t0s + HOOK_END, t1 = t1s + HOOK_END, s = subEls[i];
    if (!story || t < t0 - 0.02 || t > t1 + 0.4) { s.el.style.display = 'none'; return; }
    s.el.style.display = 'block';
    s.el.style.opacity = 1 - sstep(t1, t1 + 0.35, t);
    s.chars.forEach((sp, j) => { const a = sstep(0, 0.3, t - t0 - j * 0.032); sp.style.opacity = a; sp.style.transform = `translateY(${(1 - a) * 14}px)`; sp.style.filter = a < 0.99 ? `blur(${(1 - a) * 6}px)` : 'none'; });
    s.e.style.opacity = 0.9 * sstep(0.25, 0.75, t - t0);
  });
}

// ------------------------------------------------------------------ main entry
window.renderAt = (t) => {
  const T = storyTime(t);
  const st = stateAt(T);
  updateCamera(t);
  updateEnv(st, t);
  updateTree(st, t);
  updateVillage(st, t);
  updateParticles(st, t);
  updatePost(st, t);
  updateUI(t, st);
  composer.render();
};
window.getEvents = () => ({
  offset: HOOK_END,
  houses: HOUSES.map((h) => ({ kind: h.kind, build: h.buildT, dur: h.dur, demolish: h.demolishT ?? null, on: h.onT ?? null, dist: h.dist, first: !!h.first })),
  poles: POLES.map((p) => p.t0), bulb: 28.95,
  lanterns: LANTERNS.map((l) => l.t0),
  ribbons: RIBBONS.map((r) => r.t0),
  crackers: CRACK_SITES.map((c) => [c.t0, c.t1, c.h.dist]),
  fireworks: FW.bursts.map((b) => ({ launch: b.launch, explode: b.explode, type: b.type, dist: b.center.distanceTo(camPos(storyCam(b.explode))) })),
  subs: SUBS.map((s) => [s[0], s[1]]),
});

(async () => {
  const txt = SUBS.map((s) => s[2]).join('') + CHAPTERS.map((c) => c[2]).join('') + '春夏秋冬树龄年村口这棵银杏今年岁了倒回的0123456789·—◀';
  await Promise.all([
    document.fonts.load('700 56px "Noto Serif SC"', txt), document.fonts.load('900 56px "Noto Serif SC"', txt), document.fonts.load('600 33px "Noto Serif SC"', txt),
    document.fonts.load('500 40px "Cormorant Garamond"', 'abc0123456789'), document.fonts.load('italic 500 34px "Cormorant Garamond"', 'abc'), document.fonts.load('600 40px "Cormorant Garamond"', '0123456789'),
  ]);
  await document.fonts.ready;
  window.renderAt(0);
  window.ready = true;
})();
