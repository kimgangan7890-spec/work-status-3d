// 층 평면도의 방 배치(DESIGN5 §B). 순수 함수만 있다: 장면(three)과 DOM에 의존하지 않아 vitest로 확인한다.
// 단위는 장면 월드 단위. 방의 기준점(x, z)은 책상 앞줄 가운데이고, 방 안쪽 범위는 기준점에서 BACK~FRONT(z), ±W/2(x)다.
export const ROOM = {
  W: 13, D: 9, WALL: 0.3, CORRIDOR: 4,
  BACK: -5.2, FRONT: 3.8,   // 방 안쪽의 뒤·앞 가장자리(기준점 기준 z)
  WALL_H: 2.4, WALL_LOW: 2.4, WALL_BACK: 2.4, DOOR: 3, // 부록 C: 네 벽 같은 높이
  MAX: 8,
};
export const PITCH_ROOM_X = ROOM.W + ROOM.WALL;            // 방 하나가 가로로 차지하는 폭(옆 벽 포함)
export const PITCH_ROOM_Z = ROOM.D + 2 * ROOM.WALL + ROOM.CORRIDOR; // 줄 간격(앞뒤 벽 + 복도)

/** 방 하나가 벽까지 포함해 차지하는 z 범위(기준점 기준). */
export const ROOM_Z0 = ROOM.BACK - ROOM.WALL, ROOM_Z1 = ROOM.FRONT + ROOM.WALL;

/**
 * 팀 수 n(배열 순서 = 방 순서)에 대한 방 배치. 부록 C: 두 줄은 가운데 복도를 마주 본다.
 * - n ≤ 3: 한 줄(복도는 앞쪽, 문은 앞). n ≥ 4: 위줄 ceil(n/2), 아래줄 floor(n/2), 줄마다 가운데 정렬.
 * - 위줄을 왼쪽에서 오른쪽으로 먼저 채우고 아래줄을 이어서 채운다.
 * - facing: 0이면 문이 +z(앞), 1이면 방을 180° 돌려 문이 -z(위 복도 쪽). 아래줄 방이 1이다.
 *   기준점(x, z)은 방 회전의 중심이므로 facing 1의 방은 z 범위가 [z-ROOM_Z1, z-ROOM_Z0]다.
 * - opts.special: 위줄 끝에 방 2칸 폭 특수실 1칸을 붙인다(GitHub/CI 상태실). 줄 가운데 정렬에는 특수실 폭도 포함한다.
 * @returns {{rooms: {index:number,x:number,z:number,row:number,col:number,facing:0|1}[], special: null|{x:number,z:number,row:number,facing:0|1,width:number}, bounds:{minX,maxX,minZ,maxZ}, rows:number}}
 */
export function layoutRooms(n, opts = {}) {
  const count = Math.max(0, Math.min(ROOM.MAX, Math.floor(Number(n) || 0)));
  if (count === 0) return { rooms: [], special: null, rows: 0, bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } };
  const rowSizes = count <= 3 ? [count] : [Math.ceil(count / 2), Math.floor(count / 2)];
  const two = rowSizes.length === 2;
  const zOf = (row) => (two && row === 1 ? ROOM_Z0 + ROOM_Z1 : (row - (rowSizes.length - 1)) * PITCH_ROOM_Z); // 아래줄은 복도 폭 4만 남기고 위줄을 마주 본다
  const rooms = [];
  let index = 0, special = null, minX = 0, maxX = 0;
  rowSizes.forEach((size, row) => {
    const slots = row === 0 && opts.special ? size + 2 : size; // 특수실은 방 2칸 폭
    const z = zOf(row), facing = two && row === 1 ? 1 : 0;
    for (let col = 0; col < size; col++) rooms.push({ index: index++, x: (col - (slots - 1) / 2) * PITCH_ROOM_X, z, row, col, facing });
    if (row === 0 && opts.special) special = { x: (size + 0.5 - (slots - 1) / 2) * PITCH_ROOM_X, z, row, facing, width: 2 * PITCH_ROOM_X };
    minX = Math.min(minX, -(slots * PITCH_ROOM_X) / 2); maxX = Math.max(maxX, (slots * PITCH_ROOM_X) / 2);
  });
  const zTop = rooms[0].z;
  return {
    rooms, special, rows: rowSizes.length,
    // 경계: 가장 넓은 줄의 바깥 벽, 위쪽 뒷벽 바깥, 아래쪽 바깥(두 줄이면 회전한 뒷벽 바깥, 한 줄이면 앞 복도까지)
    bounds: { minX, maxX, minZ: zTop + ROOM_Z0, maxZ: two ? zOf(1) - ROOM_Z0 : ROOM_Z1 + ROOM.CORRIDOR },
  };
}
