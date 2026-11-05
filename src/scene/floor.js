// 층 평면도의 방 배치(DESIGN5 §B). 순수 함수만 있다: 장면(three)과 DOM에 의존하지 않아 vitest로 확인한다.
// 단위는 장면 월드 단위. 방의 기준점(x, z)은 책상 앞줄 가운데이고, 방 안쪽 범위는 기준점에서 BACK~FRONT(z), ±W/2(x)다.
export const ROOM = {
  W: 13, D: 9, WALL: 0.3, CORRIDOR: 4,
  BACK: -5.2, FRONT: 3.8,   // 방 안쪽의 뒤·앞 가장자리(기준점 기준 z)
  WALL_LOW: 1.6, WALL_BACK: 3.9, DOOR: 3,
  MAX: 8,
};
export const PITCH_ROOM_X = ROOM.W + ROOM.WALL;            // 방 하나가 가로로 차지하는 폭(옆 벽 포함)
export const PITCH_ROOM_Z = ROOM.D + 2 * ROOM.WALL + ROOM.CORRIDOR; // 줄 간격(앞뒤 벽 + 복도)

/** 방 하나가 벽까지 포함해 차지하는 z 범위(기준점 기준). */
export const ROOM_Z0 = ROOM.BACK - ROOM.WALL, ROOM_Z1 = ROOM.FRONT + ROOM.WALL;

/**
 * 팀 수 n(배열 순서 = 방 순서)에 대한 방 배치.
 * - n ≤ 3: 한 줄(복도는 앞쪽). n ≥ 4: 위줄 ceil(n/2), 아래줄 floor(n/2), 줄마다 가운데 정렬.
 * - 위줄을 왼쪽에서 오른쪽으로 먼저 채우고 아래줄을 이어서 채운다. 아래줄(앞쪽) 기준점이 z=0이다.
 * @returns {{rooms: {index:number,x:number,z:number,row:number,col:number}[], bounds:{minX,maxX,minZ,maxZ}, rows:number}}
 */
export function layoutRooms(n) {
  const count = Math.max(0, Math.min(ROOM.MAX, Math.floor(Number(n) || 0)));
  if (count === 0) return { rooms: [], rows: 0, bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } };
  const rowSizes = count <= 3 ? [count] : [Math.ceil(count / 2), Math.floor(count / 2)];
  const rooms = [];
  let index = 0;
  rowSizes.forEach((size, row) => {
    const z = (row - (rowSizes.length - 1)) * PITCH_ROOM_Z; // 마지막 줄(앞쪽)이 0
    for (let col = 0; col < size; col++) rooms.push({ index: index++, x: (col - (size - 1) / 2) * PITCH_ROOM_X, z, row, col });
  });
  const cols = Math.max(...rowSizes);
  const zTop = rooms[0].z;
  return {
    rooms, rows: rowSizes.length,
    // 경계: 가장 넓은 줄의 바깥 벽, 위쪽 뒷벽 바깥, 아래쪽 앞벽 바깥 + 앞 복도
    bounds: { minX: -(cols * PITCH_ROOM_X) / 2, maxX: (cols * PITCH_ROOM_X) / 2, minZ: zTop + ROOM_Z0, maxZ: ROOM_Z1 + ROOM.CORRIDOR },
  };
}
