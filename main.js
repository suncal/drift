/* DRIFT ✦ — a pocket universe. v2 "HYPERREAL".
   EXPLORE: seeded star systems — textured worlds with clouds, moons, rings,
            comets and derelict stations; scan everything, jump deeper. Fly INTO
            any planet's atmosphere to break through and explore infinite
            procedural terrain on the surface, then climb back to space.
   RUN:     60s asteroid gauntlet; chain beacons, guard your hull.
   Rendering: ACES tone mapping + bloom, procedural Milky Way skybox driving
   real reflections (PMREM), fully greebled physical-material spacecraft.
   Static site, no backend; progress in localStorage. */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- rng / noise ----------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// value noise + fbm (seedable, fast enough for texture bakes + terrain)
function noise2Factory(seed) {
  const h = (x, y) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sm = t => t * t * (3 - 2 * t);
  const vn = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    const ux = sm(fx), uy = sm(fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  return (x, y, oct = 4) => {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { v += vn(x * f, y * f) * amp; amp *= 0.5; f *= 2.07; }
    return v; // ~[0,1]
  };
}

// ---------- names ----------
const SYL_A = ['Ka', 'Ve', 'Tho', 'Ry', 'Ze', 'Al', 'Ori', 'Nym', 'Cra', 'Sol', 'Hel', 'Vor', 'Ash', 'Lu', 'Mar'];
const SYL_B = ['ra', 'lios', 'dan', 'mir', 'thys', 'ven', 'dara', 'x', 'nia', 'los', 'gard', 'una', 'eth', 'is'];
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Theta', 'Sigma', 'Tau', 'Omega'];
function sysName(rng) {
  return `${GREEK[Math.floor(rng() * GREEK.length)]} ${SYL_A[Math.floor(rng() * SYL_A.length)]}${SYL_B[Math.floor(rng() * SYL_B.length)]}`;
}
function smallName(rng) {
  return `${SYL_A[Math.floor(rng() * SYL_A.length)]}${SYL_B[Math.floor(rng() * SYL_B.length)]}`;
}

// planet archetypes + habitat definitions (plants/fauna/weather per biome)
const PLANET_TYPES = [
  { key: 'rock', label: 'Rocky world', col: 0x9a8f7d, ramp: [0x4a4038, 0x8a7a64, 0xcfc0a8], sky: 0xc8b090, sea: null, amp: 26,
    mountainous: true, plants: null, flyers: true, jellies: null, weather: 'dust', fauna: 'Silica gliders' },
  { key: 'ice', label: 'Ice world', col: 0xa8d8e8, ramp: [0x7ba8c0, 0xd8ecf4, 0xffffff], sky: 0xbfe4f5, sea: null, amp: 22,
    mountainous: true, plants: 'shard', flyers: false, jellies: null, weather: 'snow', aurora: true, fauna: 'Frost motes' },
  { key: 'gas', label: 'Gas giant', col: 0xd8a86a, ramp: [0x8a6a4a, 0xd8a86a, 0xf4d8a8], sky: 0xe8c08a, sea: null, amp: 0,
    volume: true, fauna: 'Cloud drifters' },
  { key: 'ocean', label: 'Ocean world', col: 0x4a90c2, ramp: [0x2a6a4a, 0x8aa85a, 0xd8d0a8], sky: 0x9fd0f0, sea: 0x1a5a8a, amp: 18,
    plants: 'tree', flyers: true, jellies: null, weather: 'rain', fauna: 'Reef gliders' },
  { key: 'lava', label: 'Lava world', col: 0xe86a4a, ramp: [0x180c0a, 0x3a2018, 0x6a4030], sky: 0x481810, sea: null, amp: 24, glow: 0xff5a1a,
    mountainous: true, plants: null, flyers: false, jellies: null, weather: 'embers', fauna: 'Ember wisps' },
  { key: 'desert', label: 'Desert world', col: 0xd8c08a, ramp: [0x8a6a3a, 0xc8a86a, 0xf0d8a0], sky: 0xe8c890, sea: null, amp: 12,
    plants: 'cactus', flyers: true, jellies: null, weather: 'dust', fauna: 'Dune striders' },
  { key: 'toxic', label: 'Toxic world', col: 0x9ac25a, ramp: [0x2a3a18, 0x5a7a2a, 0xa8c85a], sky: 0x8aa848, sea: 0x3a5a20, amp: 16,
    plants: 'pod', flyers: false, jellies: 0x9ae070, weather: 'spores', fauna: 'Spore floaters' },
  { key: 'crystal', label: 'Crystal world', col: 0xc8a8e8, ramp: [0x3a2a5a, 0x8a6ab8, 0xd8c0f0], sky: 0x9a80c8, sea: null, amp: 28, glow: 0xb388ff,
    mountainous: true, plants: null, flyers: false, jellies: 0xb388ff, fauna: 'Resonant motes' },
];
const WEATHER = {
  snow:   { col: 0xffffff, size: 0.5,  vy: -6,  vx: 0,  op: 0.8 },
  rain:   { col: 0x9ac8ff, size: 0.4,  vy: -46, vx: 0,  op: 0.6 },
  embers: { col: 0xff7a30, size: 0.55, vy: 9,   vx: 2,  op: 0.9 },
  spores: { col: 0xb8e070, size: 0.5,  vy: -1.5, vx: 1, op: 0.8 },
  dust:   { col: 0xd8b880, size: 0.4,  vy: -2,  vx: 15, op: 0.5 },
};

// ---------- renderer / composer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 8000);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- lights ----------
const ambient = new THREE.AmbientLight(0x8f9db8, 0.32);
scene.add(ambient);
const sunLight = new THREE.PointLight(0xfff2dd, 3.4, 0, 1.55);
scene.add(sunLight);
const fillLight = new THREE.DirectionalLight(0x6f8fd0, 0.35);
fillLight.position.set(-1, 1, -0.5);
scene.add(fillLight);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3020, 0);  // surface mode only
scene.add(hemi);
const surfSun = new THREE.DirectionalLight(0xfff0d8, 0);        // surface mode only
surfSun.position.set(0.4, 1, 0.3);
surfSun.castShadow = true;
surfSun.shadow.mapSize.set(1024, 1024);
surfSun.shadow.camera.left = -180; surfSun.shadow.camera.right = 180;
surfSun.shadow.camera.top = 180; surfSun.shadow.camera.bottom = -180;
surfSun.shadow.camera.near = 10; surfSun.shadow.camera.far = 800;
surfSun.shadow.bias = -0.0006;
scene.add(surfSun);
scene.add(surfSun.target);
const SUN_DIR = new THREE.Vector3(0.55, 0.5, -0.66).normalize(); // surface sun direction

// tiling gray-noise detail texture (terrain grain + water ripples)
function makeDetailTex(repeat) {
  const S = 96, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rng = mulberry32(909);
  for (let i = 0; i < S * S; i++) {
    const v = 205 + rng() * 50;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}
const terrainDetailTex = makeDetailTex(6);

// ---------- procedural Milky Way skybox + environment reflections ----------
const sky = (() => {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // deep space gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#050810'); bg.addColorStop(0.5, '#0a0e1c'); bg.addColorStop(1, '#04060e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const rng = mulberry32(20260816);
  // galactic band: layered soft blobs along a diagonal sine path
  for (let i = 0; i < 900; i++) {
    const u = rng();
    const x = u * W;
    const y = H * 0.5 + Math.sin(u * Math.PI * 2) * H * 0.13 + (rng() - 0.5) * H * 0.16;
    const r = 14 + rng() * 60;
    const warm = rng() < 0.3;
    const a = 0.012 + rng() * 0.022;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, warm ? `rgba(255,220,180,${a * 1.4})` : `rgba(170,190,255,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // dark dust lanes through the band
  for (let i = 0; i < 240; i++) {
    const u = rng();
    const x = u * W;
    const y = H * 0.5 + Math.sin(u * Math.PI * 2) * H * 0.13 + (rng() - 0.5) * H * 0.05;
    const r = 12 + rng() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(4,5,10,${0.1 + rng() * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // nebulae
  const NEB = [[0.18, 0.3, '255,120,150'], [0.72, 0.68, '110,200,255'], [0.45, 0.2, '180,140,255'], [0.9, 0.35, '120,255,200']];
  for (const [nu, nv, rgb] of NEB) {
    for (let i = 0; i < 40; i++) {
      const x = nu * W + (rng() - 0.5) * 260, y = nv * H + (rng() - 0.5) * 160;
      const r = 24 + rng() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${0.012 + rng() * 0.02})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  // stars — dim field + bright haloed ones
  for (let i = 0; i < 3200; i++) {
    const x = rng() * W, y = rng() * H;
    const nearBand = Math.abs(y - (H * 0.5 + Math.sin(x / W * Math.PI * 2) * H * 0.13)) < H * 0.14;
    if (!nearBand && rng() < 0.45) continue;
    const b = 0.3 + rng() * 0.7;
    ctx.fillStyle = `rgba(255,255,255,${b * 0.85})`;
    ctx.fillRect(x, y, rng() < 0.12 ? 2 : 1, 1);
  }
  for (let i = 0; i < 90; i++) {
    const x = rng() * W, y = rng() * H, r = 1.5 + rng() * 3;
    const hueRoll = rng();
    const col = hueRoll < 0.25 ? '180,200,255' : hueRoll < 0.5 ? '255,230,190' : '255,255,255';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, `rgba(${col},0.9)`);
    g.addColorStop(0.25, `rgba(${col},0.25)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 48, 32),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }));
  scene.add(mesh);
  // drive PBR reflections from the same sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  return mesh;
})();

// ---------- texture helpers ----------
function glowTexture(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const sunGlowTex = glowTexture('rgba(255,240,210,1)', 'rgba(255,160,60,0)');
const tealGlowTex = glowTexture('rgba(140,240,255,1)', 'rgba(60,180,255,0)');

const _c = new THREE.Color();
function mix3(ramp, t) {
  const [a, b, c] = ramp;
  if (t < 0.5) _c.set(a).lerp(new THREE.Color(b), t * 2);
  else _c.set(b).lerp(new THREE.Color(c), (t - 0.5) * 2);
  return _c;
}

// equirect planet texture, periodic in longitude (seam-free)
function planetTexture(type, seed) {
  const W = 384, H = 192;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const fbm = noise2Factory(seed);
  const glowCv = type.glow ? document.createElement('canvas') : null;
  let gimg = null, gctx = null;
  if (glowCv) { glowCv.width = W; glowCv.height = H; gctx = glowCv.getContext('2d'); gimg = gctx.createImageData(W, H); }

  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      // periodic longitude coords
      const nx = Math.cos(u * Math.PI * 2) * 2.2, ny = Math.sin(u * Math.PI * 2) * 2.2;
      let col, glow = 0;
      if (type.key === 'gas') {
        const warp = fbm(nx + v * 3, ny - v * 2, 4);
        const band = Math.sin(v * Math.PI * (7 + (seed % 5)) + warp * 4.5) * 0.5 + 0.5;
        col = mix3(type.ramp, band);
        const storm = fbm(nx * 2 + 7, ny * 2 + v * 6, 3);
        if (storm > 0.72) col.lerp(new THREE.Color(0xffffff), (storm - 0.72) * 1.6);
      } else if (type.key === 'lava' || type.key === 'crystal') {
        const n = fbm(nx + v * 4, ny + v * 2.5, 5);
        const ridge = Math.abs(n - 0.5) * 2;                 // 0 at ridges
        col = mix3(type.ramp, n);
        if (ridge < 0.1) { const g = 1 - ridge / 0.1; col.lerp(new THREE.Color(type.glow), g * 0.8); glow = g; }
      } else if (type.key === 'ocean' || type.key === 'toxic') {
        const n = fbm(nx + v * 3.4, ny + v * 2.2, 5);
        const lat = Math.abs(v - 0.5) * 2;
        if (n > 0.55) col = mix3(type.ramp, (n - 0.55) * 2.4);
        else { _c.set(type.sea).lerp(new THREE.Color(type.sea).multiplyScalar(1.8), n * 1.4); col = _c; }
        if (lat > 0.86) col.lerp(new THREE.Color(0xffffff), (lat - 0.86) * 6);
      } else {
        const n = fbm(nx + v * 3.6, ny + v * 2.6, 5);
        col = mix3(type.ramp, n);
        const lat = Math.abs(v - 0.5) * 2;
        if (type.key === 'ice' && lat < 0.25) col.lerp(new THREE.Color(0x9ac8e0), 0.3);
      }
      const i = (y * W + x) * 4;
      img.data[i] = col.r * 255; img.data[i + 1] = col.g * 255; img.data[i + 2] = col.b * 255; img.data[i + 3] = 255;
      if (gimg) {
        const gi = glow * 255;
        gimg.data[i] = gi; gimg.data[i + 1] = gi * 0.5; gimg.data[i + 2] = gi * 0.2; gimg.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  let glowTex = null;
  if (gctx) { gctx.putImageData(gimg, 0, 0); glowTex = new THREE.CanvasTexture(glowCv); glowTex.colorSpace = THREE.SRGBColorSpace; }
  return { map: tex, glowMap: glowTex };
}

function cloudTexture(seed) {
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const fbm = noise2Factory(seed);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const nx = Math.cos(u * Math.PI * 2) * 2.4, ny = Math.sin(u * Math.PI * 2) * 2.4;
    const n = fbm(nx + v * 3, ny + v * 4, 4);
    const a = THREE.MathUtils.clamp((n - 0.52) * 4, 0, 1) * 255;
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// sun surface granulation
function sunTexture(seed) {
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const fbm = noise2Factory(seed);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const nx = Math.cos(u * Math.PI * 2) * 3, ny = Math.sin(u * Math.PI * 2) * 3;
    const n = fbm(nx + v * 5, ny + v * 3, 5);
    _c.set(0xff9a30).lerp(new THREE.Color(0xfff4d0), n * n * 1.4);
    const i = (y * W + x) * 4;
    img.data[i] = _c.r * 255; img.data[i + 1] = _c.g * 255; img.data[i + 2] = _c.b * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// displaced rock geometry (unique verts → craggy flat-shaded facets, no cracks)
function rockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const fbm = noise2Factory(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.4 + v.z * 0.7, v.y * 1.4 - v.z * 0.6, 3);
    const s = 1 + (n - 0.5) * 0.85;
    p.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- ultra-detailed ship ----------
const ship = new THREE.Group();          // physics body
const shipModel = new THREE.Group();     // visual child (banking)
ship.add(shipModel);
const shipLights = { plume: null, plumeLight: null, nacelleGlows: [], strobe: null, navL: null, navR: null };
(() => {
  const hull = new THREE.MeshPhysicalMaterial({ color: 0xcdd5e2, metalness: 0.85, roughness: 0.32, clearcoat: 0.65, clearcoatRoughness: 0.25, envMapIntensity: 1.3 });
  const panel = new THREE.MeshPhysicalMaterial({ color: 0x232c3a, metalness: 0.75, roughness: 0.45, envMapIntensity: 1.0 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x59e3ff, emissive: 0x1a8aa8, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1420, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.55, envMapIntensity: 2.4, clearcoat: 1 });

  // fuselage: cylinder body + nose cone + tail block
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.5, 12), hull);
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.15, 12), hull);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.8;
  const tailBlock = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7), panel);
  tailBlock.position.set(0, 0.05, 1.35);
  // cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(1, 0.75, 1.9);
  canopy.position.set(0, 0.36, -0.55);
  const canopyFrame = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 8, 20), panel);
  canopyFrame.rotation.x = Math.PI / 2;
  canopyFrame.position.set(0, 0.37, -0.55);
  canopyFrame.scale.set(1, 1.9, 1);
  // swept wings with panel insets + accent stripes
  const wingGeo = new THREE.BoxGeometry(1.9, 0.08, 1.15);
  const wingL = new THREE.Mesh(wingGeo, hull);
  wingL.position.set(-1.25, -0.06, 0.5);
  wingL.rotation.y = 0.22;
  const wingR = new THREE.Mesh(wingGeo, hull);
  wingR.position.set(1.25, -0.06, 0.5);
  wingR.rotation.y = -0.22;
  const stripeGeo = new THREE.BoxGeometry(1.6, 0.02, 0.09);
  for (const [w, sx] of [[wingL, -1], [wingR, 1]]) {
    const inset = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.5), panel);
    inset.position.set(sx * 0.1, 0.05, 0.15);
    w.add(inset);
    const stripe = new THREE.Mesh(stripeGeo, accent);
    stripe.position.set(sx * 0.05, 0.05, -0.38);
    w.add(stripe);
  }
  // engine nacelles: cylinder + rim torus + inner glow disc + nozzle
  const nacelleParts = [];
  for (const sx of [-1, 1]) {
    const nac = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.5, 12), hull);
    tube.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 8, 16), panel);
    rim.position.z = 0.75;
    const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16),
      new THREE.MeshBasicMaterial({ color: 0x8ff0ff }));
    glowDisc.position.z = 0.78;
    glowDisc.rotation.y = Math.PI;
    const intake = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 12), panel);
    intake.rotation.x = -Math.PI / 2;
    intake.position.z = -0.95;
    nac.add(tube, rim, glowDisc, intake);
    nac.position.set(sx * 0.95, -0.12, 0.75);
    shipModel.add(nac);
    shipLights.nacelleGlows.push(glowDisc);
    nacelleParts.push(nac);
  }
  // center engine nozzle
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 12, 1, true), panel);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.05, 1.85);
  const nozzleGlow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16),
    new THREE.MeshBasicMaterial({ color: 0xaef6ff }));
  nozzleGlow.position.set(0, 0.05, 2.08);
  nozzleGlow.rotation.y = Math.PI;
  // tail fin with accent edge
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, 0.85), hull);
  fin.position.set(0, 0.55, 1.15);
  const finEdge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.75, 0.06), accent);
  finEdge.position.set(0, 0.55, 0.73);
  // RCS pods + antenna + skids + greeble panels
  const rcsGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8);
  for (const [x, y, z, rz] of [[-0.42, 0.1, -1.35, Math.PI / 2], [0.42, 0.1, -1.35, Math.PI / 2], [-0.42, -0.18, -1.35, Math.PI / 2], [0.42, -0.18, -1.35, Math.PI / 2]]) {
    const rcs = new THREE.Mesh(rcsGeo, panel);
    rcs.position.set(x, y, z);
    rcs.rotation.z = rz;
    shipModel.add(rcs);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6), panel);
  antenna.position.set(0.2, 0.62, 0.4);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4455 }));
  antennaTip.position.set(0.2, 0.9, 0.4);
  const skidGeo = new THREE.BoxGeometry(0.1, 0.08, 1.3);
  const skidL = new THREE.Mesh(skidGeo, panel); skidL.position.set(-0.45, -0.4, 0.2);
  const skidR = new THREE.Mesh(skidGeo, panel); skidR.position.set(0.45, -0.4, 0.2);
  const grng = mulberry32(777);
  for (let i = 0; i < 9; i++) {
    const gr = new THREE.Mesh(new THREE.BoxGeometry(0.1 + grng() * 0.2, 0.03, 0.1 + grng() * 0.25), panel);
    gr.position.set((grng() - 0.5) * 0.6, 0.24 + grng() * 0.04, -0.1 + (grng() - 0.5) * 1.6);
    shipModel.add(gr);
  }
  // cockpit dashboard (seen in first-person view through the canopy)
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.24), panel);
  dash.position.set(0, 0.28, -0.82);
  dash.rotation.x = -0.35;
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x1a7a8a, emissiveIntensity: 1.3, roughness: 0.4 });
  for (const sx of [-0.14, 0.14]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), screenMat);
    scr.position.set(sx, 0.35, -0.76);
    scr.rotation.x = -0.5;
    shipModel.add(scr);
  }
  shipModel.add(dash);

  // nav lights: red port / green starboard / white strobe tail
  const navGeoSm = new THREE.SphereGeometry(0.05, 8, 6);
  shipLights.navL = new THREE.Mesh(navGeoSm, new THREE.MeshBasicMaterial({ color: 0xff2233 }));
  shipLights.navL.position.set(-2.1, -0.02, 0.62);
  shipLights.navR = new THREE.Mesh(navGeoSm, new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
  shipLights.navR.position.set(2.1, -0.02, 0.62);
  shipLights.strobe = new THREE.Mesh(navGeoSm, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  shipLights.strobe.position.set(0, 0.98, 1.15);
  // engine plume: layered sprites + light
  const plume = new THREE.Group();
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tealGlowTex, color: 0xd8fbff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  core.scale.setScalar(1.0);
  const outer = new THREE.Sprite(new THREE.SpriteMaterial({ map: tealGlowTex, color: 0x4aa8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  outer.scale.setScalar(2.0);
  const trail = new THREE.Mesh(new THREE.ConeGeometry(0.24, 3.2, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  trail.rotation.x = -Math.PI / 2;
  trail.position.z = 1.7;
  plume.add(core, outer, trail);
  plume.position.set(0, 0.05, 2.15);
  shipLights.plume = plume;
  shipLights.plumeLight = new THREE.PointLight(0x66d9ff, 0, 14, 1.8);
  shipLights.plumeLight.position.set(0, 0.05, 2.4);
  shipModel.add(body, nose, tailBlock, canopy, canopyFrame, wingL, wingR, nozzle, nozzleGlow,
    fin, finEdge, antenna, antennaTip, skidL, skidR,
    shipLights.navL, shipLights.navR, shipLights.strobe, plume, shipLights.plumeLight);
})();
shipModel.traverse(o => { if (o.isMesh) o.castShadow = true; });
scene.add(ship);

// AI-generated hull (assets/ship.glb) swaps in for the chase view when loaded;
// the procedural build stays for the cockpit interior and as fallback.
const keepParts = new Set([shipLights.plume, shipLights.plumeLight, shipLights.navL, shipLights.navR, shipLights.strobe]);
const procParts = shipModel.children.filter(c => !keepParts.has(c));
let glbShip = null;
new GLTFLoader().load('assets/ship.glb', g => {
  const obj = g.scene;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  obj.scale.setScalar(4.6 / Math.max(size.x, size.y, size.z));
  box.setFromObject(obj);
  obj.position.sub(box.getCenter(new THREE.Vector3()));
  obj.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      if (o.material) {
        o.material.metalness = Math.min(0.65, o.material.metalness ?? 0.4);
        o.material.roughness = Math.max(0.3, o.material.roughness ?? 0.5);
        o.material.envMapIntensity = 1.15;
      }
    }
  });
  glbShip = new THREE.Group();
  glbShip.add(obj);
  glbShip.rotation.y = -Math.PI / 2;   // align generated hull's nose with ship forward (-Z)
  shipModel.add(glbShip);
}, undefined, () => { /* keep procedural ship */ });

// ---------- world containers ----------
const world = new THREE.Group();          // space content (per sector / run)
scene.add(world);
const surfaceWorld = new THREE.Group();   // planet-surface content
scene.add(surfaceWorld);
surfaceWorld.visible = false;

function disposeGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse?.(o => { o.geometry?.dispose(); if (o.material?.dispose) o.material.dispose(); });
  }
}
const clearWorld = () => disposeGroup(world);

// ---------- physics / input ----------
const vel = new THREE.Vector3();
const steer = { x: 0, y: 0 };
let thrusting = false, braking = false;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), fwd = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// ---------- game state ----------
const M = { MENU: 0, EXPLORE: 1, RUN: 2, SURFACE: 3, VOLUME: 4 };
let mode = M.MENU;
let sectorIdx = 1;
let scannables = [];         // explore: {mesh,pos,radius,name,type,scanned,kind,entry}
let spinners = [];           // {obj, axis, speed} visual rotation
let orbiters = [];           // moons: {pivot, speed}
let scanTarget = null, scanProgress = 0;
let asteroids = [], beacons = [];
let blackHole = null, wreckBlink = null;
let entrySeq = null, jumpSeq = null, lastWhoosh = 0;
let runScore = 0, runRings = 0, runTime = 60, hull = 100, runActive = false;
let lastHitT = -10;
let lastNow = performance.now();

// surface-mode state
let surf = null;   // {planet, heightAt, chunks:Map, mat, water, dome, feats, seaLevel, type}

const store = {
  get() { try { return JSON.parse(localStorage.getItem('drift') || '{}'); } catch { return {}; } },
  set(d) { localStorage.setItem('drift', JSON.stringify(d)); },
};

// ---------- HUD ----------
const $ = id => document.getElementById(id);
function toast(t1, t2, ms = 3000) {
  $('toast-t1').textContent = t1;
  $('toast-t2').innerHTML = t2;
  $('toast').classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => $('toast').classList.remove('show'), ms);
}

// ---------- EXPLORE: build a seeded system ----------
function buildSystem(idx) {
  clearWorld();
  scannables = []; spinners = []; orbiters = [];
  const rng = mulberry32(hashStr(`drift-sector-${idx}`));
  ambient.intensity = 0.32;
  hemi.intensity = 0; surfSun.intensity = 0;
  const name = sysName(rng);
  $('sectorname').textContent = `Sector ${String(idx).padStart(2, '0')} · ${name}`;

  // sun with granulation + layered corona
  const sunR = 14 + rng() * 10;
  const sun = new THREE.Mesh(new THREE.SphereGeometry(sunR, 32, 24),
    new THREE.MeshBasicMaterial({ map: sunTexture(hashStr(`sun-${idx}`)) }));
  world.add(sun);
  spinners.push({ obj: sun, axis: 'y', speed: 0.02 });
  for (const [s, o] of [[3.2, 0.75], [5.5, 0.35], [9, 0.16]]) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunGlowTex, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(sunR * s);
    world.add(glow);
  }
  sunLight.position.set(0, 0, 0);
  const starClass = ['Class G star', 'Class K star', 'Class F star'][Math.floor(rng() * 3)];
  scannables.push({ mesh: sun, pos: new THREE.Vector3(0, 0, 0), radius: sunR, name, type: starClass, scanned: false, kind: 'star' });

  // planets
  const n = 4 + Math.floor(rng() * 4);
  let orbit = 90;
  for (let i = 0; i < n; i++) {
    orbit += 55 + rng() * 90;
    const type = PLANET_TYPES[Math.floor(rng() * PLANET_TYPES.length)];
    const radius = 4 + rng() * 7;
    const a = rng() * Math.PI * 2;
    const pos = new THREE.Vector3(Math.cos(a) * orbit, (rng() - 0.5) * 30, Math.sin(a) * orbit);
    const texSeed = hashStr(`p-${idx}-${i}`);
    const { map, glowMap } = planetTexture(type, texSeed);
    const matOpts = {
      map, bumpMap: map, bumpScale: 2.2, roughness: 0.92, metalness: 0.02,
      emissiveMap: glowMap || map, emissive: glowMap ? new THREE.Color(type.glow) : new THREE.Color(0xffffff),
      emissiveIntensity: glowMap ? 1.4 : 0.17,
    };
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), new THREE.MeshStandardMaterial(matOpts));
    mesh.position.copy(pos);
    world.add(mesh);
    spinners.push({ obj: mesh, axis: 'y', speed: 0.02 + rng() * 0.05 });
    // clouds on some worlds
    if (['ocean', 'toxic', 'gas', 'ice'].includes(type.key) && rng() < 0.8) {
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, 32, 22),
        new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: cloudTexture(texSeed + 9), transparent: true, depthWrite: false, roughness: 1 }));
      clouds.position.copy(pos);
      world.add(clouds);
      spinners.push({ obj: clouds, axis: 'y', speed: 0.035 + rng() * 0.04 });
    }
    // fresnel atmosphere rim (replaces the old flat sprite halo)
    const rim = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.07, 36, 24), new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { col: { value: new THREE.Color(type.sky) } },
      vertexShader: `varying float vF;
        void main() {
          vec3 n = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vF = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 2.8);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vF; uniform vec3 col;
        void main() { gl_FragColor = vec4(col * vF * 1.6, vF); }`,
    }));
    rim.position.copy(pos);
    world.add(rim);
    // layered rings
    if (rng() < 0.35) {
      const base = new THREE.Color(type.col).offsetHSL(0, -0.15, 0.12);
      const tilt = Math.PI / 2 + (rng() - 0.5) * 0.7;
      for (let k = 0; k < 3; k++) {
        const r0 = radius * (1.45 + k * 0.32), r1 = r0 + radius * (0.14 + rng() * 0.16);
        const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 56),
          new THREE.MeshBasicMaterial({ color: base.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.15), side: THREE.DoubleSide, transparent: true, opacity: 0.28 + rng() * 0.2 }));
        ring.rotation.x = tilt;
        ring.position.copy(pos);
        world.add(ring);
      }
    }
    // moons
    if (radius > 6 && rng() < 0.6) {
      const mCount = 1 + (rng() < 0.3 ? 1 : 0);
      for (let m = 0; m < mCount; m++) {
        const pivot = new THREE.Group();
        pivot.position.copy(pos);
        pivot.rotation.set(rng() * 0.8, rng() * Math.PI * 2, 0);
        const moon = new THREE.Mesh(rockGeometry(texSeed + m + 3, 2),
          new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.95, flatShading: true }));
        moon.scale.setScalar(radius * (0.14 + rng() * 0.1));
        moon.position.x = radius * (1.9 + m * 0.9);
        pivot.add(moon);
        world.add(pivot);
        orbiters.push({ pivot, speed: 0.25 + rng() * 0.3 });
      }
    }
    // faint orbit line
    const seg = 96, lp = new Float32Array(seg * 3);
    for (let s = 0; s < seg; s++) {
      const t = s / (seg - 1) * Math.PI * 2;
      lp[s * 3] = Math.cos(t) * orbit; lp[s * 3 + 1] = pos.y; lp[s * 3 + 2] = Math.sin(t) * orbit;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    world.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x24314a, transparent: true, opacity: 0.5 })));

    scannables.push({ mesh, pos, radius, name: smallName(rng), type: type.label, scanned: false, kind: 'planet', ptype: type, texSeed });
  }

  // comets (scannable, with ion tails away from the sun)
  const nComets = 1 + (rng() < 0.5 ? 1 : 0);
  for (let ci = 0; ci < nComets; ci++) {
    const a = rng() * Math.PI * 2, r = orbit * (0.5 + rng() * 0.8);
    const pos = new THREE.Vector3(Math.cos(a) * r, (rng() - 0.5) * 60, Math.sin(a) * r);
    const nucleus = new THREE.Mesh(rockGeometry(hashStr(`c-${idx}-${ci}`), 1),
      new THREE.MeshStandardMaterial({ color: 0xcfe4f0, roughness: 0.6, metalness: 0.1, flatShading: true }));
    nucleus.scale.setScalar(1.6);
    nucleus.position.copy(pos);
    world.add(nucleus);
    spinners.push({ obj: nucleus, axis: 'x', speed: 0.4 });
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: tealGlowTex, color: 0xbfefff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    coma.scale.setScalar(9);
    coma.position.copy(pos);
    world.add(coma);
    const away = pos.clone().normalize();
    const tail = new THREE.Mesh(new THREE.ConeGeometry(2.6, 46, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9fdfff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    tail.position.copy(pos).addScaledVector(away, 23);
    tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), away);
    world.add(tail);
    scannables.push({ mesh: nucleus, pos, radius: 2, name: `C/${smallName(rng)}`, type: 'Comet', scanned: false, kind: 'comet' });
  }

  // derelict ring station (sometimes)
  if (rng() < 0.4) {
    const a = rng() * Math.PI * 2, r = orbit * (0.4 + rng() * 0.5);
    const pos = new THREE.Vector3(Math.cos(a) * r, (rng() - 0.5) * 40, Math.sin(a) * r);
    const st = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x5a6272, metalness: 0.85, roughness: 0.55 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.8, 10, 40), metal);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), metal);
    st.add(ring, hub);
    for (let s = 0; s < 4; s++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.35, 12, 0.35), metal);
      spoke.rotation.z = s * Math.PI / 4;
      st.add(spoke);
    }
    const beaconBlip = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true }));
    beaconBlip.position.set(0, 0, 2);
    st.add(beaconBlip);
    st.position.copy(pos);
    world.add(st);
    spinners.push({ obj: st, axis: 'z', speed: 0.06 });
    spinners.push({ obj: st, axis: 'x', speed: 0.02 });
    scannables.push({ mesh: st, pos, radius: 8, name: `Derelict ${smallName(rng)}`, type: 'Derelict station', scanned: false, kind: 'station' });
  }

  // rare anomaly — one singular object that makes this sector worth talking about
  blackHole = null; wreckBlink = null; entrySeq = null;
  if (rng() < 0.28) {
    const roll = rng();
    const a = rng() * Math.PI * 2, r = orbit * (0.55 + rng() * 0.6);
    const pos = new THREE.Vector3(Math.cos(a) * r, (rng() - 0.5) * 50, Math.sin(a) * r);
    if (roll < 0.3) {
      // black hole: dark core + glowing accretion disc + gravity well
      const core = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      core.position.copy(pos);
      world.add(core);
      for (const [rr0, rr1, o] of [[9, 16, 0.9], [17, 24, 0.45]]) {
        const disc = new THREE.Mesh(new THREE.RingGeometry(rr0, rr1, 64),
          new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: o, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        disc.rotation.x = Math.PI / 2 - 0.35;
        disc.position.copy(pos);
        world.add(disc);
        spinners.push({ obj: disc, axis: 'z', speed: 0.5 });
      }
      const gl = new THREE.PointLight(0xff9040, 3, 220, 1.6);
      gl.position.copy(pos);
      world.add(gl);
      blackHole = { pos, pull: 3200 };
      scannables.push({ mesh: core, pos, radius: 9, name: `${smallName(rng)} Singularity`, type: 'Black hole', scanned: false, kind: 'anomaly' });
    } else if (roll < 0.55) {
      // binary companion star
      const bR = sunR * (0.45 + rng() * 0.25);
      const b = new THREE.Mesh(new THREE.SphereGeometry(bR, 28, 20),
        new THREE.MeshBasicMaterial({ map: sunTexture(hashStr(`bsun-${idx}`)) }));
      b.position.copy(pos);
      world.add(b);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunGlowTex, color: 0xaaccff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(bR * 5);
      glow.position.copy(pos);
      world.add(glow);
      scannables.push({ mesh: b, pos, radius: bR, name: `${name} B`, type: 'Binary companion', scanned: false, kind: 'anomaly' });
    } else {
      // wrecked mega-freighter, tumbling dark
      const wreck = new THREE.Group();
      const metal = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.8, roughness: 0.6 });
      const spine = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 42), metal);
      wreck.add(spine);
      const wrng = mulberry32(hashStr(`wreck-${idx}`));
      for (let w = 0; w < 8; w++) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(2 + wrng() * 6, 2 + wrng() * 5, 3 + wrng() * 8), metal);
        seg.position.set((wrng() - 0.5) * 6, (wrng() - 0.5) * 6, (wrng() - 0.5) * 38);
        seg.rotation.set(wrng(), wrng(), wrng());
        wreck.add(seg);
      }
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true }));
      blink.position.set(0, 3, -20);
      wreck.add(blink);
      wreckBlink = blink;
      wreck.position.copy(pos);
      world.add(wreck);
      spinners.push({ obj: wreck, axis: 'y', speed: 0.04 });
      spinners.push({ obj: wreck, axis: 'x', speed: 0.015 });
      scannables.push({ mesh: wreck, pos, radius: 24, name: `Hulk of ${smallName(rng)}`, type: 'Wrecked mega-freighter', scanned: false, kind: 'anomaly' });
    }
    setTimeout(() => { if (mode === M.EXPLORE) toast('SENSOR PING', 'Anomalous signature detected in this sector'); }, 2500);
  }

  // decorative asteroid belt
  const beltR = orbit + 90 + rng() * 60;
  const belt = new THREE.InstancedMesh(rockGeometry(hashStr(`belt-${idx}`), 1),
    new THREE.MeshStandardMaterial({ color: 0x8a8f9a, roughness: 0.95, flatShading: true }), 350);
  const d = new THREE.Object3D();
  for (let i = 0; i < 350; i++) {
    const a = rng() * Math.PI * 2, rr = beltR + (rng() - 0.5) * 50;
    d.position.set(Math.cos(a) * rr, (rng() - 0.5) * 22, Math.sin(a) * rr);
    d.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    d.scale.setScalar(0.6 + rng() * 2.2);
    d.updateMatrix();
    belt.setMatrixAt(i, d.matrix);
  }
  world.add(belt);

  ship.position.set(0, 8, 150);
  ship.quaternion.identity();
  vel.set(0, 0, 0);
  $('controlshint').innerHTML = 'Steer with mouse · <b>W / hold click</b> thrust · <b>S</b> brake<br>Fly close to scan · <b>dive into a planet</b> to land';
}

// ---------- RUN ----------
function buildRun() {
  clearWorld();
  scannables = []; spinners = []; orbiters = [];
  asteroids = []; beacons = [];
  const rng = mulberry32(hashStr(`drift-run-${Math.floor(Math.random() * 1e9)}`));
  blackHole = null; wreckBlink = null; entrySeq = null;
  $('sectorname').textContent = 'The Gauntlet';
  sunLight.position.set(0, 400, -800);
  ambient.intensity = 0.8;
  hemi.intensity = 0; surfSun.intensity = 0;

  const N = 520;
  const im = new THREE.InstancedMesh(rockGeometry(hashStr('runrocks'), 1),
    new THREE.MeshStandardMaterial({ color: 0x777d8c, roughness: 0.9, flatShading: true }), N);
  const d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const z = -60 - (i / N) * 2600 - rng() * 30;
    const a = rng() * Math.PI * 2, rr = 6 + Math.pow(rng(), 0.6) * 46;
    const pos = new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, z);
    const s = 1.2 + rng() * 3.4;
    d.position.copy(pos);
    d.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    d.scale.setScalar(s);
    d.updateMatrix();
    im.setMatrixAt(i, d.matrix);
    asteroids.push({ pos, radius: s * 1.15 });
  }
  world.add(im);

  for (let i = 0; i < 26; i++) {
    const z = -140 - i * 95 - rng() * 40;
    const pos = new THREE.Vector3((rng() - 0.5) * 44, (rng() - 0.5) * 44, z);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tealGlowTex, color: 0x8ff0ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.position.copy(pos);
    sp.scale.setScalar(9);
    world.add(sp);
    beacons.push({ sprite: sp, pos, taken: false });
  }

  ship.position.set(0, 0, 40);
  ship.quaternion.identity();
  vel.set(0, 0, 0);
  runScore = 0; runRings = 0; runTime = 60; hull = 100; runActive = true;
  $('controlshint').innerHTML = 'Chain the <b>beacons</b> · dodge the rocks<br><b>W / hold click</b> thrust harder';
}

function endRun(reason) {
  runActive = false;
  mode = M.MENU;
  const d = store.get();
  d.bestScore = Math.max(d.bestScore || 0, runScore);
  store.set(d);
  $('runover-title').textContent =
    reason === 'hull' ? 'HULL BREACH' : reason === 'finish' ? 'CORRIDOR CLEARED +500' : 'RUN COMPLETE';
  $('beaconmark').style.display = 'none';
  $('ro-score').textContent = runScore;
  $('ro-best').textContent = d.bestScore;
  $('ro-rings').textContent = runRings;
  $('runover').classList.add('show');
}

// ---------- SURFACE: fly into a planet, explore infinite terrain ----------
const CHUNK = 220, CHUNK_VERTS = 40, CHUNK_RANGE = 2;   // 5x5 grid of 220-unit tiles
function entryFlash() {
  $('atmoflash').style.opacity = 1;
  setTimeout(() => $('atmoflash').style.opacity = 0, 700);
}
function hideSpace() {
  surfaceWorld.visible = true;
  world.visible = false;
  sky.visible = false;
  sunLight.intensity = 0;
  scanTarget = null; scanProgress = 0;
  $('scanwrap').classList.remove('show');
}
function restoreSpace() {
  disposeGroup(surfaceWorld);
  surfaceWorld.visible = false;
  world.visible = true;
  sky.visible = true;
  scene.fog = null;
  hemi.intensity = 0; surfSun.intensity = 0;
  ambient.intensity = 0.32;
  ambient.color.set(0x8f9db8);
  sunLight.intensity = 3.4;
  const rng0 = mulberry32(hashStr(`drift-sector-${sectorIdx}`));
  $('sectorname').textContent = `Sector ${String(sectorIdx).padStart(2, '0')} · ${sysName(rng0)}`;
  $('controlshint').innerHTML = 'Steer with mouse · <b>W / hold click</b> thrust · <b>S</b> brake<br>Fly close to scan · <b>dive into any world or star</b>';
}

function enterPlanet(p) {
  const type = p.ptype;
  const fbm = noise2Factory(p.texSeed);
  const amp = (type.amp || 14) * 1.35;
  const seaLevel = type.sea != null ? amp * 0.18 : -1e9;
  const ridge = (x, z) => {
    const r = 1 - Math.abs(fbm(x * 0.006 + 7, z * 0.006 - 3, 4) - 0.5) * 2;
    return r * r;
  };
  const heightAt = (x, z) =>
    (fbm(x * 0.004, z * 0.004, 4) - 0.45) * amp * 2.2 +
    fbm(x * 0.025, z * 0.025, 3) * amp * 0.28 +
    (type.mountainous ? ridge(x, z) * amp * 1.15 : 0);

  disposeGroup(surfaceWorld);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: true, map: terrainDetailTex });

  // gradient atmosphere dome with an in-shader sun disc + haze
  const skyCol = new THREE.Color(type.sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      horizon: { value: skyCol.clone().multiplyScalar(1.06) },
      zenith: { value: skyCol.clone().multiplyScalar(0.4).lerp(new THREE.Color(0x16224a), 0.3) },
      sunDir: { value: SUN_DIR },
      sunCol: { value: new THREE.Color(0xfff0d0) },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 horizon, zenith, sunDir, sunCol;
      void main() {
        float h = pow(clamp(1.0 - max(vDir.y, 0.0), 0.0, 1.0), 1.6);
        vec3 col = mix(zenith, horizon, h);
        float s = max(dot(vDir, sunDir), 0.0);
        col += sunCol * (pow(s, 380.0) * 1.7 + pow(s, 20.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  surfaceWorld.add(dome);
  scene.fog = new THREE.Fog(skyCol.clone().multiplyScalar(0.85), 120, 950);
  hemi.color.set(skyCol);
  hemi.groundColor.set(new THREE.Color(type.ramp[0]));
  hemi.intensity = 0.75;
  surfSun.intensity = 1.6;
  ambient.intensity = 0.12;

  // local sun in the sky
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunGlowTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sunSprite.scale.setScalar(240);
  surfaceWorld.add(sunSprite);

  let water = null;
  if (type.sea != null) {
    const waterRipple = makeDetailTex(40);
    water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshPhysicalMaterial({
        color: type.sea, transparent: true, opacity: 0.82, roughness: 0.12, metalness: 0.1,
        envMapIntensity: 1.4, bumpMap: waterRipple, bumpScale: 1.6 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = seaLevel;
    surfaceWorld.add(water);
  }

  // rocks / crystals layer (wraps around the ship — infinite scatter)
  const featGeo = type.key === 'crystal' ? new THREE.ConeGeometry(1, 5, 5) : rockGeometry(p.texSeed + 5, 1);
  const featMat = type.key === 'crystal'
    ? new THREE.MeshStandardMaterial({ color: 0xc8a8f0, emissive: 0x8a5ae0, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3, flatShading: true })
    : new THREE.MeshStandardMaterial({ color: new THREE.Color(type.ramp[1]).multiplyScalar(0.8), roughness: 0.95, flatShading: true });
  const feats = new THREE.InstancedMesh(featGeo, featMat, 140);
  feats.castShadow = true;
  const frng = mulberry32(p.texSeed + 11);
  const featData = [];
  for (let i = 0; i < 140; i++) {
    featData.push({ x: (frng() - 0.5) * CHUNK * 5, z: (frng() - 0.5) * CHUNK * 5, s: 0.8 + frng() * 2.6, r: frng() * Math.PI * 2 });
  }
  surfaceWorld.add(feats);

  // plant life layer per biome
  let plants = null, plantData = null;
  if (type.plants) {
    const cfg = {
      tree: [new THREE.ConeGeometry(1.7, 5, 6), new THREE.MeshStandardMaterial({ color: 0x2a6a35, roughness: 0.9, flatShading: true })],
      cactus: [new THREE.CylinderGeometry(0.32, 0.42, 3.4, 6), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.9, flatShading: true })],
      shard: [new THREE.ConeGeometry(0.8, 3.8, 5), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x3a7a9a, emissiveIntensity: 0.4, roughness: 0.25, flatShading: true })],
      pod: [new THREE.IcosahedronGeometry(0.95, 0), new THREE.MeshStandardMaterial({ color: 0x8ac240, emissive: 0x3a6a10, emissiveIntensity: 0.7, roughness: 0.7, flatShading: true })],
    }[type.plants];
    plants = new THREE.InstancedMesh(cfg[0], cfg[1], 110);
    plants.castShadow = true;
    plantData = [];
    for (let i = 0; i < 110; i++) {
      plantData.push({ x: (frng() - 0.5) * CHUNK * 5, z: (frng() - 0.5) * CHUNK * 5, s: 0.7 + frng() * 1.5, r: frng() * Math.PI * 2 });
    }
    surfaceWorld.add(plants);
  }

  // flying fauna: circling gliders with wing-flap
  let flyers = null, flyerData = null;
  if (type.flyers) {
    flyers = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.55, 1.7, 4).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.7, flatShading: true }), 14);
    flyerData = [];
    for (let i = 0; i < 14; i++) {
      flyerData.push({ x: (frng() - 0.5) * CHUNK * 4, z: (frng() - 0.5) * CHUNK * 4, r: 16 + frng() * 40, h: 14 + frng() * 30, ph: frng() * Math.PI * 2, sp: 0.25 + frng() * 0.35 });
    }
    surfaceWorld.add(flyers);
  }

  // drifting bioluminescent floaters
  let jellies = null, jellyData = null;
  if (type.jellies) {
    jellies = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.9, 10, 8),
      new THREE.MeshStandardMaterial({ color: type.jellies, emissive: type.jellies, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, roughness: 0.4 }), 22);
    jellyData = [];
    for (let i = 0; i < 22; i++) {
      jellyData.push({ x: (frng() - 0.5) * CHUNK * 4, z: (frng() - 0.5) * CHUNK * 4, h: 6 + frng() * 22, ph: frng() * Math.PI * 2, s: 0.7 + frng() * 1.6 });
    }
    surfaceWorld.add(jellies);
  }

  // weather particles
  let weather = null, weatherBase = null, wcfg = null;
  if (type.weather) {
    wcfg = WEATHER[type.weather];
    const N = 420;
    weatherBase = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) weatherBase[i] = frng() * 200;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    weather = new THREE.Points(g, new THREE.PointsMaterial({
      color: wcfg.col, size: wcfg.size, transparent: true, opacity: wcfg.op, depthWrite: false, sizeAttenuation: true }));
    surfaceWorld.add(weather);
  }

  // aurora curtains on ice worlds
  let auroras = null;
  if (type.aurora) {
    const aTex = glowTexture('rgba(120,255,180,0.9)', 'rgba(40,220,140,0)');
    auroras = [];
    for (let k = 0; k < 2; k++) {
      const geo = new THREE.PlaneGeometry(760, 95, 72, 1);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: aTex, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.position.y = 185 + k * 30;
      m.rotation.y = k * 1.2;
      surfaceWorld.add(m);
      auroras.push(m);
    }
  }

  surf = {
    planet: p, heightAt, chunks: new Map(), mat, water, dome, feats, featData,
    plants, plantData, flyers, flyerData, jellies, jellyData,
    weather, weatherBase, wcfg, auroras, sunSprite, seaLevel, type,
    landed: false, surveyP: 0, takeoffHold: 0,
  };
  hideSpace();

  ship.position.set(0, amp * 1.6 + 40, 0);
  ship.quaternion.identity();
  vel.set(0, 0, -20);
  mode = M.SURFACE;
  $('sectorname').textContent = `${p.name} · ${p.type}`;
  $('controlshint').innerHTML = `Exploring <b>${p.name}</b> — slow down near the ground to <b>land</b><br><b>Climb above 170</b> to return to space`;
  toast('ATMOSPHERIC ENTRY', `<b>${p.name}</b> — ${p.type}`);
}

function exitPlanet() {
  const p = surf.planet;
  surf = null;
  restoreSpace();
  ship.position.copy(p.pos).addScaledVector(p.pos.clone().normalize(), p.radius * 1.9);
  ship.quaternion.identity();
  vel.copy(ship.position).sub(p.pos).normalize().multiplyScalar(18);
  mode = M.EXPLORE;
}

// ---------- VOLUME: inside a star, or the cloud ocean of a gas giant ----------
let vol = null;
function enterVolume(kind, p) {
  const isStar = kind === 'star';
  const entryDir = ship.position.clone().sub(p.pos).normalize();
  disposeGroup(surfaceWorld);

  const baseCol = isStar ? new THREE.Color(0xff8a20) : new THREE.Color(p.ptype.sky);
  scene.fog = new THREE.Fog(baseCol.clone().multiplyScalar(isStar ? 1.05 : 0.8), 10, isStar ? 300 : 480);
  ambient.intensity = isStar ? 1.7 : 0.9;
  ambient.color.set(baseCol);
  hemi.color.set(baseCol);
  hemi.groundColor.set(baseCol.clone().multiplyScalar(0.4));
  hemi.intensity = 0.7;
  surfSun.intensity = 0;

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 16),
    new THREE.MeshBasicMaterial({ color: baseCol.clone().multiplyScalar(isStar ? 1.1 : 0.9), side: THREE.BackSide, depthWrite: false }));
  surfaceWorld.add(dome);

  const vrng = mulberry32(hashStr(`${kind}-${p.name}`));
  // floaters: plasma cells inside a star / balloon-fauna in a gas giant
  const floatN = isStar ? 70 : 44;
  const floatMat = isStar
    ? new THREE.MeshStandardMaterial({ color: 0xff6a10, emissive: 0xffa030, emissiveIntensity: 2.2, roughness: 0.6 })
    : new THREE.MeshStandardMaterial({ color: p.ptype.col, emissive: p.ptype.col, emissiveIntensity: 0.7, transparent: true, opacity: 0.5, roughness: 0.5 });
  const floaters = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 10), floatMat, floatN);
  const floatData = [];
  for (let i = 0; i < floatN; i++) {
    floatData.push({ x: (vrng() - 0.5) * 460, y: (vrng() - 0.5) * 460, z: (vrng() - 0.5) * 460, s: isStar ? 2 + vrng() * 7 : 3 + vrng() * 8, ph: vrng() * Math.PI * 2 });
  }
  surfaceWorld.add(floaters);

  // magnetic arcs inside stars / drifting cloud banks inside gas giants
  const props = [];
  if (isStar) {
    for (let i = 0; i < 7; i++) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(16 + vrng() * 26, 1.1, 8, 26, Math.PI * (0.5 + vrng() * 0.5)),
        new THREE.MeshStandardMaterial({ color: 0xffc060, emissive: 0xffd080, emissiveIntensity: 2.6, roughness: 0.4 }));
      arc.position.set((vrng() - 0.5) * 380, (vrng() - 0.5) * 380, (vrng() - 0.5) * 380);
      arc.rotation.set(vrng() * 6, vrng() * 6, vrng() * 6);
      surfaceWorld.add(arc);
      props.push(arc);
    }
  } else {
    for (let i = 0; i < 26; i++) {
      const cl = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunGlowTex, color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false }));
      cl.position.set((vrng() - 0.5) * 500, (vrng() - 0.5) * 500, (vrng() - 0.5) * 500);
      cl.scale.setScalar(70 + vrng() * 130);
      surfaceWorld.add(cl);
      props.push(cl);
    }
  }

  vol = { kind, p, entryDir, dome, floaters, floatData, props, heat: isStar ? 24 : null };
  hideSpace();

  ship.position.set(0, 0, 0);
  ship.quaternion.identity();
  vel.set(0, 0, -16);
  mode = M.VOLUME;
  $('sectorname').textContent = `${isStar ? 'INSIDE' : 'CLOUD OCEAN OF'} ${p.name.toUpperCase()}`;
  $('controlshint').innerHTML = isStar
    ? `You are flying <b>inside ${p.name}</b> — plasma cells and magnetic arcs<br><b>Climb above 170</b> to escape before the hull overheats`
    : `Diving the endless clouds of <b>${p.name}</b> — no surface below<br><b>Climb above 170</b> to return to space`;
  toast(isStar ? 'SOLAR DIVE' : 'CLOUD DIVE', `<b>${p.name}</b> — ${p.type}`);
}

function exitVolume(reason) {
  const { p, entryDir, kind } = vol;
  vol = null;
  restoreSpace();
  ship.position.copy(p.pos).addScaledVector(entryDir, p.radius * (kind === 'star' ? 1.7 : 1.9));
  ship.quaternion.identity();
  vel.copy(entryDir).multiplyScalar(24);
  mode = M.EXPLORE;
  if (reason === 'heat') toast('THERMAL LIMIT', 'Emergency ejection — hull glowing');
}

function chunkKey(cx, cz) { return cx + ',' + cz; }
function buildChunk(cx, cz) {
  const { heightAt, mat, type } = surf;
  const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, CHUNK_VERTS, CHUNK_VERTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const amp = (type.amp || 14) * 1.35;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i) + ox, pos.getZ(i) + oz));
  }
  geo.computeVertexNormals();
  // color by height, darken steep slopes, foam band at the waterline
  const norm = geo.attributes.normal;
  const foam = new THREE.Color(0xe8f4f0);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    const t = THREE.MathUtils.clamp(h / (amp * 1.3) + 0.5, 0, 1);
    const col = mix3(type.ramp, t).clone();
    if (type.sea != null && Math.abs(h - surf.seaLevel) < 0.9) {
      col.lerp(foam, 0.55 * (1 - Math.abs(h - surf.seaLevel) / 0.9));
    }
    const shade = 0.6 + 0.4 * Math.max(0, norm.getY(i));
    colors[i * 3] = col.r * shade; colors[i * 3 + 1] = col.g * shade; colors[i * 3 + 2] = col.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.position.set(ox, 0, oz);
  // PlaneGeometry is centered — offset built into vertex world coords above, so re-zero:
  mesh.position.set(ox, 0, oz);
  surfaceWorld.add(mesh);
  return mesh;
}
function updateChunks() {
  const cx = Math.round(ship.position.x / CHUNK), cz = Math.round(ship.position.z / CHUNK);
  const needed = new Set();
  for (let dx = -CHUNK_RANGE; dx <= CHUNK_RANGE; dx++) for (let dz = -CHUNK_RANGE; dz <= CHUNK_RANGE; dz++) {
    const k = chunkKey(cx + dx, cz + dz);
    needed.add(k);
    if (!surf.chunks.has(k)) surf.chunks.set(k, buildChunk(cx + dx, cz + dz));
  }
  for (const [k, mesh] of surf.chunks) {
    if (!needed.has(k)) {
      surfaceWorld.remove(mesh);
      mesh.geometry.dispose();
      surf.chunks.delete(k);
    }
  }
}

// ---------- infinite near-field dust (space modes) ----------
const DUST_N = 500, DUST_CELL = 260;
const dustBase = new Float32Array(DUST_N * 3);
{
  const rng = mulberry32(4242);
  for (let i = 0; i < DUST_N * 3; i++) dustBase[i] = rng() * DUST_CELL;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color: 0x8fa8d8, size: 0.4, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true,
}));
scene.add(dust);
function updateDust() {
  const p = dustGeo.attributes.position.array;
  const sx = ship.position.x, sy = ship.position.y, sz = ship.position.z;
  const half = DUST_CELL / 2;
  for (let i = 0; i < DUST_N; i++) {
    p[i * 3] = sx + ((dustBase[i * 3] - sx) % DUST_CELL + DUST_CELL * 1.5) % DUST_CELL - half;
    p[i * 3 + 1] = sy + ((dustBase[i * 3 + 1] - sy) % DUST_CELL + DUST_CELL * 1.5) % DUST_CELL - half;
    p[i * 3 + 2] = sz + ((dustBase[i * 3 + 2] - sz) % DUST_CELL + DUST_CELL * 1.5) % DUST_CELL - half;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

// ---------- view mode + procedural engine audio ----------
let viewMode = 'chase';
function setView(v) {
  viewMode = v;
  document.body.classList.toggle('cockpit', v === 'cockpit');
  $('viewbtn').textContent = v === 'cockpit' ? '◉ CHASE · V' : '◉ COCKPIT · V';
}
$('viewbtn').addEventListener('click', e => { e.stopPropagation(); setView(viewMode === 'chase' ? 'cockpit' : 'chase'); });
window.addEventListener('keydown', e => {
  if (e.code === 'KeyV') setView(viewMode === 'chase' ? 'cockpit' : 'chase');
});

let audio = null;
function initAudio() {
  if (audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    // wind / interior-rumble layer (second noise voice, bandpassed)
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = buf; wsrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 500; windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wsrc.connect(windFilter).connect(windGain).connect(ctx.destination);
    wsrc.start();
    // deep-space drone pad (two slow detuned oscillators)
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    for (const f of [54, 55.7, 81.2]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(droneGain);
      o.start();
    }
    droneGain.connect(ctx.destination);
    audio = { ctx, gain, filter, windGain, windFilter, droneGain };
  } catch { audio = null; }
}
function ping(freq = 880, vol = 0.12) {
  if (!audio) return;
  const o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, audio.ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.ctx.currentTime + 0.5);
  o.connect(g).connect(audio.ctx.destination);
  o.start(); o.stop(audio.ctx.currentTime + 0.5);
  o.frequency.exponentialRampToValueAtTime(freq * 1.5, audio.ctx.currentTime + 0.18);
}
window.addEventListener('pointerdown', initAudio, { once: true });

// ---------- input ----------
// Two steering schemes: absolute pointer position (default, mobile-friendly) and
// pointer-lock "virtual stick" (flight-sim: deltas deflect, stick self-centers).
let locked = false, rollInput = 0, boosting = false, boostMeter = 1, boostCooldown = 0;
const coarse = matchMedia('(pointer: coarse)').matches;
canvas.addEventListener('click', () => {
  if (!coarse && !locked && mode !== M.MENU && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { steer.x = 0; steer.y = 0; }
});
window.addEventListener('pointermove', e => {
  if (locked) {
    steer.x = THREE.MathUtils.clamp(steer.x + e.movementX * 0.0016, -1, 1);
    steer.y = THREE.MathUtils.clamp(steer.y + e.movementY * 0.0016, -1, 1);
  } else {
    steer.x = (e.clientX / innerWidth) * 2 - 1;
    steer.y = (e.clientY / innerHeight) * 2 - 1;
  }
});
window.addEventListener('pointerdown', e => {
  if (e.target.closest('button, .card')) return;
  thrusting = true;
  if (!locked) {
    steer.x = (e.clientX / innerWidth) * 2 - 1;
    steer.y = (e.clientY / innerHeight) * 2 - 1;
  }
});
window.addEventListener('pointerup', () => { thrusting = false; });
window.addEventListener('keydown', e => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') thrusting = true;
  if (e.code === 'KeyS' || e.code === 'ArrowDown') braking = true;
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') rollInput = 1;
  if (e.code === 'KeyD' || e.code === 'ArrowRight') rollInput = -1;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') boosting = true;
});
window.addEventListener('keyup', e => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') thrusting = false;
  if (e.code === 'KeyS' || e.code === 'ArrowDown') braking = false;
  if (e.code === 'KeyA' || e.code === 'ArrowLeft' || e.code === 'KeyD' || e.code === 'ArrowRight') rollInput = 0;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') boosting = false;
});
$('thrustbtn').addEventListener('pointerdown', e => { e.stopPropagation(); thrusting = true; });
$('thrustbtn').addEventListener('pointerup', e => { e.stopPropagation(); thrusting = false; });

// ---------- mode switching ----------
function startExplore() {
  mode = M.EXPLORE;
  $('menu').classList.remove('show');
  $('runover').classList.remove('show');
  $('beaconmark').style.display = 'none';
  buildSystem(sectorIdx);
}
function startRunMode() {
  mode = M.RUN;
  $('menu').classList.remove('show');
  $('runover').classList.remove('show');
  buildRun();
}
function jumpSector() {
  if (jumpSeq) return;
  $('jumpbtn').classList.remove('show');
  $('sectordone').classList.remove('show');
  jumpSeq = { t0: lastNow, built: false };
  ping(1180, 0.1);
}

function logDiscovery(name2, type2) {
  const d = store.get();
  d.journal = d.journal || [];
  if (!d.journal.some(j => j.n === name2 && j.s === sectorIdx)) d.journal.push({ n: name2, t: type2, s: sectorIdx });
  d.discoveries = (d.discoveries || 0) + 1;
  store.set(d);
}
$('logbtn').addEventListener('click', () => {
  const j = store.get().journal || [];
  $('journal-list').innerHTML = j.length
    ? j.slice().reverse().map(e2 => `✦ <b>${e2.n}</b> — ${e2.t} <span style="opacity:.55">· S${String(e2.s).padStart(2, '0')}</span>`).join('<br>')
    : 'Nothing logged yet — go scan something.';
  $('journal').classList.add('show');
});
$('journal-close').addEventListener('click', () => $('journal').classList.remove('show'));
$('mode-explore').addEventListener('click', startExplore);
$('mode-run').addEventListener('click', startRunMode);
$('jumpbtn').addEventListener('click', jumpSector);
$('sd-jump').addEventListener('click', jumpSector);
$('sd-menu').addEventListener('click', () => { $('sectordone').classList.remove('show'); mode = M.MENU; $('menu').classList.add('show'); });
$('ro-again').addEventListener('click', startRunMode);
$('ro-menu').addEventListener('click', () => { $('runover').classList.remove('show'); $('menu').classList.add('show'); });
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && mode !== M.MENU) {
    if (mode === M.SURFACE) exitPlanet();
    if (mode === M.VOLUME) exitVolume();
    runActive = false; mode = M.MENU; $('menu').classList.add('show');
    $('jumpbtn').classList.remove('show'); $('scanwrap').classList.remove('show');
  }
});

sectorIdx = store.get().sector || 1;

// ---------- resize ----------
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ---------- flight ----------
const DEAD = 0.07;
let fovTarget = 58;
function applyFlight(dt, maxSpeed, thrustAcc, now) {
  const sx = Math.abs(steer.x) > DEAD ? steer.x : 0;
  const sy = Math.abs(steer.y) > DEAD ? steer.y : 0;
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sx * 1.45 * dt);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -sy * 1.05 * dt);
  ship.quaternion.multiply(qYaw).multiply(qPitch);
  if (rollInput) {
    ship.quaternion.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollInput * 1.7 * dt));
  }
  shipModel.rotation.z += ((-sx * 0.7) - shipModel.rotation.z) * Math.min(1, dt * 6);
  // pointer-lock virtual stick self-centers
  if (locked) { steer.x *= Math.exp(-5.5 * dt); steer.y *= Math.exp(-5.5 * dt); }

  // boost: drains a meter, recharges after a short cooldown
  const boostActive = boosting && boostMeter > 0.02;
  if (boostActive) { boostMeter = Math.max(0, boostMeter - dt * 0.4); boostCooldown = 0.9; }
  else {
    boostCooldown = Math.max(0, boostCooldown - dt);
    if (boostCooldown <= 0) boostMeter = Math.min(1, boostMeter + dt * 0.2);
  }
  const acc = boostActive ? thrustAcc * 2.3 : thrustAcc;
  const vmax = boostActive ? maxSpeed * 1.55 : maxSpeed;
  $('boostfill').style.width = `${Math.round(boostMeter * 100)}%`;

  fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
  if (thrusting || boostActive) vel.addScaledVector(fwd, acc * dt);
  if (braking) vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
  vel.multiplyScalar(Math.max(0, 1 - 0.35 * dt));
  if (vel.length() > vmax) vel.setLength(vmax);
  ship.position.addScaledVector(vel, dt);

  // engine visuals
  const th = boostActive ? 1.6 : thrusting ? 1 : 0;
  const flick = 1 + Math.sin(now / 47) * 0.12 + Math.sin(now / 13) * 0.06;
  const [core, outer, trail] = shipLights.plume.children;
  core.scale.setScalar((0.5 + th * 1.3) * flick);
  outer.scale.setScalar((1.0 + th * 1.8) * flick);
  core.material.opacity = 0.25 + th * 0.7;
  outer.material.opacity = 0.15 + th * 0.45;
  trail.material.opacity = th * 0.32 * flick;
  trail.scale.set(1, 0.4 + th * 1.1, 1);
  shipLights.plumeLight.intensity = th * 2.6 * flick;
  for (const g of shipLights.nacelleGlows) g.material.color.setHex(th ? 0xc8f8ff : 0x2a6a7a);
  shipLights.strobe.material.opacity = (now % 1200) < 90 ? 1 : 0.08;

  // camera: chase or first-person cockpit
  if (viewMode === 'cockpit') {
    tmpV.set(0, 0.63, -0.6).applyQuaternion(ship.quaternion).add(ship.position);
    if (thrusting || boostActive) {
      const sh = boostActive ? 0.07 : 0.03;
      tmpV.x += (Math.random() - 0.5) * sh;
      tmpV.y += (Math.random() - 0.5) * sh;
    }
    camera.position.copy(tmpV);
    tmpQ.copy(ship.quaternion);
    tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), shipModel.rotation.z * 0.55));
    tmpQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-sy * 0.1, -sx * 0.16, 0)));
    camera.quaternion.copy(tmpQ);
    fovTarget = 66 + (vel.length() / maxSpeed) * 10 + (boostActive ? 9 : 0);
  } else {
    tmpV.set(0, 2.6, 9.5).applyQuaternion(ship.quaternion).add(ship.position);
    camera.position.lerp(tmpV, Math.min(1, dt * 4.5));
    tmpV2.copy(ship.position).addScaledVector(fwd, 14);
    camera.lookAt(tmpV2);
    fovTarget = 58 + (vel.length() / maxSpeed) * 9 + (boostActive ? 9 : 0);
  }
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }

  // engine audio follows throttle + speed
  if (audio) {
    const target = (boostActive ? 0.18 : thrusting ? 0.12 : 0.028) + (vel.length() / maxSpeed) * 0.04;
    audio.gain.gain.value += (target - audio.gain.gain.value) * Math.min(1, dt * 5);
    audio.filter.frequency.value = 200 + (vel.length() / maxSpeed) * 500 + (thrusting ? 480 : 0) + (boostActive ? 600 : 0);
  }
}

// ---------- main loop ----------
const smoothstep = t => t * t * (3 - 2 * t);
let manualStep = false;
function tick(now) {
  if (!manualStep) requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;
  const t = now / 1000;

  // ambient spins (planets, sun, clouds, stations, comets)
  for (const s of spinners) s.obj.rotation[s.axis] += s.speed * dt;
  for (const o of orbiters) o.pivot.rotation.y += o.speed * dt;

  if (mode === M.EXPLORE) {
    applyFlight(dt, 95, 42, now);

    // black hole gravity well + wreck blinker
    if (blackHole) {
      tmpV.copy(blackHole.pos).sub(ship.position);
      const bd = tmpV.length();
      if (bd < 200 && bd > 1) {
        vel.addScaledVector(tmpV.normalize(), Math.min(55, blackHole.pull / (bd * bd) * 60) * dt);
        if (bd < 13) {
          vel.addScaledVector(tmpV, -85);
          toast('EVENT HORIZON', 'Slingshot — flung clear of the singularity');
        }
      }
    }
    if (wreckBlink) wreckBlink.material.opacity = (now % 1600) < 140 ? 1 : 0.12;

    // entry sequences: hull-heat buildup, THEN the punch-through
    if (!entrySeq) {
      for (const p of scannables) {
        if (p.kind === 'planet' && ship.position.distanceTo(p.pos) < p.radius * 1.3) {
          entrySeq = { t0: now, fn: () => { if (p.ptype.volume) enterVolume('gas', p); else enterPlanet(p); } };
          ping(360, 0.09);
          break;
        }
        if (p.kind === 'star' && ship.position.distanceTo(p.pos) < p.radius * 1.35) {
          entrySeq = { t0: now, fn: () => enterVolume('star', p) };
          ping(280, 0.1);
          break;
        }
      }
    }
    if (entrySeq) {
      const e = (now - entrySeq.t0) / 1000;
      $('entryheat').style.opacity = Math.min(1, e / 1.0);
      camera.position.x += (Math.random() - 0.5) * e * 0.35;   // building rumble-shake
      camera.position.y += (Math.random() - 0.5) * e * 0.35;
      if (audio) audio.gain.gain.value = Math.min(0.3, audio.gain.gain.value + dt * 0.4);
      vel.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
      if (e > 1.15) {
        $('entryheat').style.opacity = 0;
        entryFlash();
        const fn = entrySeq.fn;
        entrySeq = null;
        fn();
      }
    }

    if (mode === M.EXPLORE) {   // may have just switched to SURFACE
      let best = null, bestD = 1e9;
      for (const p of scannables) {
        if (p.scanned) continue;
        const d2 = ship.position.distanceTo(p.pos) - p.radius;
        if (d2 < bestD) { bestD = d2; best = p; }
      }
      const inRange = best && bestD < 26;
      if (inRange) {
        if (scanTarget !== best) { scanTarget = best; scanProgress = 0; }
        scanProgress += dt / 2.4;
        $('scanwrap').classList.add('show');
        $('scanlabel').textContent = `Scanning ${best.name}`;
        $('scanfill').style.width = `${Math.min(100, scanProgress * 100)}%`;
        if (scanProgress >= 1) {
          best.scanned = true;
          scanTarget = null;
          $('scanwrap').classList.remove('show');
          const remaining = scannables.filter(p => !p.scanned).length;
          ping(880);
          toast('DISCOVERY LOGGED', `<b>${best.name}</b> — ${best.type}${remaining ? ` · ${remaining} left` : ''}`);
          logDiscovery(best.name, best.type);
          if (!remaining) {
            $('discovery-list').innerHTML = scannables.map(p => `✦ <b>${p.name}</b> — ${p.type}`).join('<br>');
            setTimeout(() => $('sectordone').classList.add('show'), 700);
          }
        }
      } else {
        scanTarget = null; scanProgress = 0;
        $('scanwrap').classList.remove('show');
      }

      const spd = Math.round(vel.length() * 3.6);
      const scannedN = scannables.filter(p => p.scanned).length;
      $('readout').innerHTML =
        `<b>${spd}</b> km/s<br>charted <b>${scannedN}/${scannables.length}</b>` +
        `<br>total discoveries <b>${store.get().discoveries || 0}</b>`;
      if (scannedN === scannables.length && !$('sectordone').classList.contains('show')) $('jumpbtn').classList.add('show');
      updateDust();
    }
  }

  if (mode === M.SURFACE && surf) {
    const ground = Math.max(surf.heightAt(ship.position.x, ship.position.z), surf.seaLevel) + 2.2;
    const alt = ship.position.y - ground;   // 0 = resting on the skids

    if (!surf.landed) {
      applyFlight(dt, 70, 38, now);
      vel.y -= 5.5 * dt;
      if (ship.position.y < ground) {
        ship.position.y = ground;
        if (vel.y < 0) vel.y = Math.abs(vel.y) * 0.25;
      }
      // touchdown: low and slow → settle onto the skids
      if (alt < 1.6 && vel.length() < 9 && !thrusting) {
        surf.landed = true;
        surf.takeoffHold = 0;
        vel.set(0, 0, 0);
        ping(440);
        toast('TOUCHDOWN', `<b>${surf.planet.name}</b> — look around with the mouse · hold <b>W</b> to lift off`);
      }
    } else {
      // LANDED: ship parked; free look-around camera; survey the habitat
      ship.position.y += (ground - ship.position.y) * Math.min(1, dt * 6);
      // settle to level attitude, keep heading
      fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      tmpQ.setFromEuler(new THREE.Euler(0, yaw, 0));
      ship.quaternion.slerp(tmpQ, Math.min(1, dt * 4));
      shipModel.rotation.z *= 1 - Math.min(1, dt * 5);
      // orbiting observation camera, mouse steers it
      surf.camA = (surf.camA ?? yaw + Math.PI) + dt * (0.07 + (Math.abs(steer.x) > DEAD ? steer.x * 1.3 : 0));
      const camH = 3.2 - (Math.abs(steer.y) > DEAD ? steer.y * 1.8 : 0);
      tmpV.set(ship.position.x + Math.cos(surf.camA) * 10, ship.position.y + camH, ship.position.z + Math.sin(surf.camA) * 10);
      tmpV.y = Math.max(tmpV.y, surf.heightAt(tmpV.x, tmpV.z) + 1.2);
      camera.position.lerp(tmpV, Math.min(1, dt * 3.5));
      camera.lookAt(ship.position.x, ship.position.y + 1, ship.position.z);
      // habitat survey while parked
      if (!surf.planet.surveyed) {
        surf.surveyP += dt / 5;
        $('scanwrap').classList.add('show');
        $('scanlabel').textContent = `Surveying habitat`;
        $('scanfill').style.width = `${Math.min(100, surf.surveyP * 100)}%`;
        if (surf.surveyP >= 1) {
          surf.planet.surveyed = true;
          $('scanwrap').classList.remove('show');
          logDiscovery(`${surf.planet.name} habitat`, surf.type.fauna);
          ping(660);
          toast('HABITAT SURVEYED', `<b>${surf.type.fauna}</b> logged on ${surf.planet.name}`);
        }
      }
      // hold W / click to take off
      if (thrusting) {
        surf.takeoffHold += dt;
        if (surf.takeoffHold > 0.45) {
          surf.landed = false;
          $('scanwrap').classList.remove('show');
          vel.set(0, 14, 0);
        }
      } else surf.takeoffHold = 0;
    }

    updateChunks();
    if (surf.water) {
      surf.water.position.x = ship.position.x; surf.water.position.z = ship.position.z;
      surf.water.material.bumpMap.offset.set(t * 0.021, t * 0.013);   // slow ripple drift
    }
    surf.dome.position.copy(ship.position);
    surf.sunSprite.position.set(
      ship.position.x + SUN_DIR.x * 760, ship.position.y + SUN_DIR.y * 760, ship.position.z + SUN_DIR.z * 760);
    // shadow-casting sun follows the ship
    surfSun.position.copy(ship.position).addScaledVector(SUN_DIR, 320);
    surfSun.target.position.copy(ship.position);
    surfSun.target.updateMatrixWorld();

    // wrap-scatter layers: rocks/crystals + plants
    const d = new THREE.Object3D();
    const span = CHUNK * 5;
    const wrapPlace = (im, data, onGround) => {
      for (let i = 0; i < data.length; i++) {
        const f = data[i];
        const wx = ship.position.x + ((f.x - ship.position.x) % span + span * 1.5) % span - span / 2;
        const wz = ship.position.z + ((f.z - ship.position.z) % span + span * 1.5) % span - span / 2;
        const h = surf.heightAt(wx, wz);
        if (h < surf.seaLevel + (onGround === 'plant' ? 1.5 : 0)) { d.scale.setScalar(0.001); d.position.set(wx, -200, wz); }
        else { d.position.set(wx, h + (onGround === 'plant' ? f.s * 1.4 : 0), wz); d.scale.setScalar(f.s); }
        d.rotation.set(0, f.r, 0);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    };
    wrapPlace(surf.feats, surf.featData, 'rock');
    if (surf.plants) wrapPlace(surf.plants, surf.plantData, 'plant');

    // flyers: circling gliders with wing-flap
    if (surf.flyers) {
      const wspan = CHUNK * 4;
      for (let i = 0; i < surf.flyerData.length; i++) {
        const f = surf.flyerData[i];
        const cx2 = ship.position.x + ((f.x - ship.position.x) % wspan + wspan * 1.5) % wspan - wspan / 2;
        const cz2 = ship.position.z + ((f.z - ship.position.z) % wspan + wspan * 1.5) % wspan - wspan / 2;
        const a = t * f.sp + f.ph;
        const wx = cx2 + Math.cos(a) * f.r, wz = cz2 + Math.sin(a) * f.r;
        const wy = Math.max(surf.heightAt(wx, wz), surf.seaLevel) + f.h + Math.sin(t * 1.7 + f.ph) * 3;
        d.position.set(wx, wy, wz);
        d.rotation.set(0, -a, Math.sin(t * 9 + f.ph) * 0.35);
        d.scale.set(1 + Math.sin(t * 9 + f.ph) * 0.25, 1, 1);
        d.updateMatrix();
        surf.flyers.setMatrixAt(i, d.matrix);
      }
      surf.flyers.instanceMatrix.needsUpdate = true;
    }
    // jellies: bobbing bioluminescent floaters
    if (surf.jellies) {
      const wspan = CHUNK * 4;
      for (let i = 0; i < surf.jellyData.length; i++) {
        const f = surf.jellyData[i];
        const wx = ship.position.x + ((f.x + t * 1.5 - ship.position.x) % wspan + wspan * 1.5) % wspan - wspan / 2;
        const wz = ship.position.z + ((f.z - ship.position.z) % wspan + wspan * 1.5) % wspan - wspan / 2;
        const wy = Math.max(surf.heightAt(wx, wz), surf.seaLevel) + f.h + Math.sin(t * 0.9 + f.ph) * 4;
        d.position.set(wx, wy, wz);
        d.rotation.set(0, 0, 0);
        const squish = 1 + Math.sin(t * 2.2 + f.ph) * 0.18;
        d.scale.set(f.s, f.s * squish, f.s);
        d.updateMatrix();
        surf.jellies.setMatrixAt(i, d.matrix);
      }
      surf.jellies.instanceMatrix.needsUpdate = true;
    }
    // weather
    if (surf.weather) {
      const wp = surf.weather.geometry.attributes.position.array;
      const cell = 200, half = 100;
      for (let i = 0; i < surf.weatherBase.length / 3; i++) {
        surf.weatherBase[i * 3] += surf.wcfg.vx * dt;
        surf.weatherBase[i * 3 + 1] += surf.wcfg.vy * dt;
        wp[i * 3] = ship.position.x + ((surf.weatherBase[i * 3] - ship.position.x) % cell + cell * 1.5) % cell - half;
        wp[i * 3 + 1] = ship.position.y + ((surf.weatherBase[i * 3 + 1] - ship.position.y) % cell + cell * 1.5) % cell - half;
        wp[i * 3 + 2] = ship.position.z + ((surf.weatherBase[i * 3 + 2] - ship.position.z) % cell + cell * 1.5) % cell - half;
      }
      surf.weather.geometry.attributes.position.needsUpdate = true;
    }
    // aurora shimmer
    if (surf.auroras) {
      for (let k = 0; k < surf.auroras.length; k++) {
        const a = surf.auroras[k];
        a.position.x = ship.position.x; a.position.z = ship.position.z;
        const ap = a.geometry.attributes.position;
        for (let i = 0; i < ap.count; i++) {
          ap.setZ(i, Math.sin(ap.getX(i) * 0.018 + t * (0.5 + k * 0.3)) * 26);
        }
        ap.needsUpdate = true;
        a.material.opacity = 0.35 + Math.sin(t * 0.7 + k) * 0.15;
      }
    }

    $('readout').innerHTML = surf.landed
      ? `<b>LANDED</b> — ${surf.type.fauna}<br>${surf.planet.surveyed ? 'habitat surveyed ✓' : 'surveying habitat…'}<br><span style="color:var(--teal)">hold W to lift off</span>`
      : `<b>${Math.round(vel.length() * 3.6)}</b> km/h<br>altitude <b>${Math.max(0, Math.round(alt))}</b>` +
        `<br><span style="color:var(--teal)">climb ${Math.max(0, 170 - Math.round(ship.position.y))} to orbit</span>`;
    if (!surf.landed && ship.position.y > 170) {
      entryFlash();
      exitPlanet();
    }
  }

  if (mode === M.VOLUME && vol) {
    applyFlight(dt, 62, 34, now);
    const isStar = vol.kind === 'star';
    if (!isStar) vel.x += 2.5 * dt;                       // gas giant jetstream
    if (ship.position.y < -260) vel.y += 40 * dt;          // pressure floor pushes back up
    vol.dome.position.copy(ship.position);

    // floaters wobble + wrap around the ship (endless interior)
    const d = new THREE.Object3D();
    const span = 500, half = 250;
    for (let i = 0; i < vol.floatData.length; i++) {
      const f = vol.floatData[i];
      const wx = ship.position.x + ((f.x - ship.position.x) % span + span * 1.5) % span - half;
      const wy = ship.position.y + ((f.y + Math.sin(t * 0.6 + f.ph) * 6 - ship.position.y) % span + span * 1.5) % span - half;
      const wz = ship.position.z + ((f.z - ship.position.z) % span + span * 1.5) % span - half;
      d.position.set(wx, wy, wz);
      const pulse = 1 + Math.sin(t * (isStar ? 2.4 : 1.1) + f.ph) * (isStar ? 0.3 : 0.15);
      d.scale.setScalar(f.s * pulse);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      vol.floaters.setMatrixAt(i, d.matrix);
    }
    vol.floaters.instanceMatrix.needsUpdate = true;
    for (const pr of vol.props) {
      const wspan = isStar ? 780 : 900, whalf = wspan / 2;
      pr.position.x = ship.position.x + ((pr.position.x - ship.position.x) % wspan + wspan * 1.5) % wspan - whalf;
      pr.position.y = ship.position.y + ((pr.position.y - ship.position.y) % wspan + wspan * 1.5) % wspan - whalf;
      pr.position.z = ship.position.z + ((pr.position.z - ship.position.z) % wspan + wspan * 1.5) % wspan - whalf;
      if (isStar) pr.rotation.y += dt * 0.15;
    }

    if (isStar) {
      vol.heat -= dt;
      const hv = Math.max(0, Math.ceil(vol.heat));
      $('readout').innerHTML =
        `<b>${Math.round(vel.length() * 3.6)}</b> km/s<br><span${vol.heat < 8 ? ' class="warn"' : ''}>hull integrity <b>${hv}s</b></span>` +
        `<br><span style="color:var(--teal)">climb ${Math.max(0, 170 - Math.round(ship.position.y))} to escape</span>`;
      if (vol.heat <= 0) { entryFlash(); exitVolume('heat'); }
    } else {
      $('readout').innerHTML =
        `<b>${Math.round(vel.length() * 3.6)}</b> km/h<br>depth <b>${Math.max(0, -Math.round(ship.position.y))}</b>` +
        `<br><span style="color:var(--teal)">climb ${Math.max(0, 170 - Math.round(ship.position.y))} to orbit</span>`;
    }
    if (vol && ship.position.y > 170) { entryFlash(); exitVolume(); }
  }

  if (mode === M.RUN && runActive) {
    applyFlight(dt, 130, 65, now);
    runTime -= dt;
    if (runTime <= 0) { runTime = 0; endRun('time'); }
    else if (ship.position.z < -2700) { runScore += 500; endRun('finish'); }

    if (runActive) {
      const rr = Math.hypot(ship.position.x, ship.position.y);
      if (rr > 58) {
        tmpV.set(-ship.position.x, -ship.position.y, 0).normalize();
        vel.addScaledVector(tmpV, (rr - 58) * 22 * dt);
      }
      let nb = null, nbD = 1e9;
      for (const b of beacons) {
        if (b.taken) continue;
        const d2 = ship.position.distanceTo(b.pos);
        if (d2 < 7.5) {
          b.taken = true;
          b.sprite.material.opacity = 0;
          runScore += 100; runRings++; runTime = Math.min(60, runTime + 2.5);
          ping(1040);
          toast('BEACON', `+100 · +2.5s`, 900);
        } else {
          b.sprite.scale.setScalar(9 + Math.sin(now / 300 + b.pos.z) * 1.5);
          if (d2 < nbD) { nbD = d2; nb = b; }
        }
      }
      const mark = $('beaconmark');
      if (nb) {
        tmpV.copy(nb.pos).project(camera);
        if (tmpV.z < 1) {
          mark.style.display = 'block';
          mark.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`;
          mark.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`;
          $('beacondist').textContent = `${Math.round(nbD)}`;
        } else mark.style.display = 'none';
      } else mark.style.display = 'none';

      for (const a of asteroids) {
        const d2 = ship.position.distanceTo(a.pos);
        if (d2 > a.radius + 1.4 && d2 < a.radius + 8 && vel.length() > 55 && now - lastWhoosh > 380) {
          lastWhoosh = now;
          ping(150 + Math.random() * 60, 0.06);   // near-miss whoosh
        }
        if (d2 < a.radius + 1.4) {
          if (now / 1000 - lastHitT < 0.9) break;
          lastHitT = now / 1000;
          hull -= 18;
          tmpV.copy(ship.position).sub(a.pos).normalize();
          vel.addScaledVector(tmpV, 34);
          ship.position.addScaledVector(tmpV, a.radius + 1.6 - d2);
          $('vignette-hit').style.opacity = 1;
          setTimeout(() => $('vignette-hit').style.opacity = 0, 180);
          if (hull <= 0) { hull = 0; endRun('hull'); }
          break;
        }
      }
      if (runActive) {
        runScore += Math.round(Math.max(0, -vel.z) * dt * 0.5);
        $('readout').innerHTML =
          `score <b>${runScore}</b><br><span${hull <= 36 ? ' class="warn"' : ''}>hull <b>${Math.max(0, Math.round(hull))}%</b></span>` +
          `<br>time <b>${runTime.toFixed(1)}s</b>`;
      }
      updateDust();
    }
  }

  if (mode === M.MENU) {
    camera.position.lerp(tmpV.set(Math.sin(now / 11000) * 220, 90, Math.cos(now / 11000) * 220 + 160), 0.02);
    camera.lookAt(0, 0, 0);
  }

  // GLB hull in chase view; procedural interior in cockpit view
  const useGlb = !!glbShip && viewMode === 'chase';
  if (glbShip) glbShip.visible = useGlb;
  for (const pp of procParts) pp.visible = !useGlb;

  // hyperjump warp sequence
  if (jumpSeq) {
    const e = (now - jumpSeq.t0) / 1000;
    $('warp').style.opacity = e < 0.15 ? e / 0.15 : e > 0.95 ? Math.max(0, (1.25 - e) / 0.3) : 1;
    camera.fov += (100 - camera.fov) * Math.min(1, dt * 6);
    camera.updateProjectionMatrix();
    if (e > 0.6 && !jumpSeq.built) {
      jumpSeq.built = true;
      sectorIdx++;
      const d = store.get(); d.sector = sectorIdx; store.set(d);
      buildSystem(sectorIdx);
    }
    if (e > 1.25) { jumpSeq = null; $('warp').style.opacity = 0; }
  }

  // ambient audio bed: wind on surfaces, rumble in interiors, drone pad in space
  if (audio) {
    let windT = 0, droneT = 0, windF = 500;
    if (mode === M.SURFACE && surf) windT = 0.02 + Math.min(0.13, (vel.length() / 70) * 0.13);
    if (mode === M.VOLUME && vol) { windT = vol.kind === 'star' ? 0.2 : 0.09; windF = vol.kind === 'star' ? 85 : 300; }
    if (mode === M.EXPLORE || mode === M.MENU) droneT = 0.045;
    audio.windGain.gain.value += (windT - audio.windGain.gain.value) * Math.min(1, dt * 3);
    audio.windFilter.frequency.value += (windF - audio.windFilter.frequency.value) * Math.min(1, dt * 2);
    audio.droneGain.gain.value += (droneT - audio.droneGain.gain.value) * Math.min(1, dt * 1.5);
    // sparse alien chirps in living habitats
    if (mode === M.SURFACE && surf && surf.type.fauna && Math.random() < dt * 0.14) {
      ping(480 + Math.random() * 980, 0.028);
    }
  }

  // HUD chrome that only exists while flying
  document.body.classList.toggle('playing', mode !== M.MENU);
  $('logbtn').style.display = (mode === M.EXPLORE || mode === M.MENU) ? 'block' : 'none';

  // sky is centered on the camera → backdrop at infinity
  sky.position.copy(camera.position);

  composer.render();
}

// boot
buildSystem(sectorIdx);
$('sectorname').textContent = '';
requestAnimationFrame(tick);

// ---------- debug hooks ----------
window.DRIFT = {
  get mode() { return ['MENU', 'EXPLORE', 'RUN', 'SURFACE', 'VOLUME'][mode]; },
  get ship() { return { pos: ship.position.toArray(), speed: vel.length() }; },
  get planets() { return scannables.map(p => ({ name: p.name, type: p.type, kind: p.kind, scanned: p.scanned, pos: p.pos.toArray(), radius: p.radius })); },
  get run() { return { score: runScore, hull, time: runTime, rings: runRings, active: runActive }; },
  get rocks() { return asteroids.slice(0, 5).map(a => ({ pos: a.pos.toArray(), radius: a.radius })); },
  get beaconList() { return beacons.slice(0, 5).map(b => ({ pos: b.pos.toArray(), taken: b.taken })); },
  get surface() { return surf ? { planet: surf.planet.name, type: surf.type.label, chunks: surf.chunks.size, alt: ship.position.y, landed: surf.landed, surveyed: !!surf.planet.surveyed } : null; },
  get volume() { return vol ? { kind: vol.kind, body: vol.p.name, heat: vol.heat, y: ship.position.y } : null; },
  enterStar() { const s = scannables.find(q => q.kind === 'star'); if (s) enterVolume('star', s); },
  setView,
  enterGasByIndex(i) { const g = scannables.filter(q => q.kind === 'planet' && q.ptype.volume)[i]; if (g) enterVolume('gas', g); },
  teleport(x, y, z) { ship.position.set(x, y, z); vel.set(0, 0, 0); },
  faceToward(x, y, z) {
    const m = new THREE.Matrix4().lookAt(ship.position, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0));
    ship.quaternion.setFromRotationMatrix(m);
  },
  setThrust(v) { thrusting = v; },
  setSteer(x, y) { steer.x = x; steer.y = y; },
  enterPlanetByIndex(i) { const p = scannables.filter(s => s.kind === 'planet')[i]; if (p) enterPlanet(p); },
  exitPlanet() { if (surf) exitPlanet(); else if (vol) exitVolume(); },
  step(frames = 60, dtMs = 16.7) {
    manualStep = true;
    for (let i = 0; i < frames; i++) tick(lastNow + dtMs);
    manualStep = false;
  },
  startExplore, startRunMode,
};
