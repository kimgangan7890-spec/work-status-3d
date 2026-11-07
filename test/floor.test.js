import { describe, it, expect } from "vitest";
import { layoutRooms, ROOM, ROOM_Z0, ROOM_Z1, PITCH_ROOM_X, PITCH_ROOM_Z } from "../src/scene/floor.js";

// facing 1(180° 회전)이면 앞뒤가 뒤집힌다
const rect = (r, w = PITCH_ROOM_X) => ({ x0: r.x - w / 2, x1: r.x + w / 2, z0: r.facing ? r.z - ROOM_Z1 : r.z + ROOM_Z0, z1: r.facing ? r.z - ROOM_Z0 : r.z + ROOM_Z1 });
const overlap = (a, b) => a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.z0 < b.z1 - 1e-9 && b.z0 < a.z1 - 1e-9;

describe("layoutRooms", () => {
  it("팀이 없으면 방도 없다", () => {
    expect(layoutRooms(0).rooms).toEqual([]);
    expect(layoutRooms(-3).rooms).toEqual([]);
    expect(layoutRooms(NaN).rooms).toEqual([]);
  });
  it("방 하나는 (0,0)이다", () => {
    const { rooms, rows } = layoutRooms(1);
    expect(rooms).toEqual([{ index: 0, x: 0, z: 0, row: 0, col: 0, facing: 0 }]);
    expect(rows).toBe(1);
  });
  it("1~3팀은 한 줄, 4팀 이상은 위줄 ceil·아래줄 floor", () => {
    const rowsOf = (n) => { const m = new Map(); for (const r of layoutRooms(n).rooms) m.set(r.row, (m.get(r.row) ?? 0) + 1); return [...m.values()]; };
    expect(rowsOf(2)).toEqual([2]); expect(rowsOf(3)).toEqual([3]);
    expect(rowsOf(4)).toEqual([2, 2]); expect(rowsOf(5)).toEqual([3, 2]); expect(rowsOf(6)).toEqual([3, 3]);
    expect(rowsOf(7)).toEqual([4, 3]); expect(rowsOf(8)).toEqual([4, 4]);
  });
  it("N=1~8 모두 방이 겹치지 않고 줄마다 가운데 정렬이다", () => {
    for (let n = 1; n <= 8; n++) {
      const { rooms } = layoutRooms(n);
      expect(rooms).toHaveLength(n);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(rect(rooms[i]), rect(rooms[j]))).toBe(false);
      for (const row of new Set(rooms.map((r) => r.row))) {
        const xs = rooms.filter((r) => r.row === row).map((r) => r.x);
        expect(Math.abs(xs.reduce((a, b) => a + b, 0))).toBeLessThan(1e-9);
      }
    }
  });
  it("순서: 위줄 왼쪽→오른쪽, 이어서 아래줄. 인덱스는 배열 순서", () => {
    const { rooms } = layoutRooms(7);
    expect(rooms.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rooms.slice(0, 4).every((r, i, a) => r.row === 0 && (i === 0 || r.x > a[i - 1].x))).toBe(true);
    expect(rooms.slice(4).every((r, i, a) => r.row === 1 && (i === 0 || r.x > a[i - 1].x))).toBe(true);
    expect(rooms[0].z).toBeLessThan(rooms[4].z);
    expect(rooms[4].z).toBeCloseTo(ROOM_Z0 + ROOM_Z1, 9);
  });
  it("두 줄 사이 복도는 4이고 같은 줄 방 사이는 벽 하나(0.3)다", () => {
    const { rooms } = layoutRooms(8);
    const top = rect(rooms[0]), bottom = rect(rooms[4]);
    expect(bottom.z0 - top.z1).toBeCloseTo(ROOM.CORRIDOR, 9); // 문이 있는 앞면끼리 복도를 사이에 두고 마주 본다
    expect(PITCH_ROOM_Z - (ROOM_Z1 - ROOM_Z0)).toBeCloseTo(ROOM.CORRIDOR, 9);
    expect(rooms[1].x - rooms[0].x).toBeCloseTo(ROOM.W + ROOM.WALL, 9);
  });
  it("경계 상자는 모든 방을 담는다", () => {
    for (let n = 1; n <= 8; n++) {
      const { rooms, bounds: b } = layoutRooms(n);
      for (const r of rooms) { const q = rect(r); expect(q.x0).toBeGreaterThanOrEqual(b.minX - 1e-9); expect(q.x1).toBeLessThanOrEqual(b.maxX + 1e-9); expect(q.z0).toBeGreaterThanOrEqual(b.minZ - 1e-9); expect(q.z1).toBeLessThanOrEqual(b.maxZ + 1e-9); }
      expect(b.minX).toBeCloseTo(-b.maxX, 9);
    }
  });
  it("9팀 이상은 8방까지만 만든다", () => {
    expect(layoutRooms(9).rooms).toHaveLength(8);
    expect(layoutRooms(100).rooms).toHaveLength(8);
  });
  it("팀 이름·종류에 의존하지 않는다(입력은 개수뿐)", () => {
    expect(layoutRooms(3)).toEqual(layoutRooms(3.9));
  });

  it("한 줄(1~3팀)은 모두 문이 앞(facing 0)", () => {
    for (let n = 1; n <= 3; n++) expect(layoutRooms(n).rooms.every((r) => r.facing === 0)).toBe(true);
  });
  it("두 줄(4~8팀): 위줄 facing 0, 아래줄 facing 1이며 복도를 마주 본다", () => {
    for (let n = 4; n <= 8; n++) {
      const { rooms } = layoutRooms(n);
      expect(rooms.filter((r) => r.row === 0).every((r) => r.facing === 0)).toBe(true);
      expect(rooms.filter((r) => r.row === 1).every((r) => r.facing === 1)).toBe(true);
      // 윗줄 문(앞면)과 아랫줄 문(앞면)은 같은 복도(폭 4)에 접한다
      const t = rect(rooms[0]), b = rect(rooms.at(-1));
      expect(b.z0 - t.z1).toBeCloseTo(ROOM.CORRIDOR, 9);
    }
  });
});

describe("layoutRooms 특수실", () => {
  it("옵션이 없으면 없다", () => { expect(layoutRooms(5).special).toBeNull(); expect(layoutRooms(0, { special: true }).special).toBeNull(); });
  it("위줄 끝(맨 오른쪽), 방 2칸 폭, 같은 줄·같은 방향", () => {
    for (let n = 1; n <= 8; n++) {
      const { rooms, special } = layoutRooms(n, { special: true });
      const top = rooms.filter((r) => r.row === 0), last = top.at(-1);
      expect(special.row).toBe(0); expect(special.facing).toBe(0); expect(special.z).toBe(last.z);
      expect(special.width).toBeCloseTo(2 * PITCH_ROOM_X, 9);
      expect(special.x - special.width / 2).toBeCloseTo(last.x + PITCH_ROOM_X / 2, 9); // 마지막 방 바로 옆
    }
  });
  it("겹침 없음, 위줄(특수실 포함) 가운데 정렬 유지, 경계가 특수실을 담는다", () => {
    for (let n = 1; n <= 8; n++) {
      const { rooms, special, bounds: b } = layoutRooms(n, { special: true });
      const sr = rect(special, special.width);
      for (const r of rooms) expect(overlap(rect(r), sr)).toBe(false);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(rect(rooms[i]), rect(rooms[j]))).toBe(false);
      const xs = rooms.filter((r) => r.row === 0).map((r) => r.x);
      const lo = Math.min(...xs) - PITCH_ROOM_X / 2, hi = special.x + special.width / 2;
      expect(lo + hi).toBeCloseTo(0, 9);
      expect(sr.x1).toBeLessThanOrEqual(b.maxX + 1e-9); expect(b.minX).toBeCloseTo(-b.maxX, 9);
    }
  });
  it("아래줄은 특수실 때문에 움직이지 않는다", () => {
    expect(layoutRooms(6, { special: true }).rooms.filter((r) => r.row === 1)).toEqual(layoutRooms(6).rooms.filter((r) => r.row === 1));
  });
});
