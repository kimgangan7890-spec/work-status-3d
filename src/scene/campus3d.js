import * as THREE from "three";
import { layoutCampus, towerLayout, lookProps, desaturate } from "./campus-layout.js";

// 한 층의 창과 세로 몰딩. 이 텍스처 하나를 모든 타워가 UV 반복으로 공유한다.
function facadeTexture() {
  const canvas = globalThis.document?.createElement("canvas"), ctx = canvas?.getContext?.("2d");
  if (!ctx) return null; // WebGL 없는 단위 테스트도 형상·배치를 검증한다.
  canvas.width = 128; canvas.height = 64;
  ctx.fillStyle = "#d9d6cf"; ctx.fillRect(0, 0, 128, 64);
  for (let col = 0; col < 4; col++) {
    const x = col * 32;
    ctx.fillStyle = "#b6b3ad"; ctx.fillRect(x, 0, 2, 64);
    ctx.fillStyle = "#f0eee8"; ctx.fillRect(x + 3, 0, 2, 64);
    ctx.fillStyle = "#788f9a"; ctx.fillRect(x + 9, 5, 16, 54);
    ctx.fillStyle = "#b0c9d0"; ctx.fillRect(x + 10, 6, 14, 38);
    ctx.fillStyle = "#809eaa"; ctx.fillRect(x + 10, 44, 14, 14);
    ctx.fillStyle = "#e7e4dc"; ctx.fillRect(x + 16, 5, 1, 54);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 1;
  return texture;
}
const ACCENTS = [0x6b8191, 0x8d9381, 0x98877e, 0x768d8b];
export function createCampusScene() {
  const group = new THREE.Group(), unit = new THREE.BoxGeometry(1, 1, 1), body = unit.clone(), tree = new THREE.ConeGeometry(0.65, 1.6, 5);
  // 면별 명암은 그림자 없이도 옥탑과 측벽을 구분하게 한다.
  for (const geo of [unit, body]) {
    const normals = geo.attributes.normal, colors = [];
    for (let i = 0; i < normals.count; i++) { const c = normals.getY(i) > 0 ? 1 : normals.getX(i) !== 0 ? 0.73 : 0.91; colors.push(c, c, c); }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  const texture = facadeTexture(), materials = [], meshes = [], nodes = new Map();
  const basic = (color, extra = {}) => { const m = new THREE.MeshBasicMaterial({ color, vertexColors: true, ...extra }); materials.push(m); return m; };
  const uNight = { value: 0 };
  const facade = basic(0xffffff, { map: texture });
  if (texture) {
    facade.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float facadeFloors; attribute float facadeLit; attribute float facadeDesat; varying float vLit; varying float vDesat;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvLit = facadeLit; vDesat = facadeDesat; vMapUv.y *= facadeFloors; if (abs(normal.y) > 0.5) vMapUv = vec2(0.05, 0.98);");
      // 켜진 창 비율: 공유 텍스처 그대로, 칸마다 해시로 일부 유리만 어둡게(vLit<0이면 효과 없음 = 지표 없는 동)
      shader.uniforms.uNight = uNight;
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vLit; varying float vDesat; uniform float uNight; float winGlow = 0.0;")
        .replace("#include <map_fragment>", "#include <map_fragment>\nfloat glass = step(0.02, sampledDiffuseColor.b - sampledDiffuseColor.r); vec2 cell = floor(vec2(vMapUv.x * 4.0, vMapUv.y)); float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453); winGlow = glass * step(h, vLit >= 0.0 ? vLit : 0.4); if (vLit >= 0.0 && glass > 0.5 && h > vLit) diffuseColor.rgb *= vec3(0.7, 0.74, 0.82); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), vDesat);")
        .replace("#include <opaque_fragment>", "outgoingLight = mix(outgoingLight, vec3(1.0, 0.82, 0.5), winGlow * uNight * 0.6);\n#include <opaque_fragment>");
    };
    facade.customProgramCacheKey = () => "campus-floors-v4";
  }
  body.setAttribute("facadeFloors", new THREE.InstancedBufferAttribute(new Float32Array(36).fill(12), 1));
  body.setAttribute("facadeDesat", new THREE.InstancedBufferAttribute(new Float32Array(36), 1));
  body.setAttribute("facadeLit", new THREE.InstancedBufferAttribute(new Float32Array(36).fill(-1), 1));
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  function batch(geo, mat, capacity) { const m = new THREE.InstancedMesh(geo, mat, capacity); m.count = 0; m.frustumCulled = false; group.add(m); meshes.push(m); return m; }
  const m = {
    body: batch(body, facade, 36), roof: batch(unit, basic(0xa8aaa5), 36), equipment: batch(unit, basic(0xc1c2bb), 36),
    band: batch(unit, basic(0xffffff), 36), progress: batch(unit, basic(0x4c9c94), 36),
    podium: batch(unit, basic(0xb8b6ad), 12), entrance: batch(unit, basic(0x546974), 12),
    warning: batch(body, basic(0xe09b5c, { map: texture }), 36), beacon: batch(unit, basic(0xf0bc49), 12),
    lawn: batch(unit, basic(0xa3b68c), 12), path: batch(unit, basic(0xd8d3c3), 12), parking: batch(unit, basic(0x8f9b9d), 12), lines: batch(unit, basic(0xd8ddda), 60),
    lampPole: batch(unit, basic(0x4a5058), 24), lampHead: batch(unit, basic(0xffd98a), 24),
    trunks: batch(unit, basic(0x877e68), 60), trees: batch(tree, new THREE.MeshBasicMaterial({ color: 0x708c63 }), 60),
  };
  m.lampHead.name = "lampHead"; m.warning.name = "warning"; m.progress.name = "progress";
  materials.push(m.trees.material);
  const ground = new THREE.Mesh(unit, basic(0xa3b591)), road = new THREE.Mesh(unit, basic(0xabb6b4)); group.add(ground, road);
  const mountainGeometries = [], mountainMaterial = new THREE.MeshBasicMaterial({ vertexColors: true }); materials.push(mountainMaterial);
  const mountains = Array.from({ length: 4 }, (_, i) => {
    const geo = new THREE.BufferGeometry(), h = 14 + (i % 2) * 8;
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-40, 0, 0, 40, 0, 0, 0, h, 0], 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute([0.65, 0.73, 0.68, 0.65, 0.73, 0.68, 0.78, 0.83, 0.79], 3));
    mountainGeometries.push(geo); const mesh = new THREE.Mesh(geo, mountainMaterial); group.add(mesh); return mesh;
  });
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false }); materials.push(hitMaterial);
  let layout = layoutCampus(0), signature = "";
  function put(mesh, i, x, y, z, w, h, d, color) {
    position.set(x, y, z); scale.set(w, h, d); matrix.compose(position, rotation, scale); mesh.setMatrixAt(i, matrix);
    if (color !== undefined) mesh.setColorAt(i, new THREE.Color(color));
  }
  function draw(n) {
    const ts = towerLayout(n.summary, n.look), lp = lookProps(n.look); n.towers = ts; const tone = c => lp?.desat ? desaturate(c, lp.desat) : c;
    const { x, z } = n.q, idx = n.index, first = ts[0], top = first.height + 1.6;
    put(m.podium, idx, x, 0.45, z, 11.8, 0.9, 13.8);
    put(m.entrance, idx, x + 1, 0.4, z + 6.93, 1.6, 0.65, 0.04);
    ts.forEach((t, j) => {
      const i = idx * 3 + j, px = x + t.x, pz = z + t.z, y = t.height + 0.9;
      put(m.body, i, px, 0.9 + t.height / 2, pz, t.width, t.height, t.depth, n.error ? 0x909b9d : 0xffffff);
      body.attributes.facadeFloors.setX(i, t.floors); body.attributes.facadeLit.setX(i, lp ? lp.lit : -1); body.attributes.facadeDesat.setX(i, lp ? lp.desat : 0);
      put(m.roof, i, px, y + 0.34, pz, t.width * 0.7, 0.65, t.depth * 0.78);
      put(m.equipment, i, px + t.width * 0.12, y + 0.83, pz - t.depth * 0.1, t.width * 0.34, 0.4, t.depth * 0.3, lp?.roofColor ? tone(lp.roofColor) : 0xffffff);
      put(m.band, i, px, y + 0.04, pz, t.width * 1.03, 0.13, t.depth * 1.03, tone(lp?.roofColor ?? ACCENTS[idx % 4]));
      const pct = Math.max(0, Math.min(100, n.summary?.progress ?? 0)) / 100;
      put(m.progress, i, px - t.width * (1 - pct) / 2, y + 0.14, pz, t.width * pct, pct ? 0.15 : 0, pct ? t.depth * 1.04 : 0);
      const blocked = !n.error && n.summary?.blocked;
      put(m.warning, i, px, y - 0.4, pz, blocked ? t.width * 1.003 : 0, blocked ? 0.8 : 0, blocked ? t.depth * 1.003 : 0);
    });
    for (let j = ts.length; j < 3; j++) for (const key of ["body", "roof", "equipment", "band", "progress", "warning"]) put(m[key], idx * 3 + j, 0, -100, 0, 0, 0, 0);
    put(m.beacon, idx, x + first.x, top + 0.2, z + first.z, n.fresh ? 0.85 : 0, n.fresh ? 0.85 : 0, n.fresh ? 0.85 : 0);
    n.hit.scale.set(15, top, 17); n.hit.position.set(x, top / 2, z);
    n.anchor = { id: n.id, x: x + first.x, y: top + 3.2, z: z + first.z };
  }
  function flush() { for (const mesh of meshes) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; } body.attributes.facadeFloors.needsUpdate = true; body.attributes.facadeLit.needsUpdate = true; body.attributes.facadeDesat.needsUpdate = true; }
  function setProjects(projects) {
    projects = projects.slice(0, 12);
    const sig = JSON.stringify(projects.map(p => [p.id, p.name])); if (sig === signature) return;
    signature = sig; for (const n of nodes.values()) group.remove(n.hit); nodes.clear(); layout = layoutCampus(projects.length);
    const b = layout.bounds, w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    ground.scale.set(w + 400, 0.1, d + 350); ground.position.set(0, -0.4, 0); road.scale.set(w, 0.12, d); road.position.set(0, -0.25, 0);
    mountains.forEach((mesh, i) => mesh.position.set((i - 1.5) * 34, -0.3, b.minZ - 28 - (i % 2) * 8));
    for (const q of layout.buildings) {
      const p = projects[q.index], hit = new THREE.Mesh(unit, hitMaterial); hit.userData.projectId = p.id; group.add(hit);
      const lk = looks.get(p.id) ?? null, n = { id: p.id, index: q.index, q, hit, summary: null, look: lk, lookSig: lk ? lookSig(lk) : "" }; nodes.set(p.id, n); draw(n);
      put(m.lawn, q.index, q.x, -0.05, q.z, 16, 0.12, 18);
      put(m.path, q.index, q.x + 1, 0.04, q.z + 8, 1.7, 0.08, 2.2);
      put(m.parking, q.index, q.x + 6.5, 0.04, q.z + 1, 1.7, 0.08, 12);
      for (let j = 0; j < 5; j++) put(m.lines, q.index * 5 + j, q.x + 6.5, 0.09, q.z - 4 + j * 2.4, 1.4, 0.015, 0.06);
    }
    const treeCount = Math.min(60, projects.length * 5);
    for (let i = 0; i < treeCount; i++) {
      const q = layout.buildings[Math.floor(i / 5)], x = q.x - 7 + (i % 5 === 4 ? 5 : 0), z = q.z + (i % 5 === 4 ? 8 : -7 + (i % 5) * 3.2);
      put(m.trunks, i, x, 0.45, z, 0.15, 0.8, 0.15); put(m.trees, i, x, 1.45, z, 1.15, 1.15, 1.15);
    }
    for (let i = 0; i < Math.min(24, projects.length * 2); i++) { // 가로등: 대지 사이 도로 모서리에 발광 상자 머리
      const q = layout.buildings[i >> 1], x = q.x + (i & 1 ? 9.4 : -9.4), z = q.z + 9.6;
      put(m.lampPole, i, x, 1.5, z, 0.14, 3, 0.14); put(m.lampHead, i, x, 3.15, z, 0.5, 0.3, 0.5);
    }
    for (const [key, mesh] of Object.entries(m)) mesh.count = key.startsWith("lamp") ? Math.min(24, projects.length * 2) : ["body", "roof", "equipment", "band", "progress", "warning"].includes(key) ? projects.length * 3 : key === "lines" ? projects.length * 5 : ["trees", "trunks"].includes(key) ? treeCount : projects.length;
    flush();
  }
  function update({ id, summary, error, fresh }) { const n = nodes.get(id); if (!n) return; n.summary = summary; n.error = error; n.fresh = fresh; draw(n); flush(); }
  // 외부 지표를 건물에 반영한다. 같은 내용이면 아무것도 하지 않고, 바뀐 건물만 다시 그린다. 반환: 바뀌었는지.
  const looks = new Map(), lookSig = look => JSON.stringify([look.floors ?? null, look.litRatio ?? 0, look.roof ?? "", !!look.dim]);
  function setLook(id, look) {
    if (look) looks.set(id, look); else looks.delete(id);
    const n = nodes.get(id); if (!n) return false;
    const sig = look ? lookSig(look) : "";
    if ((n.lookSig ?? "") === sig) return false;
    n.lookSig = sig; n.look = look ?? null; draw(n); flush(); return true;
  }
  // 낮·밤: 모든 재질이 MeshBasic이라 빛 대신 색 곱으로 시간대를 표현한다. 밤에는 사무동 유리 창이 켜지고(uNight) 가로등 머리가 발광한다.
  const base = new Map(), tintC = new THREE.Color(), tmpTint = new THREE.Color(), lampHead = new THREE.Color(0xffd98a);
  const mtnC = new THREE.Color(), skyC = new THREE.Color();
  function setDaylight(d) {
    // 색 곱은 원래 색과 30%만 섞는다(노을이 전부 세피아가 되지 않게). 밤(night > 0.25)에는 최대 65%까지 어둡게 하되 창 발광이 주인공이다.
    const k = 0.3 + 0.35 * Math.max(0, (d.night - 0.25) / 0.75);
    tintC.setHex(0xffffff).lerp(tmpTint.setHex(d.ambient.color).multiplyScalar(Math.min(1, d.ambient.intensity)), k);
    // 산 평면: 하늘 아래색과 섞어 원근감만(색조는 유지)
    mtnC.setHex(0xffffff).lerp(skyC.setHex(d.skyBottom), 0.3 + 0.35 * d.night);
    for (const mt of materials) {
      if (!base.has(mt)) base.set(mt, mt.color.clone());
      mt.color.copy(base.get(mt));
      if (mt === mountainMaterial) mt.color.multiply(mtnC); else if (mt !== m.lampHead.material) mt.color.multiply(tintC);
    }
    m.lampHead.material.color.copy(lampHead).multiplyScalar(0.1 + 0.9 * d.night); // 밤에만 켜지는 발광 상자
    uNight.value = d.night;
  }
  return { group, setProjects, update, setLook, setDaylight, get layout() { return layout; }, maxHeight: 18,
    hits: () => [...nodes.values()].map(n => n.hit),
    anchorPoints: () => [...nodes.values()].map(n => n.anchor),
    composition: () => [...nodes.values()].map(n => ({ id: n.id, towers: n.towers })),
    center: id => { const n = nodes.get(id); return n ? { x: n.q.x, z: n.q.z } : null; },
    dispose() { group.clear(); nodes.clear(); [unit, body, tree, ...mountainGeometries].forEach(g => g.dispose()); materials.forEach(m => m.dispose()); texture?.dispose(); },
  };
}
