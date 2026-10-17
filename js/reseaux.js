// Pack Réseaux (demo): a FICTITIOUS set of services drawn into Appartement B.
// Fixtures you would see on the walls (sockets, switches, panel, water heater) are part of
// the normal visit. The pipes and cables appear only in Réseaux mode (the model is then a line
// drawing): sharp where they are in view, faint where a wall or a piece of furniture hides them,
// with numbered markers on the points to check. Data: data/reseaux.json (made by reseaux.py).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flat } from './core.js';

export const NET_COLORS = { elec: 0xf2b705, ef: 0x2f7fe0, ec: 0xe0442f, evac: 0x8a8f96 };
const RADIUS = { elec: 0.011, ef: 0.012, ec: 0.012, evac: 0.032 };

// a tube along a polyline, as cylinders plus ball joints (no twisting on sharp corners)
function polyTube(pts, r) {
  const geos = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
    const len = a.distanceTo(b);
    if (len < 1e-4) continue;
    const g = new THREE.CylinderGeometry(r, r, len, 10, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    geos.push(g);
  }
  for (const p of pts) geos.push(new THREE.SphereGeometry(r * 1.05, 10, 8).translate(...p));
  return geos;
}

function overlay(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
}
// Sharp pass: depth-tested, but pulled PULL metres towards the eye so a cable inside the wall
// (or a pipe in the screed) in front of you still shows. What runs behind another wall or a
// piece of furniture fails the test and is left to the faint pass.
export const PULL = { value: 0.35 };
function pulled(color) {
  const m = new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: false, toneMapped: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPull = PULL;
    sh.vertexShader = 'uniform float uPull;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    { float L = length(mvPosition.xyz); mvPosition.xyz *= max(L - uPull, min(L, 0.08)) / L; gl_Position = projectionMatrix * mvPosition; }`);
  };
  m.customProgramCacheKey = () => 'netpull';
  return m;
}
const FAINT = 0.34;
function twoPass(group, geo, color, order) {
  const sharp = new THREE.Mesh(geo, pulled(color));
  sharp.renderOrder = order; sharp.frustumCulled = false;
  const faint = new THREE.Mesh(geo, overlay(color, FAINT));
  faint.renderOrder = order - 10; faint.frustumCulled = false;
  group.add(faint, sharp);
}

function numberSprite(n) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d93a2b'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
  g.fillStyle = '#fff'; g.font = '600 64px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, toneMapped: false }));
  s.scale.setScalar(0.26); s.renderOrder = 30;
  return s;
}

export async function buildReseaux() {
  const R = await (await fetch('data/reseaux.json')).json();
  const fixtures = new THREE.Group();
  const xray = new THREE.Group(); xray.visible = false;

  // ---- what is on the walls (normal visit) ----
  const white = flat(0xf4f2ee, { roughness: 0.35 });
  const grey = flat(0x8d8f92, { roughness: 0.5 });
  const dark = flat(0x2b2b2d, { roughness: 0.6 });
  const parts = { white: [], grey: [], dark: [] };
  const place = (g, f, along = 0.012) => {
    const yaw = Math.atan2(f.n[0], f.n[1]);
    g.rotateY(yaw);
    g.translate(f.p[0] + f.n[0] * along, f.p[1], f.p[2] + f.n[1] * along);
    return g;
  };
  for (const f of R.fixtures) {
    if (f.k === 'prise') {
      parts.white.push(place(new THREE.BoxGeometry(0.08, 0.08, 0.012), f));
      for (const dx of [-0.011, 0.011]) parts.dark.push(place(new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 8).rotateX(Math.PI / 2).translate(dx, 0, 0.006), f));
    } else if (f.k === 'inter') {
      parts.white.push(place(new THREE.BoxGeometry(0.08, 0.08, 0.012), f));
      parts.white.push(place(new THREE.BoxGeometry(0.05, 0.05, 0.008).translate(0, 0, 0.008), f));
    } else if (f.k === 'tableau') {
      parts.white.push(place(new THREE.BoxGeometry(0.42, 0.5, 0.1), f, 0.05));
      parts.grey.push(place(new THREE.BoxGeometry(0.36, 0.06, 0.004).translate(0, 0.1, 0.052), f, 0.05));
    } else if (f.k === 'chauffe_eau') {
      parts.white.push(place(new THREE.CylinderGeometry(0.22, 0.22, 0.75, 28), f, 0.23));
      parts.grey.push(place(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateX(Math.PI / 2).translate(0, -0.15, 0.225), f, 0.23));
    } else if (f.k === 'compteur') {
      parts.grey.push(place(new THREE.BoxGeometry(0.3, 0.22, 0.14), f, 0.07));
    }
  }
  const mats = { white, grey, dark };
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const prep = list.map((g) => { g = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(g.attributes)) if (!['position', 'normal'].includes(a)) g.deleteAttribute(a); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; });
    const m = new THREE.Mesh(mergeGeometries(prep), mats[k]); m.castShadow = false; m.receiveShadow = true;
    fixtures.add(m);
  }

  // ---- the networks (X-ray) ----
  const byType = {};
  for (const r of R.runs) (byType[r.t] ??= []).push(...polyTube(r.pts, RADIUS[r.t]));
  const order = { evac: 20, ef: 21, ec: 22, elec: 23 };
  for (const [t, geos] of Object.entries(byType)) {
    twoPass(xray, mergeGeometries(geos.map((g) => { g.deleteAttribute('uv'); return g; })), NET_COLORS[t], order[t]);
  }
  // markers on fixtures
  const marks = { elec: [], ef: [], ec: [], evac: [] };
  for (const f of R.fixtures) {
    const t = { prise: 'elec', inter: 'elec', dcl: 'elec', tableau: 'elec', eau: 'ef', chauffe_eau: 'ec', compteur: 'ef', chute: 'evac' }[f.k];
    const r = ['tableau', 'chauffe_eau', 'compteur'].includes(f.k) ? 0.07 : f.k === 'chute' ? 0.0 : 0.035;
    if (r) marks[t].push(new THREE.SphereGeometry(r, 14, 10).translate(...f.p));
  }
  for (const [t, geos] of Object.entries(marks)) {
    if (!geos.length) continue;
    twoPass(xray, mergeGeometries(geos), new THREE.Color(NET_COLORS[t]).multiplyScalar(0.8), 25);
  }
  // points to check
  const alertSprites = R.alerts.map((a) => {
    const s = numberSprite(a.id); s.position.set(...a.p); xray.add(s);
    return s;
  });
  return { fixtures, xray, alerts: R.alerts, alertSprites, note: R.note };
}
