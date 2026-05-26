// /api/login
//   POST body: { email }
//   응답:
//     - 등록된 관리자: 200 { ok:true, admin:true } + Set-Cookie itpe_admin
//     - 등록된 일반 사용자: 200 { ok:true, admin:false } (쿠키 없음 — 클라이언트 세션만)
//     - 미등록 이메일: 401 { ok:false, error:'not_registered' }

import { isAdminEmail, isRegisteredEmail, setUserCookie } from './_auth.js';

export const config = {
    api: { bodyParser: { sizeLimit: '4kb' } },
};

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method not allowed' });
    }
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
    }
    const email = String(body?.email || '').toLowerCase().trim();

    // 등록 여부 우선 확인
    const registered = await isRegisteredEmail(email);
    if (!registered) {
        return res.status(401).json({ ok: false, error: 'not_registered', message: '등록되지 않은 이메일입니다.' });
    }

    const admin = await isAdminEmail(email);
    // 모든 등록 사용자에게 서명 쿠키 발급 (사용자별 서버 저장용 식별).
    // 관리자 전용 작업은 verifyAdminRequest 가 화이트리스트로 별도 검증하므로 권한 상승 없음.
    try {
        setUserCookie(res, email);
    } catch (e) {
        // 시크릿 미설정 등으로 쿠키 발급 실패해도 로그인 자체는 허용(관리자 기능만 비활성)
        if (admin) return res.status(500).json({ error: 'cookie set failed', detail: e?.message || String(e) });
    }
    return res.status(200).json({ ok: true, admin });
}
