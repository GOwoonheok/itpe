// E2E 핵심 3흐름 — 정적 서버 + 번들 데이터 폴백 위에서 실제 UI 검증.
// 운영 코드 무수정: 세션은 localStorage 시드, /api/login 만 스텁(로그인 흐름 테스트용).
// 각 단계 스크린샷을 test-results/screens/ 에 남겨 증빙으로 사용한다.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SCREENS = 'test-results/screens';
const index = JSON.parse(readFileSync('data/index.json', 'utf8'));
const firstUnit = index.units[0];

// 외부 폰트 CDN 차단 — 네트워크 비결정성 제거 (렌더링은 시스템 폰트로 진행)
async function blockExternal(context) {
    await context.route(/https:\/\/(cdn\.jsdelivr\.net|hangeul\.pstatic\.net)\/.*/, (r) => r.abort());
}

// 학습자(비관리자) 세션 시드 — 클라이언트 게이트(localStorage) 통과
async function seedSession(context, email = 'tester@example.com') {
    await context.addInitScript((e) => {
        localStorage.setItem('itpe.session', JSON.stringify({ email: e, since: Date.now() }));
    }, email);
}

test('① 로그인 — 이메일 제출 → 시트 목록(1~11 단원) 진입', async ({ page, context }) => {
    await blockExternal(context);
    // 서버 인증만 스텁 — 나머지 UI·리다이렉트는 실제 코드 그대로
    await context.route('**/api/login**', (r) =>
        r.fulfill({ json: { ok: true, admin: false } }));

    await page.goto('/login.html');
    await expect(page.locator('#login-email')).toBeVisible();
    await page.fill('#login-email', 'tester@example.com');
    await page.screenshot({ path: `${SCREENS}/1a-login.png` });

    await page.click('button[type=submit]');
    await page.waitForURL('**/index.html');

    const items = page.locator('.sheet-item');
    await expect(items.first()).toBeVisible();
    await expect(items).toHaveCount(index.units.length);   // data/index.json 의 단원 수와 일치
    await page.screenshot({ path: `${SCREENS}/1b-sheet-list.png`, fullPage: true });
});

test('② 단원 진입 — 1번 단원 클릭 → 모드 선택 첫 화면', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/index.html');
    await page.locator(`.sheet-item[data-unit-id="${firstUnit.id}"]`).click();
    await page.waitForURL(`**/flash.html?unit=${firstUnit.id}*`);

    await expect(page.locator('#mode-screen')).toBeVisible();
    await expect(page.locator('.mode-question')).toContainText('문제를 어떻게 진행하시겠습니까');
    await expect(page.locator('#study-screen')).toBeHidden();
    // 하단 툴바의 찾기 버튼이 첫 화면에서도 보여야 함
    await expect(page.locator('#btn-find')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/2-mode-screen.png` });
});

test('③ 찾기 점프 — 첫 화면에서 🔍 검색 → 카드 클릭 → 바로 해당 카드 표시', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto(`/flash.html?unit=${firstUnit.id}`);
    await expect(page.locator('#mode-screen')).toBeVisible();

    // 🔍 찾기 모달 열기
    await page.locator('#btn-find').click();
    await expect(page.locator('#find-modal')).toBeVisible();
    const firstItem = page.locator('#find-list .find-item').first();
    await expect(firstItem).toBeVisible();

    // 첫 카드의 토픽으로 검색 — 입력 즉시 조회(디바운스 120ms)
    const topic = (await firstItem.locator('.find-topic').textContent()).trim();
    await page.fill('#find-input', topic.slice(0, 6));
    await expect(page.locator('#find-list .find-item').first()).toContainText(topic.slice(0, 6));
    await page.screenshot({ path: `${SCREENS}/3a-find-search.png` });

    // 검색 결과 클릭 → 학습 화면으로 전환 + 해당 카드 표시 (2026-06-06 수정 기능)
    await page.locator('#find-list .find-item').first().click();
    await expect(page.locator('#find-modal')).toBeHidden();
    await expect(page.locator('#study-screen')).toBeVisible();
    await expect(page.locator('#mode-screen')).toBeHidden();
    await expect(page.locator('#sec-topic')).toContainText(topic.slice(0, 6));
    // URL 에 mode=sequence 반영 (새로고침 유지 보장)
    expect(page.url()).toContain('mode=sequence');
    await page.screenshot({ path: `${SCREENS}/3b-card-shown.png` });
});
