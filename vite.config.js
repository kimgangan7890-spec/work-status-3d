import { defineConfig } from "vite";
// --mode public: 정적 공개판. 샘플 데이터(public-sample)만 복사하고, 서버 호출·지시 기능은 끈다.
export default defineConfig(({ mode }) => ({
  base: "./",
  publicDir: mode === "public" ? "public-sample" : "public",
  define: { __PUBLIC__: JSON.stringify(mode === "public") },
  server: { port: 5174, host: "127.0.0.1" },
  test: { include: ["test/**/*.test.js"] },
}));
