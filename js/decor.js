// The decor: real scanned models (Khronos glTF samples, Poly Haven) and furniture
// modelled in code, dressed only with real scanned textures (Poly Haven, CC0).
// Layout comes from data/furniture.json (made by furnish.py): one entry per piece,
// in plan metres, with its rotation. Item-local axes: x = width, y = up, z = depth,
// front of the piece facing +z, origin on the floor at the centre of its footprint.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { real, flat, wrapInk } from './core.js';

const CEIL = 2.8;

// ---------------------------------------------------------------- materials
const MATS = {};
const BOOKS = ['#7a3b2e', '#2f3e46', '#c9b28a', '#5b6b4f', '#e6dfd1', '#3d3a36', '#a35f3e', '#8a8f96', '#b9a27a', '#44505a'];
const artLoader = new THREE.TextureLoader();
const pendingArt = [];
function material(key) {
  if (MATS[key]) return MATS[key];
  let m;
  const [k, v] = key.split('_');
  if (k === 'linen') m = real('rough_linen', v, { size: 0.5, normalScale: 0.7, roughness: 1 });
  else if (k === 'herringbone') m = real('poly_wool_herringbone', v, { size: 0.7, normalScale: 0.8, roughness: 1 });
  else if (key === 'carpet_warm') m = real('dirty_carpet', 'warm', { size: 1.0, roughness: 1 });
  else if (key === 'carpet_dark') m = real('dirty_carpet', 'warm', { size: 0.6, roughness: 1, color: 0x6a6258 });
  else if (key === 'oak') m = real('white_oak_veneer', 'oak', { size: 1.0, normalScale: 0.35, roughness: 0.7 });
  else if (key === 'oaklight') m = real('white_oak_veneer', 'oaklight', { size: 1.0, normalScale: 0.3, roughness: 0.72 });
  else if (key === 'walnut') m = real('natural_walnut_veneer', 'walnut', { size: 0.9, normalScale: 0.3, roughness: 0.6 });
  else if (key === 'marble') m = real('marble_rock', 'white', { size: 0.9, roughness: 0.22 });
  else if (key === 'travertine') m = real('marble_01', 'bath', { size: 0.7, normalScale: 0.6, roughness: 0.55 });
  else if (key === 'leather') m = real('brown_leather', 'diff', { size: 0.5, normalScale: 0.8, roughness: 0.6, color: 0xd9b48f });
  else if (key === 'concrete') m = real('wood_textured_concrete', 'deck', { size: 0.8, normalScale: 0.8, roughness: 0.95 });
  else if (key === 'brass') m = flat(0xb48f58, { roughness: 0.32, metalness: 1 });
  else if (key === 'blacksteel') m = flat(0x1f1f21, { roughness: 0.45, metalness: 0.6 });
  else if (key === 'chrome') m = flat(0xdedede, { roughness: 0.1, metalness: 1 });
  else if (key === 'aluminium') m = flat(0xc2c4c7, { roughness: 0.32, metalness: 0.9 });
  else if (key === 'ceramic_white') m = flat(0xf3f1ed, { roughness: 0.16 });
  else if (key === 'ceramic_sand') m = flat(0xcdb99d, { roughness: 0.55 });
  else if (key === 'ceramic_dark') m = flat(0x3b3431, { roughness: 0.45 });
  else if (key === 'ceramic_green') m = flat(0x6f7a62, { roughness: 0.4 });
  else if (key === 'black_glass') m = flat(0x0b0b0c, { roughness: 0.08, metalness: 0.2 });
  else if (key === 'screen') m = flat(0x0d0e10, { roughness: 0.12, metalness: 0.3 });
  else if (key === 'paper') m = flat(0xf1ede4, { roughness: 0.9 });
  else if (key === 'soil') m = flat(0x2e261f, { roughness: 1 });
  else if (key === 'amber') m = flat(0x8a4b1d, { roughness: 0.15 });
  else if (key === 'opal') m = flat(0xfff4e6, { roughness: 0.4, emissive: 0xffdcb4, emissiveIntensity: 1.4 });
  else if (key === 'glow') m = flat(0xfff2e0, { roughness: 0.5, emissive: 0xffe2c0, emissiveIntensity: 1.8 });
  else if (key === 'shade') {
    m = real('rough_linen', 'ivory', { size: 0.4, normalScale: 0.5, roughness: 1 });
    m.emissive = new THREE.Color(0xffcf9a); m.emissiveIntensity = 0.55; m.emissiveMap = m.map;
  } else if (key === 'mirror') m = wrapInk(new THREE.MeshStandardMaterial({ color: 0xf4f4f2, metalness: 1, roughness: 0.03 }));
  else if (key === 'glass') m = wrapInk(new THREE.MeshPhysicalMaterial({ color: 0xe9f0ef, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false }), { glass: true });
  else if (k === 'book') m = flat(BOOKS[+v % BOOKS.length], { roughness: 0.82 });
  else if (k === 'art') {
    const t = artLoader.load('assets/art/' + v + '.jpg');
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    pendingArt.push(new Promise((res) => { const im = new Image(); im.onload = res; im.onerror = res; im.src = 'assets/art/' + v + '.jpg'; }));
    m = wrapInk(new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 }));
  } else m = flat(0xd8d2c6, { roughness: 0.9 });
  m.name = key;
  return (MATS[key] = m);
}
export const artReady = () => Promise.all(pendingArt);

// ---------------------------------------------------------------- geometry helpers
// UVs in metres by box projection, so every texture keeps its real scale.
function boxUV(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) { uv[i * 2] = p.getZ(i); uv[i * 2 + 1] = p.getY(i); }
    else if (ay >= az) { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getZ(i); }
    else { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getY(i); }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

class Parts {
  constructor() { this.list = []; this.edges = []; this.models = []; this.lights = []; }
  add(mat, g, edgeGeo, uv = true) {
    if (uv) boxUV(g);
    this.list.push([mat, g]);
    if (edgeGeo) {
      const e = new THREE.EdgesGeometry(edgeGeo === true ? g : edgeGeo, 35).attributes.position;
      for (let i = 0; i < e.count; i++) this.edges.push(new THREE.Vector3(e.getX(i), e.getY(i), e.getZ(i)));
    }
    return g;
  }
  // box: centre x, z; bottom y
  box(mat, x, y, z, w, h, d, r = 0, edges = true) {
    const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    const eg = edges ? new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z) : null;
    return this.add(mat, g, eg);
  }
  cyl(mat, x, y, z, rt, rb, h, seg = 28, edges = true, open = false) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    g.translate(x, y + h / 2, z);
    return this.add(mat, g, edges ? new THREE.CylinderGeometry(rt, rb, h, 12, 1, open).translate(x, y + h / 2, z) : null, false);
  }
  lathe(mat, pts, x, y, z, seg = 36, edges = false) {
    const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg);
    g.translate(x, y, z);
    return this.add(mat, g, edges ? true : null, false);
  }
  sphere(mat, x, y, z, r, sy = 1) {
    const g = new THREE.SphereGeometry(r, 28, 18); g.scale(1, sy, 1); g.translate(x, y, z);
    return this.add(mat, g, null, false);
  }
  torus(mat, x, y, z, R, r, rotX = 0, arc = Math.PI * 2) {
    const g = new THREE.TorusGeometry(R, r, 10, 40, arc); g.rotateX(rotX); g.translate(x, y, z);
    return this.add(mat, g, null, false);
  }
  model(name, x, y, z, rot = 0, s = 1, opts = {}) { this.models.push({ name, x, y, z, rot, s, ...opts }); }
  light(x, y, z, intensity = 3, distance = 6, color = 0xffd2a0) { this.lights.push({ x, y, z, intensity, distance, color }); }
}

// ---------------------------------------------------------------- the pieces
const B = {};
B.rug = (P, it) => P.box(material(it.mat), 0, 0, 0, it.w, 0.012, it.d, 0.004);
B.doormat = (P, it) => P.box(material('carpet_dark'), 0, 0, 0, it.w, 0.015, it.d, 0.004);
B.bathmat = (P, it) => P.box(material('linen_white'), 0, 0, 0, it.w, 0.012, it.d, 0.004);

function legs(P, mat, w, d, h, inset = 0.05, r = 0.018, round = true) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (round) P.cyl(mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), r, r * 0.8, h, 12);
    else P.box(mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), r * 2, h, r * 2);
  }
}
function fronts(P, mat, w, y0, h, z, n, pull = 'brass', vertical = false) {
  const gap = 0.004, fw = (w - gap * (n + 1)) / n;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + gap + fw / 2 + i * (fw + gap);
    P.box(material(mat), cx, y0 + gap, z, fw, h - 2 * gap, 0.018, 0.002, true);
    if (pull) {
      if (vertical) P.box(material(pull), cx + (i % 2 ? -1 : 1) * (fw / 2 - 0.05), y0 + h * 0.35, z + 0.018, 0.012, h * 0.3, 0.012);
      else P.box(material(pull), cx, y0 + h - 0.06, z + 0.015, Math.min(0.16, fw * 0.4), 0.012, 0.014);
    }
  }
}

B.credenza = (P, it) => {
  const { w, d, h } = it, lh = 0.14;
  legs(P, material('oak'), w - 0.1, d - 0.08, lh, 0.03, 0.016);
  P.box(material('walnut'), 0, lh, 0, w, h - lh, d - 0.02, 0.006);
  fronts(P, 'walnut', w - 0.02, lh, h - lh - 0.02, d / 2 - 0.006, 3, 'brass');
};
B.sideboard = (P, it) => {
  const { w, d, h } = it, lh = 0.16;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(material('blacksteel'), sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.06), 0.012, 0.012, lh, 10);
  P.box(material('walnut'), 0, lh, 0, w, h - lh, d - 0.02, 0.006);
  fronts(P, 'walnut', w - 0.02, lh, h - lh - 0.02, d / 2 - 0.006, 4, 'brass', true);
};
B.tv = (P, it) => {
  const y0 = it.y - it.h / 2;
  P.box(material('blacksteel'), 0, y0, 0, it.w, it.h, 0.03, 0.004);
  P.box(material('screen'), 0, y0 + 0.008, 0.016, it.w - 0.016, it.h - 0.016, 0.002, 0, false);
};
B.books = (P, it) => {
  seed = Math.floor(Math.abs(it.x * 977 + it.z * 131)) % 2147483646 + 1;
  if (it.lying) {
    let y = 0;
    for (let i = 0; i < it.n; i++) {
      const t = 0.025 + rnd() * 0.02, bw = it.w * (0.8 + rnd() * 0.2), bd = it.d * (0.8 + rnd() * 0.2);
      const g = P.box(material('book_' + Math.floor(rnd() * 10)), 0, y, 0, bw, t, bd, 0.002);
      g.rotateY((rnd() - 0.5) * 0.25);
      y += t;
    }
    return;
  }
  let x = -it.w / 2;
  for (let i = 0; i < it.n; i++) {
    const t = 0.022 + rnd() * 0.022, bh = 0.19 + rnd() * 0.09, bd = it.d * (0.75 + rnd() * 0.25);
    P.box(material('book_' + Math.floor(rnd() * 10)), x + t / 2, 0, -it.d / 2 + bd / 2, t, bh, bd, 0.002);
    x += t + 0.002;
  }
};
B.book_open = (P, it) => {
  const L = P.box(material('paper'), -0.075, 0, 0, 0.15, 0.012, 0.22, 0.003); L.rotateZ(0.06);
  const R = P.box(material('paper'), 0.075, 0, 0, 0.15, 0.012, 0.22, 0.003); R.rotateZ(-0.06);
  P.box(material('book_2'), 0, -0.004, 0, 0.31, 0.005, 0.225, 0.001, false);
};
B.vase = (P, it) => {
  const h = it.h, r = it.w / 2;
  P.lathe(material(it.mat || 'ceramic_sand'), [[0, 0], [r * 0.7, 0], [r, h * 0.25], [r * 0.95, h * 0.6], [r * 0.45, h * 0.88], [r * 0.4, h], [r * 0.34, h], [r * 0.34, h * 0.9], [0, h * 0.9]], 0, 0, 0, 40);
};
B.bowl = (P, it) => {
  const r = it.w / 2;
  P.lathe(material(it.mat || 'ceramic_dark'), [[0, 0], [r * 0.45, 0], [r * 0.85, r * 0.3], [r, r * 0.55], [r * 0.94, r * 0.56], [r * 0.8, r * 0.3], [r * 0.4, 0.012], [0, 0.012]], 0, 0, 0, 40);
  if (it.fruit) for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    P.model('m_avocado', Math.cos(a) * r * 0.42, 0.02 + (i === 3 ? 0.045 : 0), Math.sin(a) * r * 0.42, a, 1);
  }
};
B.mug = (P, it) => {
  P.lathe(material('ceramic_white'), [[0, 0], [0.038, 0], [0.042, 0.09], [0.039, 0.09], [0.035, 0.008], [0, 0.008]], 0, 0, 0, 28);
  P.torus(material('ceramic_white'), 0, 0, 0, 0.022, 0.006, 0, Math.PI).rotateZ(-Math.PI / 2).translate(0.04, 0.048, 0);
};
B.magazines = (P, it) => {
  const cols = ['paper', 'book_6', 'book_4'];
  for (let i = 0; i < 3; i++) {
    const g = P.box(material(cols[i]), 0, i * 0.008, 0, it.w, 0.007, it.d, 0.001);
    g.rotateY(i * 0.18 - 0.15);
  }
};
B.cushion = (P, it) => {
  const g = new RoundedBoxGeometry(it.w, it.h, it.d, 4, 0.06);
  g.rotateX(-0.28); g.translate(0, it.h / 2, 0);
  P.add(material(it.mat), g, new THREE.BoxGeometry(it.w, it.h, it.d).translate(0, it.h / 2, 0));
};
B.throw = (P, it) => {
  P.box(material(it.mat), 0, 0, 0, it.w, 0.025, it.d, 0.01);
  P.box(material(it.mat), 0, -0.3, it.d / 2 + 0.012, it.w, 0.32, 0.02, 0.008);
};
B.coffee_round = (P, it) => {
  const r = it.w / 2, h = it.h;
  P.cyl(material('oak'), 0, 0, 0, r * 0.62, r * 0.62, h - 0.04, 40);
  P.cyl(material('travertine'), 0, h - 0.04, 0, r, r, 0.04, 56);
};
B.floor_lamp = (P, it) => {
  P.cyl(material('blacksteel'), 0, 0, 0, 0.14, 0.15, 0.025, 32);
  P.cyl(material('brass'), 0, 0.025, 0, 0.009, 0.009, it.h - 0.05, 10, false);
  P.cyl(material('shade'), 0, it.h - 0.05, 0, 0.17, 0.2, 0.28, 40, true, true);
  P.light(0, it.h + 0.05, 0, 3.0, 5);
};
B.table_lamp = (P, it) => {
  const h = it.h, r = it.w / 2;
  P.lathe(material('ceramic_white'), [[0, 0], [r * 0.45, 0], [r * 0.6, h * 0.18], [r * 0.55, h * 0.4], [r * 0.2, h * 0.55], [r * 0.08, h * 0.6], [0, h * 0.6]], 0, 0, 0, 32);
  P.cyl(material('brass'), 0, h * 0.6, 0, 0.006, 0.006, h * 0.12, 8, false);
  P.cyl(material('shade'), 0, h * 0.62, 0, r * 0.8, r, h * 0.38, 36, true, true);
  if (it.light) P.light(0, h * 0.78, 0, 2.2, 4.5);
};
B.banquette = (P, it) => {
  const { w, d } = it;
  P.box(material('oak'), 0, 0.06, 0, w, 0.32, d, 0.008);
  P.box(material('blacksteel'), 0, 0, 0, w - 0.08, 0.06, d - 0.08);
  P.box(material('linen_sand'), 0, 0.38, 0.02, w - 0.02, 0.08, d - 0.04, 0.03);
  const g = new RoundedBoxGeometry(w - 0.04, 0.4, 0.11, 3, 0.04); g.rotateX(-0.12); g.translate(0, 0.66, -d / 2 + 0.07);
  P.add(material('linen_sand'), g, new THREE.BoxGeometry(w - 0.04, 0.4, 0.11).translate(0, 0.66, -d / 2 + 0.07));
};
B.dining_rect = (P, it) => {
  const { w, d, h } = it;
  P.box(material('oak'), 0, h - 0.035, 0, w, 0.035, d, 0.006);
  P.box(material('oak'), 0, h - 0.11, 0, w - 0.16, 0.075, d - 0.16);
  legs(P, material('oak'), w, d, h - 0.035, 0.07, 0.025, false);
};
B.dining_chair = (P, it) => {
  const { w, d } = it, sh = 0.46;
  legs(P, material('oak'), w - 0.04, d - 0.06, sh - 0.04, 0.03, 0.016);
  P.box(material('oak'), 0, sh - 0.05, 0, w - 0.02, 0.04, d - 0.04, 0.006);
  P.box(material('linen_sand'), 0, sh - 0.01, 0.01, w - 0.06, 0.05, d - 0.1, 0.02);
  for (const sx of [-1, 1]) P.box(material('oak'), sx * (w / 2 - 0.04), sh, -d / 2 + 0.04, 0.03, 0.42, 0.03);
  P.box(material('oak'), 0, sh + 0.24, -d / 2 + 0.035, w - 0.06, 0.14, 0.02, 0.005);
};
B.pendant_globe = (P, it) => {
  const r = it.w / 2, y = it.y;
  P.cyl(material('brass'), 0, CEIL - 0.02, 0, 0.06, 0.06, 0.02, 24);
  P.cyl(material('blacksteel'), 0, y + r, 0, 0.003, 0.003, CEIL - 0.02 - y - r, 6, false);
  P.cyl(material('brass'), 0, y + r * 0.92, 0, 0.03, 0.035, 0.05, 20);
  P.sphere(material('opal'), 0, y, 0, r);
  P.light(0, y - 0.05, 0, 4.0, 6);
};
B.pendant_drum = (P, it) => {
  const r = it.w / 2, y = it.y;
  P.cyl(material('blacksteel'), 0, CEIL - 0.02, 0, 0.05, 0.05, 0.02, 20);
  P.cyl(material('blacksteel'), 0, y + 0.3, 0, 0.003, 0.003, CEIL - 0.02 - y - 0.3, 6, false);
  P.cyl(material('shade'), 0, y, 0, r, r, 0.3, 40, true, true);
  P.cyl(material('glow'), 0, y + 0.02, 0, r * 0.95, r * 0.95, 0.004, 32, false);
  P.light(0, y - 0.05, 0, 3.2, 5.5);
};
B.ceiling_drum = (P, it) => {
  const r = it.w / 2;
  P.cyl(material('shade'), 0, CEIL - 0.17, 0, r, r, 0.16, 44, true, true);
  P.cyl(material('glow'), 0, CEIL - 0.165, 0, r * 0.97, r * 0.97, 0.004, 36, false);
  P.light(0, CEIL - 0.35, 0, 2.0, 5);
};
B.painting = (P, it) => {
  const { w, h } = it, y0 = it.y - h / 2, fr = material(it.frame === 'black' ? 'blacksteel' : 'oak');
  const f = 0.028, dd = 0.035;
  P.box(fr, 0, y0, 0, w, f, dd); P.box(fr, 0, y0 + h - f, 0, w, f, dd);
  P.box(fr, -w / 2 + f / 2, y0 + f, 0, f, h - 2 * f, dd); P.box(fr, w / 2 - f / 2, y0 + f, 0, f, h - 2 * f, dd);
  const photo = ['sky1', 'sky2', 'spruit', 'field'].includes(it.img);
  const m = photo ? 0.05 : 0;
  if (photo) P.box(material('paper'), 0, y0 + f, -0.006, w - 2 * f, h - 2 * f, 0.004, 0, false);
  const g = new THREE.PlaneGeometry(w - 2 * f - 2 * m, h - 2 * f - 2 * m);
  g.translate(0, y0 + h / 2, -0.002);
  P.add(material('art_' + it.img), g, null, false);
};
B.mirror_round = (P, it) => {
  const r = it.w / 2;
  P.torus(material('brass'), 0, it.y, 0, r, 0.012);
  const g = new THREE.CircleGeometry(r - 0.005, 48); g.translate(0, it.y, -0.004);
  P.add(material('mirror'), g, null, false);
  if (it.light) P.light(0, it.y + 0.1, 0.35, 1.6, 3.5);
};
B.mirror_rect = (P, it) => {
  const { w, h } = it, y0 = it.y - h / 2;
  P.box(material('glow'), 0, y0 - 0.01, -0.012, w + 0.02, h + 0.02, 0.005, 0, false);
  P.box(material('mirror'), 0, y0, 0, w, h, 0.008, 0.004);
  if (it.light) P.light(0, it.y + 0.15, 0.4, 2.0, 3.5);
};
B.curtain = (P, it) => {
  const w = it.w, top = CEIL - 0.08, h = top - 0.015, seg = 40;
  const g = new THREE.PlaneGeometry(w, h, seg, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w) * Math.PI * 7) * 0.035);
  g.computeVertexNormals();
  g.translate(0, 0.015 + h / 2, 0);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  P.add(material('linen_ivory'), g, new THREE.BoxGeometry(w, h, 0.07).translate(0, 0.015 + h / 2, 0), false);
  const rod = P.cyl(material('blacksteel'), 0, 0, 0, 0.011, 0.011, w + 0.12, 10, false);
  rod.translate(0, -(w + 0.12) / 2, 0); rod.rotateZ(Math.PI / 2); rod.translate(0, top + 0.03, 0);
};
B.bed = (P, it) => {
  const { w, d, h } = it, hb = 0.09, md = d - hb, z0 = -d / 2 + hb;   // mattress from z0 to d/2
  const mc = z0 + md / 2;
  P.box(material(it.head), 0, 0.08, -d / 2 + hb / 2, w + 0.12, h - 0.08, hb, 0.03);
  P.box(material('oak'), 0, 0.08, mc, w, 0.22, md, 0.01);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(material('blacksteel'), sx * (w / 2 - 0.1), 0, mc + sz * (md / 2 - 0.1), 0.05, 0.08, 0.05);
  P.box(material('linen_white'), 0, 0.3, mc, w - 0.03, 0.2, md - 0.04, 0.05);
  // duvet over the lower two thirds, its top folded back in white
  const dl = md * 0.74, dz = d / 2 - dl / 2;
  P.box(material(it.duvet), 0, 0.27, dz + 0.01, w + 0.08, 0.27, dl + 0.02, 0.07);
  P.box(material('linen_white'), 0, 0.5, z0 + md * 0.26 + 0.05, w + 0.08, 0.05, 0.16, 0.025);
  // throw across the foot
  P.box(material(it.throw), 0, 0.53, d / 2 - 0.3, w + 0.1, 0.035, 0.5, 0.015);
  P.box(material(it.throw), 0, 0.3, d / 2 + 0.025, w + 0.1, 0.27, 0.025, 0.01);
  // pillows: two to sleep on, the rest in front
  const pl = it.pillows || [];
  const n0 = Math.min(2, pl.length);
  for (let i = 0; i < n0; i++) {
    const g = new RoundedBoxGeometry(w / 2 - 0.08, 0.17, 0.42, 4, 0.07); g.rotateX(-0.45);
    g.translate((i - 0.5) * (w / 2 - 0.02), 0.6, z0 + 0.2);
    P.add(material(pl[i]), g, new THREE.BoxGeometry(w / 2 - 0.08, 0.17, 0.42).translate((i - 0.5) * (w / 2 - 0.02), 0.6, z0 + 0.2));
  }
  for (let i = n0; i < pl.length; i++) {
    const k = i - n0, n = pl.length - n0, cw = 0.42;
    const g = new RoundedBoxGeometry(cw, 0.4, 0.13, 4, 0.06); g.rotateX(-0.3);
    g.translate((k - (n - 1) / 2) * (cw + 0.04), 0.68, z0 + 0.42);
    P.add(material(pl[i]), g, new THREE.BoxGeometry(cw, 0.4, 0.13).translate((k - (n - 1) / 2) * (cw + 0.04), 0.68, z0 + 0.42));
  }
};
B.nightstand = (P, it) => {
  const { w, d, h } = it;
  legs(P, material('oak'), w - 0.04, d - 0.04, 0.16, 0.03, 0.014);
  P.box(material('oak'), 0, 0.16, 0, w, h - 0.16, d, 0.006);
  P.box(material('oak'), 0, h - 0.17, d / 2, w - 0.02, 0.13, 0.012, 0.002);
  P.cyl(material('brass'), 0, 0, 0, 0.012, 0.012, 0.014, 14, false).rotateX(Math.PI / 2).translate(0, h - 0.11, d / 2 + 0.006);
};
B.wardrobe = (P, it) => {
  const { w, d, h } = it;
  P.box(material('blacksteel'), 0, 0, -0.03, w - 0.04, 0.08, d - 0.06);
  P.box(material('oaklight'), 0, 0.08, -0.01, w, h - 0.08, d - 0.02);
  const n = Math.max(2, Math.round(w / 0.5));
  fronts(P, 'oaklight', w, 0.08, h - 0.08, d / 2 - 0.009, n, 'brass', true);
};
B.dresser = (P, it) => {
  const { w, d, h } = it;
  legs(P, material('blacksteel'), w - 0.06, d - 0.06, 0.14, 0.02, 0.01);
  P.box(material('walnut'), 0, 0.14, 0, w, h - 0.14, d, 0.006);
  const dh = (h - 0.16) / 3;
  for (let i = 0; i < 3; i++) {
    P.box(material('walnut'), 0, 0.15 + i * dh + 0.003, d / 2, w - 0.02, dh - 0.006, 0.014, 0.002);
    P.box(material('brass'), 0, 0.15 + i * dh + dh / 2, d / 2 + 0.014, 0.14, 0.012, 0.012);
  }
};
B.tray = (P, it) => {
  P.box(material('brass'), 0, 0, 0, it.w, 0.012, it.d, 0.003);
  P.cyl(material('amber'), -0.08, 0.012, 0, 0.03, 0.03, 0.12, 20);
  P.cyl(material('ceramic_white'), 0.0, 0.012, 0.02, 0.025, 0.025, 0.09, 20);
  P.cyl(material('glass'), 0.09, 0.012, -0.01, 0.028, 0.028, 0.14, 20, false);
};
B.desk = (P, it) => {
  const { w, d, h } = it;
  P.box(material('oak'), 0, h - 0.03, 0, w, 0.03, d, 0.004);
  for (const sx of [-1, 1]) {
    P.box(material('blacksteel'), sx * (w / 2 - 0.05), 0, 0, 0.025, h - 0.03, d - 0.06);
  }
  P.box(material('blacksteel'), 0, h - 0.1, -d / 2 + 0.05, w - 0.12, 0.05, 0.02);
};
B.desk_chair = (P, it) => {
  const { w, d } = it, sh = 0.46;
  legs(P, material('blacksteel'), w - 0.04, d - 0.06, sh - 0.03, 0.03, 0.011);
  P.box(material('oak'), 0, sh - 0.03, 0, w - 0.02, 0.03, d - 0.04, 0.006);
  P.box(material('leather'), 0, sh, 0.01, w - 0.06, 0.035, d - 0.12, 0.015);
  for (const sx of [-1, 1]) P.box(material('blacksteel'), sx * (w / 2 - 0.035), sh, -d / 2 + 0.035, 0.018, 0.36, 0.018);
  P.box(material('leather'), 0, sh + 0.2, -d / 2 + 0.04, w - 0.05, 0.16, 0.025, 0.01);
};
B.laptop = (P, it) => {
  P.box(material('aluminium'), 0, 0, 0, it.w, 0.014, it.d, 0.006);
  const g = new THREE.BoxGeometry(it.w, it.d * 0.92, 0.006); g.translate(0, it.d * 0.46, 0); g.rotateX(-0.28); g.translate(0, 0.014, -it.d / 2);
  P.add(material('aluminium'), g, true);
  const s = new THREE.PlaneGeometry(it.w - 0.02, it.d * 0.8); s.translate(0, it.d * 0.46, 0.0035); s.rotateX(-0.28); s.translate(0, 0.014, -it.d / 2);
  P.add(material('screen'), s, null, false);
};
B.desk_lamp = (P, it) => {
  P.cyl(material('blacksteel'), 0, 0, 0, 0.07, 0.075, 0.02, 24);
  const a = P.cyl(material('blacksteel'), 0, 0, 0, 0.007, 0.007, 0.38, 8, false); a.rotateZ(0.25); a.translate(0, 0.02, 0);
  const s = P.cyl(material('blacksteel'), 0, 0, 0, 0.03, 0.075, 0.12, 24, true, true); s.rotateZ(-0.5); s.translate(-0.12, 0.36, 0.02);
};
B.kitchen_run = (P, it) => {
  const { w, d, h } = it;
  P.box(material('blacksteel'), 0, 0, -0.04, w, 0.1, d - 0.1);
  P.box(material('oaklight'), 0, 0.1, -0.01, w, h - 0.13, d - 0.04);
  const n = Math.round(w / 0.55);
  fronts(P, 'oaklight', w, 0.1, h - 0.13, d / 2 - 0.03, n, 'brass');
  P.box(material('marble'), 0, h - 0.03, 0, w + 0.01, 0.03, d, 0.004);
  P.box(material('marble'), 0, h, -d / 2 + 0.01, w + 0.01, 0.6, 0.015);           // splashback
  const sx = it.sink || 0, hx = it.hob || 0;
  P.box(material('chrome'), sx, h - 0.004, 0.02, 0.55, 0.006, 0.42, 0.01, true);   // sink
  P.box(material('black_glass'), sx, h - 0.0035, 0.02, 0.48, 0.004, 0.34, 0.01, false);
  P.cyl(material('chrome'), sx, h, -d / 2 + 0.07, 0.022, 0.025, 0.04, 16);
  const tap = P.cyl(material('chrome'), 0, 0, 0, 0.011, 0.011, 0.32, 10, false); tap.translate(sx, h + 0.04, -d / 2 + 0.07);
  P.torus(material('chrome'), 0, 0, 0, 0.08, 0.011, 0, Math.PI).rotateY(Math.PI / 2).translate(sx, h + 0.36, -d / 2 + 0.15);
  P.box(material('black_glass'), hx, h, 0.02, 0.6, 0.006, 0.5, 0.004);             // induction hob
};
B.upper_shelves = (P, it) => {
  const { w, d } = it;
  for (const y of [it.y, it.y + 0.42]) {
    P.box(material('oak'), 0, y, 0, w, 0.03, d, 0.004);
    for (const sx of [-1, 1]) P.box(material('brass'), sx * (w / 2 - 0.15), y - 0.06, -d / 2 + 0.01, 0.015, 0.06, 0.02);
  }
  for (let i = 0; i < 6; i++) P.cyl(material('ceramic_white'), -w / 2 + 0.2, it.y + 0.03 + i * 0.018, 0, 0.13, 0.12, 0.016, 32);
  for (let i = 0; i < 4; i++) P.cyl(material('ceramic_sand'), -w / 2 + 0.5 + i * 0.13, it.y + 0.03, 0, 0.045, 0.04, 0.1, 24);
  for (let i = 0; i < 3; i++) P.cyl(material('glass'), 0.15 + i * 0.12, it.y + 0.45, 0.0, 0.04, 0.04, 0.16, 20, false);
  for (let i = 0; i < 5; i++) P.box(material('book_' + (i * 3 + 1)), w / 2 - 0.35 + i * 0.045, it.y + 0.45, -0.01, 0.035, 0.24, 0.19, 0.002);
  P.lathe(material('ceramic_green'), [[0, 0], [0.06, 0], [0.09, 0.08], [0.07, 0.18], [0.04, 0.21], [0, 0.21]], -w / 2 + 0.3, it.y + 0.45, 0, 32);
};
B.hood = (P, it) => {
  P.box(material('chrome'), 0, it.y, 0, it.w, 0.08, it.d, 0.005);
  P.box(material('chrome'), 0, it.y + 0.08, -it.d / 2 + 0.15, 0.3, CEIL - it.y - 0.08, 0.26, 0.004);
};
B.fridge = (P, it) => {
  const { w, d, h } = it;
  P.box(material('oaklight'), 0, 0, 0, w, CEIL - 0.02, d, 0.004);
  P.box(material('oaklight'), 0, 0.1, d / 2, w - 0.01, h - 0.12, 0.015, 0.002);
  P.box(material('oaklight'), 0, h, d / 2, w - 0.01, CEIL - 0.04 - h, 0.015, 0.002);
  P.box(material('brass'), -w / 2 + 0.06, 0.9, d / 2 + 0.015, 0.012, 0.45, 0.012);
};
B.kettle = (P, it) => {
  P.lathe(material('chrome'), [[0, 0], [0.085, 0], [0.095, 0.08], [0.085, 0.16], [0.05, 0.2], [0.012, 0.21], [0, 0.21]], 0, 0, 0, 36);
  P.torus(material('blacksteel'), 0, 0.17, 0, 0.065, 0.009, 0, Math.PI).rotateY(Math.PI / 2);
};
B.board = (P, it) => P.box(material('oak'), 0, 0, 0, it.w, 0.022, it.d, 0.01);
B.jars = (P, it) => {
  for (let i = 0; i < 3; i++) {
    const x = -it.w / 2 + 0.06 + i * 0.12, hh = 0.14 + i * 0.03;
    P.cyl(material('ceramic_white'), x, 0, 0, 0.05, 0.05, hh, 28);
    P.cyl(material('oak'), x, hh, 0, 0.052, 0.052, 0.018, 28);
  }
};
B.bistro_table = (P, it) => {
  const r = it.w / 2, h = it.h;
  P.cyl(material('blacksteel'), 0, 0, 0, 0.2, 0.22, 0.02, 30);
  P.cyl(material('blacksteel'), 0, 0.02, 0, 0.02, 0.02, h - 0.05, 12);
  P.cyl(material('oak'), 0, h - 0.03, 0, r, r, 0.03, 48);
};
B.bistro_chair = (P, it) => {
  const { w, d } = it, sh = 0.46;
  legs(P, material('blacksteel'), w - 0.02, d - 0.04, sh, 0.02, 0.01);
  for (let i = 0; i < 4; i++) P.box(material('oak'), 0, sh, -d / 2 + 0.06 + i * (d - 0.1) / 3.5, w - 0.03, 0.02, 0.07, 0.006);
  for (const sx of [-1, 1]) P.box(material('blacksteel'), sx * (w / 2 - 0.02), sh, -d / 2 + 0.02, 0.016, 0.4, 0.016);
  P.box(material('oak'), 0, sh + 0.28, -d / 2 + 0.02, w - 0.03, 0.09, 0.016, 0.004);
};
B.shower = (P, it) => {
  const { w, d } = it;
  P.box(material('ceramic_white'), 0, 0, 0, w, 0.035, d, 0.01);
  const clad = (it.clad || 'back,left,right').split(',');
  const M = material('marble');
  if (clad.includes('back')) P.box(M, 0, 0.035, -d / 2 + 0.005, w, 2.1, 0.01, 0, false);
  if (clad.includes('left')) P.box(M, -w / 2 + 0.005, 0.035, 0, 0.01, 2.1, d, 0, false);
  if (clad.includes('right')) P.box(M, w / 2 - 0.005, 0.035, 0, 0.01, 2.1, d, 0, false);
  // glass screen on the open side, half its length
  P.box(material('glass'), w / 4, 0.04, d / 2 - 0.02, w / 2, 1.95, 0.008, 0, true);
  P.box(material('chrome'), w / 4, 1.99, d / 2 - 0.02, w / 2, 0.012, 0.012);
  P.cyl(material('chrome'), 0, 2.0, -d / 2 + 0.25, 0.12, 0.12, 0.012, 32);
  const arm = P.cyl(material('chrome'), 0, 0, 0, 0.01, 0.01, 0.25, 8, false); arm.rotateX(Math.PI / 2); arm.translate(0, 2.03, -d / 2 + 0.125);
  P.box(material('chrome'), 0.15, 1.0, -d / 2 + 0.03, 0.08, 0.12, 0.04, 0.01);
};
B.wc = (P, it) => {
  const w = it.w, d = it.d;
  P.box(material('ceramic_white'), 0, 0.33, -d / 2 + 0.06, w, 0.42, 0.12, 0.03);                   // in-wall frame cover
  P.box(material('chrome'), 0, 0.95, -d / 2 + 0.122, 0.18, 0.12, 0.006, 0.003, false);
  const g = new RoundedBoxGeometry(w - 0.02, 0.36, d - 0.14, 5, 0.12); g.translate(0, 0.22, 0.05);
  P.add(material('ceramic_white'), g, new THREE.BoxGeometry(w - 0.02, 0.36, d - 0.14).translate(0, 0.22, 0.05));
  P.box(material('ceramic_white'), 0, 0.4, 0.05, w - 0.03, 0.02, d - 0.16, 0.01);
};
B.vanity = (P, it) => {
  const { w, d, h } = it;
  if (!it.small) {
    P.box(material('walnut'), 0, h - 0.42, 0, w, 0.4, d, 0.006);
    P.box(material('walnut'), 0, h - 0.4, d / 2, w - 0.02, 0.36, 0.012, 0.002);
    P.box(material('marble'), 0, h - 0.02, 0, w + 0.01, 0.02, d + 0.01, 0.003);
  } else P.box(material('marble'), 0, h - 0.06, 0, w, 0.06, d, 0.006);
  const r = Math.min(0.2, w * 0.3);
  P.lathe(material('ceramic_white'), [[0, 0], [r * 0.6, 0], [r, r * 0.45], [r, r * 0.6], [r * 0.93, r * 0.6], [r * 0.9, r * 0.45], [r * 0.5, 0.02], [0, 0.02]], 0, h, 0.02, 40);
  P.cyl(material('chrome'), 0, h, -d / 2 + 0.05, 0.016, 0.018, 0.22, 14);
  const sp = P.cyl(material('chrome'), 0, 0, 0, 0.01, 0.01, 0.1, 10, false); sp.rotateX(Math.PI / 2); sp.translate(0, h + 0.2, -d / 2 + 0.1);
};
B.towel_rail = (P, it) => {
  const g = P.cyl(material('chrome'), 0, 0, 0, 0.01, 0.01, it.w, 10, false); g.translate(0, -it.w / 2, 0); g.rotateZ(Math.PI / 2); g.translate(0, it.y, 0.05);
  for (const sx of [-1, 1]) P.box(material('chrome'), sx * it.w / 2, it.y - 0.01, 0, 0.02, 0.02, 0.06);
  P.box(material(it.towel), 0, it.y - 0.55, 0.065, it.w - 0.1, 0.55, 0.02, 0.008);
  P.box(material(it.towel), 0, it.y - 0.35, 0.035, it.w - 0.1, 0.35, 0.02, 0.008);
};
B.bottles = (P, it) => {
  P.cyl(material('amber'), -0.05, 0, 0, 0.03, 0.03, 0.15, 20); P.cyl(material('blacksteel'), -0.05, 0.15, 0, 0.008, 0.008, 0.04, 8);
  P.cyl(material('ceramic_white'), 0.04, 0, 0, 0.028, 0.028, 0.12, 20);
};
B.console = (P, it) => {
  const { w, d, h } = it;
  P.box(material('walnut'), 0, h - 0.03, 0, w, 0.03, d, 0.004);
  for (const sx of [-1, 1]) {
    P.box(material('blacksteel'), sx * (w / 2 - 0.04), 0, 0, 0.018, h - 0.03, d - 0.04);
  }
  P.box(material('walnut'), 0, 0.12, 0, w - 0.1, 0.02, d - 0.04, 0.003);
  P.box(material('book_3'), -w / 2 + 0.25, 0.14, 0, 0.26, 0.05, 0.2, 0.003);
};
B.bench = (P, it) => {
  const { w, d, h } = it;
  for (const sx of [-1, 1]) P.box(material('oak'), sx * (w / 2 - 0.05), 0, 0, 0.04, h - 0.04, d - 0.02);
  P.box(material('oak'), 0, h - 0.04, 0, w, 0.04, d, 0.006);
  P.box(material('oak'), 0, 0.1, 0, w - 0.1, 0.02, d - 0.04);
  P.box(material('linen_olive'), 0, h, 0.0, w - 0.04, 0.05, d - 0.04, 0.02);
};
B.planter = (P, it) => {
  P.box(material('concrete'), 0, 0, 0, it.w, it.h, it.d, 0.01);
  P.box(material('soil'), 0, it.h - 0.03, 0, it.w - 0.05, 0.02, it.d - 0.05, 0, false);
};

// ---------------------------------------------------------------- models
const MODELS = {
  m_sofa: 'sofa.glb', m_lounge: 'lounge_chair.glb', m_chair_peacock: 'chair_peacock.glb',
  m_pouf: 'pouf.glb', m_plant: 'plant_syngonium.glb', m_vases: 'vases_flowers.glb', m_succulent: 'succulent.glb',
  m_avocado: 'avocado.glb',
};
const loader = new GLTFLoader();
// The host serves text, not binary 3D formats, so models ship as base64 text and are decoded here.
export async function fetchBinary(url) {
  const b64 = (await (await fetch(url)).text()).trim();
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
const cache = {};
async function loadModel(t) {
  if (cache[t]) return cache[t];
  cache[t] = fetchBinary('assets/b64/' + MODELS[t] + '.txt').then((buf) => loader.parseAsync(buf, '')).then((g) => {
    const root = g.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => {
        if (t === 'm_pouf') { m.map = null; m.color.set(0xc08a4a); m.sheenColor?.set(0xe8c48c); }
        if (t === 'm_sofa' && /fabric/.test(m.name)) { m.color.setRGB(0.46, 0.38, 0.27); m.sheenColor?.setRGB(0.95, 0.82, 0.66); m.roughness = 0.85; }
        wrapInk(m, { glass: m.transparent || m.transmission > 0 });
        if (m.transmission > 0) { m.transparent = true; m.opacity = 0.35; m.transmission = 0; }
      });
    });
    return { root, offset: new THREE.Vector3(-c.x, -box.min.y, -c.z), size: box.getSize(new THREE.Vector3()) };
  });
  return cache[t];
}

// ---------------------------------------------------------------- build everything
export async function buildDecor(items) {
  const group = new THREE.Group();
  const buckets = {};
  const edges = [];
  const lights = [];
  const placements = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const it of items) {
    const base = it.on || 0;
    m4.compose(new THREE.Vector3(it.x, base, it.z), q.setFromAxisAngle(up, it.rot), one);
    if (it.t.startsWith('m_')) { placements.push({ name: it.t, x: 0, y: 0, z: 0, rot: 0, s: it.s || 1, m: m4.clone() }); continue; }
    const fn = B[it.t];
    if (!fn) { console.warn('no builder for', it.t); continue; }
    const P = new Parts();
    fn(P, it);
    for (const [mat, g] of P.list) {
      g.applyMatrix4(m4);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      (buckets[mat.name] ??= { mat, geos: [] }).geos.push(g.index ? g.toNonIndexed() : g);
    }
    for (const v of P.edges) { v.applyMatrix4(m4); edges.push(v.x, v.y, v.z); }
    for (const l of P.lights) { const v = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(m4); lights.push({ ...l, x: v.x, y: v.y, z: v.z, room: it.room }); }
    for (const mm of P.models) placements.push({ ...mm, m: m4.clone() });
  }
  for (const { mat, geos } of Object.values(buckets)) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    const transparent = mat.transparent;
    mesh.castShadow = !transparent && !['opal', 'glow', 'shade', 'mirror'].includes(mat.name);
    mesh.receiveShadow = !transparent;
    if (transparent) mesh.renderOrder = 3;
    group.add(mesh);
  }
  // models, with a box drawn around each for the line drawing
  const loaded = await Promise.all([...new Set(placements.map((p) => p.name))].map(async (n) => [n, await loadModel(n)]));
  const lib = Object.fromEntries(loaded);
  for (const p of placements) {
    const L = lib[p.name];
    const inner = L.root.clone(true);
    inner.position.copy(L.offset);
    const holder = new THREE.Group();
    holder.add(inner);
    holder.scale.setScalar(p.s);
    holder.rotation.y = p.rot;
    holder.position.set(p.x, p.y, p.z);
    const outer = new THREE.Group();
    outer.add(holder);
    outer.applyMatrix4(p.m);
    group.add(outer);
    // outline box for the drawing
    const sz = L.size.clone().multiplyScalar(p.s);
    const bx = new THREE.BoxGeometry(sz.x, sz.y, sz.z).translate(0, sz.y / 2, 0);
    bx.rotateY(p.rot); bx.translate(p.x, p.y, p.z); bx.applyMatrix4(p.m);
    const e = new THREE.EdgesGeometry(bx).attributes.position;
    for (let i = 0; i < e.count; i++) edges.push(e.getX(i), e.getY(i), e.getZ(i));
  }
  return { group, edges, lights };
}
