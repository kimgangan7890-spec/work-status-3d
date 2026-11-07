import { describe, it, expect } from "vitest";
import { layoutCampus, towerLayout } from "../src/scene/campus-layout.js";
import { summarize } from "../src/shared/projects.js";
describe("단지 배치·요약", () => {
  for (let n = 1; n <= 12; n++) it(`${n}채가 겹치지 않고 각 줄 가운데 정렬`, () => {
    const { buildings: bs, bounds: b } = layoutCampus(n); expect(bs).toHaveLength(n);
    for (const a of bs) { expect(a.x - 4).toBeGreaterThanOrEqual(b.minX); expect(a.z + 3).toBeLessThanOrEqual(b.maxZ); for (const c of bs) if (c !== a) expect(Math.abs(a.x - c.x) >= 16 || Math.abs(a.z - c.z) >= 18).toBe(true); }
    for (const row of new Set(bs.map(b => b.row))) expect(bs.filter(b => b.row === row).reduce((n,b) => n+b.x, 0)).toBe(0);
  });
  it("잘못된 수와 상한", () => { expect(layoutCampus(-2).buildings).toEqual([]); expect(layoutCampus(99).buildings).toHaveLength(12); });
  it("작업 평균과 최신 이벤트(시간대 포함)", () => { const s = summarize({ tasks: [{ progress: 20 }, { progress: 80 }], events: [{ at: "2026-01-01T10:00:00+09:00" }, { at: "2026-01-01T02:00:00Z" }] }); expect(s.progress).toBe(50); expect(s.latestAt).toBe("2026-01-01T02:00:00Z"); expect(summarize({}).progress).toBeNull(); });
});

describe("슬림 타워 구성 규칙",()=>{
  for (const teams of [1,2,3,8]) it(`${teams}팀의 동 수·층 수·높이 차·대지 경계`,()=>{
    for (const work of [0,6,20,80]) {
      const towers=towerLayout({teams,agents:work,tasks:work});expect(towers).toHaveLength(Math.min(3,teams));
      expect(towers[0].floors).toBeGreaterThanOrEqual(12);expect(towers[0].floors).toBeLessThanOrEqual(22);
      if(towers.length>1) expect(towers[0].totalHeight/towers.at(-1).totalHeight).toBeGreaterThanOrEqual(1.3);
      for(let i=0;i<towers.length;i++){
        const t=towers[i];expect(t.depth/t.width).toBeCloseTo(2);expect(t.totalHeight/t.width).toBeGreaterThanOrEqual(3.5);expect(t.totalHeight/t.width).toBeLessThanOrEqual(4.5);
        expect(Math.abs(t.x)+t.width/2).toBeLessThanOrEqual(8);expect(Math.abs(t.z)+t.depth/2).toBeLessThanOrEqual(9);
        if(i) expect(towers[i-1].floors-t.floors).toBeGreaterThanOrEqual(2);
        if(i) expect(towers[i-1].floors-t.floors).toBeLessThanOrEqual(4);
        for(const other of towers.slice(i+1)) expect(Math.abs(t.x-other.x)>=(t.width+other.width)/2 || Math.abs(t.z-other.z)>=(t.depth+other.depth)/2).toBe(true);
      }
    }
  });
  it("요약 전에도 단일 동 기본값을 사용",()=>{expect(towerLayout(null)).toHaveLength(1);});
});
