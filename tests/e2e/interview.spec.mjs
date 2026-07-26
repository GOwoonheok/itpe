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

// 음성 엔진 스텁 — 헤드리스에는 한국어 음성이 없으므로 speak() 호출 내용만 기록한다.
// js/tts.js 로드 전에 주입되어야 래퍼가 이 스텁을 잡는다(addInitScript 는 문서 스크립트보다 먼저 실행).
async function stubSpeech(context) {
    await context.addInitScript(() => {
        window.__spoken = [];
        const synth = window.speechSynthesis;
        if (!synth) return;
        synth.speak = (u) => {
            window.__spoken.push(String(u.text || ''));
            if (typeof u.onend === 'function') setTimeout(() => u.onend(), 5);
        };
        synth.cancel = () => {};
        synth.resume = () => {};
    });
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
    await expect(cards).toHaveCount(manifest.categories.length + 4);   // 카테고리 + 전체·선택토픽·소개하기·인쇄하기
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

test('⑥ 소개하기 — 카드 넘김 + ✏ 편집 자동 저장 + 새로고침 유지', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview.html');
    await page.locator('.iv-mode-card', { hasText: '소개하기' }).click();
    await expect(page.locator('#iv-intro-screen')).toBeVisible();

    // 카드 형태 — 한 번에 한 섹션, 기본은 읽기 모드(편집상자 없음)
    await expect(page.locator('#iv-intro-num')).toHaveText('1 / 4');
    await expect(page.locator('#iv-intro-card .iv-intro-body')).toBeVisible();
    await expect(page.locator('.iv-intro-ta')).toHaveCount(0);
    await expect(page.locator('#iv-intro-prev')).toBeDisabled();
    await page.screenshot({ path: `${SCREENS}/iv-6-intro.png`, fullPage: true });

    // 다음 카드
    await page.locator('#iv-intro-next').click();
    await expect(page.locator('#iv-intro-num')).toHaveText('2 / 4');

    // ✏ → 그 자리에서 편집 (자동 저장)
    await page.locator('#iv-intro-edit').click();
    const ta = page.locator('.iv-intro-ta');
    await expect(ta).toBeVisible();
    await ta.fill('테스트 포부 문장입니다.');
    await page.screenshot({ path: `${SCREENS}/iv-6b-intro-edit.png`, fullPage: true });

    // 새로고침 후에도 유지 (localStorage) — 딥링크 ?intro=1 복원, 읽기 모드로 복귀
    await page.reload();
    await expect(page.locator('#iv-intro-num')).toHaveText('1 / 4');
    await page.locator('#iv-intro-next').click();
    await expect(page.locator('#iv-intro-card .iv-intro-body')).toContainText('테스트 포부 문장입니다.');
});

test('⑦ 인쇄 — 회독 요약본(2단) 렌더 + 블록 목차 페이지번호', async ({ page, context }) => {
    test.setTimeout(120_000);   // Paged.js 지면 분할은 문항 수에 비례해 오래 걸린다
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview-print.html?cat=career&density=brief');
    // Paged.js 분할 완료 신호
    await expect(page.locator('body[data-ivp-ready="1"]')).toBeAttached({ timeout: 110_000 });

    // 문항이 전역 연번과 함께 렌더 — 이력연계는 1번부터
    await expect(page.locator('.ivp-item').first()).toBeVisible();
    await expect(page.locator('.ivp-item')).toHaveCount(career.length);
    await expect(page.locator('.ivp-item .ivp-n').first()).toHaveText('1');
    await expect(page.locator('.ivp-item.is-brief').first()).toBeVisible();

    // 블록 목차에 실제 페이지번호가 채워졌는지 (Paged.js 성공 시)
    const firstPage = page.locator('.ivp-toc-entry .ivp-toc-page').first();
    await expect(firstPage).not.toBeEmpty();

    // 지면 분할 후에도 도구막대가 화면에 남아야 한다
    // (Paged.js 가 전달받은 시트의 @media print 를 화면에도 적용 → 크롬 CSS 는 별도 시트로 분리)
    await expect(page.locator('#ivp-toolbar')).toBeVisible();
    await expect(page.locator('#ivp-print')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/iv-7-print-brief.png`, fullPage: true });

    // 형식 전환(도구막대) — 같은 URL 로 재진입해 상세 답변집이 선택 상태가 되는지
    await page.locator('.ivp-seg button[data-density="full"]').click();
    await page.waitForURL(/density=full/);
    await expect(page.locator('body[data-ivp-ready="1"]')).toBeAttached({ timeout: 110_000 });
    await expect(page.locator('.ivp-seg button[data-density="full"]')).toHaveClass(/is-on/);
});

test('⑧ 인쇄 — 상세 답변집(1단)에 4단 답변 + 압박 대응 수록', async ({ page, context }) => {
    test.setTimeout(120_000);
    await blockExternal(context);
    await seedSession(context);

    await page.goto('/interview-print.html?cat=career&density=full');
    await expect(page.locator('body[data-ivp-ready="1"]')).toBeAttached({ timeout: 110_000 });

    const first = page.locator('.ivp-item').first();
    await expect(first).toContainText('복명복창');
    await expect(first).toContainText('실사례');
    await expect(page.locator('.ivp-guard-h').first()).toContainText('면접관 압박 대응');
    await page.screenshot({ path: `${SCREENS}/iv-8-print-full.png`, fullPage: true });
});

test('⑨ TTS — 문항 질문·답변 낭독이 음성엔진으로 전달', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);
    await stubSpeech(context);

    await page.goto('/interview.html');
    await page.locator('.iv-mode-card', { hasText: '이력연계' }).click();

    // 낭독 바 노출 — 답변은 정답 공개 전이라 비활성
    await expect(page.locator('#iv-tts')).toBeVisible();
    await expect(page.locator('#iv-tts-a')).toBeDisabled();

    // 낭독은 조각을 이어서 비동기로 넘긴다 — 누적될 때까지 폴링
    const spokenLen = () => page.evaluate(() => window.__spoken.join('').replace(/\s+/g, '').length);
    const spokenAll = async () =>
        (await page.evaluate(() => window.__spoken.join(''))).replace(/\s+/g, '');

    // 질문 낭독 — 조각으로 쪼개져도 합치면 원문 그대로
    const question = (await page.locator('#iv-question').textContent()).replace(/\s+/g, '');
    await page.locator('#iv-tts-q').click();
    await expect.poll(spokenLen).toBe(question.length);
    expect(await spokenAll()).toBe(question);

    // 정답 공개 → 답변 낭독 활성 → 4단이 순서대로(복명복창부터) 전달
    await page.evaluate(() => { window.__spoken = []; });
    await page.locator('#iv-reveal').click();
    await expect(page.locator('#iv-tts-a')).toBeEnabled();
    // 화면의 4단 본문을 이어붙인 것과 낭독 텍스트가 정확히 일치해야 한다(분량에 의존하지 않는 검증)
    const parts = await page.locator('.iv-part .iv-part-body').allTextContents();
    const answer = parts.join('').replace(/\s+/g, '');
    expect(parts.length).toBeGreaterThanOrEqual(4);   // 복명복창·구조화·개념·실사례
    await page.locator('#iv-tts-a').click();
    await expect.poll(spokenLen, { timeout: 15_000 }).toBe(answer.length);
    expect(await spokenAll()).toBe(answer);
    await page.screenshot({ path: `${SCREENS}/iv-9-tts.png`, fullPage: true });

    // 카드를 넘기면 낭독은 멈춘다
    await page.evaluate(() => { window.__spoken = []; });
    await page.locator('#iv-next').click();
    await expect(page.locator('#iv-tts-q')).toHaveText('🔊 질문');
});

test('⑩ TTS — 소개하기 카드 듣기 + 속도 설정 저장', async ({ page, context }) => {
    await blockExternal(context);
    await seedSession(context);
    await stubSpeech(context);

    await page.goto('/interview.html?intro=1');
    await expect(page.locator('#iv-intro-screen')).toBeVisible();

    // 속도 변경 → localStorage 에 기억
    await page.locator('#iv-intro-card select').selectOption('1.2');
    expect(await page.evaluate(() => localStorage.getItem('iv:ttsRate'))).toBe('1.2');

    // 현재 카드 본문이 낭독 대상
    const body = (await page.locator('#iv-intro-card .iv-intro-body').textContent()).replace(/\s+/g, '');
    await page.locator('#iv-intro-speak').click();
    await expect
        .poll(() => page.evaluate(() => window.__spoken.join('').replace(/\s+/g, '').length), { timeout: 15_000 })
        .toBe(body.length);
    expect((await page.evaluate(() => window.__spoken.join(''))).replace(/\s+/g, '')).toBe(body);
});
