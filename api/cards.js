// /api/cards
//   GET  /api/cards            → { gk:[...], sg:[...], ..., jm:[...] }
//   GET  /api/cards?unit=jm    → [ {topic,...}, ... ]
//   PUT  /api/cards?unit=jm    body: array → GitHub 커밋 (관리자만)
//
// 인증: HttpOnly 서명 쿠키 itpe_admin (api/_auth.js)
// 저장: 번들 data/cards/<unitId>.json — PUT 시 GitHub Contents API 로 커밋,
//        Vercel 자동 재배포 (약 30초~1분) 후 새 데이터가 반영됨.
// 폴백: 파일이 없으면 빈 배열.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAdminRequest } from './_auth.js';
import { commitJson, isConfigured as ghConfigured, notConfiguredResponse } from './_github.js';

const DATA_DIR = join(process.cwd(), 'data', 'cards');

// 동적 단원 ID 검증 — 영문 소문자·숫자·-·_, 1~16자.
function isValidUnitId(u) {
    return typeof u === 'string' && /^[a-z0-9_-]{1,16}$/.test(u);
}

function readUnitCards(unit) {
    try {
        const p = join(DATA_DIR, unit + '.json');
        const t = readFileSync(p, 'utf8');
        const j = JSON.parse(t);
        return Array.isArray(j) ? j : [];
    } catch {
        return [];
    }
}

// data/cards 안에 존재하는 모든 단원 파일 id 목록.
// 콜드 스타트 시 1회 스캔 — 재배포마다 새로고침.
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
    // index.json 우선, 누락된 seeded 파일도 포함 (방어적)
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
    // 정적 파일 기반이라 응답은 CDN 캐시 허용 — 재배포 시 자동 무효화.
    // 다만 PUT 직후 잠시 동안은 옛 데이터 가능 (약 1분), 클라이언트가 사용자에게 안내.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

    const unit = req.query?.unit ? String(req.query.unit) : '';

    if (req.method === 'GET') {
        if (!unit) {
            const activeUnits = listActiveUnits();
            const all = {};
            for (const u of activeUnits) all[u] = readUnitCards(u);
            return res.status(200).json(all);
        }
        if (!isValidUnitId(unit)) {
            return res.status(400).json({ error: 'invalid unit', hint: '영문 소문자·숫자·-·_ 1~16자' });
        }
        return res.status(200).json(readUnitCards(unit));
    }

    if (req.method === 'PUT') {
        const auth = await verifyAdminRequest(req);
        if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
        if (!isValidUnitId(unit)) return res.status(400).json({ error: 'invalid unit', hint: '영문 소문자·숫자·-·_ 1~16자' });
        if (!ghConfigured()) return notConfiguredResponse(res);

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
        }
        if (!Array.isArray(body)) return res.status(400).json({ error: 'body must be array' });
        if (body.length > 500) return res.status(400).json({ error: 'too many cards (max 500)' });

        const cards = body.map(sanitizeCard).filter(Boolean);

        try {
            const r = await commitJson(
                `data/cards/${unit}.json`,
                cards,
                `chore(cards): update ${unit} (${cards.length} cards) by ${auth.email}`
            );
            return res.status(200).json({
                ok: true,
                unit,
                count: cards.length,
                commit: r.commit,
                note: '커밋됨 — Vercel 재배포 후 약 30초~1분 뒤 반영됩니다.',
            });
        } catch (e) {
            return res.status(500).json({ error: 'github commit failed', detail: e?.message || String(e) });
        }
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
}
