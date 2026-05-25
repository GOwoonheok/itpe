// /api/units
//   GET                 → { title, description, units: [...], source: 'seed' }
//   PUT body: { units: [...] }   관리자만. 단원 목록 전체를 교체 → GitHub commit
//   DELETE              관리자만. 시드 상태로 복원 (현재는 noop — GitHub 에서 직접 되돌리세요)
//
// 저장: 번들 data/index.json — PUT 시 GitHub Contents API 로 커밋, 재배포 후 반영.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAdminRequest } from './_auth.js';
import { commitJson, isConfigured as ghConfigured, notConfiguredResponse } from './_github.js';

let DATA = { units: [] };
try {
    const p = join(process.cwd(), 'data', 'index.json');
    DATA = JSON.parse(readFileSync(p, 'utf8'));
} catch {}

// 단원 객체 sanitize — id/name 필수.
function sanitizeUnit(u) {
    if (!u || typeof u !== 'object') return null;
    const id = String(u.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16);
    if (!id) return null;
    const name = String(u.name || '').trim().slice(0, 40);
    if (!name) return null;
    const out = { id, name };
    if (u.emoji)       out.emoji       = String(u.emoji).trim().slice(0, 8);
    if (u.color)       out.color       = String(u.color).trim().slice(0, 24).replace(/[^#A-Za-z0-9]/g, '').slice(0, 24);
    if (u.description) out.description = String(u.description).trim().slice(0, 120);
    out.file = id + '.json';
    if (typeof u.count === 'number') out.count = Math.max(0, Math.min(99999, u.count | 0));
    return out;
}

export const config = {
    api: { bodyParser: { sizeLimit: '128kb' } },
};

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
        if (!body || !Array.isArray(body.units)) {
            return res.status(400).json({ error: 'units array required' });
        }
        if (body.units.length > 100) {
            return res.status(400).json({ error: 'too many units (max 100)' });
        }
        const units = body.units.map(sanitizeUnit).filter(Boolean);
        const seen = new Set();
        const dedup = [];
        for (const u of units) {
            if (seen.has(u.id)) continue;
            seen.add(u.id);
            dedup.push(u);
        }
        // notebooklmUrl — body 에 명시되면 검증·저장, 미명시면 기존 값 유지 (units 편집 시 보존)
        let notebooklmUrl = (typeof body.notebooklmUrl === 'string') ? body.notebooklmUrl.trim() : DATA.notebooklmUrl;
        if (notebooklmUrl) {
            // 안전: https URL + notebooklm 도메인만 허용
            if (!/^https:\/\/(?:[a-z0-9-]+\.)?notebooklm\.google\.com\//i.test(notebooklmUrl) || notebooklmUrl.length > 500) {
                notebooklmUrl = '';
            }
        }
        const out = {
            title: String(body.title || DATA.title || 'ITPE Flash').slice(0, 60),
            description: String(body.description || DATA.description || '').slice(0, 200),
            ...(notebooklmUrl ? { notebooklmUrl } : {}),
            units: dedup,
        };
        try {
            const r = await commitJson(
                'data/index.json',
                out,
                `chore(units): update unit list (${dedup.length}) by ${auth.email}`
            );
            return res.status(200).json({
                ok: true,
                count: dedup.length,
                commit: r.commit,
                note: '커밋됨 — Vercel 재배포 후 약 30초~1분 뒤 반영됩니다.',
            });
        } catch (e) {
            return res.status(500).json({ error: 'github commit failed', detail: e?.message || String(e) });
        }
    }

    if (req.method === 'DELETE') {
        const auth = await verifyAdminRequest(req);
        if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
        // 시드 복원은 git 로 직접 되돌리는 것이 안전 — API 로는 안 함
        return res.status(501).json({
            error: 'reset not implemented',
            hint: 'data/index.json 을 git revert 또는 수동 편집 후 커밋하세요.',
        });
    }

    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
}
