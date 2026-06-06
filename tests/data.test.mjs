// 데이터 무결성 테스트 — `npm test` (node --test) 로 실행.
// scripts/check.mjs 의 검증 로직을 그대로 사용해 이중 기준이 생기지 않게 한다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateData, listJsFiles, checkSyntax } from '../scripts/check.mjs';

test('데이터 무결성 — 오류 0건 (경고는 허용)', () => {
    const { errors, warns } = validateData();
    if (warns.length) console.warn(`경고 ${warns.length}건 (허용):\n` + warns.slice(0, 10).join('\n'));
    assert.deepEqual(errors, [], '데이터 오류:\n' + errors.join('\n'));
});

test('JS 구문 — 전 파일 통과', () => {
    const bad = [];
    for (const f of listJsFiles()) {
        const r = checkSyntax(f);
        if (!r.ok) bad.push(`${f}: ${r.message}`);
    }
    assert.deepEqual(bad, [], '구문 오류:\n' + bad.join('\n'));
});
