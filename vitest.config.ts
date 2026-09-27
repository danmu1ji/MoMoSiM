import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 빌드 산출물(dist)의 복사본은 테스트 대상이 아니다 — 소스만 돈다.
    exclude: ['**/node_modules/**', '**/dist/**', '**/target/**'],
  },
});
