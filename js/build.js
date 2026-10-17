// Turns plan3d.json into meshes and ink lines.
// Plan coordinates (x right, y down the sheet) map to three.js (x, up, z = y).
// Walls are the polygons traced from the PDF, extruded at any angle.

import * as THREE from 'three';

const EDGE = 30; // degrees: only real corners become ink lines

// extrude a plan polygon [[x,y]...] between heights y0 and y1, world-planar UVs in metres
export function prism(poly, y0, y1) {
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, UVGenerator: worldUV });
  g.rotateX(Math.PI / 2); // shape (x, y) -> (x, -depth.., y)
  g.translate(0, y1, 0);
  return g;
}
// UVs: caps use plan x/y, sides use (distance along the wall, height)
const worldUV = {
  generateTopUV(geo, v, a, b, c) {
    return [a, b, c].map((i) => new THREE.Vector2(v[i * 3], v[i * 3 + 1]));
  },
  generateSideWallUV(geo, v, a, b, c, d) {
    const P = (i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
    const [ax, ay, az] = P(a), [bx, by, bz] = P(b), [cx, cy, cz] = P(c), [dx, dy, dz] = P(d);
    if (Math.abs(ay - by) < Math.abs(ax - bx)) {
      return [new THREE.Vector2(ax, -az), new THREE.Vector2(bx, -bz), new THREE.Vector2(cx, -cz), new THREE.Vector2(dx, -dz)];
    }
    return [new THREE.Vector2(ay, -az), new THREE.Vector2(by, -bz), new THREE.Vector2(cy, -cz), new THREE.Vector2(dy, -dz)];
  },
};

// a thin box along a segment a->b of the plan, `t` thick, between heights
export function slabAlong(a, b, t, y0, y1, offset = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (!(L > 1e-4) || !(y1 > y0)) return null;
  const nx = -dy / L, ny = dx / L;
  const o0 = offset - t / 2, o1 = offset + t / 2;
  return prism([
    [a[0] + nx * o0, a[1] + ny * o0], [b[0] + nx * o0, b[1] + ny * o0],
    [b[0] + nx * o1, b[1] + ny * o1], [a[0] + nx * o1, a[1] + ny * o1],
  ], y0, y1);
}
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export class Collector {
  constructor() { this.meshes = {}; this.edges = []; this.annot = []; }
  add(mat, g, edges = true) {
    if (!g) return;
    const pa = g.attributes.position.array;
    for (let i = 0; i < pa.length; i++) if (!Number.isFinite(pa[i])) { console.warn('NaN geometry dropped', mat); return; }
    (this.meshes[mat] ??= []).push(g);
    if (edges) {
      const e = new THREE.EdgesGeometry(g, EDGE).attributes.position;
      for (let i = 0; i < e.count; i++) this.edges.push(e.getX(i), e.getY(i), e.getZ(i));
    }
  }
  line(pts, y) {
    for (let i = 0; i < pts.length - 1; i++) this.annot.push(pts[i][0], y, pts[i][1], pts[i + 1][0], y, pts[i + 1][1]);
  }
}

export function buildApartment(P) {
  const C = new Collector();
  const H = P.hsp, TOP = P.hsp + P.slab;
  const st = P.stair;
  const inStair = (w) => {
    const cx = w.reduce((s, p) => s + p[0], 0) / w.length, cy = w.reduce((s, p) => s + p[1], 0) / w.length;
    return cx > st.x0 - 0.3 && cx < st.x1 + 0.3 && cy > st.top - 0.6 && cy < st.landing_y1 + 0.3;
  };

  // ---- walls ----
  for (const w of P.walls) C.add('wall', prism(w, inStair(w) ? -P.storey : 0, inStair(w) ? TOP + 1.6 : TOP));

  // ---- floors and ceilings, one per room ----
  P.rooms.forEach((r, i) => {
    if (r.name === 'ESCALIER') return;
    const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const f = new THREE.ShapeGeometry(shape);
    f.rotateX(Math.PI / 2); // (x, y, 0) -> (x, 0, y)
    f.translate(0, 0.0004 * i, 0);
    f.computeVertexNormals();
    // normals point down after rotation: flip winding so the floor faces up
    const idx = f.index.array;
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k]; idx[k] = idx[k + 2]; idx[k + 2] = t; }
    f.computeVertexNormals();
    C.add(r.floor, f, false);
    if (r.name !== 'BALCON') C.add('ceiling', prism(r.poly, H, TOP), false);
  });

  // ---- openings ----
  for (const o of P.openings) {
    const a = o.a, b = o.b, t = 0.16;
    C.add('wall', slabAlong(a, b, t, o.head, TOP));                     // lintel
    if (o.kind === 'window' || o.kind === 'baie') {
      if (o.sill > 0) {
        C.add('wall', slabAlong(a, b, t, 0, o.sill - 0.03));
        C.add('sill', slabAlong(a, b, t + 0.06, o.sill - 0.03, o.sill, 0.03));
      }
      // aluminium frame and glass
      const f = 0.05;
      C.add('alu', slabAlong(a, b, 0.07, o.sill, o.sill + f));
      C.add('alu', slabAlong(a, b, 0.07, o.head - f, o.head));
      C.add('alu', slabAlong(a, lerp2(a, b, f / o.width), 0.07, o.sill, o.head));
      C.add('alu', slabAlong(lerp2(a, b, 1 - f / o.width), b, 0.07, o.sill, o.head));
      if (o.width > 1.0) C.add('alu', slabAlong(lerp2(a, b, 0.5 - 0.02 / o.width), lerp2(a, b, 0.5 + 0.02 / o.width), 0.07, o.sill, o.head));
      C.add('glass', slabAlong(a, b, 0.012, o.sill + f, o.head - f), false);
    } else if (o.kind === 'door' && o.pocket) {
      // pocket door: the leaf slides into the partition, only the frame shows
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      C.add('wood', slabAlong(a, lerp2(a, b, 0.04 / L), t + 0.02, 0, o.head));
      C.add('wood', slabAlong(lerp2(a, b, 1 - 0.04 / L), b, t + 0.02, 0, o.head));
      C.add('wood', slabAlong(a, b, t + 0.02, o.head - 0.04, o.head));
    } else if (o.kind === 'door') {
      // leaf standing open at 90 degrees, into the room it serves
      const room = P.rooms.find((r) => r.name === o.into);
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      let nx = -dy / L, ny = dx / L;
      if (room) {
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if ((room.center[0] - mx) * nx + (room.center[1] - my) * ny < 0) { nx = -nx; ny = -ny; }
      }
      const leafs = o.width > 1.1 ? [[a, 0.4 * L, 1], [b, 0.6 * L, -1]] : [[a, L - 0.04, 1]];
      for (const [h, w] of leafs) {
        const tip = [h[0] + nx * w, h[1] + ny * w];
        C.add('wood', slabAlong(h, tip, 0.04, 0.01, o.head - 0.01, 0));
      }
      // frame
      C.add('wood', slabAlong(a, lerp2(a, b, 0.04 / L), t + 0.02, 0, o.head));
      C.add('wood', slabAlong(lerp2(a, b, 1 - 0.04 / L), b, t + 0.02, 0, o.head));
      C.add('wood', slabAlong(a, b, t + 0.02, o.head - 0.04, o.head));
    }
  }
  // doors the visitor does not open: apartments and lifts
  for (const c of P.closed) {
    C.add('wall', slabAlong(c.a, c.b, 0.16, c.head, TOP));
    if (c.kind === 'lift') {
      const m = lerp2(c.a, c.b, 0.5);
      C.add('steel', slabAlong(c.a, m, 0.05, 0, c.head, 0.02));
      C.add('steel', slabAlong(m, c.b, 0.05, 0, c.head, 0.02));
    } else {
      C.add('wood', slabAlong(c.a, c.b, 0.05, 0, c.head));
    }
  }

  // ---- balcony: glass guard with a steel top rail ----
  const ra = P.rail.a, rb = P.rail.b;
  C.add('glass', slabAlong(ra, rb, 0.015, 0.02, 1.0), false);
  C.add('steel', slabAlong(ra, rb, 0.05, 1.0, 1.05));
  const RL = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
  for (let s = 0; s <= RL; s += RL / 4) {
    const p = lerp2(ra, rb, s / RL), q = lerp2(ra, rb, Math.min(1, (s + 0.04) / RL));
    C.add('steel', slabAlong(p, q, 0.05, 0, 1.0));
  }

  // ---- stairs: left flight down to the half landing, right flight up ----
  const n = st.n, T = st.tread, R = st.rise, g = st.gap / 2;
  const down = [st.x0, st.split - g], up = [st.split + g, st.x1];
  for (let i = 0; i < n; i++) {
    const y0 = st.top + i * T, y1 = y0 + T;
    const hd = -R * (i + 1), hu = R * (i + 1);
    C.add('stone', prism([[down[0], y0], [down[1], y0], [down[1], y1], [down[0], y1]], hd - 0.18, hd));
    C.add('stone', prism([[up[0], y0], [up[1], y0], [up[1], y1], [up[0], y1]], hu - 0.18, hu));
    // the flight below, coming back up under the right one
    const hb = -1.5 - R * (n - i);
    C.add('stone', prism([[up[0], y0], [up[1], y0], [up[1], y1], [up[0], y1]], hb - 0.18, hb));
  }
  const yb = st.bottom;
  C.add('stone', prism([[st.x0, yb], [st.x1, yb], [st.x1, st.landing_y1], [st.x0, st.landing_y1]], -1.5 - 0.2, -1.5));
  C.add('stone', prism([[st.x0, yb], [st.x1, yb], [st.x1, st.landing_y1], [st.x0, st.landing_y1]], 1.5 - 0.2, 1.5));
  C.add('stone', prism([[st.x0, st.top - 0.6], [st.x1, st.top - 0.6], [st.x1, st.top], [st.x0, st.top]], -0.2, 0), false);
  // floor of the storey below, seen down the stairwell
  C.add('stone', prism([[st.x0, st.top - 0.6], [st.x1, st.top - 0.6], [st.x1, st.landing_y1], [st.x0, st.landing_y1]], -P.storey - 0.2, -P.storey), false);
  // the open well between the flights: steel rails on both sides
  for (const x of [st.split - g, st.split + g]) {
    C.add('steel', prism([[x - 0.02, st.top], [x + 0.02, st.top], [x + 0.02, yb], [x - 0.02, yb]], 0.85, 0.9).translate(0, 0, 0), true);
  }
  // sloped rails follow the flights
  const rail = (x, h0, h1) => {
    const g2 = new THREE.BoxGeometry(0.04, 0.04, Math.hypot(n * T, h1 - h0));
    g2.rotateX(Math.atan2(h0 - h1, n * T));
    g2.translate(x, (h0 + h1) / 2 + 0.9, st.top + (n * T) / 2);
    return g2;
  };
  C.add('steel', rail(st.split - g - 0.03, 0, -1.5).rotateX(0));
  C.add('steel', rail(st.split + g + 0.03, 0, 1.5));
  for (let i = 0; i <= n; i += 3) {
    const z = st.top + i * T + 0.15;
    C.add('steel', new THREE.BoxGeometry(0.03, 0.9, 0.03).translate(st.split - g - 0.03, -R * i + 0.45, z));
    C.add('steel', new THREE.BoxGeometry(0.03, 0.9, 0.03).translate(st.split + g + 0.03, R * i + 0.45, z));
  }

  // ---- the drawing on the floor: furniture and fittings from the PDF ----
  for (const L of P.furniture) C.line(L, 0.004);
  for (const L of P.sanitary) C.line(L, 0.004);
  return C;
}

// The tower around the flat: six storeys below, three above.
export function buildTower(P, footprint) {
  const below = prism(footprint, -P.floor * P.storey - 0.2, -0.22);
  const above = prism(footprint, P.hsp + P.slab + 0.02, P.hsp + P.slab + 3 * P.storey);
  return [below, above];
}
