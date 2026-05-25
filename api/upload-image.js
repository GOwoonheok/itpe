// /api/upload-image
//   POST  body: { dataUrl: "data:image/webp;base64,..." }
//   → { url: "https://pub-xxx.r2.dev/images/<uuid>.webp" }
//
// 저장: Cloudflare R2 (S3 호환). aws4fetch 로 PUT 요청 서명.
// 인증: 관리자 쿠키 (api/_auth.js)
// 환경변수 (모두 필요):
//   R2_ACCOUNT_ID           — Cloudflare account ID
//   R2_ACCESS_KEY_ID        — R2 API token 의 Access Key ID
//   R2_SECRET_ACCESS_KEY    — R2 API token 의 Secret
//   R2_BUCKET               — 버킷 이름 (예: itpe-images)
//   R2_PUBLIC_BASE          — 공개 URL prefix (예: https://pub-xxx.r2.dev)
//                              마지막 슬래시는 있어도 없어도 OK.

import { AwsClient } from 'aws4fetch';
import { randomUUID } from 'node:crypto';
import { verifyAdminRequest } from './_auth.js';

const ACCOUNT_ID  = process.env.R2_ACCOUNT_ID  || '';
const ACCESS_KEY  = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_KEY  = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET      = process.env.R2_BUCKET || '';
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');

function isConfigured() {
    return !!(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_BASE);
}

const ALLOWED = {
    'image/webp':    'webp',
    'image/jpeg':    'jpg',
    'image/png':     'png',
    'image/gif':     'gif',
    'image/svg+xml': 'svg',
};
const MAX_BYTES = 4 * 1024 * 1024; // 4MB (압축 후 권장 한도)

// 바이너리 매직 바이트로 실제 MIME 검출 — 클라이언트 헤더 신뢰 안 함
function detectMime(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
    const head = buf.subarray(0, 64).toString('utf8').trim().toLowerCase();
    if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
    return null;
}

export const config = {
    api: {
        bodyParser: { sizeLimit: '6mb' },
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method not allowed' });
    }
    const auth = await verifyAdminRequest(req);
    if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });

    if (!isConfigured()) {
        const missing = [];
        if (!ACCOUNT_ID)  missing.push('R2_ACCOUNT_ID');
        if (!ACCESS_KEY)  missing.push('R2_ACCESS_KEY_ID');
        if (!SECRET_KEY)  missing.push('R2_SECRET_ACCESS_KEY');
        if (!BUCKET)      missing.push('R2_BUCKET');
        if (!PUBLIC_BASE) missing.push('R2_PUBLIC_BASE');
        return res.status(503).json({
            error: 'image storage not configured',
            missing,
            hint: 'Vercel Settings → Environment Variables 에서 위 변수를 추가하고 재배포 필요.',
        });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
    }
    const dataUrl = body?.dataUrl;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return res.status(400).json({ error: 'invalid dataUrl', reason: 'not a data URL' });
    }
    const m = /^data:([^,]*),([\s\S]+)$/i.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'unsupported dataUrl format' });
    const params = (m[1] || '').toLowerCase();
    const payload = m[2];
    const tokens = params.split(';').map((s) => s.trim()).filter(Boolean);
    const declared = tokens[0] || '';
    const isB64 = tokens.includes('base64');

    let buf;
    try {
        buf = isB64
            ? Buffer.from(payload, 'base64')
            : Buffer.from(decodeURIComponent(payload), 'utf8');
    } catch (e) {
        return res.status(400).json({ error: 'payload decode failed', detail: e?.message || String(e) });
    }
    if (!buf || buf.length === 0) return res.status(400).json({ error: 'empty image' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'too large', size: buf.length, max: MAX_BYTES });

    const detected = detectMime(buf);
    const mime = detected || declared;
    if (!mime || !ALLOWED[mime]) {
        return res.status(415).json({
            error: 'mime not allowed',
            declared,
            detected,
            hint: 'jpeg/png/gif/webp/svg 만 지원',
        });
    }

    const id = randomUUID();
    const ext = ALLOWED[mime];
    const key = `images/${id}.${ext}`;

    // R2 S3-호환 endpoint 에 PUT 으로 업로드
    const client = new AwsClient({
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        service: 's3',
        region: 'auto',
    });
    const putUrl = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`;
    try {
        const r = await client.fetch(putUrl, {
            method: 'PUT',
            body: buf,
            headers: {
                'Content-Type': mime,
                'Content-Length': String(buf.length),
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
        if (!r.ok) {
            const detail = await r.text().catch(() => '');
            return res.status(502).json({ error: 'r2 put failed', status: r.status, detail: detail.slice(0, 500) });
        }
        return res.status(200).json({
            url: `${PUBLIC_BASE}/${key}`,
            pathname: key,
            size: buf.length,
            mime,
        });
    } catch (e) {
        return res.status(500).json({ error: 'r2 upload error', detail: e?.message || String(e) });
    }
}
