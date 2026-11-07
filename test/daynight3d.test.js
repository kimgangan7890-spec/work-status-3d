import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createSky } from "../src/scene/sky.js";
import { createCampusScene } from "../src/scene/campus3d.js";
import { daylight } from "../src/scene/daylight.js";

const at = (h) => daylight(h * 60);
const countTree = (o) => { let n = 1; for (const c of o.children) n += countTree(c); return n; };

describe("하늘(sky.js)", () => {
  it("분당 갱신은 색·투명도만 바꾸고 형상(자식 수·지오메트리)은 그대로", () => {
    const sky = createSky(), n = countTree(sky.group), geos = new Set();
    sky.group.traverse((o) => o.geometry && geos.add(o.geometry));
    for (const h of [13, 17.5, 23, 3, 13]) sky.update(at(h));
    expect(countTree(sky.group)).toBe(n);
    const after = new Set(); sky.group.traverse((o) => o.geometry && after.add(o.geometry));
    expect([...after].every((g) => geos.has(g))).toBe(true);
  });
  it("별은 밤·저녁에만 보이고 낮에는 숨는다", () => {
    const sky = createSky(); let stars; sky.group.traverse((o) => { if (o.isPoints) stars = o; });
    sky.update(at(13)); expect(stars.visible).toBe(false);
    sky.update(at(23)); expect(stars.visible).toBe(true); expect(stars.material.opacity).toBe(1);
    sky.update(at(20)); expect(stars.material.opacity).toBeGreaterThan(0.5);
  });
  it("해/달 원판은 하나, 별 Points는 하나, 도시 층은 3겹(위·오른쪽 직선 띠 6장 + 지면 1장)", () => {
    const sky = createSky(); let points = 0, discs = 0, strips = 0;
    sky.group.traverse((o) => { if (o.isPoints) points++; if (o === sky.bodyMesh) discs++; if (o.isMesh && o.geometry?.type === "PlaneGeometry") strips++; });
    expect({ points, discs, strips }).toEqual({ points: 1, discs: 1, strips: 7 });
  });
  it("시각이 바뀌면 하늘 색이 바뀐다", () => {
    const sky = createSky(); let dome; sky.group.traverse((o) => { if (o.material?.uniforms?.uTop) dome = o; });
    sky.update(at(13)); const day = dome.material.uniforms.uTop.value.getHex();
    sky.update(at(23)); expect(dome.material.uniforms.uTop.value.getHex()).not.toBe(day);
  });
  it("도시 띠는 지면에 붙은 직선 띠: 멀수록 낮고, 위·오른쪽 바깥에 선다", () => {
    const sky = createSky(); sky.update(at(13)); sky.setExtent(-20, 20, -10, 10);
    const city = sky.group.children.find((c) => c.isGroup), meshes = city.children;
    const ground = meshes.find((m) => m.rotation.x !== 0); expect(ground).toBeTruthy(); expect(ground.position.y).toBeLessThan(-0.4);
    expect(meshes).toHaveLength(7);
    const strips = meshes.filter((m) => m !== ground), tops = strips.filter((m) => m.rotation.y === 0), rights = strips.filter((m) => m.rotation.y !== 0);
    for (const m of strips) expect(m.position.y - m.scale.y / 2).toBeCloseTo(-0.4, 9); // 지면에 붙음
    tops.forEach((m, i) => { expect(m.position.z).toBeLessThan(-10); if (i) { expect(m.position.z).toBeLessThan(tops[i - 1].position.z); expect(m.scale.y).toBeLessThan(tops[i - 1].scale.y); } });
    rights.forEach((m, i) => { expect(m.position.x).toBeGreaterThan(20); if (i) expect(m.position.x).toBeGreaterThan(rights[i - 1].position.x); });
  });
  it("follow: 방 화면 등에서는 도시를 숨기고, 해/달은 카메라 앞 화면 귀퉁이에 둔다", () => {
    const sky = createSky(); sky.update(at(13));
    const cam = new THREE.PerspectiveCamera(32, 1.6, 0.1, 1000); cam.position.set(0, 50, 80); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
    sky.follow(cam, true);
    const city = sky.group.children.find((c) => c.isGroup); expect(city.visible).toBe(true);
    const v = sky.bodyMesh.position.clone().project(cam);
    expect(v.x).toBeLessThan(-0.5); expect(v.y).toBeGreaterThan(0.5); expect(Math.abs(v.x)).toBeLessThan(1); expect(Math.abs(v.y)).toBeLessThan(1);
    sky.follow(cam, false); expect(city.visible).toBe(false);
  });
});

describe("단지 낮·밤(campus3d)", () => {
  const projects = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `동${i}` }));
  const head = (c) => c.group.children.find((o) => o.name === "lampHead");
  it("가로등은 밤에만 켜지고(발광 색이 밝아짐) 형상은 그대로", () => {
    const c = createCampusScene(); c.setProjects(projects); const n = countTree(c.group);
    c.setDaylight(at(13)); const day = head(c).material.color.getHex();
    c.setDaylight(at(23)); const night = head(c).material.color.getHex();
    const lum = (h) => ((h >> 16) & 255) + ((h >> 8) & 255) + (h & 255);
    expect(lum(night)).toBeGreaterThan(lum(day) * 2);
    expect(countTree(c.group)).toBe(n);
    expect(head(c).count).toBe(24);
  });
  it("밤에는 사무동 색이 어두워지고 낮으로 돌아오면 원래대로", () => {
    const c = createCampusScene(); c.setProjects(projects); c.setDaylight(at(13));
    const roof = c.group.children.find((o) => o.isInstancedMesh && o !== head(c) && o.material.color.getHex() !== 0xffffff);
    const base = roof.material.color.getHex();
    c.setDaylight(at(23)); expect(roof.material.color.getHex()).not.toBe(base);
    c.setDaylight(at(13)); expect(roof.material.color.getHex()).toBe(base);
  });
  it("같은 시각을 반복 적용해도 색이 누적해서 어두워지지 않는다", () => {
    const c = createCampusScene(); c.setProjects(projects);
    c.setDaylight(at(23)); const a = c.group.children.find((o) => o.material?.color && o !== head(c)).material.color.getHex();
    for (let i = 0; i < 5; i++) c.setDaylight(at(23));
    expect(c.group.children.find((o) => o.material?.color && o !== head(c)).material.color.getHex()).toBe(a);
  });
  it("지표 없는 사무동도 지표 있는 사무동도 낮·밤 호출이 외관 구성(층수)을 바꾸지 않는다", () => {
    const c = createCampusScene(); c.setProjects(projects); c.setLook("p1", { floors: 20, litRatio: 0.5, roof: "busy", dim: false });
    const before = JSON.stringify(c.composition()); c.setDaylight(at(23)); c.setDaylight(at(13));
    expect(JSON.stringify(c.composition())).toBe(before);
  });
});
