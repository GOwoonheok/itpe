// Claude Code PostToolUse 훅 — Edit/Write 직후 자동 검증.
// .js/.mjs/.cjs → node --check 구문 검사, data/**/*.json → JSON 파싱 검사.
// 실패 시 exit 2 → 에이전트에게 즉시 피드백 (사용자가 보기 전에 스스로 고침).

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

let input = '';
try {
    input = readFileSync(0, 'utf8'); // stdin
} catch {
    process.exit(0);
}

let filePath = '';
try {
    // BOM·공백 방어 (PowerShell 파이프 등)
    const data = JSON.parse(input.replace(/^﻿/, '').trim());
    filePath = data?.tool_input?.file_path || '';
} catch {
    process.exit(0);
}

if (!filePath || !existsSync(filePath)) process.exit(0);

// JS 구문 검사
if (/\.(js|mjs|cjs)$/.test(filePath) && !/[\\/](node_modules|vendor)[\\/]/.test(filePath)) {
    const r = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
    if (r.status !== 0) {
        console.error(`[hook] 구문 오류 — 수정 필요:\n${(r.stderr || '').trim()}`);
        process.exit(2);
    }
}

// JSON 파싱 검사 (data/ 하위)
if (/\.json$/.test(filePath) && /[\\/]data[\\/]/.test(filePath)) {
    try {
        JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`[hook] JSON 파싱 오류 — 수정 필요: ${e.message}`);
        process.exit(2);
    }
}

process.exit(0);
