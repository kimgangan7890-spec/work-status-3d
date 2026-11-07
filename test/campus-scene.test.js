import { Matrix4 } from "three";
import { it, expect, vi } from "vitest";
import { createCampusScene } from "../src/scene/campus3d.js";
import { hasNewEvent } from "../src/panels/buildings.js";
it("12개 프로젝트의 최대 36동이 형상·재질을 공유하고 교체 시 자원이 누적되지 않는다", () => {
  const campus = createCampusScene(); const ps = Array.from({length:12},(_,i)=>({id:`p${i}`,name:`동 ${i}`})); campus.setProjects(ps);
  for (const p of ps) campus.update({ id:p.id, summary:{teams:8,agents:24,tasks:30,progress:75,blocked:1} });
  expect(campus.composition().flatMap(p=>p.towers)).toHaveLength(36);
  const geometries = new Set();let instances=0, trees=0;
  campus.group.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);expect(o.castShadow).toBe(false);if(o.isInstancedMesh)instances++;if(o.geometry.type==="ConeGeometry")trees+=o.count;}});
  expect(geometries.size).toBeLessThanOrEqual(7);expect(instances).toBeGreaterThan(0);expect(trees).toBeLessThanOrEqual(60);
  expect(campus.anchorPoints()[0].y).toBeGreaterThan(campus.composition()[0].towers[0].height+1.9);
  campus.setProjects(ps.slice(0,2));expect(campus.hits()).toHaveLength(2);expect(campus.composition()).toHaveLength(2);
  campus.update({id:'p0',error:true});campus.dispose();expect(campus.hits()).toHaveLength(0);
});
it("새 이벤트는 마지막 방문보다 늦은 실제 시각만 알린다",()=>{
  expect(hasNewEvent({latestAt:'2026-01-01T02:00:00Z'},'2026-01-01T10:00:00+09:00')).toBe(true);
  expect(hasNewEvent({latestAt:'2026-01-01T01:00:00Z'},'2026-01-01T10:00:00+09:00')).toBe(false);
  expect(hasNewEvent({latestAt:'bad'},'2026-01-01T01:00:00Z')).toBe(false);
  expect(hasNewEvent({latestAt:'2026-01-01T02:00:00Z'},null)).toBe(false);
});

it("모든 타워와 경고 창이 절차적 텍스처 한 장만 공유한다",()=>{
  vi.stubGlobal("document",{createElement:()=>({getContext:()=>({fillRect(){}})})});
  try {
    const campus=createCampusScene(), maps=new Set();campus.setProjects([{id:"a",name:"A"}]);
    campus.group.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]) if(m?.map)maps.add(m.map);});
    expect(maps.size).toBe(1);const texture=[...maps][0];expect(texture.image.width).toBe(128);expect(texture.image.height).toBe(64);campus.dispose();
  } finally {vi.unstubAllGlobals();}
});

it("막힘 없음과 0% 진행도는 접힌 면의 색 띠도 남기지 않는다",()=>{
  const c=createCampusScene(), matrix=new Matrix4();c.setProjects([{id:"a",name:"A"}]);
  c.update({id:"a",summary:{teams:1,progress:0,blocked:0}});
  for(const key of ["warning","progress"]){c.group.getObjectByName(key).getMatrixAt(0,matrix);expect([matrix.elements[0],matrix.elements[5],matrix.elements[10]]).toEqual([0,0,0]);}
  c.update({id:"a",summary:{teams:1,progress:50,blocked:1}});
  for(const key of ["warning","progress"]){c.group.getObjectByName(key).getMatrixAt(0,matrix);expect(matrix.elements[0]).toBeGreaterThan(0);expect(matrix.elements[5]).toBeGreaterThan(0);expect(matrix.elements[10]).toBeGreaterThan(0);}c.dispose();
});
