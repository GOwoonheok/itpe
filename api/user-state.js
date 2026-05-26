// /api/user-state — 사용자별 학습 상태(체크한 카드)를 R2 에 저장/조회.
//   GET                  → { checked: { <unitId>: [cardKey...] , ... } }
//   PUT ?unit=<id>  body: { checked: [cardKey...] }  → 해당 단원 체크 목록 교체
//
// 인증: verifyUserRequest (등록 사용자 누구나 — 관리자 아니어도 OK).
// 저장: R2 객체 userstate/<sha256(email)>.json  (이메일 원문은 키에 노출 안 함).
//        계정별 분리 + 기기 간 동기화. 마지막 쓰기 우선(단일 사용자라 충돌 거의 없음).

import { createHash } from 'node:crypto';
import { verifyUserRequest } from './_auth.js';
import * as r2 from './_r2.js';

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };

function keyFor(email) {
    const h = createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 40);
    return `userstate/${h}.json`;
}
function isValidUnitId(u) { return typeof u === 'string' && /^[a-z0-9_-]{1,16}$/.test(u); }

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const auth = await verifyUserRequest(req);
    if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
    if (!r2.isConfigured()) return res.status(503).json({ error: 'storage not configured' });

    const key = keyFor(auth.email);

    if (req.method === 'GET') {
        try {
            const got = await r2.getJson(key);
            const data = (got && got.data && typeof got.data === 'object') ? got.data : {};
            return res.status(200).json({ checked: (data.checked && typeof data.checked === 'object') ? data.checked : {} });
        } catch (e) {
            return res.status(500).json({ error: 'read failed', detail: e?.message || String(e) });
        }
    }

    if (req.method === 'PUT') {
        const unit = String(req.query?.unit || '');
        if (!isValidUnitId(unit)) return res.status(400).json({ error: 'invalid unit' });

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
        }
        let arr = Array.isArray(body?.checked) ? body.checked : (Array.isArray(body) ? body : null);
        if (!arr) return res.status(400).json({ error: 'checked must be array' });
        // 정제 — 문자열 키만, 길이 제한, 최대 개수
        arr = [...new Set(arr.filter((k) => typeof k === 'string' && k.length > 0 && k.length <= 80))].slice(0, 5000);

        try {
            const got = await r2.getJson(key);
            const data = (got && got.data && typeof got.data === 'object') ? got.data : {};
            if (!data.checked || typeof data.checked !== 'object') data.checked = {};
            if (arr.length) data.checked[unit] = arr;
            else delete data.checked[unit];
            data.updatedAt = new Date().toISOString();
            await r2.putJson(key, data);
            return res.status(200).json({ ok: true, unit, count: arr.length });
        } catch (e) {
            return res.status(500).json({ error: 'save failed', detail: e?.message || String(e) });
        }
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
}
