// /api/delete-images
//   POST  body: { urls: string[] }  또는  { keys: string[] }  (혼합 허용)
//   → R2(images/ prefix) 에서 명시적으로 지정된 객체만 삭제. 관리자 전용.
//
// cleanup-orphans 와의 차이:
//   - cleanup-orphans 는 "배포된 data/cards/*.json 기준 orphan" 을 스캔해 지움 →
//     단원을 막 비운 직후엔 재배포(~1분) 전이라 그 단원 이미지가 아직 in-use 로 잡혀 안 지워짐.
//   - 이 엔드포인트는 클라이언트가 라이브 스냅샷으로 계산한 "삭제 대상 키" 를 그대로 받아 삭제.
//     (공유 여부 판단은 호출자 책임 — 다른 단원과 공유 중인 키는 보내지 않음)
//
// 안전장치:
//   - images/ prefix 로 시작하는 key 만 삭제 (다른 경로 보호)
//   - 공개 URL(R2_PUBLIC_BASE) 만 key 로 변환, data:/외부 URL 은 무시
//   - 한 번에 최대 2000개

import { AwsClient } from 'aws4fetch';
import { verifyAdminRequest } from './_auth.js';

const ACCOUNT_ID  = (process.env.R2_ACCOUNT_ID || '').trim();
const ACCESS_KEY  = (process.env.R2_ACCESS_KEY_ID || '').trim();
const SECRET_KEY  = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const BUCKET      = (process.env.R2_BUCKET || '').trim();
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');

function isConfigured() {
    return !!(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_BASE);
}
function endpoint() {
    return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}`;
}

// 공개 URL 또는 key 문자열 → 버킷 key (images/...). 그 외엔 null.
function toKey(s) {
    if (typeof s !== 'string') return null;
    const v = s.trim();
    if (!v) return null;
    if (PUBLIC_BASE && v.startsWith(PUBLIC_BASE + '/')) {
        return v.slice(PUBLIC_BASE.length + 1);
    }
    if (/^images\//.test(v)) return v;   // 이미 key 형태
    return null;                          // data: URL·외부 URL 등은 무시
}

async function deleteOne(client, key) {
    const url = endpoint() + '/' + key.split('/').map(encodeURIComponent).join('/');
    const r = await client.fetch(url, { method: 'DELETE' });
    return r.ok;   // R2 는 없는 key 삭제도 204 로 ok
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method not allowed' });
    }

    const auth = await verifyAdminRequest(req);
    if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
    if (!isConfigured()) return res.status(503).json({ error: 'r2 not configured' });

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
    }
    const raw = []
        .concat(Array.isArray(body?.urls) ? body.urls : [])
        .concat(Array.isArray(body?.keys) ? body.keys : []);
    if (raw.length === 0) return res.status(400).json({ error: 'no urls/keys' });
    if (raw.length > 2000) return res.status(400).json({ error: 'too many (max 2000)' });

    // images/ prefix 로 제한 + 중복 제거
    const keys = [...new Set(raw.map(toKey).filter((k) => k && k.startsWith('images/')))];
    if (keys.length === 0) {
        return res.status(200).json({ deletedCount: 0, failedCount: 0, matched: 0, requested: raw.length });
    }

    try {
        const client = new AwsClient({
            accessKeyId: ACCESS_KEY,
            secretAccessKey: SECRET_KEY,
            service: 's3',
            region: 'auto',
        });
        const deleted = [];
        const failed = [];
        for (const key of keys) {
            try {
                const ok = await deleteOne(client, key);
                if (ok) deleted.push(key); else failed.push(key);
            } catch {
                failed.push(key);
            }
        }
        return res.status(200).json({
            deletedCount: deleted.length,
            failedCount: failed.length,
            matched: keys.length,
            requested: raw.length,
            by: auth.email,
        });
    } catch (e) {
        return res.status(500).json({ error: 'delete failed', detail: e?.message || String(e) });
    }
}
