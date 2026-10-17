// Shared state for the ink <-> material look.
//
// Every surface asks a small texture "which room am I in?" (rooms.png, made
// from the plan). A room stays a line drawing until the visitor walks in; then
// the material spreads out from where they stood. The cut (one clipping plane)
// turns the model into a floor plan: inside faces of the walls are painted ink.

import * as THREE from 'three';

export const PAPER = '#f1eee6';
export const INK = '#17171a';
export const NR = 11; // rooms in rooms.png (index 1..NR)

export const CUT = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2);

const raw = (hex) => new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);

export const U = {
  uRoomMap: { value: null },
  uBounds: { value: new THREE.Vector4() },
  uReveal: { value: Array.from({ length: NR }, () => new THREE.Vector4(0, 0, -1e4, 0)) },
  uOutside: { value: 0 },
  uForceInk: { value: 0 }, // 1 = the whole model as a line drawing (Réseaux mode)
  uPaper: { value: raw(PAPER) },
  uInkCol: { value: raw(INK) },
  uSoft: { value: 1.2 },
  uInkTone: { value: 0.05 },
};

export const DECL = /* glsl */ `
#define NR ${NR}
uniform sampler2D uRoomMap;
uniform vec4 uBounds;
uniform vec4 uReveal[NR];
uniform float uOutside;
uniform float uForceInk;
uniform vec3 uPaper;
uniform vec3 uInkCol;
uniform float uSoft;
uniform float uInkTone;
int roomOf(vec3 q) {
  vec2 uv = (q.xz - uBounds.xy) / (uBounds.zw - uBounds.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1;
  float r = texture2D(uRoomMap, uv).r;
  return int(floor(r * 255.0 / 20.0 + 0.5)) - 1;
}
// 1 = line drawing, 0 = material
float inkOf(vec3 q) {
  if (uForceInk > 0.5) return 1.0;
  int r = roomOf(q);
  if (r < 0) return 1.0 - uOutside;
  vec4 s = uReveal[r];
  float d = distance(q.xz, s.xy);
  return smoothstep(s.z - uSoft, s.z, d);
}
`;

// ---- surfaces -------------------------------------------------------------
export function inkAware(material, { backInk = false, glass = false } = {}) {
  material.side = THREE.DoubleSide;
  material.clippingPlanes = [CUT];
  if (!glass) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
  }
  const own = { uBackInk: { value: backInk ? 1 : 0 }, uGlass: { value: glass ? 1 : 0 } };
  material.userData.ink = own;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = 'varying vec3 vWp;\nvarying vec3 vWn;\n' + sh.vertexShader.replace(
      '#include <fog_vertex>',
      '#include <fog_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);'
    );
    sh.fragmentShader = 'varying vec3 vWp;\nvarying vec3 vWn;\nuniform float uBackInk;\nuniform float uGlass;\n' + DECL + sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `#include <dithering_fragment>
      {
        vec3 nn = normalize(vWn) * (gl_FrontFacing ? 1.0 : -1.0);
        float ink = inkOf(vWp + nn * 0.05);
        if (uGlass > 0.5) {
          gl_FragColor.a *= (1.0 - ink);
        } else if (uBackInk > 0.5 && !gl_FrontFacing) {
          gl_FragColor.rgb = uInkCol;
        } else {
          vec3 wash = uPaper * (1.0 - uInkTone * (abs(nn.x) + 0.6 * abs(nn.z)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, wash, ink);
        }
      }`
    );
  };
  material.customProgramCacheKey = () => 'ink' + (backInk ? 'B' : '') + (glass ? 'G' : '');
  return material;
}

// ---- lines: visible while any surface next to them is still a drawing --------
export function inkLines(material) {
  material.transparent = true;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vWL;\n' + sh.vertexShader.replace(
      'void main() {',
      'void main() {\nvWL = (modelMatrix * vec4(position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;'
    );
    sh.fragmentShader = 'varying vec3 vWL;\n' + DECL + sh.fragmentShader.replace(
      '#include <fog_fragment>',
      /* glsl */ `#include <fog_fragment>
      {
        float k = max(max(inkOf(vWL + vec3(0.07, 0.0, 0.0)), inkOf(vWL - vec3(0.07, 0.0, 0.0))),
                      max(inkOf(vWL + vec3(0.0, 0.0, 0.07)), inkOf(vWL - vec3(0.0, 0.0, 0.07))));
        gl_FragColor.a *= k;
        if (gl_FragColor.a < 0.02) discard;
      }`
    );
  };
  material.customProgramCacheKey = () => 'inkline';
  return material;
}

// ---- textures ---------------------------------------------------------------
const loader = new THREE.TextureLoader();
const pending = [];
let maxAniso = 8;
export const setAnisotropy = (n) => (maxAniso = n);
export const texturesReady = () => Promise.all(pending);

function tex(file, { srgb = false, size = 1, rot = 0 } = {}) {
  const t = new THREE.Texture();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / size, 1 / size);
  t.rotation = rot;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  pending.push(loader.loadAsync(file).then((src) => {
    t.image = src.image; t.anisotropy = maxAniso; t.needsUpdate = true;
  }));
  return t;
}

// Poly Haven sets: diff (colour), nor (normal, GL), arm (AO / roughness / metal)
function pbr(name, { size = 1, rot = 0, color = 0xffffff, normalScale = 1, roughness = 1, metal = false, ink = {} } = {}) {
  const base = 'tex/' + name + '/';
  const arm = tex(base + 'arm.jpg', { size, rot });
  const m = new THREE.MeshStandardMaterial({
    map: tex(base + 'diff.jpg', { srgb: true, size, rot }),
    normalMap: tex(base + 'nor.jpg', { size, rot }),
    roughnessMap: arm, aoMap: null,
    metalnessMap: metal ? arm : null,
    roughness, metalness: metal ? 1 : 0, color,
  });
  m.normalScale.set(normalScale, normalScale);
  return inkAware(m, ink);
}
const flat = (color, { roughness = 0.8, metalness = 0, emissive = 0, emissiveIntensity = 1, ink = {} } = {}) =>
  inkAware(new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity }), ink);

// Real scanned textures (Poly Haven, CC0), graded to the decor palette offline.
// tex2/<set>/<variant>.jpg is the colour; nor.jpg and arm.jpg come from the same scan.
const HAS_MAPS = new Set(['oak_wood_planks', 'marble_01', 'natural_walnut_veneer', 'rough_linen', 'poly_wool_herringbone',
  'leather_red_02', 'white_stucco', 'wood_textured_concrete', 'white_oak_veneer', 'plastered_wall', 'brown_leather']);
export function real(set, variant, { size = 1, rot = 0, color = 0xffffff, normalScale = 1, roughness = 1, metalness = 0, ink = {}, side } = {}) {
  const base = 'tex2/' + set + '/';
  const maps = HAS_MAPS.has(set);
  const m = new THREE.MeshStandardMaterial({
    map: tex(base + variant + '.jpg', { srgb: true, size, rot }),
    normalMap: maps ? tex(base + 'nor.jpg', { size, rot }) : null,
    roughnessMap: maps ? tex(base + 'arm.jpg', { size, rot }) : null,
    roughness, metalness, color,
  });
  m.normalScale.set(normalScale, normalScale);
  return inkAware(m, ink);
}
export { flat, inkAware as wrapInk };

export function makeMaterials() {
  const M = {};
  // walls: lime plaster painted light ivory
  M.wall = real('plastered_wall', 'ivory', { size: 2.2, normalScale: 0.18, roughness: 1, ink: { backInk: true } });
  M.wallOut = real('white_stucco', 'diff', { size: 3.0, color: 0xe6d7bf, normalScale: 0.3, roughness: 0.95, ink: { backInk: true } });
  M.ceiling = flat(0xf3efe8, { roughness: 1, ink: { backInk: true } });
  // floors: limestone slabs in the living spaces, oak in the bedrooms, honed stone in the bathrooms
  M.tile = real('marble_01', 'living', { size: 2.4, normalScale: 0.5, roughness: 0.8 });
  M.bath = real('marble_01', 'bath', { size: 1.4, normalScale: 0.5, roughness: 0.75 });
  M.oak = real('oak_wood_planks', 'honey', { size: 2.4, normalScale: 0.6, roughness: 0.85 });
  M.stone = real('marble_01', 'landing', { size: 2.0, normalScale: 0.5, roughness: 0.8, ink: { backInk: true } });
  M.balcony = real('wood_textured_concrete', 'deck', { size: 1.6, normalScale: 0.5, roughness: 0.95 });
  // joinery
  M.wood = real('natural_walnut_veneer', 'walnut', { size: 1.0, rot: Math.PI / 2, normalScale: 0.4, roughness: 0.75, ink: { backInk: true } });
  M.alu = flat(0x3b3c3e, { roughness: 0.45, metalness: 0.7, ink: { backInk: true } });
  M.steel = flat(0xa7a9ac, { roughness: 0.32, metalness: 1, ink: { backInk: true } });
  M.sill = real('marble_rock', 'white', { size: 0.8, roughness: 0.3, ink: { backInk: true } });
  M.glass = inkAware(new THREE.MeshPhysicalMaterial({ color: 0xdfe9ea, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false }), { glass: true });
  M.dark = flat(0x2a2a2c, { roughness: 0.9, ink: { backInk: true } });
  return M;
}
