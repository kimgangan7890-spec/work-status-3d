import * as THREE from "three";

// 하늘·해/달·별·창밖 도시 실루엣(DESIGN7 부록 D). 형상은 한 번만 만들고 update(daylight)는 색·투명도만 바꾼다.
// 층·단지는 지평선 아래를 내려다보는 조감(피치 32~41°)이라 하늘 그라데이션을 그 시야 범위에 맞춰 "뒤 배경"으로 읽히게 한다.
const DOME_R = 450, RANGE = [-0.8, -0.25]; // 조감 카메라가 보는 방향의 고도(sin) 범위: 화면 아래 = 아래색, 위 = 위색
// 지면에 붙은 낮은 블록 실루엣 띠 3겹(멀수록 낮고 옅다). 층 바닥판의 뒤쪽 두 변(위·오른쪽)을 따라 직선으로 선다.
const CITY_LAYERS = [{ gap: 7, h: 7, day: 0x5d7396, haze: 0.28 }, { gap: 19, h: 5.5, day: 0x7288aa, haze: 0.5 }, { gap: 33, h: 4.2, day: 0x8ea1bf, haze: 0.72 }];

function cityTexture() { // 절차적 캔버스 1장: 회색 실루엣 + 노란 창 점(밤에만 켜짐). 아래쪽은 투명하게 흐려져 배경 안개에 녹는다.
  const c = globalThis.document?.createElement("canvas"), g = c?.getContext?.("2d");
  if (!g) return null;
  c.width = 512; c.height = 128;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = "#e6e6e6";
  const wins = [];
  for (let x = 0; x < 512;) {
    const w = 14 + Math.floor(rnd() * 26), h = 36 + Math.floor(rnd() * 84);
    g.fillRect(x, 128 - h, w - 2, h);
    if (rnd() < 0.3) g.fillRect(x + 4, 128 - h - 8, w - 10, 8);
    for (let wy = 128 - h + 6; wy < 118; wy += 8) for (let wx = x + 3; wx < x + w - 5; wx += 6) if (rnd() < 0.55) wins.push([wx, wy]);
    x += w;
  }
  g.fillStyle = "#ffd77a"; for (const [wx, wy] of wins) g.fillRect(wx, wy, 3, 4);
  g.globalCompositeOperation = "destination-in";
  const fade = g.createLinearGradient(0, 0, 0, 128); fade.addColorStop(0, "#fff"); fade.addColorStop(0.62, "#fff"); fade.addColorStop(1, "rgba(255,255,255,0.08)");
  g.fillStyle = fade; g.fillRect(0, 0, 512, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(3.5, 1);
  return tex;
}

export function createSky() {
  const group = new THREE.Group(); group.visible = false;
  const disposables = [];
  const own = (o) => { disposables.push(o); return o; };
  // 하늘 구(2색 그라데이션)
  const uTop = { value: new THREE.Color() }, uBottom = { value: new THREE.Color() };
  const domeMat = own(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uTop, uBottom },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vDir; void main(){ float t = smoothstep(${RANGE[0]}, ${RANGE[1]}, vDir.y); gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);\n#include <colorspace_fragment>\n}`,
  }));
  const domeGeo = own(new THREE.SphereGeometry(DOME_R, 24, 16));
  const dome = new THREE.Mesh(domeGeo, domeMat); dome.renderOrder = -10; dome.frustumCulled = false; group.add(dome);
  // 해/달 원판 하나
  const bodyMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthTest: false, depthWrite: false })), bodyGeo = own(new THREE.CircleGeometry(1, 28));
  const body = new THREE.Mesh(bodyGeo, bodyMat); body.renderOrder = -9; body.frustumCulled = false; body.scale.setScalar(8); group.add(body);
  // 별 Points 1개(지평선 아래~조금 위 범위에 흩뿌려 조감에서도 보인다)
  const N = 260, pos = new Float32Array(N * 3); let s = 11; const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) { const a = rnd() * Math.PI * 2, y = RANGE[0] + rnd() * (RANGE[1] - RANGE[0]), r = Math.sqrt(1 - y * y), R = DOME_R * 0.96; pos.set([Math.sin(a) * r * R, y * R, Math.cos(a) * r * R], i * 3); }
  const starGeo = own(new THREE.BufferGeometry()); starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const starMat = own(new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthTest: false, depthWrite: false }));
  const stars = new THREE.Points(starGeo, starMat); stars.renderOrder = -8; stars.frustumCulled = false; stars.visible = false; group.add(stars);
  // 창밖 도시: 카메라 반대쪽 호(arc) 3겹. 텍스처 1장 공유, 창 점은 uNight로 켜진다.
  const tex = cityTexture(), uNight = { value: 0 }, layerMats = [], layers = [];
  const city = new THREE.Group(); group.add(city);
  const plane = own(new THREE.PlaneGeometry(1, 1));
  // 바닥판 바깥 지면(건물 띠가 서 있는 땅). 시간대 색은 update()가 칠한다.
  const groundMat = own(new THREE.MeshBasicMaterial({ color: 0x7d8a82, fog: false })), ground = new THREE.Mesh(plane, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.scale.set(900, 900, 1); ground.frustumCulled = false; city.add(ground);
  for (const L of CITY_LAYERS) {
    const m = own(new THREE.MeshBasicMaterial({ color: L.day, map: tex ?? undefined, alphaTest: 0.5, side: THREE.DoubleSide, fog: false }));
    if (tex) m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = uNight;
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight; float cityWin = 0.0;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ncityWin = step(0.28, texture2D(map, vMapUv).r - texture2D(map, vMapUv).b);")
        .replace("#include <opaque_fragment>", "outgoingLight = mix(outgoingLight, vec3(1.0, 0.84, 0.45), cityWin * uNight);\n#include <opaque_fragment>");
    };
    m.customProgramCacheKey = () => "sky-city-v1";
    const top = new THREE.Mesh(plane, m), right = new THREE.Mesh(plane, m); // 위 변 · 오른쪽 변
    right.rotation.y = -Math.PI / 2; top.frustumCulled = right.frustumCulled = false; city.add(top, right);
    layerMats.push(m); layers.push({ top, right, L });
  }
  const tmp = new THREE.Color(), dayBase = new THREE.Color(), nightBase = new THREE.Color(0x1a2038), haze = new THREE.Color();
  
  return {
    group, bodyMesh: body,
    /** 하늘 색·해/달·별·도시 색을 바꾼다(분당 1회). 형상 재생성 없음. */
    update(d) {
      uTop.value.setHex(d.skyTop); uBottom.value.setHex(d.skyBottom);
      bodyMat.color.setHex(d.body.color).lerp(tmp.setHex(0xffffff), d.body.kind === "sun" ? 0.25 : 0.1);
      starMat.opacity = d.stars; stars.visible = d.stars > 0.01;
      uNight.value = d.night; haze.setHex(d.skyBottom);
      groundMat.color.setHex(0x7d8a82).lerp(nightBase, d.night * 0.85).lerp(haze, 0.2);
      layerMats.forEach((m, i) => { const L = CITY_LAYERS[i]; dayBase.setHex(L.day); m.color.copy(dayBase).lerp(nightBase, d.night * 0.85).lerp(haze, L.haze * (1 - 0.3 * d.night)); });
      this.body = d.body;
    },
    /** 바닥판 경계(월드). 위(-z)·오른쪽(+x) 바깥 지면에 띠를 세운다(화면 레이아웃이 바뀔 때만). */
    setExtent(minX, maxX, minZ, maxZ) {
      ground.position.set((minX + maxX) / 2, -0.45, (minZ + maxZ) / 2);
      layers.forEach(({ top, right, L }) => {
        const x0 = minX - L.gap, x1 = maxX + L.gap, z0 = minZ - L.gap, z1 = maxZ + L.gap;
        top.scale.set(x1 - x0, L.h, 1); top.position.set((x0 + x1) / 2, L.h / 2 - 0.4, z0);
        right.scale.set(z1 - z0, L.h, 1); right.position.set(x1, L.h / 2 - 0.4, (z0 + z1) / 2);
      });
    },
    /** 구는 카메라를 따라가고, 해/달은 화면 위쪽 왼쪽 귀퉁이에 작게 둔다. 매 프레임 호출(행렬 몇 개). */
    follow(camera, showCity) {
      dome.position.copy(camera.position); stars.position.copy(camera.position);
      const b = this.body; if (b) {
        const R = DOME_R * 0.9, hh = R * Math.tan((camera.fov * Math.PI) / 360), e = camera.matrixWorld.elements;
        const fx = -e[8], fy = -e[9], fz = -e[10], rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6];
        const sx = -0.8 * camera.aspect * hh, sy = (0.74 + 0.1 * b.height) * hh; // 높이 1 = 더 위
        body.position.set(camera.position.x + fx * R + rx * sx + ux * sy, camera.position.y + fy * R + ry * sx + uy * sy, camera.position.z + fz * R + rz * sx + uz * sy); body.lookAt(camera.position);
      }
      city.visible = showCity;
    },
    dispose() { disposables.forEach((o) => o.dispose()); tex?.dispose(); },
  };
}
