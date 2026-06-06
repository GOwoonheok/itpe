// Playwright E2E 설정 — 정적 서버 위에서 실제 UI 흐름 검증 + 스크린샷 증빙.
// API 는 정적 서버가 404 → 프런트의 번들 폴백 경로로 동작 (운영 코드 무수정).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    outputDir: 'test-results',
    timeout: 30_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['github']] : [['list']],
    use: {
        baseURL: 'http://localhost:4173',
        // 서비스워커 캐시가 테스트 간 간섭하지 않도록 차단
        serviceWorkers: 'block',
        screenshot: 'only-on-failure',
        ...devices['Pixel 7'],   // 모바일 우선 앱 — 폰 뷰포트 기준
    },
    webServer: {
        command: 'node scripts/serve-static.mjs',
        port: 4173,
        reuseExistingServer: !process.env.CI,
    },
});
