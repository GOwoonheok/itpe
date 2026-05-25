// 관리자 API 호출 헬퍼.
// 인증: 서버가 발급한 HttpOnly 쿠키 itpe_admin (api/_auth.js).
//   - 클라이언트는 시크릿을 보유하지 않음.
//   - 로그인 시 /api/login 호출로 쿠키 발급 (auth.js verifyEmail).
//   - 모든 요청에 credentials:'include' 첨부.
(function () {
    // 호환성 stub — 이전 호출부가 깨지지 않도록 유지
    function getSecret() { return null; }
    function setSecret() {}
    function clearSecret() {
        try { localStorage.removeItem('itpe.adminApiSecret'); } catch {}
    }
    function authHeaders() { return {}; }

    function fetchOpts(extra) {
        const o = Object.assign({ credentials: 'include', cache: 'no-store' }, extra || {});
        return o;
    }

    // 카드 GET — 시드 + Blob 자동 폴백
    async function fetchCards(unitId) {
        const q = '_t=' + Date.now();
        const url = '/api/cards' + (unitId ? '?unit=' + encodeURIComponent(unitId) + '&' + q : '?' + q);
        const r = await fetch(url, fetchOpts());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }
    // 카드 PUT — 쿠키 인증
    async function saveCards(unitId, cards) {
        const r = await fetch('/api/cards?unit=' + encodeURIComponent(unitId), fetchOpts({
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cards),
        }));
        if (!r.ok) {
            const body = await r.text().catch(() => '');
            throw new Error('save failed ' + r.status + ': ' + body);
        }
        return r.json();
    }
    // 이미지 POST — 쿠키 인증
    async function uploadImage(dataUrl) {
        const preview = String(dataUrl || '').slice(0, 100);
        const length = String(dataUrl || '').length;
        console.log('[ITPE upload] sending  len=' + length + '  preview=' + preview);
        const r = await fetch('/api/upload-image', fetchOpts({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl }),
        }));
        if (!r.ok) {
            let detail = null;
            try { detail = await r.json(); } catch { detail = { raw: await r.text().catch(() => '') }; }
            console.error('[ITPE upload] FAILED status=' + r.status
                + '  error=' + (detail && detail.error)
                + '  reason=' + (detail && detail.reason)
                + '  sent_len=' + length
                + '  sent_preview=' + preview);
            const err = new Error('upload failed ' + r.status);
            err.status = r.status;
            err.detail = detail;
            throw err;
        }
        const j = await r.json();
        console.log('[ITPE upload] SUCCESS url=' + (j && j.url));
        return j;
    }

    // 관리자 + 세션 둘 다 활성이어야 admin 모드
    function isAdminWithSecret() {
        return !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
    }
    // 호환 stub — 더 이상 시크릿 입력받지 않음
    async function ensureSecretInteractive() {
        return isAdminWithSecret() ? 'cookie' : null;
    }

    window.ITPEAdmin = {
        getSecret,
        setSecret,
        clearSecret,
        authHeaders,
        fetchCards,
        saveCards,
        uploadImage,
        isAdminWithSecret,
        ensureSecretInteractive,
        fetchOpts, // 다른 모듈이 동일한 옵션을 쓰도록
    };
})();
