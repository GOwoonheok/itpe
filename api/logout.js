// /api/logout — 관리자 쿠키 삭제

import { clearAdminCookie } from './_auth.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST' && req.method !== 'GET') {
        res.setHeader('Allow', 'POST, GET');
        return res.status(405).json({ error: 'method not allowed' });
    }
    clearAdminCookie(res);
    return res.status(200).json({ ok: true });
}
