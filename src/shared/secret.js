// 토큰·키·이메일처럼 보이는 문자열 감지. update.js와 server.js가 같은 규칙을 쓴다.
const PATTERNS = [/sk-[A-Za-z0-9_-]{16,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{20,}/, /xox[abp]-[A-Za-z0-9-]{10,}/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /[A-Za-z0-9+/=_-]{40,}/, /[\w.+-]+@[\w-]+\.[\w.-]+/];
export const looksSecret = (t) => PATTERNS.some((re) => re.test(t));
