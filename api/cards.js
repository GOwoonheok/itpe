// /api/cards
//   GET  /api/cards            → { gk:[...], sg:[...], ..., jm:[...] }
//   GET  /api/cards?unit=jm    → [ {topic,...}, ... ]
//   PUT  /api/cards?unit=jm    body: array → R2 즉시 저장 (관리자만)
//
// 인증: HttpOnly 서명 쿠키 itpe_admin (api/_auth.js)
// 저장: Cloudflare R2 객체 cards/<unitId>.json — 요청 시점에 즉시 읽기/쓰기.
//        커밋·재배포 없음 → 지연/desync 없는 런타임 저장소.
// 폴백: R2 에 해당 단원 객체가 아직 없으면 번들 시드 data/cards/<unitId>.json 사용
//        (마이그레이션 무중단 — 관리자가 처음 저장하면 그때부터 R2 가 단일 소스).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAdminRequest } from './_auth.js';
import * as r2 from './_r2.js';

const DATA_DIR = join(process.cwd(), 'data', 'cards');

// 동적 단원 ID 검증 — 영문 소문자·숫자·-·_, 1~16자.
function isValidUnitId(u) {
    return typeof u === 'string' && /^[a-z0-9_-]{1,16}$/.test(u);
}

function cardsKey(unit) { return `cards/${unit}.json`; }

// 번들 시드(배포 파일) 읽기 — R2 미존재 시 폴백 + 초기 데이터
function readSeedCards(unit) {
    try {
        const p = join(DATA_DIR, unit + '.json');
        const j = JSON.parse(readFileSync(p, 'utf8'));
        return Array.isArray(j) ? j : [];
    } catch {
        return [];
    }
}

// 단원 카드 읽기 — R2 우선(객체 있으면 그것이 단일 소스), 없으면 시드.
async function readUnitCards(unit) {
    if (r2.isConfigured()) {
        try {
            const got = await r2.getJson(cardsKey(unit));
            if (got) return Array.isArray(got.data) ? got.data : [];
            // got === null → R2 에 객체 없음 → 시드 폴백
        } catch {
            // R2 일시 오류 → 시드 폴백 (읽기는 끊기지 않게)
        }
    }
    return readSeedCards(unit);
}

// data/cards 안에 존재하는 모든 단원 파일 id 목록.
let SEEDED_UNITS = [];
try {
    SEEDED_UNITS = readdirSync(DATA_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .filter(isValidUnitId);
} catch {}

// 단원 메타 (data/index.json) — listActiveUnits 가 우선 사용
let SEED_INDEX = { units: [] };
try {
    SEED_INDEX = JSON.parse(readFileSync(join(process.cwd(), 'data', 'index.json'), 'utf8'));
} catch {}

function listActiveUnits() {
    const fromIndex = Array.isArray(SEED_INDEX.units)
        ? SEED_INDEX.units.map((u) => u.id).filter(isValidUnitId)
        : [];
    const seen = new Set(fromIndex);
    const merged = fromIndex.slice();
    for (const id of SEEDED_UNITS) {
        if (!seen.has(id)) { merged.push(id); seen.add(id); }
    }
    return merged;
}

// 카드 객체 유효성 — 필드 길이·타입 강제
const LIMITS = { category: 100, topic: 200, definition: 2000, mnemonic: 1000, keyword: 500, extra: 2000 };
function sanitizeCard(c) {
    if (!c || typeof c !== 'object') return null;
    const topic = String(c.topic ?? c.q ?? '').trim();
    if (!topic) return null;
    const clean = (v, max) => {
        if (typeof v !== 'string') return '';
        return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, max).trim();
    };
    const out = {
        category:   clean(c.category ?? '', LIMITS.category),
        topic: clean(topic, LIMITS.topic),
        definition: clean(c.definition ?? c.a ?? '', LIMITS.definition),
        mnemonic:   clean(c.mnemonic ?? '', LIMITS.mnemonic),
        keyword:    clean(c.keyword ?? '',  LIMITS.keyword),
        extra:      clean(c.extra ?? '',    LIMITS.extra),
    };
    if (!out.category) delete out.category;
    if (Array.isArray(c.images)) {
        out.images = c.images
            .filter((s) => typeof s === 'string' && s.length > 0)
            .filter((s) =>
                /^https:\/\/[^\s]+\.(webp|jpe?g|png|gif|svg)(\?[^\s]*)?$/i.test(s)
                || /^data:image\/[a-z+]+(;[a-z0-9-]+=[^;,]+)*;base64,/i.test(s)
            )
            .slice(0, 10);
        if (out.images.length === 0) delete out.images;
    }
    if (Array.isArray(c.references)) {
        out.references = c.references
            .filter((r) => r && typeof r === 'object')
            .map((r) => {
                const url = typeof r.url === 'string' ? r.url.trim() : '';
                if (!/^https?:\/\/[a-z0-9.\-]+/i.test(url)) return null;
                if (url.length > 500) return null;
                return {
                    title: clean(String(r.title || '').trim(), 200) || url,
                    url,
                    ...(r.note ? { note: clean(String(r.note), 200) } : {}),
                };
            })
            .filter(Boolean)
            .slice(0, 5);
        if (out.references.length === 0) delete out.references;
    }
    if (c.userId) out.userId = String(c.userId).slice(0, 64);
    if (c.createdAt) out.createdAt = String(c.createdAt).slice(0, 64);
    if (c.editedAt)  out.editedAt  = String(c.editedAt).slice(0, 64);
    if (c.movedFromJsonUnit) out.movedFromJsonUnit = String(c.movedFromJsonUnit).slice(0, 16);
    if (c.source === 'ai' || c.source === 'manual') out.source = c.source;
    if (c.aiGeneratedAt) out.aiGeneratedAt = String(c.aiGeneratedAt).slice(0, 32);
    if (c.aiConfidence && /^(high|medium|low)$/.test(c.aiConfidence)) out.aiConfidence = c.aiConfidence;
    return out;
}

export default async function handler(req, res) {
    // R2 가 단일 소스 — 항상 신선하게 읽도록 캐시 안 함.
    res.setHeader('Cache-Control', 'no-store');

    const unit = req.query?.unit ? String(req.query.unit) : '';

    if (req.method === 'GET') {
        if (!unit) {
            const activeUnits = listActiveUnits();
            const pairs = await Promise.all(
                activeUnits.map(async (u) => [u, await readUnitCards(u)])
            );
            const all = {};
            for (const [u, cards] of pairs) all[u] = cards;
            return res.status(200).json(all);
        }
        if (!isValidUnitId(unit)) {
            return res.status(400).json({ error: 'invalid unit', hint: '영문 소문자·숫자·-·_ 1~16자' });
        }
        return res.status(200).json(await readUnitCards(unit));
    }

    if (req.method === 'PUT') {
        const auth = await verifyAdminRequest(req);
        if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
        if (!isValidUnitId(unit)) return res.status(400).json({ error: 'invalid unit', hint: '영문 소문자·숫자·-·_ 1~16자' });
        if (!r2.isConfigured()) {
            return res.status(503).json({
                error: 'storage not configured',
                hint: 'Vercel 환경변수 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET 필요.',
            });
        }

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
        }
        if (!Array.isArray(body)) return res.status(400).json({ error: 'body must be array' });
        if (body.length > 500) return res.status(400).json({ error: 'too many cards (max 500)' });

        const cards = body.map(sanitizeCard).filter(Boolean);

        try {
            await r2.putJson(cardsKey(unit), cards);
            return res.status(200).json({
                ok: true,
                unit,
                count: cards.length,
                storage: 'r2',
                note: '저장 완료 — 즉시 반영 (재배포 불필요).',
            });
        } catch (e) {
            return res.status(500).json({ error: 'r2 save failed', detail: e?.message || String(e) });
        }
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
}
