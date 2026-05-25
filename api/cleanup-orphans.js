// /api/cleanup-orphans
//   GET  → orphan 미리보기 (삭제 대상 목록만)
//   POST → 실제 삭제
//
// 인증: 관리자 쿠키
// 처리: 모든 카드 JSON 에서 사용 중인 R2 URL 수집 → R2 버킷의 images/ 전체 list →
//        차집합(=어느 카드에서도 참조 안 되는 것) = orphan → 삭제

import { AwsClient } from 'aws4fetch';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAdminRequest } from './_auth.js';

const ACCOUNT_ID  = (process.env.R2_ACCOUNT_ID || '').trim();
const ACCESS_KEY  = (process.env.R2_ACCESS_KEY_ID || '').trim();
const SECRET_KEY  = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const BUCKET      = (process.env.R2_BUCKET || '').trim();
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');

function isConfigured() {
    return !!(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_BASE);
}
function r2Client() {
    return new AwsClient({
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        service: 's3',
        region: 'auto',
    });
}
function endpoint() {
    return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}`;
}

// data/cards/*.json 의 모든 카드 images[] 중 R2 URL 의 key 부분만 수집
function collectInUseKeys() {
    const inUse = new Set();
    const cardsDir = join(process.cwd(), 'data', 'cards');
    let files = [];
    try {
        files = readdirSync(cardsDir).filter((f) => f.endsWith('.json'));
    } catch {}
    const basePrefix = PUBLIC_BASE + '/';
    for (const f of files) {
        try {
            const j = JSON.parse(readFileSync(join(cardsDir, f), 'utf8'));
            if (!Array.isArray(j)) continue;
            for (const card of j) {
                if (!card || !Array.isArray(card.images)) continue;
                for (const url of card.images) {
                    if (typeof url !== 'string') continue;
                    if (url.startsWith(basePrefix)) {
                        const key = url.slice(basePrefix.length);
                        if (key) inUse.add(key);
                    }
                }
            }
        } catch {}
    }
    return inUse;
}

// S3 ListObjectsV2 — 페이지네이션 포함, XML 응답 정규식 파싱
async function listAllObjects(client) {
    const all = [];
    let continuationToken = null;
    let safetyHops = 0;
    while (safetyHops < 50) {
        const url = new URL(endpoint() + '/');
        url.searchParams.set('list-type', '2');
        url.searchParams.set('max-keys', '1000');
        url.searchParams.set('prefix', 'images/');
        if (continuationToken) url.searchParams.set('continuation-token', continuationToken);

        const r = await client.fetch(url.toString(), { method: 'GET' });
        if (!r.ok) {
            const t = await r.text().catch(() => '');
            throw new Error('list failed ' + r.status + ': ' + t.slice(0, 300));
        }
        const xml = await r.text();
        const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
        for (const c of contents) {
            const keyM = /<Key>([\s\S]*?)<\/Key>/.exec(c);
            const sizeM = /<Size>(\d+)<\/Size>/.exec(c);
            if (keyM && sizeM) {
                all.push({ key: keyM[1], size: parseInt(sizeM[1], 10) });
            }
        }
        const truncM = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml);
        const truncated = truncM && truncM[1] === 'true';
        if (!truncated) break;
        const tokenM = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
        if (!tokenM) break;
        continuationToken = tokenM[1];
        safetyHops++;
    }
    return all;
}

async function deleteOne(client, key) {
    const url = endpoint() + '/' + key.split('/').map(encodeURIComponent).join('/');
    const r = await client.fetch(url, { method: 'DELETE' });
    return r.ok;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const auth = await verifyAdminRequest(req);
    if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
    if (!isConfigured()) return res.status(503).json({ error: 'r2 not configured' });

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'method not allowed' });
    }

    try {
        const client = r2Client();
        const inUseKeys = collectInUseKeys();
        const allObjects = await listAllObjects(client);
        // 안전 — images/ prefix 만 대상 (다른 폴더가 추가될 경우 보호)
        const candidates = allObjects.filter((o) => o.key.startsWith('images/'));
        const orphans = candidates.filter((o) => !inUseKeys.has(o.key));
        const orphanSize = orphans.reduce((s, o) => s + o.size, 0);

        if (req.method === 'GET') {
            return res.status(200).json({
                mode: 'preview',
                inUseCount: inUseKeys.size,
                totalCount: candidates.length,
                orphanCount: orphans.length,
                orphanSize,
                orphanSample: orphans.slice(0, 30).map((o) => o.key),
            });
        }

        // POST — 실제 삭제 (순차, 보수적)
        const deleted = [];
        const failed = [];
        for (const o of orphans) {
            try {
                const ok = await deleteOne(client, o.key);
                if (ok) deleted.push(o.key);
                else failed.push(o.key);
            } catch {
                failed.push(o.key);
            }
        }
        return res.status(200).json({
            mode: 'executed',
            inUseCount: inUseKeys.size,
            totalCount: candidates.length,
            orphanCount: orphans.length,
            deletedCount: deleted.length,
            failedCount: failed.length,
            freedBytes: orphanSize,
            by: auth.email,
        });
    } catch (e) {
        return res.status(500).json({ error: 'cleanup failed', detail: e?.message || String(e) });
    }
}
