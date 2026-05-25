// /api/ai-fill
//   POST body: { topic: "Zero Trust" }     → 1장
//   POST body: { topics: ["A","B","C"] }  → 여러 장 병렬 생성 (최대 20개)
//
// 응답: { items: [ {topic, category, definition, mnemonic, keyword, references, confidence} ... ], usage: {...} }
// 인증: Authorization: Bearer <ADMIN_API_SECRET>
// 모델: gpt-4o-mini (Vercel AI Gateway 경유 또는 OpenAI 직접)

import { generateObject } from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAdminRequest } from './_auth.js';

const MAX_BATCH = 20;

const DEFAULT_SYSTEM_PROMPT_FULL = `당신은 대한민국 "정보관리기술사" 자격증 학습 카드 작성 전문가입니다.
사용자가 토픽 명을 제시하면, 시험 답안 작성에 유용한 카드 데이터를 만들어주세요.

규칙:
1. category(분류): 상위 영역 (예: 보안, SW공학, 데이터, 네트워크, OS, AI, 컴퓨터구조, DB, 경영, 통계)
2. definition(내용): 30자 이내. 패턴 "X를 위해, [핵심키워드 활용]한 Y(명사)". 한국어. 명사로 끝남.
3. mnemonic(두음): 외우기 쉬운 두음·구성요소·약어. 줄바꿈으로 구분. 5줄 이내.
4. keyword(키워드): 핵심 기술요소 5개를 쉼표로 구분.
5. references(참고): 권위 있는 출처 1~3개 (KISA, NIST, ISO, IEEE, 공식 vendor docs, Wikipedia 등). 실재하는 URL 만 (학습 시점 knowledge 기준).
6. confidence: 정보관리기술사 시험 범위인지 확신도 (high/medium/low). 범위 밖이면 low.

답안 톤: 서술형 한국어, 군더더기 없이.`;

const DEFAULT_SYSTEM_PROMPT_DEF = `당신은 대한민국 "정보관리기술사" 자격증 학습 카드의 "정의(definition)" 작성 전문가입니다.
주어진 토픽 한 개에 대해, 시험 답안에 그대로 옮길 수 있는 깔끔한 "정의" 문장 한 줄만 만들어주세요.

규칙:
1. 분량: 30자 이내 (공백 포함). 50자 절대 초과 금지.
2. 패턴: "X를 위해, [핵심키워드 활용]한 Y(명사)" — 앞: 목적, 뒤: 핵심 메커니즘 + 명사로 끝남.
3. 한국어. 군더더기 없이. 마침표 없음.
4. 외래어는 토픽에 포함된 경우 그대로 사용.
5. confidence: 정보관리기술사 시험 범위인지 확신도 (high/medium/low).

예시:
- Zero Trust → "내부망 침해 차단 위해, 모든 접근 검증한 보안모델"
- SOAR → "보안운영 자동화 위해, 사고대응 통합한 플랫폼"`;

// 시스템 프롬프트 — 번들 파일 (data/ai-prompts/*.txt) 우선, 없으면 위 상수 기본값.
// 저장은 /api/ai-prompt 가 GitHub commit → 재배포 시 새 콜드스타트가 새 값 자동 로드.
const _filePath = { full: 'data/ai-prompts/full.txt', def: 'data/ai-prompts/def.txt' };
const _defaultFor = { full: DEFAULT_SYSTEM_PROMPT_FULL, def: DEFAULT_SYSTEM_PROMPT_DEF };
const _loaded = {};
for (const k of Object.keys(_filePath)) {
    try {
        const text = readFileSync(join(process.cwd(), _filePath[k]), 'utf8');
        if (text && text.trim()) _loaded[k] = text;
    } catch {}
}

function loadSystemPrompt(kind) {
    const k = (kind === 'def') ? 'def' : 'full';
    return _loaded[k] || _defaultFor[k];
}

const ItemSchema = z.object({
    category: z.string().describe('상위 분류 (예: 보안, 네트워크, OS)'),
    definition: z.string().max(60).describe('30자 이내, "~위해 ~명사" 패턴'),
    mnemonic: z.string().describe('두음·구성요소 5줄 이내, 줄바꿈 구분'),
    keyword: z.string().describe('핵심 기술요소 5개 쉼표 구분'),
    references: z.array(z.object({
        title: z.string(),
        url: z.string().url(),
        note: z.string().optional(),
    })).max(3).describe('권위 있는 출처 URL 1~3개'),
    confidence: z.enum(['high', 'medium', 'low']).describe('정보관리기술사 범위 확신도'),
});

// 정의 전용 — 더 가벼운 스키마 (속도/토큰 절감)
const DefSchema = z.object({
    definition: z.string().max(60).describe('30자 이내, "~위해 ~명사" 패턴, 마침표 없음'),
    confidence: z.enum(['high', 'medium', 'low']).describe('정보관리기술사 범위 확신도'),
});

function pickModel() {
    // 우선 순위: Gemini(무료) → Vercel AI Gateway → OpenAI 직접
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) {
        // @ai-sdk/google 는 GOOGLE_GENERATIVE_AI_API_KEY 자동 인식
        if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GEMINI_API_KEY) {
            process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
        }
        // 실제 모델은 generateOne 의 폴백 체인에서 결정 (Google 정책 변경 대응)
        return { provider: 'google', model: null, name: 'gemini-flash (fallback)', free: true };
    }
    if (process.env.AI_GATEWAY_API_KEY) {
        const provider = createOpenAI({
            apiKey: process.env.AI_GATEWAY_API_KEY,
            baseURL: 'https://ai-gateway.vercel.sh/v1',
        });
        return { provider: 'gateway', model: provider('gpt-4o-mini'), name: 'gpt-4o-mini@gateway', free: false };
    }
    if (process.env.OPENAI_API_KEY) {
        return { provider: 'openai', model: openai('gpt-4o-mini'), name: 'gpt-4o-mini', free: false };
    }
    return null;
}

// Gemini 모델 폴백 체인 — v1beta GA 모델만 사용
// (gemini-1.5-*, gemini-2.0-flash-exp 는 2025년 후반 폐기됨)
const GEMINI_CANDIDATES = [
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
];

async function generateOne(modelInfo, topic, systemPrompt, mode) {
    const safeTopic = String(topic || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 200);
    if (!safeTopic) throw new Error('빈 토픽');

    const isDef = (mode === 'def');
    const schema = isDef ? DefSchema : ItemSchema;
    const maxTokens = isDef ? 200 : 600;

    const tryWith = (model) => generateObject({
        model,
        schema,
        system: systemPrompt,
        prompt: '토픽: ' + safeTopic,
        temperature: isDef ? 0.3 : 0.4,
        maxTokens,
    });

    // Gemini provider 면 모델 폴백 체인 시도
    if (modelInfo.provider === 'google') {
        const tried = [];
        let lastErr = null;
        for (const name of GEMINI_CANDIDATES) {
            try {
                const result = await tryWith(google(name));
                modelInfo.name = name; // 성공한 모델 기록
                return { topic: safeTopic, ...result.object };
            } catch (e) {
                const msg = String(e?.message || '');
                tried.push(name + ': ' + msg.slice(0, 120));
                lastErr = e;
                // 모델 미지원·할당 초과는 다음 후보로
                if (/not found|not supported|quota|exceed|deprecat|UNAVAILABLE|404|429/i.test(msg)) continue;
                // 그 외 에러 (네트워크·인증 등) 도 다음 모델 시도 — 모델별 가용성 변동이 잦음
                continue;
            }
        }
        const err = new Error('모든 Gemini 모델 실패. tried: ' + tried.join(' | '));
        err.tried = tried;
        err.lastErr = lastErr?.message || null;
        throw err;
    }

    const result = await tryWith(modelInfo.model);
    return { topic: safeTopic, ...result.object };
}

export const config = {
    api: { bodyParser: { sizeLimit: '512kb' } },
};

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method not allowed' });
    }
    const auth = await verifyAdminRequest(req);
    if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
    }

    // 토픽 정규화 — 단일 / 배열 모두 허용
    let topics = [];
    if (Array.isArray(body?.topics)) topics = body.topics;
    else if (typeof body?.topic === 'string') topics = [body.topic];
    topics = topics
        .map((t) => String(t || '').trim())
        .filter((t) => t.length > 0 && t.length <= 200)
        .slice(0, MAX_BATCH);

    if (topics.length === 0) {
        return res.status(400).json({ error: 'topic(s) required', hint: 'body: { topic: "..." } 또는 { topics: ["A","B"] }' });
    }

    const modelInfo = pickModel();
    if (!modelInfo) {
        return res.status(500).json({
            error: 'AI 모델 미설정',
            hint: 'Vercel 환경변수 GEMINI_API_KEY (무료, 추천) 또는 AI_GATEWAY_API_KEY 또는 OPENAI_API_KEY 중 하나 설정',
        });
    }

    // mode — 'def' 면 정의 전용 (다른 프롬프트 + 가벼운 스키마)
    const mode = (String(body?.mode || '').toLowerCase() === 'def') ? 'def' : 'full';

    // 시스템 프롬프트 — 번들 파일 우선, kind 별
    const systemPrompt = loadSystemPrompt(mode);

    // 병렬 호출 (실패한 카드는 error 필드로 표시)
    const results = await Promise.all(topics.map(async (topic) => {
        try {
            const item = await generateOne(modelInfo, topic, systemPrompt, mode);
            return item;
        } catch (e) {
            return { topic, error: e?.message || String(e) };
        }
    }));

    const ok = results.filter((r) => !r.error).length;
    const fail = results.length - ok;
    return res.status(200).json({
        items: results,
        ok, fail,
        mode,
        model: modelInfo.name,
        free: modelInfo.free,
    });
}
