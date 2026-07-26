#!/usr/bin/env node
// 워크플로우 생성 결과(scratchpad/cards/*.json) → data/cards/<unit>.json 주입.
// 무의존성. 작업용 스크립트 — 사용법:
//   node scripts/build-cards-from-gen.mjs <genDir> <unitFile> [--dry]
//   예) node scripts/build-cards-from-gen.mjs .../cards 12.json
//
// 기존 파일이 있으면 **덮어쓰지 않고 뒤에 이어붙인다**(topic 기준 중복 제외).

import fs from 'node:fs';
import path from 'node:path';

const GEN = process.argv[2];
const UNIT = process.argv[3];
const DRY = process.argv.includes('--dry');
if (!GEN || !UNIT) {
    console.error('사용법: node scripts/build-cards-from-gen.mjs <genDir> <unitFile.json> [--dry]');
    process.exit(2);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const TARGET = path.join(ROOT, 'data', 'cards', UNIT);
const ORDER = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'];

const errors = [];
const warns = [];
const fresh = [];

for (const key of ORDER) {
    const p = path.join(GEN, key + '.json');
    if (!fs.existsSync(p)) { errors.push(`${key}.json 없음`); continue; }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { errors.push(`${key}.json 파싱 실패 — ${e.message}`); continue; }
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.cards) ? raw.cards : []);
    if (!arr.length) { errors.push(`${key}.json 카드 0장`); continue; }
    arr.forEach((c) => fresh.push({ key, c }));
}

// ── 린트 ──────────────────────────────────────────────
const seen = new Set();
for (const { key, c } of fresh) {
    const t = String(c.topic || '').trim();
    const where = `${key}/${t.slice(0, 24)}`;
    if (!t) errors.push(`${key} topic 비어 있음`);
    if (!String(c.definition || '').trim()) errors.push(`${where} definition 비어 있음`);
    if (!String(c.mnemonic || '').trim()) errors.push(`${where} mnemonic 비어 있음`);
    if (!String(c.keyword || '').trim()) errors.push(`${where} keyword 비어 있음`);
    if (!String(c.category || '').trim()) errors.push(`${where} category 비어 있음`);
    const dl = String(c.definition || '').length;
    if (dl > 60) warns.push(`${where} definition ${dl}자 (권장 25~45)`);
    const ml = String(c.mnemonic || '').length;
    if (ml > 320) warns.push(`${where} mnemonic ${ml}자 (권장 150~260)`);
    if (ml < 80) warns.push(`${where} mnemonic ${ml}자 — 너무 짧음`);
    const kn = String(c.keyword || '').split(',').filter((x) => x.trim()).length;
    if (kn < 4) warns.push(`${where} keyword ${kn}개 — 너무 적음`);
    const norm = t.replace(/\s+/g, '').toLowerCase();
    if (seen.has(norm)) warns.push(`${where} topic 중복`);
    seen.add(norm);
}

// ── 기존 카드와 병합 ──────────────────────────────────
let existing = [];
if (fs.existsSync(TARGET)) {
    try { existing = JSON.parse(fs.readFileSync(TARGET, 'utf8')); }
    catch (e) { errors.push(`기존 ${UNIT} 파싱 실패 — ${e.message}`); }
    if (!Array.isArray(existing)) existing = [];
}
const existingTopics = new Set(existing.map((c) => String(c.topic || '').replace(/\s+/g, '').toLowerCase()));

const stamp = Date.now();
let seq = 0;
const added = [];
for (const { c } of fresh) {
    const norm = String(c.topic || '').replace(/\s+/g, '').toLowerCase();
    if (existingTopics.has(norm)) { warns.push(`기존 카드와 중복이라 건너뜀 — ${c.topic}`); continue; }
    existingTopics.add(norm);
    seq++;
    added.push({
        category: String(c.category || '').trim(),
        topic: String(c.topic || '').trim(),
        definition: String(c.definition || '').trim(),
        mnemonic: String(c.mnemonic || '').trim(),
        // 기존 카드 관례에 맞춰 쉼표+공백으로 정규화
        keyword: String(c.keyword || '').split(',').map((s) => s.trim()).filter(Boolean).join(', '),
        extra: '',
        userId: `u${stamp}-${String(seq).padStart(3, '0')}g`,
        createdAt: new Date(stamp + seq).toISOString(),
    });
}

// ── 리포트 ────────────────────────────────────────────
const byCat = {};
added.forEach((c) => { byCat[c.category] = (byCat[c.category] || 0) + 1; });
console.log(`\n■ data/cards/${UNIT}`);
console.log(`  기존 ${existing.length}장 + 신규 ${added.length}장 = ${existing.length + added.length}장`);
Object.entries(byCat).forEach(([k, n]) => console.log(`   - ${k}: ${n}`));
const dlens = added.map((c) => c.definition.length);
const mlens = added.map((c) => c.mnemonic.length);
const rng = (a) => a.length ? `${Math.min(...a)}~${Math.max(...a)} (평균 ${Math.round(a.reduce((s, n) => s + n, 0) / a.length)})` : '-';
console.log(`  정의 ${rng(dlens)}자 · 내용 ${rng(mlens)}자`);

console.log('');
if (warns.length) { console.log(`⚠ 경고 ${warns.length}건`); warns.slice(0, 30).forEach((w) => console.log('  ' + w)); }
if (errors.length) { console.log(`✖ 오류 ${errors.length}건`); errors.slice(0, 30).forEach((e) => console.log('  ' + e)); }

if (errors.length) { console.log('\n오류가 있어 주입하지 않았습니다.'); process.exit(1); }
if (DRY) { console.log('\n(--dry) 주입하지 않았습니다.'); process.exit(0); }

fs.writeFileSync(TARGET, JSON.stringify(existing.concat(added), null, 2) + '\n', 'utf8');
console.log(`✔ data/cards/${UNIT} — ${existing.length + added.length}장 저장`);
