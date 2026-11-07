import { describe, it, expect } from "vitest";
import { daylight, minutesOf, minutesFor, ZONES, FIXED_MINUTES } from "../src/scene/daylight.js";

const at = (h, m = 0) => daylight(h * 60 + m);
const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

describe("구간 값", () => {
  it("구간 안쪽(보간 시작 전)은 그 구간 값 그대로", () => {
    expect(at(13).skyTop).toBe(0x8ec5ff); expect(at(13).skyBottom).toBe(0xe9f3ff);
    expect(at(9).skyTop).toBe(0x7fb2ee);
    expect(at(17.5 - 0).zone).toBe(3); expect(at(17.5).skyBottom).toBe(0xffb27a);
    expect(at(2).skyTop).toBe(0x0b1020); expect(at(2).night).toBe(1); expect(at(2).stars).toBe(1);
    expect(at(23).zone).toBe(5);
  });
  it("구간 번호: 05·07·11·17·19·21시 경계에서 바뀐다", () => {
    expect([4.99, 5, 6.99, 7, 10.99, 11, 16.99, 17, 18.99, 19, 20.99, 21].map((h) => at(h).zone)).toEqual([5, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
  it("낮에는 night 0·별 없음, 한밤에는 night 1·별 1", () => {
    expect(at(13)).toMatchObject({ night: 0, stars: 0 }); expect(at(23)).toMatchObject({ night: 1, stars: 1 });
  });
});

describe("다음 구간 1시간 전부터 선형 보간", () => {
  it("보간 시작 시점은 현재 구간 값, 구간 경계 직전은 다음 구간 값에 가깝다", () => {
    expect(at(16).skyTop).toBe(0x8ec5ff);          // 오후 끝 1시간 전 = 시작점
    expect(at(16, 1).skyTop).not.toBe(0x8ec5ff); // 1분만 지나도 이미 보간 중
  });
  it("중간(16:30)은 오후·노을의 정확히 가운데", () => {
    const a = rgb(0x8ec5ff), b = rgb(0x5a6fb0), got = rgb(at(16, 30).skyTop);
    got.forEach((v, i) => expect(Math.abs(v - (a[i] + b[i]) / 2)).toBeLessThanOrEqual(1));
    expect(at(16, 30).night).toBeCloseTo(0.125, 5);
    expect(at(16, 30).sun.intensity).toBeCloseTo((1.1 + 0.8) / 2, 5);
    expect(at(16, 30).ambient.intensity).toBeCloseTo(0.9, 5);
  });
  it("보간 끝 직전 값이 다음 구간 값에 거의 같다", () => {
    const a = rgb(at(16, 59.99).skyBottom), b = rgb(0xffb27a);
    a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(1));
  });
  it("값이 구간 경계에서 튀지 않는다(1분 차이 = 작은 변화)", () => {
    for (const h of [5, 7, 11, 17, 19, 21]) {
      const p = at(h - 1 / 60), q = at(h);
      rgb(p.skyTop).forEach((v, i) => expect(Math.abs(v - rgb(q.skyTop)[i])).toBeLessThanOrEqual(8));
      expect(Math.abs(p.night - q.night)).toBeLessThan(0.05); expect(Math.abs(p.ambient.intensity - q.ambient.intensity)).toBeLessThan(0.05);
    }
  });
  it("자정을 넘겨도 이어진다(밤 → 새벽 보간은 04~05시)", () => {
    expect(at(0).skyTop).toBe(at(3).skyTop);
    expect(at(23.99).skyTop).toBe(at(0.01).skyTop);
    expect(at(4.5).night).toBeCloseTo((1 + 0.35) / 2, 5);
    expect(at(5).skyTop).toBe(0x6a7fb8);
  });
  it("20~21시는 저녁에서 밤으로 보간", () => { expect(at(20.5).night).toBeCloseTo(0.85, 5); expect(at(21).night).toBe(1); });
});

describe("해·달·방향", () => {
  it("06~18시는 해, 그 밖은 달. 정오·자정에 가장 높다", () => {
    expect(at(13).body.kind).toBe("sun"); expect(at(23).body.kind).toBe("moon"); expect(at(3).body.kind).toBe("moon");
    expect(at(12).body.height).toBeCloseTo(1, 5); expect(at(0).body.height).toBeCloseTo(1, 5);
    expect(at(6).body.height).toBeCloseTo(0, 5); expect(at(18).body.height).toBeCloseTo(0, 5);
  });
  it("직사광 방향은 단위 벡터이고 늘 아래로 비춘다(y > 0)", () => {
    for (let h = 0; h < 24; h += 0.5) { const d = at(h).sun.dir; expect(Math.hypot(...d)).toBeCloseTo(1, 9); expect(d[1]).toBeGreaterThan(0); }
  });
});

describe("입력", () => {
  it("Date·분·초 단위를 받는다", () => {
    expect(minutesOf(new Date(2026, 10, 7, 15, 30, 30))).toBeCloseTo(930.5, 5);
    expect(minutesOf(1500)).toBe(60); expect(minutesOf(-60)).toBe(1380);
  });
  it("잘못된 입력은 낮 13:00", () => {
    for (const bad of [NaN, undefined, null, "abc", {}, new Date("x"), Infinity]) expect(minutesOf(bad)).toBe(FIXED_MINUTES.day);
    expect(daylight(NaN).skyTop).toBe(0x8ec5ff);
  });
  it("모드: day=13:00, night=23:00 고정, auto는 now", () => {
    const now = new Date(2026, 0, 1, 18, 0);
    expect(minutesFor("day", now)).toBe(780); expect(minutesFor("night", now)).toBe(1380);
    expect(minutesFor("auto", now)).toBe(1080); expect(minutesFor("???", now)).toBe(1080);
  });
  it("구간 표는 시작 시각 오름차순", () => { expect(ZONES.map((z) => z.start)).toEqual([5, 7, 11, 17, 19, 21]); });
});
