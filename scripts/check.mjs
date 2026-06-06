// 통합 검증 스크립트 — JS 구문 검사 + 데이터 무결성 검사.
// 읽기 전용: 앱 동작을 절대 변경하지 않는다. 커밋 전 `npm run check` 로 실행.
//
// 종료 코드: 0 = 통과(경고 허용), 1 = 오류(커밋 금지).
// 오류(ERROR)  = 앱이 깨지는 문제 (JSON 파싱 실패, 단원 파일 누락, 구문 오류 등)
// 경고(WARN)   = 동작은 하지만 품질 문제 (중복 토픽 키, 빈 토픽 등)

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ──────────────────────────────────────────────
// 1) JS 구문 검사 (node --check)
//    대상: js/*.js (vendor 제외 — 외부 라이브러리), api/*.js, sw.js, scripts/*.mjs
// ──────────────────────────────────────────────
export function listJsFiles() {
    const files = [];
    for (const f of readdirSync(join(ROOT, 'js'))) {
        if (f.endsWith('.js')) files.push(join('js', f));
    }
    for (const f of readdirSync(join(ROOT, 'api'))) {
        if (f.endsWith('.js')) files.push(join('api', f));
    }
    for (const f of readdirSync(join(ROOT, 'scripts'))) {
        if (f.endsWith('.mjs')) files.push(join('scripts', f));
    }
    files.push('sw.js');
    return files;
}

export function checkSyntax(relPath) {
    const r = spawnSync(process.execPath, ['--check', join(ROOT, relPath)], { encoding: 'utf8' });
    return { ok: r.status === 0, message: (r.stderr || '').trim() };
}

// ──────────────────────────────────────────────
// 2) 데이터 무결성 검사
//    data/index.json ↔ data/cards/*.json ↔ data/users.json
//    규칙은 js/flash.js 의 실제 사용 방식(cardKey 등)을 따른다 — 더 엄격하게 만들지 않는다.
// ──────────────────────────────────────────────
export function validateData() {
    const errors = [];
    const warns = [];

    // index.json
    let index;
    try {
        index = JSON.parse(readFileSync(join(ROOT, 'data', 'index.json'), 'utf8'));
    } catch (e) {
        errors.push(`data/index.json — JSON 파싱 실패: ${e.message}`);
        return { errors, warns };
    }
    if (!Array.isArray(index.units)) {
        errors.push('data/index.json — units 배열이 없음');
        return { errors, warns };
    }
    const seenIds = new Set();
    for (const u of index.units) {
        if (!u || typeof u.id !== 'string' || !u.id) { errors.push('data/index.json — id 없는 단원 항목'); continue; }
        if (seenIds.has(u.id)) errors.push(`data/index.json — 단원 id 중복: ${u.id}`);
        seenIds.add(u.id);
        if (typeof u.file !== 'string' || !u.file) { errors.push(`data/index.json — 단원 ${u.id}: file 누락`); continue; }
        if (!existsSync(join(ROOT, 'data', 'cards', u.file))) {
            errors.push(`data/index.json — 단원 ${u.id}: data/cards/${u.file} 파일 없음`);
        }
    }

    // cards/*.json — index 에 등록된 파일 + 디렉터리의 모든 json
    const cardFiles = new Set(index.units.map((u) => u.file).filter(Boolean));
    for (const f of readdirSync(join(ROOT, 'data', 'cards'))) {
        if (f.endsWith('.json')) cardFiles.add(f);
    }
    for (const file of cardFiles) {
        const rel = `data/cards/${file}`;
        const full = join(ROOT, 'data', 'cards', file);
        if (!existsSync(full)) continue; // 누락은 위에서 이미 오류 처리됨
        let cards;
        try {
            cards = JSON.parse(readFileSync(full, 'utf8'));
        } catch (e) {
            errors.push(`${rel} — JSON 파싱 실패: ${e.message}`);
            continue;
        }
        if (!Array.isArray(cards)) {
            errors.push(`${rel} — 최상위가 배열이 아님`);
            continue;
        }
        // cardKey 규칙(flash.js): userId 있으면 'u:'+userId, 없으면 'j:'+topic.slice(0,60)
        const seenKeys = new Map();
        cards.forEach((c, i) => {
            if (!c || typeof c !== 'object' || Array.isArray(c)) {
                errors.push(`${rel}[${i}] — 카드가 객체가 아님`);
                return;
            }
            const topic = (c.topic ?? c.q ?? '').toString().trim();
            if (!topic) warns.push(`${rel}[${i}] — topic 비어 있음 (체크상태 키 충돌 가능)`);
            const key = c.userId ? `u:${c.userId}` : `j:${topic.slice(0, 60)}`;
            if (seenKeys.has(key)) {
                warns.push(`${rel}[${i}] — 카드 키 중복 (${seenKeys.get(key)}번과 동일): "${topic.slice(0, 40)}" — 체크상태가 공유됨`);
            } else {
                seenKeys.set(key, i);
            }
            if (c.images !== undefined) {
                if (!Array.isArray(c.images) || c.images.some((s) => typeof s !== 'string')) {
                    errors.push(`${rel}[${i}] — images 가 문자열 배열이 아님`);
                }
            }
        });
    }

    // users.json
    try {
        JSON.parse(readFileSync(join(ROOT, 'data', 'users.json'), 'utf8'));
    } catch (e) {
        errors.push(`data/users.json — JSON 파싱 실패: ${e.message}`);
    }

    return { errors, warns };
}

// ──────────────────────────────────────────────
// 실행부 (직접 실행 시에만)
// ──────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    let failed = 0;

    const files = listJsFiles();
    for (const f of files) {
        const r = checkSyntax(f);
        if (!r.ok) { failed++; console.error(`✖ 구문 오류: ${f}\n${r.message}`); }
    }
    console.log(`✔ JS 구문 검사: ${files.length - failed}/${files.length} 통과`);

    const { errors, warns } = validateData();
    for (const w of warns) console.warn(`⚠ ${w}`);
    for (const e of errors) console.error(`✖ ${e}`);
    console.log(`✔ 데이터 검사: 오류 ${errors.length} · 경고 ${warns.length}`);

    if (failed + errors.length > 0) {
        console.error('\n검증 실패 — 커밋 전에 위 오류를 해결하세요.');
        process.exit(1);
    }
    console.log('\n모든 검증 통과 ✓');
}
