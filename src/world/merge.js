// Static batching: merge non-instanced static meshes that share a material into spatial chunks.
// Chunking keeps frustum culling effective while cutting draw calls (main + shadow + mirror passes) dramatically.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeStatic(root, cell = 220) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.noMerge) return;
    if (o.material.isShaderMaterial) return;
    let p = o; let skip = false; while (p) { if (p.userData.noMerge) skip = true; p = p.parent; } if (skip) return;
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() > 700) return;
    c.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const key = [o.material.uuid, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.layers.mask, o.renderOrder, Math.floor(c.x / cell), Math.floor(c.z / cell)].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  let removed = 0, added = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = [];
    for (const o of list) {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.morphAttributes = {}; g.clearGroups();
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const o0 = list[0];
    const m = new THREE.Mesh(merged, o0.material);
    m.castShadow = o0.castShadow; m.receiveShadow = o0.receiveShadow; m.layers.mask = o0.layers.mask; m.renderOrder = o0.renderOrder;
    root.add(m); added++;
    for (const o of list) { o.parent.remove(o); removed++; }
  }
  // drop now-empty groups
  const empties = []; root.traverse((o) => { if (o.isGroup && o !== root && o.children.length === 0) empties.push(o); });
  for (const e of empties) e.parent && e.parent.remove(e);
  return { removed, added };
}
