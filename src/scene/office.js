import { createCampusScene } from "./campus3d.js";
import * as THREE from "three";
import { teamsOf, pickTeam } from "../shared/teams.js";
import { own } from "../shared/own.js";
import { agentColors, hairKindFor, HAIR_CAP, HAIR_CAP_DEFAULT } from "../shared/colors.js";
import { layoutRooms, ROOM, PITCH_ROOM_X } from "./floor.js";
import { createSky } from "./sky.js";
import { daylight, minutesFor } from "./daylight.js";

// 사양: DESIGN3.md (사무실 §4, 캐릭터 §5, 카메라 §3). 근거 없는 요소는 넣지 않는다.
// 장면: 여러 팀은 층 평면도에서 방으로 확대(DESIGN5), 한 팀은 기존 화면 그대로. 문서는 해당 방 화이트보드로 도착한다.

const COLORS = { // DESIGN3 §4·§5
  wall: 0xf2efe9, carpet: 0x9a968f, partition: 0x6f8696, deskTop: 0xf4f3ef, deskLeg: 0x1d1d20,
  pants: 0x3a3a40, skin: 0xf1c9a5, hair: 0x2b2420, shoe: 0x222226,
  shirtDefault: 0x77777d, // 실제 옷색은 shared/colors.js의 agentColors가 정한다(보드 색 막대와 같은 함수)
};
const SCREEN = { working: 0x6fa8ff, idle: 0x1a2230, blocked: 0xff4d4d }; // 모니터 발광색(상태)
const KIND_COLOR = { doc: 0xffffff, ask: 0xffe27a, reply: 0x9ad7ff, report: 0xb6f2a2 };

const FOV = 32, PITCH = (32 * Math.PI) / 180, FILL = 0.8; // 책상이 장면 가로의 80%
const FLOOR_PITCH = (38 * Math.PI) / 180, FLOOR_YAW = -(30 * Math.PI) / 180; // 부록 C: 35~40° 내려다보는 대각선 조감
const WALL_CREAM = 0xe9e2d3, SLAB = 0x3a3b3f, SLAB_EDGE = 0x5b5c61;
const ROOM_TINTS = [0x2f3034, 0x2b3035, 0x2c3330, 0x33302f, 0x2f2e35, 0x2b3333, 0x33322c, 0x2e2f33]; // 방 안 바닥도 어둡게(방 구분은 벽으로)
const PITCH_X = 2.87, PITCH_2 = 2.87, ROW_DZ = 3.5, ROW_MAX = 4, TEAM_MAX = 8, DESK_W = 2.6, DESK_D = 1.4, YAW = (70 * Math.PI) / 180;
const NAME_MAX = 6, NAME_ABBR = 2; // 이름표 최대 글자 수(초과 시 …), 폰 두 줄(5~8명)의 약칭 글자 수
const SHOULDER = 0.62, L_UP = 0.42, L_FORE = 0.42;

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const box = (w, h, d, color, extra) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra)); m.castShadow = true; m.receiveShadow = true; return m; };
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

function noiseTexture(base, { speck = 0.06, seams = 0, repeat = [1, 1], size = 256 } = {}) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.18; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * speck})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 1;
  for (let i = 1; i <= seams; i++) { g.beginPath(); g.moveTo(0, (size * i) / (seams + 1)); g.lineTo(size, (size * i) / (seams + 1)); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  return t;
}

// 팔 2마디 역운동학(평면): 어깨에서 손까지 앞(f)·아래(d) 거리로 윗팔·아래팔 각도를 구한다. 각도는 "아래로 늘어진 상태에서 앞으로 든 각도".
function armAngles(f, d) {
  const D = Math.min(Math.hypot(f, d), L_UP + L_FORE - 0.01);
  const beta = Math.atan2(f, d), gamma = Math.acos(D / (2 * L_UP));
  const upper = beta - gamma, fore = beta + gamma;
  return { upper, foreRel: fore - upper };
}
const KEY_Z = 0.28, KEY_Y = 1.18, REST_Z = 0.5, REST_Y = 1.16, HIP_Y = 0.78, HIP_Z = 1.0;
function handPose(lean, handZ, handY) { // lean: 앞으로 숙인 각(+) 또는 뒤로 기댄 각(-)
  const shY = HIP_Y + SHOULDER * Math.cos(lean), shZ = HIP_Z - SHOULDER * Math.sin(lean);
  const a = armAngles(shZ - handZ, shY - handY);
  return { upper: a.upper + lean, foreRel: a.foreRel }; // 몸통이 기운 만큼 보정(자식 좌표)
}
const POSES = (() => {
  const work = handPose(0.14, KEY_Z, KEY_Y), idle = handPose(-0.16, REST_Z, REST_Y), rest = handPose(0.32, REST_Z, REST_Y);
  return {
    working: { lean: 0.14, uaL: work.upper, faL: work.foreRel, uaR: work.upper, faR: work.foreRel, headX: 0.12 },
    idle: { lean: -0.16, uaL: idle.upper, faL: idle.foreRel, uaR: idle.upper, faR: idle.foreRel, headX: -0.02 },
    // 막힘: 상체를 숙이고 한 손은 머리를 받친다(근거 없음, 사양서의 단순화)
    blocked: { lean: 0.32, uaL: rest.upper, faL: rest.foreRel, uaR: 1.15, faR: 2.1, headX: 0.22 },
  };
})();

export function createOffice(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; // r187에서 PCFSoft는 없어져 PCF로 대체된다(같은 결과, 경고 없음)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.wall);
  const campusFog = new THREE.Fog(0xdce5e4, 180, 410);
  const sky = createSky(); scene.add(sky.group);
  let dayMode = "auto", dayData = daylight(new Date()), dayMinute = -1;
  const campusScene = createCampusScene(); scene.add(campusScene.group); campusScene.group.visible = false;
  const buildingClicks = new Set(), campusFrames = new Set();
  let campusCount = 0, approach = null, campusDirty = true, drawnFrames = 0;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const target = new THREE.Vector3(0, 1.0, 0.2);

  // 조명: 선형 조명은 천장이 카메라 밖이라 빛으로만 표현, 창 쪽(오른쪽 뒤) 자연광
  const hemi = new THREE.HemisphereLight(0xf4f6fb, 0x9a968f, 1.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e2, 1.5);
  sun.position.set(9, 10, -3); sun.target.position.set(0, 0, 0); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const lights = [-4.5, 0, 4.5].map((x) => { const p = new THREE.PointLight(0xfff8ee, 9, 14, 1.6); p.position.set(x, 4.6, 0.5); scene.add(p); return p; });

  // 바닥(회색 카펫, 줄무늬 없음)과 벽(오프화이트, 왼쪽 벽 한 면만 노출 콘크리트)
  const legacy = new THREE.Group(); scene.add(legacy);
  const carpet = noiseTexture("#9a968f", { speck: 0.16, repeat: [10, 6] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0); floor.receiveShadow = true; legacy.add(floor);
  const BACK_Z = -5.2, LEFT_X = -6.4;
  const back = box(26, 6, 0.3, COLORS.wall); back.position.set(0, 3, BACK_Z - 0.15); legacy.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 14), new THREE.MeshStandardMaterial({ map: noiseTexture("#a9a69f", { speck: 0.3, seams: 3, repeat: [1, 1] }), roughness: 1 }));
  left.position.set(LEFT_X - 0.15, 3, 1.5); left.receiveShadow = true; legacy.add(left);

  // 뒷벽: 화이트보드(문서 도착점), 작은 창, 벽 액자
  function buildDecor(parent) {
    const wb = new THREE.Group(); wb.position.set(-1.2, 2.5, BACK_Z + 0.04); parent.add(wb);
    wb.add(box(5.0, 2.1, 0.06, 0xdcdcdc), at(box(4.8, 1.9, 0.04, 0xffffff), 0, 0, 0.04), at(box(2.0, 0.07, 0.12, 0xb9b9b9), 0, -1.12, 0.07));
    const win = new THREE.Group(); win.position.set(4.3, 2.8, BACK_Z + 0.03); parent.add(win);
    win.add(box(2.3, 1.7, 0.06, 0xe8e6e1), at(new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.5), new THREE.MeshBasicMaterial({ color: 0xcfe8ff })), 0, 0, 0.04));
    win.add(at(box(0.05, 1.5, 0.05, 0xe8e6e1), 0, 0, 0.06));
    for (const [x, c] of [[-5.4, 0xa9bccd], [-4.6, 0xc9b79c], [6.3, 0xb4c4b2]]) {
      const fr = new THREE.Group(); fr.position.set(x, 3.0, BACK_Z + 0.04);
      fr.add(box(0.7, 0.9, 0.05, 0x2a2a2e), at(new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.78), new THREE.MeshBasicMaterial({ color: c })), 0, 0, 0.03));
      parent.add(fr);
    }
    parent.add(plant(-5.7, -3.4, 1.9), plant(5.7, -3.4, 1.9));
    return new THREE.Vector3(-1.2, 2.5, BACK_Z + 0.25);
  }
  function plant(x, z, h, potColor = 0xe4dfd6) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(h * 0.18, h * 0.14, h * 0.32, 18), mat(potColor)), 0, h * 0.16, 0));
    const leaf = mat(0x3f7d4e);
    for (const [px, py, pz, r] of [[0, 0.58, 0, 0.26], [0.16, 0.74, 0.05, 0.2], [-0.15, 0.7, -0.06, 0.2], [0.02, 0.9, 0.0, 0.17]]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(h * r, 14, 12), leaf); s.position.set(px * h, py * h, pz * h); s.castShadow = true; g.add(s);
    }
    return g;
  }
  const boardAnchor = buildDecor(legacy);

  // 낮·밤: 분이 바뀔 때(또는 모드가 바뀔 때)만 하늘·안개·단지 색을 갱신한다. 형상은 다시 만들지 않는다.
  function applyDaylight() {
    const d = dayData = daylight(minutesFor(dayMode, new Date()));
    sky.update(d); campusFog.color.setHex(d.fog); campusScene.setDaylight(d);
    for (const f of daylightHooks) f(d);
    if (shown) { scene.background.setHex(shown.mode === "campus" ? d.fog : multi ? d.skyBottom : COLORS.wall); }
    campusDirty = true;
  }
  const daylightHooks = [];

  // 방은 팀 id로 재사용하고 바닥 재질만 따로 둔다.
  const rooms = new Map();
  // 어두운 층 바닥판 + 가장자리 띠. 방 사이 복도는 이 판이 그대로 복도가 된다.
  const slab = new THREE.Group(); slab.visible = false; scene.add(slab);
  const slabEdge = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), mat(SLAB_EDGE)), slabTop = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), mat(SLAB));
  slab.add(slabEdge, slabTop);
  const railGlass = [0, 1, 2, 3].map(() => new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.04), new THREE.MeshStandardMaterial({ color: 0x9ec3e6, roughness: 0.2, transparent: true, opacity: 0.14, depthWrite: false })));
  const railTop = [0, 1, 2, 3].map(() => new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.08), mat(0x7a7d85)));
  slab.add(...railGlass, ...railTop);
  // 방 벽·장식은 형상·재질을 모든 방이 공유한다.
  const WH = ROOM.WALL_H, WT = 0.15;
  const wallMat = new THREE.MeshStandardMaterial({ color: WALL_CREAM, roughness: 1 });
  const wallSideGeo = new THREE.BoxGeometry(WT, WH, ROOM.D);
  const doorSide = (ROOM.W + ROOM.WALL - ROOM.DOOR) / 2, wallFrontGeo = new THREE.BoxGeometry(doorSide, WH, WT);
  const frameGeo = new THREE.BoxGeometry(4.6, 1.4, 0.06), frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.6 });
  const screenGeo = new THREE.PlaneGeometry(4.4, 1.2);
  const hitGeo = new THREE.BoxGeometry(ROOM.W + ROOM.WALL, WH, ROOM.D + 0.6), hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const meshAt = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; };
  function screenTexture() {
    const c = document.createElement("canvas"); c.width = 512; c.height = 140;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return { c, tex };
  }
  function paintScreen(sc, name, line2) { // 팀 이름·작업 수. 같은 글이면 다시 그리지 않는다.
    const key = name + "|" + line2; if (sc.key === key) return; sc.key = key;
    const g = sc.c.getContext?.("2d"); if (!g) return;
    g.fillStyle = "#14161a"; g.fillRect(0, 0, 512, 140);
    g.fillStyle = "#6fa8ff"; g.fillRect(14, 14, 6, 112);
    g.fillStyle = "#e6ebff"; g.font = "700 44px system-ui, 'Noto Sans KR', sans-serif"; g.textBaseline = "top";
    g.fillText(Array.from(name).slice(0, 12).join(""), 34, 16);
    g.fillStyle = "#9fb0ff"; g.font = "600 30px system-ui, 'Noto Sans KR', sans-serif"; g.fillText(line2, 34, 76);
    for (let i = 0; i < 3; i++) { g.fillStyle = "#2c3140"; g.fillRect(34, 118 + i * 0, 200 - i * 40, 3); }
    sc.tex.needsUpdate = true;
  }
  // 방 불빛: 일하는 에이전트가 있으면 따뜻한 천장 발광 띠 + 바닥 빛 웅덩이(발광 재질, 점광원 추가 없음). 모두 쉬면 꺼짐.
  const lampOn = new THREE.MeshBasicMaterial({ color: 0xffe3b0 }), lampOff = new THREE.MeshBasicMaterial({ color: 0x3a3b40 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.1, depthWrite: false });
  const lampGeo = new THREE.BoxGeometry(8, 0.05, 0.3), glowGeo = new THREE.PlaneGeometry(ROOM.W - 1, ROOM.D - 1);
  daylightHooks.push((d) => { glowMat.opacity = 0.07 + 0.2 * d.night; });
  // 방 뒷벽 조각(폭별로 한 번만 만든다) + 유리 재질 1개 공유
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9ec3e6, roughness: 0.2, transparent: true, opacity: 0.2, depthWrite: false });
  const mullionGeo = new THREE.BoxGeometry(0.1, 1.0, WT), partsCache = new Map();
  function backParts(width) {
    if (partsCache.has(width)) return partsCache.get(width);
    const pierW = 4.8, glassW = (width - pierW) / 2 - 0.2, parts = {
      sill: new THREE.BoxGeometry(width, 0.9, WT), head: new THREE.BoxGeometry(width, 0.5, WT), pier: new THREE.BoxGeometry(pierW, 1.0, WT),
      glass: new THREE.BoxGeometry(glassW, 1.0, 0.03), glassW, glassX: pierW / 2 + glassW / 2,
    };
    partsCache.set(width, parts); return parts;
  }
  // 문 쪽 벽(front)은 방 화면에서 숨긴다. 방은 facing 1이면 통째로 180° 돌려 놓는다.
  function buildRoomShell(group, width = ROOM.W + ROOM.WALL) {
    const cx = (ROOM.BACK + ROOM.FRONT) / 2, bz = ROOM.BACK - WT / 2, g = backParts(width);
    // 뒷벽: 아래 턱·위 띠·가운데 기둥(화면판 뒤)은 크림 벽, 그 사이 가로 틈은 반투명 유리(바깥 도시가 비친다)
    group.add(meshAt(g.sill, wallMat, 0, 0.45, bz), meshAt(g.head, wallMat, 0, 2.15, bz), meshAt(g.pier, wallMat, 0, 1.4, bz));
    for (const sx of [-1, 1]) group.add(meshAt(g.glass, glassMat, sx * g.glassX, 1.4, bz), meshAt(mullionGeo, wallMat, sx * (g.glassX + g.glassW / 2 - 0.1), 1.4, bz));
    for (const sx of [-1, 1]) group.add(meshAt(wallSideGeo, wallMat, sx * (width / 2 - 0.075), WH / 2, cx));
    const front = new THREE.Group(); front.position.z = ROOM.FRONT + WT / 2; group.add(front);
    const side = (width - ROOM.DOOR) / 2, geo = side === doorSide ? wallFrontGeo : new THREE.BoxGeometry(side, WH, WT);
    for (const sx of [-1, 1]) front.add(meshAt(geo, wallMat, sx * (ROOM.DOOR + side) / 2, WH / 2, 0));
    return front;
  }
  // 특수실(GitHub/CI 상태실): 검은 랙 상자와 바닥 빛줄. 색은 ciMat 하나가 정한다(형상·재질 공유).
  const CI_COLORS = { passing: 0x3a8dff, running: 0xffcc33, failing: 0xff3b3b, none: 0x23262d };
  const ciMat = new THREE.MeshBasicMaterial({ color: CI_COLORS.none });
  let special = null;
  function ensureSpecial() {
    if (special) return special;
    const group = new THREE.Group(); scene.add(group);
    const w = 2 * PITCH_ROOM_X, floor = new THREE.Mesh(new THREE.PlaneGeometry(w - ROOM.WALL, ROOM.D), new THREE.MeshStandardMaterial({ color: 0x25262a, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.02, (ROOM.BACK + ROOM.FRONT) / 2); group.add(floor);
    buildRoomShell(group, w);
    const rackGeo = new THREE.BoxGeometry(1.3, 2.0, 1.1), rackMat = new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 0.5 }), ledGeo = new THREE.BoxGeometry(0.9, 0.07, 0.02);
    const rack = (x, z) => { // 앞면(+z)에 LED 세 줄
      const r = meshAt(rackGeo, rackMat, x, 1.0, z); group.add(r);
      for (const y of [0.5, 1.0, 1.5]) group.add(meshAt(ledGeo, ciMat, x, y, z + 0.56));
    };
    for (let i = 0; i < 6; i++) rack((i - 2.5) * 3.8, ROOM.BACK + 1.2);
    for (let i = 0; i < 3; i++) rack((i - 1) * 3.8, ROOM.BACK + 4.0);
    group.add(meshAt(new THREE.BoxGeometry(w - 3, 0.03, 0.22), ciMat, 0, 0.04, ROOM.BACK + 6.2)); // 바닥 빛줄
    group.add(meshAt(new THREE.BoxGeometry(0.22, 0.03, ROOM.D - 2), ciMat, 0, 0.04, (ROOM.BACK + ROOM.FRONT) / 2 + 0.5));
    special = { group }; return special;
  }
  function ensureRoom(teamId) {
    if (rooms.has(teamId)) return rooms.get(teamId);
    const group = new THREE.Group(); scene.add(group);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, ROOM.D), new THREE.MeshStandardMaterial({ color: ROOM_TINTS[0], roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.02, (ROOM.BACK + ROOM.FRONT) / 2); group.add(floor);
    const front = buildRoomShell(group);
    // 뒷벽 안쪽 어두운 화면판(옛 화이트보드 자리: 문서 도착점)
    const sc = screenTexture(), panel = new THREE.Group(); panel.position.set(0, 1.55, ROOM.BACK + 0.04); group.add(panel);
    panel.add(meshAt(frameGeo, frameMat, 0, 0, 0), meshAt(screenGeo, new THREE.MeshBasicMaterial({ map: sc.tex }), 0, 0, 0.035));
    group.add(plant(-5.7, -3.4, 1.5), plant(5.7, -3.4, 1.5));
    const board = new THREE.Vector3(0, 1.55, ROOM.BACK + 0.25);
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.set(0, WH / 2, (ROOM.BACK + ROOM.FRONT) / 2); hit.userData.teamId = teamId; group.add(hit);
    const lamp = meshAt(lampGeo, lampOff, 0, 2.3, ROOM.BACK + 0.3), glow = meshAt(glowGeo, glowMat, 0, 0.035, (ROOM.BACK + ROOM.FRONT) / 2); glow.rotation.x = -Math.PI / 2; glow.visible = false;
    group.add(lamp, glow);
    const room = { group, floor, front, board, hit, sc, lamp, glow, facing: 0 }; rooms.set(teamId, room); return room;
  }

  // 복도 사람: 쉬는(idle) 에이전트가 층 화면 복도를 천천히 오간다(최대 8명, 인스턴스 3벌 공유). 방 화면에서는 자기 책상에 앉아 있다.
  const WHITE = new THREE.Color(0xffffff), WALKER_MAX = 8, WALK_SPEED = 0.8;
  const walkLegs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.8, 0.24), new THREE.MeshBasicMaterial({ color: 0x6b6f78 }), WALKER_MAX);
  const walkTorso = new THREE.InstancedMesh(new THREE.BoxGeometry(0.52, 0.7, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }), WALKER_MAX);
  const walkHead = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: COLORS.skin }), WALKER_MAX);
  const walkers = [walkLegs, walkTorso, walkHead]; for (const m of walkers) { m.count = 0; m.frustumCulled = false; m.visible = false; scene.add(m); }
  const wm = new THREE.Matrix4(), wp = new THREE.Vector3(), wq = new THREE.Quaternion(), wsc = new THREE.Vector3(1.5, 1.5, 1.5), wy = new THREE.Vector3(0, 1, 0), wc = new THREE.Color();
  function updateWalkers(t, floorShown) {
    let n = 0;
    const b = floorLayout.bounds, corridorZ = (floorLayout.rooms[0]?.z ?? 0) + (ROOM.FRONT + ROOM.WALL) + ROOM.CORRIDOR / 2;
    const x0 = b.minX + 3, len = Math.max(1, b.maxX - b.minX - 6);
    for (const d of desks.values()) {
      const walking = floorShown && d.team !== undefined && d.status === "idle" && n < WALKER_MAX;
      d.person.p.visible = !walking;
      if (!walking) continue;
      const u = (t * WALK_SPEED / len + d.phase * 0.137) % 2, tri = u < 1 ? u : 2 - u, dir = u < 1 ? 1 : -1;
      wq.setFromAxisAngle(wy, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const lane = (n % 2 ? 0.55 : -0.55), step = Math.abs(Math.sin(t * 5 + d.phase)) * 0.06; // 두 줄로 오가고 걸음마다 살짝 출렁
      walkLegs.setMatrixAt(n, wm.compose(wp.set(x0 + tri * len, 0.6 + step, corridorZ + lane), wq, wsc));
      walkTorso.setMatrixAt(n, wm.compose(wp.set(x0 + tri * len, 1.72 + step, corridorZ + lane), wq, wsc)); walkTorso.setColorAt(n, wc.setHex(d.shirtHex).lerp(WHITE, 0.3));
      walkHead.setMatrixAt(n, wm.compose(wp.set(x0 + tri * len, 2.62 + step, corridorZ + lane), wq, wsc));
      n++;
    }
    for (const m of walkers) { m.count = n; m.visible = floorShown && n > 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // 책상 구성: 흰 상판 + 가는 검정 다리, 낮은 회청색 칸막이, 검정 모니터, 메시 의자(상태 모양은 syncState)
  const deskGroup = new THREE.Group(); scene.add(deskGroup);
  const desks = new Map();
  const tagsRoot = document.createElement("div");
  Object.assign(tagsRoot.style, { position: "fixed", pointerEvents: "none", overflow: "hidden", fontFamily: "system-ui, 'Noto Sans KR', sans-serif" });
  document.body.appendChild(tagsRoot);

  function buildPerson(shirtColor, hairKind) {
    const p = new THREE.Group(); p.position.set(0, HIP_Y, HIP_Z);
    const shirt = mat(shirtColor), skin = mat(COLORS.skin); // shirt: 몸통·팔이 함께 쓰는 재질(색이 바뀌면 한 번에 바뀐다)
    const sbox = (w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shirt); m.castShadow = true; m.receiveShadow = true; return m; };
    const torso = new THREE.Group(); p.add(torso);
    torso.add(at(sbox(0.64, 0.7, 0.36), 0, 0.35, 0));
    const head = new THREE.Group(); head.position.set(0, 0.7, 0); torso.add(head);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 20), skin); headMesh.position.y = 0.27; headMesh.castShadow = true; head.add(headMesh);
    // 머리카락: 짧게, 옆을 정리(사양 §5). 앞쪽(-z)으로 이마가 보이도록 위·뒤·옆만 덮는다.
    const hairM = mat(COLORS.hair), capH = HAIR_CAP[hairKind] ?? HAIR_CAP_DEFAULT;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.285, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hairM); cap.position.set(0, 0.28, 0.03); cap.scale.y = 1 + capH; head.add(cap);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.285, 20, 14, 0, Math.PI, Math.PI * 0.3, Math.PI * 0.32), hairM); back.position.set(0, 0.27, 0.06); back.scale.set(1, 1, 0.92); head.add(back);
    for (const sx of [-1, 1]) head.add(at(box(0.05, 0.16, 0.2, COLORS.hair), sx * 0.26, 0.28, 0.02));
    if (hairKind === "part") head.add(at(box(0.5, 0.05, 0.1, COLORS.hair), 0.04, 0.5, -0.12)); // 옆가르마
    for (const sx of [-1, 1]) head.add(at(box(0.05, 0.07, 0.03, 0x1b1b1f), sx * 0.1, 0.29, -0.255)); // 눈(시선 방향 표시)
    const arms = {};
    for (const [side, sx] of [["L", -1], ["R", 1]]) {
      const up = new THREE.Group(); up.position.set(sx * 0.4, SHOULDER, 0); torso.add(up);
      up.add(at(sbox(0.15, L_UP, 0.15), 0, -L_UP / 2, 0));
      const fore = new THREE.Group(); fore.position.set(0, -L_UP, 0); up.add(fore);
      fore.add(at(sbox(0.13, L_FORE, 0.13), 0, -L_FORE / 2, 0), at(box(0.13, 0.11, 0.15, COLORS.skin), 0, -L_FORE - 0.04, 0));
      arms[side] = { up, fore };
    }
    for (const sx of [-1, 1]) { // 다리 2마디: 허벅지는 앞으로, 종아리는 아래로
      const th = new THREE.Group(); th.position.set(sx * 0.17, 0, 0); th.rotation.x = Math.PI / 2; p.add(th);
      th.add(at(box(0.2, 0.42, 0.2, COLORS.pants), 0, -0.21, 0));
      const sh = new THREE.Group(); sh.position.set(0, -0.42, 0); sh.rotation.x = -Math.PI / 2; th.add(sh);
      sh.add(at(box(0.17, 0.66, 0.17, COLORS.pants), 0, -0.33, 0), at(box(0.2, 0.08, 0.3, COLORS.shoe), 0, -0.7, -0.05));
    }
    return { p, torso, head, arms, shirt };
  }

  function buildDesk(id, name, index, shirtColor) {
    const g = new THREE.Group(); g.rotation.y = YAW;
    const top = box(DESK_W, 0.08, DESK_D, COLORS.deskTop); top.position.y = 1.1; g.add(top);
    for (const dx of [-1.2, 1.2]) for (const dz of [-0.6, 0.6]) g.add(at(box(0.06, 1.06, 0.06, COLORS.deskLeg), dx, 0.53, dz));
    g.add(at(box(DESK_W - 0.1, 0.05, 0.05, COLORS.deskLeg), 0, 0.2, -0.6));
    g.add(at(box(DESK_W, 0.6, 0.08, COLORS.partition), 0, 1.44, -0.78)); // 책상 사이 낮은 칸막이
    // 모니터: 검정, 얇은 베젤, 화면 면은 상태색 발광
    const mon = new THREE.Group(); mon.position.set(0, 0, -0.4); mon.rotation.y = -0.45; g.add(mon); // 모니터를 살짝 비스듬히([A])
    mon.add(at(box(0.08, 0.3, 0.08, 0x151519), 0, 1.3, 0), at(box(0.4, 0.04, 0.24, 0x151519), 0, 1.16, 0), at(box(1.1, 0.66, 0.05, 0x101013), 0, 1.78, 0));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.56), new THREE.MeshBasicMaterial({ color: SCREEN.idle })); screen.position.set(0, 1.78, 0.028); mon.add(screen);
    g.add(at(box(0.62, 0.03, 0.22, 0x1a1a1e), 0, 1.15, 0.22)); // 키보드
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.14, 16), mat(0xf5f5f2)); mug.position.set(0.95, 1.18, 0.15); mug.castShadow = true; g.add(mug);
    g.add(at(box(0.34, 0.015, 0.44, 0xffffff), -0.95, 1.15, 0.15), at(box(0.34, 0.015, 0.44, 0xf0f0ec), -0.93, 1.165, 0.12));
    if (index === 2) g.add(at(box(0.6, 0.45, 0.7, 0xe8c547), -1.9, 0.225, 0.1)); // 책상 끝 노란 수납 상자
    if (index === 1) g.add(at(plant(0, 0, 0.55), 1.05, 1.14, -0.2)); // 책상 위 작은 화분
    // 메시 의자: 방석, 등받이, 머리받침, 기둥, 5발 바퀴
    const chairC = 0x3a3d42;
    g.add(at(box(0.72, 0.1, 0.72, chairC), 0, 0.64, 1.02), at(box(0.7, 0.85, 0.08, chairC), 0, 1.15, 1.4), at(box(0.34, 0.2, 0.08, chairC), 0, 1.7, 1.42), at(box(0.07, 0.4, 0.07, 0x222226), 0, 0.4, 1.02));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, arm = box(0.4, 0.04, 0.05, 0x222226); arm.position.set(Math.cos(a) * 0.2, 0.16, 1.02 + Math.sin(a) * 0.2); arm.rotation.y = -a; g.add(arm); g.add(at(box(0.07, 0.07, 0.07, 0x111114), Math.cos(a) * 0.4, 0.07, 1.02 + Math.sin(a) * 0.4)); }
    const person = buildPerson(shirtColor, hairKindFor(id, index));
    g.add(person.p);
    deskGroup.add(g);
    const el = document.createElement("div");
    Object.assign(el.style, { position: "absolute", transform: "translate(-50%,-100%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", whiteSpace: "nowrap" });
    const bubble = document.createElement("div");
    Object.assign(bubble.style, { display: "none", background: "#d93c3c", color: "#fff", font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "3px 10px", borderRadius: "10px" });
    const nameEl = document.createElement("div");
    Object.assign(nameEl.style, { background: "rgba(20,25,40,.82)", color: "#fff", font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "4px 10px", borderRadius: "8px" });
    nameEl.textContent = name; el.append(bubble, nameEl); tagsRoot.appendChild(el);
    const d = { id, group: g, screen, person, el, bubble, nameEl, team: undefined, status: "idle", anchor: new THREE.Vector3(), phase: index * 2.1, pose: { ...POSES.idle }, top, shirtHex: shirtColor };
    desks.set(id, d); return d;
  }

  const papers = [];
  function playEvent(ev) {
    const vis = (id) => { const d = desks.get(id); return d && d.group.visible ? d.anchor : null; }; // 보고 있는 팀 안의 문서만 그린다
    const boardFor = (id) => {
      if (!multi) return boardAnchor;
      const room = rooms.get(desks.get(id)?.team);
      return room?.group.visible ? room.board.clone().add(room.group.position) : null;
    };
    const from = ev.from === "board" ? boardFor(ev.to) : vis(ev.from);
    const to = ev.to === "board" ? boardFor(ev.from) : vis(ev.to);
    if (!from || !to) return;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), new THREE.MeshStandardMaterial({ color: own(KIND_COLOR, ev.kind, 0xffffff), side: THREE.DoubleSide, emissive: own(KIND_COLOR, ev.kind, 0xffffff), emissiveIntensity: 0.25 }));
    const clipColor = desks.get(ev.from)?.shirtHex ?? 0x888888;
    mesh.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.06), new THREE.MeshBasicMaterial({ color: clipColor })), 0, 0.12, 0.01));
    mesh.position.copy(from); scene.add(mesh);
    papers.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur: 1.8, ev, landed: 0, arrived: false });
  }

  // 팀 선택: 팀 탭이 setTeam(id)을 부른다. 모르는 팀이면 첫 팀. 팀이 없으면 전원이 기본 팀 하나다.
  let wanted = null, lastState = null, layoutKey = "", reqMode = "floor";
  let teams = [], multi = false, floorLayout = layoutRooms(0), ciStatus = null;
  let shown = null, anim = null, cur = null, goal = null;
  const canFloor = () => multi && canvas.clientWidth >= 600;
  const effMode = () => reqMode === "campus" && campusCount >= 2 && canvas.clientWidth >= 600 ? "campus" : reqMode === "floor" && canFloor() ? "floor" : "room";
  const selectedTeam = () => {
    const id = pickTeam(lastState, wanted);
    return teams.find((t) => t.id === id)?.id ?? teams[0]?.id ?? null;
  };
  const hex = (c) => parseInt(String(c).replace("#", ""), 16);
  // 팀 안 인원 n의 책상 자리(x, z). n<=4 한 줄(예전 간격), 5~8 앞줄 4명 + 뒷줄은 앞줄 사이 칸에 어긋나게.
  function slots(n) {
    if (n <= ROW_MAX) return Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * PITCH_X, z: 0 }));
    const m = n - ROW_MAX, P = PITCH_2, out = [];
    const frontShift = m === ROW_MAX ? -0.25 * P : 0, backShift = m === ROW_MAX ? 0.25 * P : 0;
    for (let i = 0; i < ROW_MAX; i++) out.push({ x: (i - (ROW_MAX - 1) / 2) * P + frontShift, z: 0 });
    const back = m === 1 ? [0] : m === 2 ? [-P, P] : m === 3 ? [-P, 0, P] : [0, 1, 2, 3].map((i) => (i - 1.5) * P + backShift);
    for (const x of back) out.push({ x, z: -ROW_DZ });
    return out;
  }
  function syncState(state) { if (state === lastState) return; lastState = state; applyState(); } // 같은 객체(내용 변화 없음)면 할 일이 없다
  function applyState() {
    const state = lastState; if (!state) return;
    for (const d of desks.values()) d.team = undefined;
    teams = teamsOf(state).slice(0, TEAM_MAX); multi = teams.length >= 2;
    floorLayout = layoutRooms(teams.length, { special: multi && ciStatus != null });
    const colors = agentColors(state);
    const keys = [];
    teams.forEach((team, index) => {
      const room = multi ? ensureRoom(team.id) : null, q = floorLayout.rooms[index];
      if (room) {
        room.group.position.set(q.x, 0, q.z); room.group.rotation.y = q.facing ? Math.PI : 0; room.facing = q.facing; // 아래줄 방은 180° 돌려 문이 복도 쪽
        room.floor.material.color.setHex(ROOM_TINTS[index]);
        const lit = team.working > 0; room.lamp.material = lit ? lampOn : lampOff; room.glow.visible = lit;
        paintScreen(room.sc, team.name ?? team.id, `일하는 중 ${team.working}/${team.count}${team.blocked ? ` · 막힘 ${team.blocked}` : ""}`);
      }
      const host = room ? room.group : deskGroup;
      const ids = new Set(team.agentIds.slice(0, TEAM_MAX));
      const members = state.agents.filter((a) => ids.has(a.id)), sl = slots(members.length);
      keys.push(`${team.id}:${sl.map((q) => q.x + ":" + q.z).join(",")}`);
      members.forEach((a, i) => {
        const col = hex(colors.get(a.id) ?? "#77777d");
        const d = desks.get(a.id) ?? buildDesk(a.id, a.name, i, col);
        if (d.shirtHex !== col) { d.shirtHex = col; d.person.shirt.color.setHex(col); }
        if (d.group.parent !== host) host.add(d.group);
        d.team = team.id;
        d.group.position.set(sl[i].x, 0, sl[i].z); d.anchor.set(host.position.x + sl[i].x, 1.5, host.position.z + sl[i].z + 0.3);
        d.name = a.name; d.status = Object.hasOwn(POSES, a.status) ? a.status : "idle";
        paintTag(d);
      });
    });
    if (multi && floorLayout.special) { const sp = ensureSpecial(), q = floorLayout.special; sp.group.position.set(q.x, 0, q.z); sp.group.rotation.y = q.facing ? Math.PI : 0; }
    if (multi) {
      const b = floorLayout.bounds;
      const m = 3, sx = b.maxX - b.minX + m, sz = b.maxZ - b.minZ + m, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      slabEdge.scale.set(sx + 0.8, 1, sz + 0.8); slabEdge.position.set(cx, -0.15, cz);
      slabTop.scale.set(sx, 1, sz); slabTop.position.set(cx, 0.001, cz);
      slab.userData.center = { x: cx, z: cz };
      sky.setExtent(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2);
      [[0, -sz / 2, sx, 0], [0, sz / 2, sx, 0], [-sx / 2, 0, sz, Math.PI / 2], [sx / 2, 0, sz, Math.PI / 2]].forEach(([dx, dz, len, ry], i) => { // 바닥판 둘레 유리 띠(얇은 틀 포함)
        for (const [m, y] of [[railGlass[i], 0.46], [railTop[i], 0.93]]) { m.scale.x = len; m.rotation.y = ry; m.position.set(cx + dx, y, cz + dz); }
      });
    }
    const key = `${multi}|${keys.join("|")}`;
    if (key !== layoutKey) { layoutKey = key; resize(); } else syncView(true);
    applyVisibility();
  }
  function applyVisibility() {
    const inCampus = shown?.mode === "campus";
    campusScene.group.visible = inCampus;
    campusDirty = true;
    // 숨긴 사무실 수백 개 메시의 행렬을 단지 프레임마다 갱신하지 않는다.
    scene.matrixWorldAutoUpdate = !inCampus;
    if (inCampus) campusScene.group.updateMatrixWorld(true);
    scene.background.setHex(inCampus ? dayData.fog : multi ? dayData.skyBottom : COLORS.wall);
    sky.group.visible = inCampus || multi;
    scene.fog = inCampus ? campusFog : null;
    const showAll = multi && (shown?.mode === "floor" || !!anim), sel = shown?.teamId ?? selectedTeam();
    for (const d of desks.values()) {
      d.group.visible = !inCampus && d.team !== undefined && (showAll || d.team === sel);
      d.el.style.display = d.group.visible ? "flex" : "none";
    }
    for (const [id, room] of rooms) {
      room.group.visible = !inCampus && multi && teams.some((t) => t.id === id) && (showAll || id === sel);
      room.front.visible = !(shown?.mode === "room" && id === sel);
    }
    if (special) special.group.visible = !inCampus && showAll && !!floorLayout.special;
    legacy.visible = !inCampus && !multi; slab.visible = !inCampus && multi;
    tagsRoot.style.visibility = inCampus || anim || shown?.mode === "floor" ? "hidden" : "visible";
    if (anim || shown?.mode !== "floor" || !rooms.get(hovered)?.group.visible) setHover(null);
  }
  // 이름표에 보일 이름. 숫자로 끝나면 첫 글자+숫자(검수 5 → 검5), 아니면 앞 2글자.
  function tagName(name, abbr) {
    const chars = Array.from(name);
    if (abbr) {
      const m = /^(.*?)\s*(\d+)$/.exec(name);
      if (m && m[1]) return Array.from(m[1])[0] + m[2];
      return chars.slice(0, NAME_ABBR).join("");
    }
    return chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join("") + "…" : name;
  }
  // 이름표 그리기. 폰 두 줄에서는 막힘 말풍선을 따로 띄우지 않고 이름표 한 줄(빨간 바탕)에 합쳐서 앞줄·뒷줄 이름표가 겹치지 않게 한다.
  function paintTag(d) {
    const blocked = d.status === "blocked", merged = d.small && blocked;
    d.bubble.style.display = blocked && !d.small ? "block" : "none"; if (blocked) d.bubble.textContent = "막힘";
    const shown = tagName(d.name ?? "", d.small); // 폰 5~8명 두 줄은 2자 약칭, 그 밖에는 전체 이름(6자 초과는 …). 전체 이름은 카드에서
    const text = merged ? `${shown}!` : shown; // 폰 두 줄은 약칭 뒤에 느낌표만 붙여 빨간 이름표를 좁게 유지(전체 이름·막힘 글자는 카드에서)
    if (d.nameEl.textContent !== text) d.nameEl.textContent = text;
    d.nameEl.style.background = merged ? "#d93c3c" : "rgba(20,25,40,.82)";
  }
  function setTeam(id) { wanted = typeof id === "string" ? id : null; applyState(); }
  function setView({ mode, teamId } = {}) {
    if (typeof teamId === "string") wanted = teamId;
    if (mode === "floor" || mode === "room" || mode === "campus") reqMode = mode;
    if (mode !== "campus") cancelApproach();
    if (lastState) applyState(); else { syncView(false); applyVisibility(); }
  }
  function getView() {
    const mode = shown?.mode ?? effMode();
    return { mode, teamId: mode === "room" ? (shown?.teamId ?? selectedTeam()) : null };
  }

  // 카메라: 책상이 장면 가로의 FILL(80%)을 채우도록 거리를 정한다. 회전은 막고 크기 변화에만 반응한다.
  function deskCorners(list) {
    const pts = [];
    for (const d of list) {
      d.group.updateMatrixWorld(true);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push(d.top.localToWorld(new THREE.Vector3(sx * DESK_W / 2, 0, sz * DESK_D / 2)));
    }
    return pts;
  }
  function span(w, list = [...desks.values()].filter((d) => d.group.visible)) {
    const pts = deskCorners(list); if (!pts.length) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { const v = p.clone().project(camera); lo = Math.min(lo, v.x); hi = Math.max(hi, v.x); }
    return { frac: (hi - lo) / 2, left: ((lo + 1) / 2) * w, right: ((hi + 1) / 2) * w };
  }
  function placePose(p) {
    camera.position.set(p.tx + p.dist * Math.cos(p.pitch) * Math.sin(p.yaw || 0), p.ty + p.dist * Math.sin(p.pitch), p.tz + p.dist * Math.cos(p.pitch) * Math.cos(p.yaw || 0));
    target.set(p.tx, p.ty, p.tz); camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  }
  function roomPose(teamId, w, h) {
    scene.updateMatrixWorld(true);
    const vis = [...desks.values()].filter((d) => d.team === teamId), n = Math.max(vis.length, 3);
    const rows = vis.some((d) => d.group.position.z < -1);
    const width = rows ? (ROW_MAX - 1) * PITCH_2 + 2.4 + 0.25 * PITCH_2 * 2 : (n - 1) * PITCH_X + 2.4;
    const room = multi ? rooms.get(teamId) : null, offset = room?.group.position, ox = offset?.x ?? 0, oz = offset?.z ?? 0, sgn = room?.facing ? -1 : 1;
    const p = { tx: ox, ty: (rows ? 1.3 : 1.0) + (multi ? 0.3 : 0), tz: oz + sgn * (rows ? 0.2 - ROW_DZ * 0.55 : 0.2), ox, oz, yaw: room?.facing ? Math.PI : 0, // 돌린 방은 문 쪽(복도)에서 본다
      dist: width / (FILL * 2 * Math.tan((FOV * Math.PI) / 360) * (w / h)), pitch: PITCH };
    placePose(p);
    const s = span(w, vis); if (s && s.frac > 0) { p.dist *= s.frac / FILL; placePose(p); }
    return p;
  }
  function floorPose(w, h) {
    const b = floorLayout.bounds, ox = (b.minX + b.maxX) / 2, oz = (b.minZ + b.maxZ) / 2;
    const p = { tx: ox, ty: 0, tz: oz, ox, oz, yaw: FLOOR_YAW, dist: (b.maxX - b.minX) / (0.9 * 2 * Math.tan((FOV * Math.PI) / 360) * (w / h)), pitch: FLOOR_PITCH };
    const pts = [];
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) pts.push(new THREE.Vector3(x, 0, z));
    const all = floorLayout.special ? [...floorLayout.rooms, floorLayout.special] : floorLayout.rooms;
    for (const q of all) {
      const hw = (q.width ?? ROOM.W + ROOM.WALL) / 2, sg = q.facing ? -1 : 1;
      for (const sx of [-1, 1]) for (const z of [ROOM.BACK - ROOM.WALL, ROOM.FRONT + ROOM.WALL]) pts.push(new THREE.Vector3(q.x + sx * hw, ROOM.WALL_H, q.z + sg * z));
    }
    for (let i = 0; i < 4; i++) {
      placePose(p);
      const extent = Math.max(...pts.map((q) => { const v = q.clone().project(camera); return Math.max(Math.abs(v.x), Math.abs(v.y)); }));
      p.dist *= extent / 0.9;
    }
    return p;
  }
  function campusPose(w, h) {
    const b = campusScene.layout.bounds;
    const p = { tx: 0, ty: 0, tz: 0, ox: 0, oz: 0, pitch: Math.PI * 0.23, yaw: Math.PI / 8, dist: 140 };
    const pts = []; for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, campusScene.maxHeight]) pts.push(new THREE.Vector3(x, y, z));
    for (let i = 0; i < 5; i++) { placePose(p); const extent = Math.max(...pts.map(v => { const q = v.clone().project(camera); return Math.max(Math.abs(q.x), Math.abs(q.y)); })); p.dist *= extent / 0.86; }
    campusFog.near = p.dist + 15; campusFog.far = p.dist + 150;
    return p;
  }
  function computeGoal(w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720) {
    camera.far = multi || shown?.mode === "campus" ? 1000 : 100;
    return { yaw: 0, ...(shown?.mode === "campus" ? campusPose(w, h) : shown?.mode === "floor" ? floorPose(w, h) : roomPose(shown?.teamId ?? selectedTeam(), w, h)) };
  }
  function cameraEvent(moving) {
    canvas.dispatchEvent(new CustomEvent("office:camera", { bubbles: true, detail: { moving, mode: shown.mode, teamId: shown.mode === "room" ? shown.teamId : null } }));
  }
  function syncView(animate) {
    if (!lastState && effMode() !== "campus") return false;
    const mode = effMode(), next = { mode, teamId: mode === "room" ? selectedTeam() : null };
    if (shown?.mode === next.mode && shown.teamId === next.teamId) return false;
    const prev = shown; shown = next; updateRenderScale(); goal = computeGoal();
    if (animate && prev && prev.mode !== next.mode && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      anim = { t: 0, from: { ...cur }, to: goal }; placePose(cur);
      applyVisibility(); cameraEvent(true);
    } else {
      anim = null; cur = { ...goal }; placePose(cur);
      applyVisibility(); layoutTags(); cameraEvent(false);
    }
    return true;
  }
  function layoutTags() {
    const r = canvas.getBoundingClientRect();
    Object.assign(tagsRoot.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const v = new THREE.Vector3();
    const rows = [...desks.values()].some((d) => d.group.visible && d.group.position.z < -1);
    const small = rows && r.width < 600; // 폰에서 두 줄이면 이름표 여백을 줄여(글자는 16px 유지) 앞줄·뒷줄 이름표가 겹치지 않게
    const placed = [];
    for (const d of desks.values()) {
      if (!d.group.visible) continue;
      if (d.small !== small) {
        d.small = small;
        d.nameEl.style.padding = small ? "1px 5px" : "4px 10px"; // 글자(16px)는 그대로, 여백만 줄인다
        d.bubble.style.padding = small ? "0 5px" : "3px 10px";
        d.el.style.gap = small ? "1px" : "4px";
        paintTag(d);
      }
      d.person.head.getWorldPosition(v); v.y += 0.62; v.project(camera);
      // 이름표가 장면 위로 벗어나면(책상 1개 방은 카메라가 가까워 머리 위 이름표가 화면 밖으로 간다) 위쪽 안으로만 밀어 넣는다. 안에 있는 이름표는 그대로다.
      const top = Math.max(((1 - v.y) / 2) * r.height, d.el.offsetHeight + 4);
      placed.push({ d, cx: ((v.x + 1) / 2) * r.width, top });
    }
    // 같은 줄 이름표가 장면 좌우 밖으로 잘리면 안쪽으로 밀고, 밀려서 겹치는 이름표는 왼쪽으로 함께 민다. 안에 있고 겹치지 않는 이름표는 그대로다.
    const rowsOf = [];
    for (const it of placed.sort((a, b) => a.top - b.top)) {
      const row = rowsOf.find((g) => Math.abs(g[0].top - it.top) < 20);
      if (row) row.push(it); else rowsOf.push([it]);
    }
    const EDGE_PX = 2, GAP_PX = 4;
    const half = (it) => it.d.el.offsetWidth / 2;
    for (const row of rowsOf) {
      row.sort((a, b) => a.cx - b.cx);
      for (const it of row) it.d.nameEl.style.maxWidth = ""; // 이전 프레임의 줄이기를 풀고 원래 폭으로 다시 잰다
      const avail = r.width - 2 * EDGE_PX - GAP_PX * (row.length - 1);
      if (row.reduce((sum, it) => sum + 2 * half(it), 0) > avail) {
        // 한 줄 이름표 폭의 합이 장면 폭보다 크면 밀어서는 겹침을 못 없앤다: 폭을 똑같이 나눠 말줄임으로 줄인다.
        const each = Math.max(24, Math.floor(avail / row.length));
        for (const it of row) Object.assign(it.d.nameEl.style, { boxSizing: "border-box", maxWidth: `${each}px`, overflow: "hidden", textOverflow: "ellipsis" });
      }
      for (const it of row) it.cx = Math.min(it.cx, r.width - half(it) - EDGE_PX);
      for (let i = row.length - 2; i >= 0; i--) row[i].cx = Math.min(row[i].cx, row[i + 1].cx - half(row[i + 1]) - GAP_PX - half(row[i]));
      for (let i = 0; i < row.length; i++) row[i].cx = Math.max(row[i].cx, i ? row[i - 1].cx + half(row[i - 1]) + GAP_PX + half(row[i]) : half(row[i]) + EDGE_PX); // 왼쪽 끝을 맞추고 왼쪽부터 다시 밀어 겹침을 남기지 않는다
    }
    // 팀 탭이 보이는 화면(폭 601 이상은 탭이 장면 위에 겹친다)에서는 탭에 가리는 이름표를 탭 아래로 내린다. 폰은 장면이 탭 아래에서 시작해 해당 없다.
    const tabs = document.querySelector(".teamtabs");
    const tr = tabs && !tabs.hidden ? tabs.getBoundingClientRect() : null;
    if (tr && tr.width > 0) {
      for (const it of placed) {
        const w = it.d.el.offsetWidth, h = it.d.el.offsetHeight;
        const absL = r.left + it.cx - w / 2, absT = r.top + it.top - h;
        if (absL < tr.right && absL + w > tr.left && absT < tr.bottom + 4 && absT + h > tr.top) it.top = tr.bottom + 4 - r.top + h;
      }
    }
    for (const { d, cx, top } of placed) { d.el.style.left = `${cx}px`; d.el.style.top = `${top}px`; }
  }

  // 층 화면의 투명 상자로 방을 고른다.
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), roomClicks = new Set();
  let hovered = null;
  function setHover(teamId) {
    hovered = teamId;
    for (const [id, room] of rooms) room.floor.material.emissive.setHex(id === teamId ? 0x26364a : 0);
    canvas.style.cursor = teamId === null ? "" : "pointer";
  }
  function hitRoom(ev) {
    if (!multi || shown?.mode !== "floor" || anim) return null;
    const r = canvas.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, 1 - ((ev.clientY - r.top) / r.height) * 2);
    scene.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera);
    const hits = [...rooms.values()].filter((room) => room.group.visible).map((room) => room.hit);
    return raycaster.intersectObjects(hits, false)[0]?.object.userData.teamId ?? null;
  }
  function hitBuilding(ev) {
    if (shown?.mode !== "campus" || anim || approach) return null;
    const r = canvas.getBoundingClientRect(); pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, 1 - ((ev.clientY - r.top) / r.height) * 2);
    scene.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(campusScene.hits(), false)[0]?.object.userData.projectId ?? null;
  }
  function pointerMove(ev) { setHover(hitRoom(ev)); if (shown?.mode === "campus") canvas.style.cursor = hitBuilding(ev) ? "pointer" : ""; }
  function pointerLeave() { setHover(null); }
  function clickRoom(ev) {
    const id = hitBuilding(ev); if (id) { for (const fn of buildingClicks) fn(id); return; }
    const teamId = hitRoom(ev); if (teamId === null) return;
    setView({ mode: "room", teamId });
    for (const cb of roomClicks) cb(teamId);
  }
  function onRoomClick(cb) { roomClicks.add(cb); return () => roomClicks.delete(cb); }
  function roomAnchors() {
    if (!multi || shown?.mode !== "floor") return [];
    const w = canvas.clientWidth, h = canvas.clientHeight, z = ROOM.BACK - 1.0; // 이름표는 뒷벽 위에 띄워 복도·문·방 안쪽을 가리지 않는다
    scene.updateMatrixWorld(true);
    const project = (room, x, y) => {
      const v = room.group.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
    };
    return teams.map((team) => {
      const room = rooms.get(team.id), p = project(room, 0, ROOM.WALL_H + 1.8); // 화면판(벽 안쪽 0.85~2.25)보다 위로 띄운다
      const l = project(room, -(ROOM.W + ROOM.WALL) / 2, 0), r = project(room, (ROOM.W + ROOM.WALL) / 2, 0);
      return { teamId: team.id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(Math.hypot(r.x - l.x, r.y - l.y)) };
    });
  }
  // restore: 단지 전체 포즈로 되돌린다(Esc 취소). 다른 건물로 바로 이어 갈 때는 지금 위치에서 출발하도록 그대로 둔다.
  function cancelApproach(restore = false) { campusDirty = true; if (approach) { const old = approach; approach = null; if (restore && goal) { cur = { ...goal }; placePose(cur); } cameraEvent(false); old.done(false); } }
  function approachBuilding(id) {
    cancelApproach(); if (anim) { anim = null; cur = { ...goal }; placePose(cur); }
    const c = campusScene.center(id);
    if (!c || shown?.mode !== "campus" || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve(true);
    cameraEvent(true);
    return new Promise(done => { approach = { t: 0, startedAt: performance.now(), from: { ...cur }, to: { ...cur, tx: c.x, tz: c.z, dist: cur.dist * 0.65 }, done }; });
  }
  function buildingAnchors() {
    if (shown?.mode !== "campus" || anim || approach) return [];
    const r = canvas.getBoundingClientRect();
    const anchors = campusScene.anchorPoints().map(p => { const v = new THREE.Vector3(p.x, p.y, p.z).project(camera); return { id: p.id, x: r.left + (v.x + 1) * r.width / 2, y: r.top + (1 - v.y) * r.height / 2, w: r.width / Math.min(4, campusCount) - 12 }; });
    for (const a of anchors) { const gaps = anchors.filter(b => b !== a && Math.abs(b.y - a.y) < 64).map(b => Math.abs(b.x - a.x)); if (gaps.length) a.w = Math.min(a.w, Math.min(...gaps) - 12); }
    return anchors;
  }
  function setCampus(list) { cancelApproach(); campusCount = list.length; campusScene.setProjects(list); resize(); }
  function updateRenderScale() {
    // 단지의 고해상도 소프트웨어 렌더링 비용을 제한한다. HTML 이름표는 원래 해상도를 유지한다.
    const ratio = Math.min(devicePixelRatio || 1, shown?.mode === "campus" ? (campusCount >= 9 ? 0.75 : 1) : 2);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  }
  function resize() {
    campusDirty = true;
    cancelApproach();
    const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720;
    updateRenderScale(); renderer.setSize(w, h, false); camera.aspect = w / h;
    const changed = syncView(false); goal = computeGoal(w, h);
    if (anim) { anim.to = goal; placePose(cur); } else { cur = { ...goal }; placePose(cur); }
    applyVisibility(); layoutTags();
    if (!changed && shown && !anim) cameraEvent(false);
  }
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("click", clickRoom);
  addEventListener("resize", resize);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null; ro?.observe(canvas);
  resize();

  const timer = new THREE.Timer(); // THREE.Clock은 r187에서 폐기 예정(경고)
  let running = true;
  const lerp = (a, b, k) => a + (b - a) * k;
  function frame() {
    if (!running) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1), t = timer.getElapsed(), k = Math.min(1, dt * 6);
    if (approach) {
      campusDirty = true;
      const a = approach; a.t = Math.min(1, (performance.now() - a.startedAt) / 600); const e = a.t * a.t * (3 - 2 * a.t);
      for (const key of Object.keys(a.from)) cur[key] = lerp(a.from[key], a.to[key], e); placePose(cur);
      if (a.t === 1) { approach = null; cameraEvent(false); a.done(true); }
    }
    if (anim) {
      campusDirty = true;
      anim.t = Math.min(1, anim.t + dt / 0.7);
      const e = anim.t < 0.5 ? 2 * anim.t * anim.t : 1 - Math.pow(-2 * anim.t + 2, 2) / 2;
      for (const key of Object.keys(goal)) cur[key] = lerp(anim.from[key], anim.to[key], e);
      placePose(cur);
      if (anim.t === 1) {
        cur = { ...goal }; anim = null; placePose(cur);
        applyVisibility(); layoutTags(); cameraEvent(false);
      }
    }
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== dayMinute) { dayMinute = minute; applyDaylight(); } // 1분마다(매 프레임 아님)
    const kf = THREE.MathUtils.clamp((cur.pitch - PITCH) / (FLOOR_PITCH - PITCH), 0, 1);
    const amb = multi ? dayData.ambient : null;
    hemi.intensity = lerp(1.5, 2.6, kf) * (amb ? amb.intensity : 1); hemi.color.setHex(amb ? amb.color : 0xf4f6fb);
    lights.forEach((p, i) => { p.intensity = 9 * (1 - kf); p.position.set(cur.ox + [-4.5, 0, 4.5][i], 4.6, cur.oz + 0.5); });
    if (multi && kf > 0) { const l = lights[1]; l.color.setHex(0xffd9a8); l.distance = 0; l.decay = 2; l.intensity = 9 * (1 - kf) + 300 * kf * (0.8 + 0.6 * dayData.night); l.position.set(cur.ox, 14, cur.oz - 2); } // 위쪽 따뜻한 점광 하나
    else { lights[1].color.setHex(0xfff8ee); lights[1].distance = 14; lights[1].decay = 1.6; }
    sun.position.set(cur.ox + 9, 10, cur.oz - 3); sun.target.position.set(cur.ox, 0, cur.oz); sun.castShadow = shown?.mode !== "campus" && kf < 0.5; renderer.shadowMap.enabled = sun.castShadow;
    if (sky.group.visible) sky.follow(camera, multi && shown?.mode !== "campus");
    updateWalkers(t, multi && (shown?.mode === "floor" || !!anim));
    if (special?.group.visible) { // 정상 파랑, 실행 중 노랑 천천히 깜빡임, 실패 빨강, 없음은 꺼짐
      ciMat.color.setHex(own(CI_COLORS, ciStatus, CI_COLORS.none));
      if (ciStatus === "running") ciMat.color.multiplyScalar(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.2)));
    }
    for (const d of desks.values()) {
      if (!d.group.visible) continue;
      const goal = POSES[d.status], ps = d.pose;
      for (const key of Object.keys(goal)) ps[key] = lerp(ps[key], goal[key], k);
      const { torso, head, arms } = d.person;
      let tapL = 0, tapR = 0, nod = 0;
      if (d.status === "working") { tapL = Math.sin(t * 16 + d.phase) * 0.05; tapR = Math.cos(t * 16 + d.phase) * 0.05; nod = Math.pow(Math.max(0, Math.sin(t * 0.9 + d.phase)), 6) * 0.1; }
      torso.rotation.x = -ps.lean;
      head.rotation.x = ps.headX + nod;
      arms.L.up.rotation.x = ps.uaL; arms.L.fore.rotation.x = ps.faL + tapL;
      arms.R.up.rotation.x = ps.uaR; arms.R.fore.rotation.x = ps.faR + tapR;
      const c = own(SCREEN, d.status, SCREEN.idle);
      d.screen.material.color.setHex(c); if (multi) d.screen.material.color.multiplyScalar(0.8 + 0.2 * dayData.night); // 밤에 모니터 발광이 도드라진다
      if (d.status === "blocked") d.screen.material.color.multiplyScalar(0.65 + 0.35 * Math.abs(Math.sin(t * 5)));
    }
    for (let i = papers.length - 1; i >= 0; i--) {
      const p = papers[i];
      if (p.t < 1) {
        p.t = Math.min(1, p.t + dt / p.dur);
        const e = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;
        p.mesh.position.lerpVectors(p.from, p.to, e); p.mesh.position.y += Math.sin(Math.PI * e) * 1.6;
        p.mesh.rotation.set(-0.4 * Math.sin(Math.PI * e), e * Math.PI * 2 * 0.5 * (1 - e), 0.3 * Math.sin(e * 8));
      } else {
        if (!p.arrived) {
          p.arrived = true; p.mesh.rotation.set(0, 0, 0);
          if (p.ev.to === "board") dispatchEvent(new CustomEvent("office:arrive", { detail: { taskId: p.ev.taskId } }));
        }
        p.landed += dt; p.mesh.scale.setScalar(Math.max(0, 1 - Math.max(0, p.landed - 1.5) * 2));
        if (p.landed > 2) { scene.remove(p.mesh); p.mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); papers.splice(i, 1); } // 문서마다 새로 만든 형상·재질을 GPU에서도 내린다
      }
    }
    if (shown?.mode !== "campus") layoutTags();
    if (shown?.mode === "campus") for (const fn of campusFrames) fn();
    // 정지한 단지는 같은 픽셀을 다시 그리지 않는다. 데이터·카메라·크기 변경은 위에서 무효화한다.
    if (shown?.mode !== "campus" || campusDirty || papers.length) {
      renderer.render(scene, camera); drawnFrames++; campusDirty = false;
    }
    requestAnimationFrame(frame);
  }
  frame();

  return {
    onCampusFrame: (fn) => { campusFrames.add(fn); return () => campusFrames.delete(fn); },
    setCampus, updateCampus: data => { campusScene.update(data); campusDirty = true; },
    // GitHub/CI 상태실(서버 모드에서 지표가 있을 때만): null이면 방 자체가 없고, "passing"|"running"|"failing"|"none"이면 랙 색이 정해진다.
    setCiStatus: (st) => { const v = st ?? null; if (v === ciStatus) return; const had = ciStatus != null; ciStatus = v; if (had !== (v != null) && lastState) { applyState(); resize(); } },
    setDayMode: (m) => { const v = m === "day" || m === "night" ? m : "auto"; if (v !== dayMode) { dayMode = v; applyDaylight(); } },
    setBuildingLook: (id, look) => { if (campusScene.setLook(id, look)) campusDirty = true; }, buildingAnchors, approachBuilding, cancelApproach, approaching: () => !!approach,
    onBuildingClick: (fn) => { buildingClicks.add(fn); return () => buildingClicks.delete(fn); },
    campusPick: (x, y) => hitBuilding({ clientX: x, clientY: y }),
    buildingHitPoints: () => { scene.updateMatrixWorld(true); const r = canvas.getBoundingClientRect(); return campusScene.hits().map(m => { const v = m.getWorldPosition(new THREE.Vector3()).project(camera); return { id: m.userData.projectId, x: r.left + (v.x + 1) * r.width / 2, y: r.top + (1 - v.y) * r.height / 2 }; }); },
    campusExtent: () => { const b = campusScene.layout.bounds; let extent = 0; for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, campusScene.maxHeight]) { const v = new THREE.Vector3(x, y, z).project(camera); extent = Math.max(extent, Math.abs(v.x), Math.abs(v.y)); } return extent; },
    campusInfo: () => ({ count: campusCount, drawnFrames, pixelRatio: renderer.getPixelRatio(), shadows: renderer.shadowMap.enabled, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, visibleDesks: [...desks.values()].filter(d => d.group.visible).length, walkers: walkLegs.count }),
    syncState, playEvent, setTeam, setView, getView, roomAnchors, onRoomClick,
    get paperCount() { return papers.length; },
    // 확인용: 보이는 책상마다 바닥 발자국(책상+의자) 네 모서리의 월드 x,z와 이름표 화면 사각형
    deskInfo: () => [...desks.values()].filter((d) => d.group.visible).map((d) => {
      d.group.updateMatrixWorld(true);
      const foot = [[-1.3, -0.8], [1.3, -0.8], [1.3, 1.5], [-1.3, 1.5]].map(([x, z]) => { const v = d.group.localToWorld(new THREE.Vector3(x, 0, z)); return [v.x, v.z]; });
      const r = d.el.getBoundingClientRect();
      return { id: d.id, foot, tag: { l: r.left, t: r.top, r: r.right, b: r.bottom } };
    }),
    deskSpan: () => span(canvas.clientWidth || 1280), // 확인용: 책상이 장면 가로에서 차지하는 비율과 좌우 픽셀
    dispose() {
      cancelApproach(); campusScene.dispose(); buildingClicks.clear(); campusFrames.clear(); running = false; removeEventListener("resize", resize); ro?.disconnect();
      canvas.removeEventListener("pointermove", pointerMove); canvas.removeEventListener("pointerleave", pointerLeave); canvas.removeEventListener("click", clickRoom);
      roomClicks.clear(); setHover(null); tagsRoot.remove(); renderer.dispose();
    },
  };
}
