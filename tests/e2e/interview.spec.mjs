// 면접 모드 E2E — 정적 서버 + 번들 데이터 폴백 위에서 실제 UI 검증.
// 운영 코드 무수정: 세션은 localStorage 시드(클라이언트 게이트 통과), /api/* 는 404 → 폴백.
// 각 단계 스크린샷을 test-results/screens/ 에 남겨 증빙으로 사용한다.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SCREENS = 'test-results/screens';
const manifest = JSON.parse(readFileSync('data/interview/index.json', 'utf8'));
const career = JSON.parse(readFileSync('data/interview/career.json', 'utf8'));
const expected = JSON.parse(readFileSync('data/interview/expected.json', 'utf8'));
const total = career.length + expected.length;

async function blockExternal(context) {
    await context.route(/https:\/\/(cdn\.jsdelivr\.net|hangeul\.pstatic\.net)\/.*/, (r) => r.abort());
}
async function seedSession(context, email = 'tester@example.com') {
    await context.addInitScript((e) => {
        localStorage.setItem('itpe.session', JSON.stringify({ email: e, since: Date.now() }));
    }, email);
}

test('① 홈 진입 버튼 — index.html 의 "면접 대비" → interview.html', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/index.html');
    const entry = page.locator('.interview-entry');
    await expect(entry).toBeVisible();
    // 기존 단원 목록도 그대로 존재(홈 회귀 방지)
    await expect(page.locator('.sheet-item').first()).toBeVisible();

    await entry.click();
    await page.waitForURL('**/interview.html');
    await expect(page.locator('#iv-mode-list .iv-mode-card').first()).toBeVisible();
});

test('② 모드 선택 — 카테고리 3장(이력기반·예상토픽·전체) 노출 + 총 문항수', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview.html');
    const cards = page.locator('#iv-mode-list .iv-mode-card');
    await expect(cards).toHaveCount(manifest.categories.length + 3);   // 카테고리 + 전체·선택토픽·소개하기
    await expect(page.locator('.iv-mode-card', { hasText: '이력연계' })).toBeVisible();
    await expect(page.locator('.iv-mode-card', { hasText: '예상토픽' })).toBeVisible();
    await expect(page.locator('.iv-mode-card', { hasText: '선택토픽' })).toBeVisible();
    await expect(page.locator('.iv-mode-card', { hasText: '소개하기' })).toBeVisible();
    await expect(page.locator('#iv-foot')).toContainText(`총 ${total}문항`);
    await page.screenshot({ path: `${SCREENS}/iv-1-modes.png`, fullPage: true });
});

test('③ 학습 → 정답 공개 → 다음 — 4단 구술 템플릿 노출 + URL 유지', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview.html');
    await page.locator('.iv-mode-card', { hasText: '이력연계' }).click();

    // 학습 화면 진입 — 질문 노출, 정답은 숨김
    await expect(page.locator('#iv-study-screen')).toBeVisible();
    await expect(page.locator('#iv-question')).not.toBeEmpty();
    await expect(page.locator('#iv-answer')).toBeHidden();
    await expect(page.locator('#iv-progress-num')).toContainText(`/ ${career.length}`);
    expect(page.url()).toContain('cat=career');
    await page.screenshot({ path: `${SCREENS}/iv-2-card.png`, fullPage: true });

    // 정답 보기 → 4단 템플릿
    await page.locator('#iv-reveal').click();
    await expect(page.locator('#iv-answer')).toBeVisible();
    await expect(page.locator('#iv-answer')).toContainText('복명복창');
    await expect(page.locator('#iv-answer')).toContainText('실사례');
    await expect(page.locator('#iv-answer .iv-part').first()).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/iv-3-revealed.png`, fullPage: true });

    // 다음 → 인덱스 이동 + 정답 다시 숨김
    await page.locator('#iv-next').click();
    await expect(page.locator('#iv-progress-num')).toContainText(`2 / ${career.length}`);
    await expect(page.locator('#iv-answer')).toBeHidden();
    expect(page.url()).toContain('cat=career');
});

test('④ 정답 공개 시 키워드 칩 노출 (회독 앵커)', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview.html');
    await page.locator('.iv-mode-card', { hasText: '이력연계' }).click();
    await page.locator('#iv-reveal').click();
    // keywords 가 있는 문항이면 칩이 4단 답변 뒤에 표시됨
    const hasKw = career.some((it) => Array.isArray(it.keywords) && it.keywords.length);
    if (hasKw) {
        await expect(page.locator('#iv-answer .iv-keywords .iv-kw').first()).toBeVisible();
    }
    await page.screenshot({ path: `${SCREENS}/iv-4-keywords.png`, fullPage: true });
});

test('⑤ 선택토픽 — ★ 북마크 후 선택토픽 카드로 재학습', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview.html');
    await page.locator('.iv-mode-card', { hasText: '이력연계' }).click();

    // ★ 토글 → 활성화
    const star = page.locator('#iv-bookmark');
    await expect(star).toHaveText('☆');
    await star.click();
    await expect(star).toHaveText('★');

    // 홈 → 선택토픽 카드 카운트 1
    await page.locator('#iv-home').click();
    const bmCard = page.locator('.iv-mode-card', { hasText: '선택토픽' });
    await expect(bmCard).toContainText('1문항');
    await page.screenshot({ path: `${SCREENS}/iv-5-bookmark.png`, fullPage: true });

    // 선택토픽 진입 → 1문항만
    await bmCard.click();
    await expect(page.locator('#iv-cat-title')).toContainText('선택토픽');
    await expect(page.locator('#iv-progress-num')).toContainText('/ 1');
    expect(page.url()).toContain('cat=bookmarks');
});

test('⑥ 소개하기 — 입력 자동 저장 + 새로고침 유지', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview.html');
    await page.locator('.iv-mode-card', { hasText: '소개하기' }).click();
    await expect(page.locator('#iv-intro-screen')).toBeVisible();

    const firstTa = page.locator('.iv-intro-ta').first();
    await expect(firstTa).toBeVisible();
    await firstTa.fill('테스트 자기소개 문장입니다.');
    await page.screenshot({ path: `${SCREENS}/iv-6-intro.png`, fullPage: true });

    // 새로고침 후에도 유지 (localStorage) — 딥링크 ?intro=1 복원
    await page.reload();
    await expect(page.locator('.iv-intro-ta').first()).toHaveValue('테스트 자기소개 문장입니다.');
});
