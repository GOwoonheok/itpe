#!/usr/bin/env node
// 워크플로우 생성 결과(scratchpad/gen/*.json) → data/interview/{career,expected}.json 주입 + 품질 린트.
// 무의존성. 커밋 대상 아님(작업용 스크립트) — 사용법:
//   node scripts/build-interview-from-gen.mjs <genDir> [--dry]
//
// 하는 일
//  1) 그룹 파일을 정해진 순서로 합친다(이력연계 c1~c7 → career, 예상토픽 t1~t10 → expected).
//  2) id/category 를 부여한다 (career-0001…, expected-0001…).
//  3) 길이·필수필드·중복 린트를 돌려 리포트한다. 오류가 있으면 종료코드 1.

import fs from 'node:fs';
import path from 'node:path';

const GEN = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!GEN) { console.error('사용법: node scripts/build-interview-from-gen.mjs <genDir> [--dry]'); process.exit(2); }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'data', 'interview');

const GROUPS = {
    career: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
    expected: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'],
};
const LABEL = { career: '이력연계', expected: '예상토픽' };
const LIMIT = { restate: 45, structure: 40, concept: 190, case: 110 };
const TOTAL_LIMIT = 340;

const FORBIDDEN = [
    '차세대', '950억', '나라장터', '화재', '7조원', '상담콜', 'vLLM',
    'PagedAttention', '페이지드어텐션', 'CCB', '사업자 이탈', '공공AX',
];

// c7 그룹이 block 을 5개로 쪼개 반환하는 경우가 있다 — 인쇄 목차가 1문항짜리 항목으로
// 잘게 갈리므로 이력연계의 마지막 블록 하나로 합친다.
const BLOCK_MERGE = {
    '자격': '자격·경력총괄·지원동기·포부·윤리',
    '경력총괄': '자격·경력총괄·지원동기·포부·윤리',
    '지원동기': '자격·경력총괄·지원동기·포부·윤리',
    '포부': '자격·경력총괄·지원동기·포부·윤리',
    '윤리': '자격·경력총괄·지원동기·포부·윤리',
    '자격·경력·지원동기·포부·윤리': '자격·경력총괄·지원동기·포부·윤리',
};

function load(key) {
    const p = path.join(GEN, key + '.json');
    if (!fs.existsSync(p)) return { key, items: [], missing: true };
    let raw;
    try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { return { key, items: [], parseError: e.message }; }
    const items = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
    return { key, items };
}

const errors = [];
const warns = [];
const out = {};

for (const [cat, keys] of Object.entries(GROUPS)) {
    const items = [];
    for (const key of keys) {
        const g = load(key);
        if (g.missing) { errors.push(`${key}.json 없음`); continue; }
        if (g.parseError) { errors.push(`${key}.json 파싱 실패 — ${g.parseError}`); continue; }
        if (!g.items.length) { errors.push(`${key}.json 문항 0개`); continue; }
        items.push(...g.items);
    }
    out[cat] = items.map((it, i) => ({
        id: `${cat}-${String(i + 1).padStart(4, '0')}`,
        category: LABEL[cat],
        block: BLOCK_MERGE[String(it.block || '').trim()] || String(it.block || ''),
        kind: String(it.kind || '1차질문'),
        prob: Number.isFinite(it.prob) ? it.prob : 60,
        question: String(it.question || '').trim(),
        restate: String(it.restate || '').trim(),
        structure: String(it.structure || '').trim(),
        concept: String(it.concept || '').trim(),
        case: String(it.case || '').trim(),
        keywords: Array.isArray(it.keywords) ? it.keywords.filter(Boolean).map(String) : [],
        followupGuard: Array.isArray(it.followupGuard) ? it.followupGuard.filter(Boolean).map(String) : [],
        pitfall: String(it.pitfall || '').trim(),
        references: Array.isArray(it.references) ? it.references.filter(Boolean).map(String) : [],
    }));
}

// ── 린트 ──────────────────────────────────────────────
for (const [cat, items] of Object.entries(out)) {
    const seenQ = new Set();
    for (const it of items) {
        const where = `${it.id}`;
        for (const f of ['question', 'restate', 'structure', 'concept', 'case', 'pitfall']) {
            if (!it[f]) errors.push(`${where} ${f} 비어 있음`);
        }
        if (!it.keywords.length) errors.push(`${where} keywords 비어 있음`);
        for (const [f, max] of Object.entries(LIMIT)) {
            if (it[f].length > max) warns.push(`${where} ${f} ${it[f].length}자 (상한 ${max})`);
        }
        const total = it.restate.length + it.structure.length + it.concept.length + it.case.length;
        if (total > TOTAL_LIMIT) warns.push(`${where} 답변 합계 ${total}자 (상한 ${TOTAL_LIMIT}) — ${it.question.slice(0, 30)}…`);
        const blob = [it.question, it.restate, it.structure, it.concept, it.case, it.pitfall,
            it.keywords.join(' '), it.followupGuard.join(' ')].join(' ');
        for (const bad of FORBIDDEN) {
            if (blob.includes(bad)) errors.push(`${where} 금지 표현 '${bad}' 포함`);
        }
        const norm = it.question.replace(/\s+/g, '').slice(0, 40);
        if (seenQ.has(norm)) warns.push(`${where} 질문 중복 의심 — ${it.question.slice(0, 40)}…`);
        seenQ.add(norm);
    }
}

// ── 리포트 ────────────────────────────────────────────
const stat = (items, f) => {
    const ns = items.map((it) => it[f].length).sort((a, b) => a - b);
    if (!ns.length) return '-';
    const avg = Math.round(ns.reduce((s, n) => s + n, 0) / ns.length);
    return `${ns[0]}~${ns[ns.length - 1]} (평균 ${avg})`;
};
for (const [cat, items] of Object.entries(out)) {
    const totals = items.map((it) => it.restate.length + it.structure.length + it.concept.length + it.case.length);
    const avgT = totals.length ? Math.round(totals.reduce((s, n) => s + n, 0) / totals.length) : 0;
    console.log(`\n■ ${LABEL[cat]} — ${items.length}문항`);
    console.log(`  복명복창 ${stat(items, 'restate')} · 구조화 ${stat(items, 'structure')}`);
    console.log(`  개념 ${stat(items, 'concept')} · 실사례 ${stat(items, 'case')}`);
    console.log(`  답변 합계 ${totals.length ? Math.min(...totals) + '~' + Math.max(...totals) : '-'} (평균 ${avgT}자 ≈ ${(avgT / 5.5).toFixed(0)}초)`);
    const blocks = {};
    items.forEach((it) => { blocks[it.block] = (blocks[it.block] || 0) + 1; });
    Object.entries(blocks).forEach(([b, n]) => console.log(`   - ${b}: ${n}`));
}

console.log('');
if (warns.length) { console.log(`⚠ 경고 ${warns.length}건`); warns.slice(0, 40).forEach((w) => console.log('  ' + w)); }
if (errors.length) { console.log(`✖ 오류 ${errors.length}건`); errors.slice(0, 40).forEach((e) => console.log('  ' + e)); }

if (errors.length) { console.log('\n오류가 있어 주입하지 않았습니다.'); process.exit(1); }
if (DRY) { console.log('\n(--dry) 주입하지 않았습니다.'); process.exit(0); }

for (const [cat, items] of Object.entries(out)) {
    fs.writeFileSync(path.join(OUT, cat + '.json'), JSON.stringify(items, null, 2) + '\n', 'utf8');
    console.log(`✔ data/interview/${cat}.json — ${items.length}문항`);
}
