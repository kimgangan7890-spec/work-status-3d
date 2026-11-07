/** 자기 속성일 때만 값을 돌려준다. id·상태처럼 데이터에서 온 키로 조회할 때 constructor·__proto__·toString 같은 프로토타입 값이 새지 않게 한다. */
export function own(obj, key, fallback) {
  return typeof key === "string" && Object.hasOwn(obj, key) ? obj[key] : fallback;
}
