// Appartement B, 6e étage: the plan becomes the flat, then the visitor walks freely.
//
// 1. The sheet: the real 3D model, cut at 1.20 m, seen from very high through a 2° lens.
// 2. "Entrer": the cut rises (walls grow), the camera comes down into the stairwell
//    and climbs the last flight to the landing.
// 3. Free visit: walk, look around; each room turns from ink to material when you enter.

import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { buildDecor, artReady, fetchBinary } from './decor.js';
import { buildReseaux, NET_COLORS } from './reseaux.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, CUT, PAPER, INK, inkLines, makeMaterials, texturesReady, setAnisotropy } from './core.js';
import { buildApartment, buildTower } from './build.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const MOBILE = matchMedia('(pointer: coarse)').matches;
const errors = (window.__errors = []);
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
const $ = (id) => document.getElementById(id);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const io = (t) => t * t * (3 - 2 * t);
const io5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const D2R = Math.PI / 180;
let clock = 0; // seconds; driven by RAF, or set by the recorder

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------
const P = await (await fetch('data/plan3d.json')).json();
const [X0, Y0, X1, Y1] = P.bounds;
async function imageData(src) {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data, img };
}
const roomsImg = await imageData('data/rooms.png');
const walkImg = await imageData('data/walk.png');
const sample = (im, x, z) => {
  const px = Math.floor((x - X0) * P.px_per_m), py = Math.floor((z - Y0) * P.px_per_m);
  if (px < 0 || py < 0 || px >= im.w || py >= im.h) return 0;
  return im.d[(py * im.w + px) * 4];
};
const roomAt = (x, z) => Math.round(sample(roomsImg, x, z) / 20) - 1;
const walkable = (x, z) => sample(walkImg, x, z) > 127;

// ---------------------------------------------------------------------------
// renderer and scene
// ---------------------------------------------------------------------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
setAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const paperCol = new THREE.Color(PAPER);
scene.background = paperCol;
// a real interior HDRI (Poly Haven, CC0) for reflections and soft bounce
{
  const pm = new THREE.PMREMGenerator(renderer);
  const exrLoader = new EXRLoader();
  const exr = exrLoader.parse(await fetchBinary('assets/b64/apartment.exr.txt'));
  const tx = new THREE.DataTexture(exr.data, exr.width, exr.height, exr.format, exr.type);
  tx.mapping = THREE.EquirectangularReflectionMapping; tx.colorSpace = THREE.LinearSRGBColorSpace; tx.needsUpdate = true;
  scene.environment = pm.fromEquirectangular(tx).texture;
  tx.dispose(); pm.dispose();
}
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(2, innerWidth / innerHeight, 1, 5000);
camera.rotation.order = 'YXZ';

const roomTex = new THREE.Texture(roomsImg.img);
roomTex.magFilter = roomTex.minFilter = THREE.NearestFilter;
roomTex.generateMipmaps = false; roomTex.flipY = false; roomTex.needsUpdate = true;
U.uRoomMap.value = roomTex;
U.uBounds.value.set(X0, Y0, X1, Y1);

const paper = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshBasicMaterial({ color: PAPER, toneMapped: false }));
paper.rotation.x = -Math.PI / 2; paper.position.y = -0.16;
scene.add(paper);

// ---------------------------------------------------------------------------
// the flat
// ---------------------------------------------------------------------------
const M = makeMaterials();
const C = buildApartment(P);
const flat = new THREE.Group(); scene.add(flat);
const prep = (g) => {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
};
for (const [key, list] of Object.entries(C.meshes)) {
  const mesh = new THREE.Mesh(mergeGeometries(list.map(prep)), M[key]);
  mesh.castShadow = key !== 'glass';
  mesh.receiveShadow = key !== 'glass';
  if (key === 'glass') mesh.renderOrder = 3;
  flat.add(mesh);
}
const lineMats = [];
function lines(pos, width, color, cut = true) {
  const g = new LineSegmentsGeometry(); g.setPositions(pos);
  const m = inkLines(new LineMaterial({ color: new THREE.Color(color), linewidth: width, worldUnits: false, toneMapped: false, clippingPlanes: cut ? [CUT] : [] }));
  m.resolution.set(innerWidth, innerHeight);
  lineMats.push(m);
  const l = new LineSegments2(g, m); l.frustumCulled = false; l.renderOrder = 1;
  return l;
}
flat.add(lines(C.edges, 1.15, INK));
// the decor: furniture, textiles, lamps, art (data/furniture.json)
const furniture = await (await fetch('data/furniture.json')).json();
const DECOR = await buildDecor(furniture);
flat.add(DECOR.group);
flat.add(lines(DECOR.edges, 0.8, INK));
// Pack Réseaux demo: sockets and switches on the walls, networks in X-ray mode
const NET = await buildReseaux();
flat.add(NET.fixtures);
scene.add(NET.xray);

// room names and areas, written on the floor like a plan
const labels = [];
P.rooms.forEach((r, i) => {
  if (r.name === 'ESCALIER') return;
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = INK; g.textAlign = 'center';
  g.font = '600 46px "IBM Plex Mono", monospace'; g.fillText(r.name, 256, 66);
  g.fillStyle = '#b8452a'; g.font = '400 38px "IBM Plex Mono", monospace';
  g.fillText(String(r.area_stated.toFixed(2)).replace('.', ',') + ' m²', 256, 122);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const small = r.area_stated < 3;
  const w = small ? 1.1 : 1.7;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 160 / 512),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, clippingPlanes: [CUT] }));
  m.rotation.x = -Math.PI / 2;
  const lp = P.rooms[i].center;
  const fromPdf = { 'CHAMBRE 1': [8.97, 5.99], SALON: [12.16, 9.35], 'CHAMBRE 2': [7.85, 11.22], CUISINE: [6.66, 13.92], ENTREE: [10.28, 13.69], 'TOIL. 1': [6.44, 7.29], 'TOIL. 2': [7.29, 9.01], 'TOIL. V': [9.28, 15.11], BALCON: [14.88, 6.36] }[r.name] || lp;
  m.position.set(fromPdf[0], 0.006, fromPdf[1]);
  m.renderOrder = 2;
  flat.add(m);
  labels.push({ mesh: m, room: i });
});

// ---------------------------------------------------------------------------
// outside: the tower, the city, the sky (only once we are inside)
// ---------------------------------------------------------------------------
const outside = new THREE.Group(); outside.visible = false; scene.add(outside);
for (const g of buildTower(P, P.footprint)) {
  const t = new THREE.Mesh(prep(g), M.wallOut); t.castShadow = t.receiveShadow = true; outside.add(t);
}
// Beyond the windows: a real sky photograph (Poly Haven, CC0). Its lower half, a calm
// reflective plane under the low sun, reads as the Atlantic seen from the 6th floor.
const skyTex = new THREE.TextureLoader().load('sky/sky.jpg');
skyTex.mapping = THREE.EquirectangularReflectionMapping; skyTex.colorSpace = THREE.SRGBColorSpace;
const haze = new THREE.Fog(0xe9d9c2, 120, 700);

// ---------------------------------------------------------------------------
// light: Dakar, late afternoon, sun low in the west-south-west (north = top of the sheet)
// ---------------------------------------------------------------------------
const SUN_AZ = 250 * D2R, SUN_EL = 22 * D2R;
const toSun = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));
const sun = new THREE.DirectionalLight(0xffd6a8, 6.5);
sun.target.position.set(10.5, 0, 14);
sun.position.copy(sun.target.position).addScaledVector(toSun, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 20, far: 120 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xeef3fb, 0xcbb592, 0.85);
scene.add(hemi);
// warm 2700 K light from the lamps of the decor
for (const L of DECOR.lights) {
  const l = new THREE.PointLight(L.color, L.intensity, L.distance, 1.6);
  l.position.set(L.x, L.y, L.z);
  scene.add(l);
}

// ---------------------------------------------------------------------------
// reveal: ink -> material, room by room
// ---------------------------------------------------------------------------
const NAMES = P.rooms.map((r) => r.name);
const reveal = NAMES.map(() => null); // {t0, x, z}
const SPEED = 4.5; // m/s for the sweep front
function startReveal(i, x, z) {
  if (i < 0 || reveal[i]) return;
  reveal[i] = { t0: clock, x, z };
}
function updateReveal() {
  reveal.forEach((r, i) => {
    const v = U.uReveal.value[i];
    if (!r) { v.set(0, 0, -1e4, 0); return; }
    v.set(r.x, r.z, -0.3 + (clock - r.t0) * SPEED, 0);
  });
  for (const L of labels) {
    const r = reveal[L.room];
    L.mesh.material.opacity = r ? 1 - clamp01((clock - r.t0) * SPEED / 3) : 1;
    L.mesh.visible = L.mesh.material.opacity > 0.01;
  }
}

// ---------------------------------------------------------------------------
// camera poses
// ---------------------------------------------------------------------------
const st = P.stair;
const DROP = { x: (st.x0 + st.split) / 2, z: 23.9 };
const floorH = (x, z) => { // the floor under the visitor, stairs included
  if (x > st.x0 && x < st.split && z > st.top) return -1.5 * clamp01((z - st.top) / (st.n * st.tread));
  return 0;
};
let SHEET; // framing of the whole plan
function sheetFrame() {
  const xs = P.footprint.map((p) => p[0]), zs = P.footprint.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const asp = innerWidth / innerHeight;
  const narrow = asp < 0.9;
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
  const F = Math.max(h * 1.18, (w * 1.25) / asp) * (narrow ? 1.12 : 1);
  // leave room on the left for the title on wide screens
  const shift = narrow ? 0 : -0.16 * F * asp;
  SHEET = { x: cx + shift, z: cz + (narrow ? -0.06 * F : 0), F };
}
sheetFrame();
const tanh = (deg) => Math.tan((deg * D2R) / 2);
const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 2, cut: 1.2 };

// top-down framing helper: target point, elevation (deg), lens (deg), frame height (m)
function framed(tx, ty, tz, elev, fov, F) {
  const dist = F / (2 * tanh(fov));
  const e = elev * D2R;
  return { x: tx, y: ty + dist * Math.sin(e), z: tz + dist * Math.cos(e), pitch: -e, fov };
}
// the intro, u from 0 to 1
const hD = floorH(DROP.x, DROP.z);
const E1 = 62, FOV1 = 50, F1 = 14;
const dist1 = F1 / (2 * tanh(FOV1));
const T1 = { x: DROP.x, y: hD, z: DROP.z - dist1 * Math.cos(E1 * D2R) };
function introPose(u) {
  const o = { yaw: 0 };
  if (u <= 0.5) {
    const s = clamp01(u / 0.5);
    const a = io(clamp01((s - 0.08) / 0.92));
    const elev = lerp(90, E1, io(clamp01((s - 0.25) / 0.75)));
    const fov = 2 * Math.atan(Math.exp(lerp(Math.log(tanh(2)), Math.log(tanh(FOV1)), io5(s)))) / D2R;
    const F = Math.exp(lerp(Math.log(SHEET.F), Math.log(F1), io(s)));
    Object.assign(o, framed(lerp(SHEET.x, T1.x, a), lerp(0, T1.y, a), lerp(SHEET.z, T1.z, a), elev, fov, F));
    o.cut = s < 0.06 ? 1.2 : lerp(1.2, 2.72, io(clamp01((s - 0.06) / 0.8)));
  } else if (u <= 0.74) {
    const s = clamp01((u - 0.5) / 0.24);
    const top = T1.y + dist1 * Math.sin(E1 * D2R);
    o.x = DROP.x; o.z = DROP.z;
    o.y = lerp(top, hD + 1.6, io(s));
    o.pitch = -E1 * D2R * (1 - io(clamp01(s * 1.15)));
    o.fov = lerp(FOV1, fovWalk(), io(s));
    o.cut = o.y < P.hsp - 0.1 ? P.hsp + P.slab + 0.01 : 2.72; // ceilings close once we are inside
  } else {
    const s = clamp01((u - 0.74) / 0.26);
    o.x = DROP.x;
    o.z = lerp(DROP.z, 21.25, io(s));
    o.y = floorH(o.x, o.z) + 1.6;
    o.pitch = 0;
    o.yaw = -0.42 * io(clamp01((s - 0.55) / 0.45));
    o.fov = fovWalk();
    o.cut = P.hsp + P.slab + 0.01;
  }
  return o;
}
function fovWalk() { const a = innerWidth / innerHeight; return a < 0.9 ? 78 : a < 1.4 ? 66 : 60; }

// ---------------------------------------------------------------------------
// modes
// ---------------------------------------------------------------------------
let mode = 'sheet'; // sheet | intro | walk | toPlan | plan | toWalk
let introT0 = 0;
const INTRO = 11; // seconds
const me = { x: DROP.x, z: 21.25, yaw: -0.42, pitch: 0 };
let flight = null; // tween between walk and plan

let inside = false;
function setInside(v) {
  if (v === inside) return;
  inside = v;
  outside.visible = v; paper.visible = !v;
  scene.background = v ? skyTex : paperCol;
  scene.fog = v ? haze : null;
  U.uOutside.value = v ? 1 : 0;
  for (const m of lineMats) m.fog = false;
  renderer.shadowMap.needsUpdate = true;
}

function apply(o) {
  Object.assign(pose, o);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.rotation.set(pose.pitch, pose.yaw, 0);
  camera.fov = pose.fov;
  const h = pose.y;
  camera.near = h > 40 ? Math.max(0.1, (h - 30) * 0.5) : 0.05;
  camera.far = h > 40 ? h * 1.6 + 600 : 3000;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  CUT.constant = pose.cut;
  setInside(pose.y < P.hsp + 0.1 && pose.cut > P.hsp);
}

function sheetPose() {
  return { ...framed(SHEET.x, 0, SHEET.z, 90, 2, SHEET.F), yaw: 0, cut: 1.2 };
}
function walkPose() {
  return { x: me.x, y: floorH(me.x, me.z) + 1.6, z: me.z, yaw: me.yaw, pitch: me.pitch, fov: fovWalk(), cut: P.hsp + P.slab + 0.01 };
}
// walk <-> plan: rise above the room, open the ceiling, then pull back to the sheet
function planPath(t) {
  const W = walkPose(), S = sheetPose();
  const above = { x: me.x, y: 11, z: me.z + 0.001, yaw: 0, pitch: -Math.PI / 2, fov: 55, cut: 1.2 };
  if (t < 0.35) {
    const s = io(t / 0.35);
    let dy = ((above.yaw - W.yaw + Math.PI) % (2 * Math.PI)) - Math.PI;
    return { x: lerp(W.x, above.x, s), y: lerp(W.y, above.y, s), z: lerp(W.z, above.z, s), yaw: W.yaw + dy * s,
      pitch: lerp(W.pitch, above.pitch, s), fov: lerp(W.fov, above.fov, s), cut: s < 0.15 ? W.cut : lerp(2.7, 1.2, io((s - 0.15) / 0.85)) };
  }
  const s = io((t - 0.35) / 0.65);
  const fl = Math.exp(lerp(Math.log(tanh(above.fov)), Math.log(tanh(S.fov)), s));
  const F = Math.exp(lerp(Math.log(2 * above.y * tanh(above.fov)), Math.log(S.F ?? SHEET.F), s));
  const fov = 2 * Math.atan(fl) / D2R;
  return { x: lerp(above.x, SHEET.x, s), y: F / (2 * fl), z: lerp(above.z, SHEET.z, s) + 0.001, yaw: 0, pitch: -Math.PI / 2, fov, cut: 1.2 };
}

// ---------------------------------------------------------------------------
// walking
// ---------------------------------------------------------------------------
const keys = new Set();
const joy = { x: 0, y: 0, on: false };
const look = { x: 0, y: 0, on: false };
let goal = null; // double-click target
function moveTo(nx, nz) {
  if (walkable(nx, nz)) { me.x = nx; me.z = nz; return true; }
  if (walkable(nx, me.z)) { me.x = nx; return true; }
  if (walkable(me.x, nz)) { me.z = nz; return true; }
  return false;
}
function stepWalk(dt) {
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyA') || keys.has('KeyQ')) s -= 1;
  if (keys.has('KeyD')) s += 1;
  if (keys.has('ArrowLeft')) me.yaw += 1.6 * dt;
  if (keys.has('ArrowRight')) me.yaw -= 1.6 * dt;
  if (joy.on) { f += -joy.y; s += joy.x; }
  if (look.on) {
    const k = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.12) / 0.88;
    me.yaw -= k(look.x) * 2.1 * dt;
    me.pitch = Math.max(-1.1, Math.min(1.1, me.pitch - k(look.y) * 1.3 * dt));
  }
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.6 : 1.4) * dt;
  if (f || s) goal = null;
  if (goal) {
    const dx = goal.x - me.x, dz = goal.z - me.z, d = Math.hypot(dx, dz);
    if (d < 0.08) goal = null;
    else {
      const want = Math.atan2(-dx, -dz);
      let dy = ((want - me.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      me.yaw += dy * Math.min(1, dt * 4);
      if (!moveTo(me.x + (dx / d) * Math.min(d, speed), me.z + (dz / d) * Math.min(d, speed))) goal = null;
    }
    return;
  }
  const n = Math.hypot(f, s);
  if (!n) return;
  f /= Math.max(1, n); s /= Math.max(1, n);
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  moveTo(me.x + (-sy * f + cy * s) * speed, me.z + (-cy * f - sy * s) * speed);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const ui = { room: $('room'), roomName: $('roomName'), roomArea: $('roomArea'), plan: $('btnPlan'), help: $('help') };
let lastRoom = -2;
function updateHud() {
  const i = roomAt(me.x, me.z);
  if (i === lastRoom) return;
  lastRoom = i;
  if (i < 0) { ui.room.classList.remove('on'); return; }
  const r = P.rooms[i];
  const NICE = { ENTREE: 'Entrée', SALON: 'Salon', CUISINE: 'Cuisine', 'CHAMBRE 1': 'Chambre 1', 'CHAMBRE 2': 'Chambre 2',
    'TOIL. 1': 'Salle d’eau · chambre 1', 'TOIL. 2': 'Salle d’eau · chambre 2', 'TOIL. V': 'Toilettes visiteurs', BALCON: 'Balcon', PALIER: 'Palier · hall', ESCALIER: 'Escalier' };
  ui.roomName.textContent = NICE[r.name] || r.name;
  ui.roomArea.textContent = r.area_stated ? r.area_stated.toFixed(2).replace('.', ',') + ' m²' : '';
  ui.room.classList.add('on');
}
function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
}
$('btnEnter').addEventListener('click', () => { if (mode === 'sheet') { introT0 = clock; setMode('intro'); } });
ui.plan.addEventListener('click', () => {
  if (mode === 'walk') { flight = { t0: clock, dir: 1 }; setMode('toPlan'); }
  else if (mode === 'plan') { flight = { t0: clock, dir: -1 }; setMode('toWalk'); }
});
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyP') ui.plan.click(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// look by dragging; joystick on touch (left bottom); double-click / double-tap to walk there
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'walk') return;
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: clock, moved: 0 };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  const k = MOBILE ? 0.006 : 0.0042;
  me.yaw += dx * k; me.pitch = Math.max(-1.1, Math.min(1.1, me.pitch + dy * k));
  goal = null;
});
canvas.addEventListener('pointerup', () => (drag = null));
const ray = new THREE.Raycaster(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
canvas.addEventListener('dblclick', (e) => {
  if (mode !== 'walk') return;
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (ray.ray.intersectPlane(floorPlane, hit) && hit.distanceTo(camera.position) < 25) goal = { x: hit.x, z: hit.z };
});
// ---------------------------------------------------------------------------
// X-ray: walls turn to glass, the services show in colour, the points to check are numbered
// ---------------------------------------------------------------------------
let xray = false;
const GHOST = [M.wall, M.ceiling, M.wood, M.alu, M.sill, M.steel];
GHOST.forEach((m) => (m.userData.solid = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, backInk: m.userData.ink?.uBackInk.value ?? 0 }));
const netPanel = $('net'), netList = $('netList'), netDetail = $('netDetail');
const LEG = { elec: 'Électricité', ef: 'Eau froide', ec: 'Eau chaude', evac: 'Évacuations' };
$('netLegend').innerHTML = Object.entries(LEG).map(([k, t]) => `<span><i style="background:#${NET_COLORS[k].toString(16).padStart(6, '0')}"></i>${t}</span>`).join('');
netList.innerHTML = NET.alerts.map((a, i) => `<li><button type="button" data-i="${i}"><b>${a.id}</b><span>${a.title}<small>${a.room === 'CHAMBRE 1' ? 'Chambre 1' : a.room === 'CHAMBRE 2' ? 'Chambre 2' : a.room}</small></span></button></li>`).join('');
let activeAlert = -1;
function showAlert(i) {
  activeAlert = i;
  [...netList.querySelectorAll('button')].forEach((b, k) => b.classList.toggle('on', k === i));
  netDetail.textContent = i >= 0 ? NET.alerts[i].text : '';
  netDetail.hidden = i < 0;
}
function setXray(on) {
  xray = on;
  NET.xray.visible = on;
  for (const m of GHOST) {
    const s = m.userData.solid;
    m.transparent = on ? true : s.transparent;
    m.opacity = on ? 0.16 : s.opacity;
    m.depthWrite = on ? false : s.depthWrite;
    if (m.userData.ink) m.userData.ink.uBackInk.value = on ? 0 : s.backInk;
    m.needsUpdate = true;
  }
  document.body.classList.toggle('xray', on);
  $('btnNet').setAttribute('aria-pressed', on ? 'true' : 'false');
  if (!on) showAlert(-1);
}
function jumpTo(i) {
  const v = NET.alerts[i].view;
  if (mode === 'plan' || mode === 'toPlan') { flight = null; }
  me.x = v.x; me.z = v.z; me.yaw = v.yaw; me.pitch = v.pitch; goal = null;
  setMode('walk');
  startReveal(roomAt(me.x, me.z), me.x, me.z);
  showAlert(i);
}
$('btnNet').addEventListener('click', () => setXray(!xray));
$('netFold').addEventListener('click', () => {
  const min = netPanel.classList.toggle('min');
  $('netFold').textContent = min ? 'Afficher' : 'Réduire';
  $('netFold').setAttribute('aria-expanded', min ? 'false' : 'true');
});
netList.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) jumpTo(+b.dataset.i); });
addEventListener('keydown', (e) => { if (e.code === 'KeyR' && (mode === 'walk' || mode === 'plan')) setXray(!xray); });

// two thumb sticks on touch screens: left walks, right looks around. Each follows its own finger.
function thumbStick(el, state) {
  const knob = el.querySelector('.knob');
  const move = (e) => {
    const r = el.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const n = Math.hypot(x, y); if (n > 1) { x /= n; y /= n; }
    state.x = x; state.y = y; knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); state.on = true; state.id = e.pointerId; el.setPointerCapture(e.pointerId); el.classList.add('held'); move(e); goal = null; });
  el.addEventListener('pointermove', (e) => state.on && e.pointerId === state.id && move(e));
  const end = (e) => { if (e.pointerId !== state.id) return; state.on = false; state.x = state.y = 0; knob.style.transform = ''; el.classList.remove('held'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
}
thumbStick($('stick'), joy);
thumbStick($('stickLook'), look);
window.__sticks = { joy, look };

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  for (const m of lineMats) m.resolution.set(innerWidth, innerHeight);
  sheetFrame();
});

// ---------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------
function frame(dt) {
  if (mode === 'sheet') apply(sheetPose());
  else if (mode === 'intro') {
    const u = clamp01((clock - introT0) / INTRO);
    const o = introPose(u);
    apply(o);
    if (u > 0.52) startReveal(NAMES.indexOf('ESCALIER'), DROP.x, DROP.z);
    if (u > 0.74 && o.z < st.top + 0.25) startReveal(NAMES.indexOf('PALIER'), DROP.x, st.top);
    if (u >= 1) { me.x = o.x; me.z = o.z; me.yaw = o.yaw; me.pitch = 0; setMode('walk'); }
  } else if (mode === 'walk') {
    stepWalk(dt);
    apply(walkPose());
    const i = roomAt(me.x, me.z);
    startReveal(i, me.x, me.z);
    updateHud();
  } else if (mode === 'toPlan' || mode === 'toWalk') {
    const t = clamp01((clock - flight.t0) / 2.6);
    apply(planPath(flight.dir > 0 ? io(t) : 1 - io(t)));
    if (t >= 1) setMode(flight.dir > 0 ? 'plan' : 'walk');
  } else if (mode === 'plan') apply(planPath(1));
  updateReveal();
  if (xray) {
    const far = Math.max(1, (2 * camera.position.y * Math.tan((camera.fov * D2R) / 2)) / 9);
    NET.alertSprites.forEach((s, i) => s.scale.setScalar((i === activeAlert ? 0.34 : 0.26) * far * (1 + 0.1 * Math.sin(clock * 4 + i))));
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
await Promise.race([document.fonts.load('600 40px "IBM Plex Mono"'), new Promise((r) => setTimeout(r, 2500))]);
await texturesReady();
await artReady();
for (const m of Object.values(M)) m.needsUpdate = true;
renderer.shadowMap.needsUpdate = true;
setMode('sheet');
frame(0);
$('loading').classList.add('done');

if (CAPTURE) {
  // the recorder drives time and input itself
  window.__api = {
    intro(u) { if (mode === 'sheet') { introT0 = clock; setMode('intro'); } clock = introT0 + u * INTRO; frame(0); },
    walkTo(x, z, yaw, pitch, t) { setMode('walk'); clock = t; me.x = x; me.z = z; me.yaw = yaw; me.pitch = pitch; frame(0); },
    plan(t, dir = 1) { if (!flight || flight.dir !== dir) flight = { t0: clock, dir }; setMode(dir > 0 ? 'toPlan' : 'toWalk'); clock = flight.t0 + t * 2.6; frame(0); },
    set clock(v) { clock = v; }, get clock() { return clock; },
    state: () => ({ mode, pose: { ...pose }, room: roomAt(me.x, me.z), errors: errors.slice(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    walkable, roomAt, xray: (on) => { setXray(on); frame(0); }, jump: (i) => { jumpTo(i); frame(0); },
  };
  window.__ready = true;
} else {
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    clock += dt;
    frame(dt);
  });
  setTimeout(() => ui.help.classList.add('gone'), 14000);
  // ?walk skips the intro and starts on the landing (handy to test, or to share a direct visit)
  if (params.has('walk')) {
    me.x = DROP.x; me.z = 21.25; me.yaw = -0.42; me.pitch = 0;
    setMode('walk');
    startReveal(NAMES.indexOf('PALIER'), me.x, me.z);
  }
  window.__me = me;
}
