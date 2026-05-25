// /api/users
//   GET  → { registeredEmails, admins, adminContact, source: 'seed' }
//   PUT  body: { registeredEmails: [], admins: [], adminContact?: '' }  관리자만 → GitHub commit
//
// 저장: 번들 data/users.json — PUT 시 GitHub Contents API 로 커밋, 재배포 후 반영.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAdminRequest, invalidateUserCache } from './_auth.js';
import { commitJson, isConfigured as ghConfigured, notConfiguredResponse } from './_github.js';

let DATA = {
    registeredEmails: ['whko337@gmail.com'],
    admins: ['whko337@gmail.com'],
    adminContact: '관리자에게 문의 바랍니다.',
};
try {
    const p = join(process.cwd(), 'data', 'users.json');
    const j = JSON.parse(readFileSync(p, 'utf8'));
    if (j && typeof j === 'object') DATA = j;
} catch {}

function normalize(e) { return String(e || '').toLowerCase().trim(); }
function isValidEmail(e) {
    if (typeof e !== 'string' || e.length === 0 || e.length > 256) return false;
    return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(e);
}
function sanitizeList(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (const v of arr) {
        const e = normalize(v);
        if (!isValidEmail(e) || seen.has(e)) continue;
        seen.add(e);
        out.push(e);
        if (out.length >= 1000) break;
    }
    return out;
}

export const config = {
    api: { bodyParser: { sizeLimit: '256kb' } },
};

// _auth.js 의 verifyAdminRequest 가 사용 — 호환성 위해 export 유지
export async function loadUsersForServer() {
    return DATA;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

    if (req.method === 'GET') {
        return res.status(200).json({ ...DATA, source: 'seed' });
    }

    if (req.method === 'PUT') {
        const auth = await verifyAdminRequest(req);
        if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
        if (!ghConfigured()) return notConfiguredResponse(res);

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
        }
        const registeredEmails = sanitizeList(body?.registeredEmails);
        const adminsRaw = sanitizeList(body?.admins);
        const regSet = new Set(registeredEmails);
        const admins = adminsRaw.filter((e) => regSet.has(e));
        // 본인(요청자)이 admins 에서 빠지지 않도록 강제 포함
        if (auth.email && !admins.includes(auth.email)) {
            admins.push(auth.email);
            if (!regSet.has(auth.email)) registeredEmails.push(auth.email);
        }
        if (registeredEmails.length === 0) {
            return res.status(400).json({ error: 'registeredEmails 가 비어 있을 수 없음' });
        }
        const adminContact = String(body?.adminContact || DATA.adminContact || '').slice(0, 200);
        const out = {
            note: DATA.note || '사용자/관리자 화이트리스트.',
            registeredEmails,
            admins,
            adminContact,
        };

        try {
            const r = await commitJson(
                'data/users.json',
                out,
                `chore(users): update whitelist (${registeredEmails.length} users, ${admins.length} admins) by ${auth.email}`
            );
            invalidateUserCache();
            return res.status(200).json({
                ok: true,
                count: registeredEmails.length,
                adminCount: admins.length,
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
