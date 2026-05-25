// Cloudflare R2 (S3 호환) 공용 헬퍼 — 카드 JSON 런타임 저장소.
//   - 이미지(upload-image/cleanup-orphans/delete-images)와 동일한 버킷·자격증명 사용.
//   - 카드는 cards/<unitId>.json 객체로 저장. 커밋·재배포 없이 요청 시점에 즉시 읽기/쓰기.
//   - 환경변수: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//     (이미지 공개 URL 은 R2_PUBLIC_BASE — 카드 저장엔 불필요)

import { AwsClient } from 'aws4fetch';

const ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').trim();
const ACCESS_KEY = (process.env.R2_ACCESS_KEY_ID || '').trim();
const SECRET_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const BUCKET     = (process.env.R2_BUCKET || '').trim();

export function isConfigured() {
    return !!(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET);
}

let _client = null;
function client() {
    if (!_client) {
        _client = new AwsClient({
            accessKeyId: ACCESS_KEY,
            secretAccessKey: SECRET_KEY,
            service: 's3',
            region: 'auto',
        });
    }
    return _client;
}

function objUrl(key) {
    const path = String(key).split('/').map(encodeURIComponent).join('/');
    return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${path}`;
}

// JSON 객체 읽기. 없으면 null, 있으면 { data, etag }.
export async function getJson(key) {
    const r = await client().fetch(objUrl(key), { method: 'GET' });
    if (r.status === 404) return null;
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error('r2 get failed ' + r.status + ': ' + t.slice(0, 200));
    }
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    return { data, etag: r.headers.get('etag') };
}

// JSON 객체 쓰기. opts.ifMatch 주면 낙관적 동시성(조건부 PUT). 반환 { etag }.
export async function putJson(key, value, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
    const r = await client().fetch(objUrl(key), {
        method: 'PUT',
        body: JSON.stringify(value),
        headers,
    });
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        const err = new Error('r2 put failed ' + r.status + ': ' + t.slice(0, 200));
        err.status = r.status;
        throw err;
    }
    return { etag: r.headers.get('etag') };
}

export async function deleteObject(key) {
    const r = await client().fetch(objUrl(key), { method: 'DELETE' });
    return r.ok;   // 없는 key 삭제도 204
}
