// /api/ai-prompt
//   GET  ?kind=full|def       → { prompt, isDefault, length, kind }
//   PUT  body: { prompt, kind } 관리자만. 빈 prompt → 기본값 복원
//
// 저장:
//   kind=full → data/ai-prompts/full.txt
//   kind=def  → data/ai-prompts/def.txt
// 둘 다 GitHub commit. 미설정 파일이면 콜드스타트 시 기본값(아래 상수) 로드.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAdminRequest } from './_auth.js';
import { commitText, isConfigured as ghConfigured, notConfiguredResponse } from './_github.js';

const DEFAULT_PROMPT_FULL = `당신은 대한민국 "정보관리기술사" 자격증 학습 카드 작성 전문가입니다.
사용자가 토픽 명을 제시하면, 시험 답안 작성에 유용한 카드 데이터를 만들어주세요.

규칙:
1. category(분류): 상위 영역 (예: 보안, SW공학, 데이터, 네트워크, OS, AI, 컴퓨터구조, DB, 경영, 통계)
2. definition(내용): 30자 이내. 패턴 "X를 위해, [핵심키워드 활용]한 Y(명사)". 한국어. 명사로 끝남.
3. mnemonic(두음): 외우기 쉬운 두음·구성요소·약어. 줄바꿈으로 구분. 5줄 이내.
4. keyword(키워드): 핵심 기술요소 5개를 쉼표로 구분.
5. references(참고): 권위 있는 출처 1~3개 (KISA, NIST, ISO, IEEE, 공식 vendor docs, Wikipedia 등). 실재하는 URL 만 (학습 시점 knowledge 기준).
6. confidence: 정보관리기술사 시험 범위인지 확신도 (high/medium/low). 범위 밖이면 low.

답안 톤: 서술형 한국어, 군더더기 없이.`;

const DEFAULT_PROMPT_DEF = `당신은 대한민국 "정보관리기술사" 자격증 학습 카드의 "정의(definition)" 작성 전문가입니다.
주어진 토픽 한 개에 대해, 시험 답안에 그대로 옮길 수 있는 깔끔한 "정의" 문장 한 줄만 만들어주세요.

규칙:
1. 분량: 30자 이내 (공백 포함). 50자 절대 초과 금지.
2. 패턴: "X를 위해, [핵심키워드 활용]한 Y(명사)"
   - 앞 절: 목적/필요성 ("~을 위해", "~하기 위해", "~을 목적으로")
   - 뒤 절: 핵심 메커니즘 + 명사로 끝남 (체계/방식/기법/도구/구조/모델 등)
3. 한국어. 군더더기 없이. 마침표 없음.
4. 외래어는 토픽에 포함된 경우 그대로 사용 (예: Zero Trust, MITRE ATT&CK).
5. confidence: 정보관리기술사 시험 범위인지 확신도 (high/medium/low).

예시:
- 토픽: Zero Trust → "내부망 침해 차단 위해, 모든 접근 검증한 보안모델"
- 토픽: SOAR → "보안운영 자동화 위해, 사고대응 통합한 플랫폼"`;

const DEFAULTS = { full: DEFAULT_PROMPT_FULL, def: DEFAULT_PROMPT_DEF };
const FILE_KEYS = { full: 'data/ai-prompts/full.txt', def: 'data/ai-prompts/def.txt' };

function normalizeKind(v) {
    const k = String(v || 'full').toLowerCase();
    return (k === 'def') ? 'def' : 'full';
}

// 콜드 스타트에서 1회 로드 — 재배포 시 새 값 자동 반영
const LOADED = {};
for (const kind of Object.keys(FILE_KEYS)) {
    try {
        const p = join(process.cwd(), FILE_KEYS[kind]);
        const text = readFileSync(p, 'utf8');
        if (text && text.trim()) LOADED[kind] = text;
    } catch {}
}

export const config = {
    api: { bodyParser: { sizeLimit: '64kb' } },
};

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
        const auth = await verifyAdminRequest(req);
        if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
        const kind = normalizeKind(req.query?.kind);
        const stored = LOADED[kind];
        const def = DEFAULTS[kind];
        const isDefault = !stored || stored.trim() === def.trim();
        return res.status(200).json({
            kind,
            prompt: stored || def,
            isDefault,
            length: (stored || def).length,
            defaultPrompt: def,
        });
    }

    if (req.method === 'PUT') {
        const auth = await verifyAdminRequest(req);
        if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
        if (!ghConfigured()) return notConfiguredResponse(res);

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
        }
        const kind = normalizeKind(body?.kind ?? req.query?.kind);
        const path = FILE_KEYS[kind];
        const def = DEFAULTS[kind];
        const prompt = typeof body?.prompt === 'string' ? body.prompt : '';

        // 빈 prompt → 기본값으로 복원 (파일을 기본값으로 덮어쓰기 — 안전한 reset)
        if (!prompt.trim()) {
            try {
                const r = await commitText(path, def, `chore(ai-prompt): reset ${kind} to default by ${auth.email}`);
                return res.status(200).json({
                    ok: true, reset: true, kind, length: def.length, commit: r.commit,
                    note: '커밋됨 — Vercel 재배포 후 약 30초~1분 뒤 반영됩니다.',
                });
            } catch (e) {
                return res.status(500).json({ error: 'github commit failed', detail: e?.message || String(e) });
            }
        }
        if (prompt.length > 8000) {
            return res.status(413).json({ error: 'too long', max: 8000, got: prompt.length });
        }
        try {
            const r = await commitText(path, prompt, `chore(ai-prompt): update ${kind} (${prompt.length} chars) by ${auth.email}`);
            return res.status(200).json({
                ok: true, kind, length: prompt.length, commit: r.commit,
                note: '커밋됨 — Vercel 재배포 후 약 30초~1분 뒤 반영됩니다.',
            });
        } catch (e) {
            return res.status(500).json({ error: 'github commit failed', detail: e?.message || String(e) });
        }
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
}
