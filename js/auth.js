// 인증 게이트 + 사용자 화이트리스트 (data/users.json 시드 + localStorage 오버레이).
// 보호 페이지의 <head>에서 가장 먼저 로드되어야 함.
// 향후 서버 인증으로 교체 시 verifyEmail / signOut / 사용자 관리 API 만 교체하면 됨.
(function () {
    const SESSION_KEY = 'itpe.session';
    const USERS_API   = '/api/users';
    const USERS_SEED  = 'data/users.json';
    const OVERLAY_KEY = 'itpe.userOverlay'; // 레거시 — 더 이상 쓰지 않음. 일회성 정리 대상.
    // 관리자 목록은 users.json 의 admins[] 로 분리. 네트워크 실패 시 폴백.
    const ADMIN_FALLBACK = ['whko337@gmail.com'];

    // 캐시된 admins (페이지 로드당 1회 로드)
    let _adminsCache = null;
    let _adminsPromise = null;

    window.ITPEAuth = {
        getSession,
        signOut,
        loadUsers,
        verifyEmail,
        listEffectiveUsers,
        addUser,
        removeUser,
        setAdmin,
        getSeedAdminContact,
        isAdmin,
        getAdmins: getAdminsList,
        safeRedirect,
        purgeAndReload,
    };

    function isAdmin() {
        const sess = getSession();
        if (!sess) return false;
        const list = _adminsCache || ADMIN_FALLBACK;
        return list.includes(normalize(sess.email));
    }
    function getAdminsList() {
        return (_adminsCache || ADMIN_FALLBACK).slice();
    }
    async function ensureAdminsLoaded() {
        if (_adminsCache) return _adminsCache;
        if (_adminsPromise) return _adminsPromise;
        _adminsPromise = loadUsers().then((u) => {
            const list = Array.isArray(u.admins) && u.admins.length
                ? u.admins.map(normalize)
                : ADMIN_FALLBACK.slice();
            _adminsCache = list;
            return list;
        });
        return _adminsPromise;
    }

    function normalize(e) { return String(e || '').toLowerCase().trim(); }
    function isValidFormat(e) {
        // RFC 5322 단순화 + 길이 제한 (이메일 헤더 한계 320자, 실용적 256자)
        if (typeof e !== 'string' || e.length === 0 || e.length > 256) return false;
        return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(e);
    }

    function getSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }
    function setSession(email) {
        const data = { email: normalize(email), since: Date.now() };
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
        return data;
    }
    function signOut() {
        try { localStorage.removeItem(SESSION_KEY); } catch {}
        // 서버 측 관리자 쿠키도 정리 (실패해도 진행)
        try {
            fetch('/api/logout', { method: 'POST', credentials: 'include', cache: 'no-store' })
                .catch(() => {})
                .finally(() => location.replace('login.html'));
        } catch {
            location.replace('login.html');
        }
    }

    // PWA 캐시·SW 잔재로 인한 로그인 불능 복구용 — 모든 캐시/SW/스토리지 일부 정리 후 리로드
    async function purgeAndReload() {
        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
            }
            if (window.caches && caches.keys) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
            }
        } catch {}
        // 세션·오버레이만 정리 (학습 데이터는 보존)
        try { localStorage.removeItem(SESSION_KEY); } catch {}
        // cache-bust 쿼리로 리로드
        const u = new URL(location.href);
        u.searchParams.set('_t', Date.now().toString());
        location.replace(u.pathname + '?' + u.searchParams.toString());
    }

    async function loadUsers() {
        // 1) /api/users (서버 — Blob 우선)
        try {
            const r = await fetch(USERS_API + '?_t=' + Date.now(), { cache: 'no-store' });
            if (r.ok) {
                const j = await r.json();
                if (j && Array.isArray(j.registeredEmails)) return j;
            }
        } catch {}
        // 2) 번들 시드
        try {
            const res = await fetch(USERS_SEED, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } catch {
            // 최종 폴백
            return {
                registeredEmails: ADMIN_FALLBACK.slice(),
                admins: ADMIN_FALLBACK.slice(),
                adminContact: '관리자에게 문의 바랍니다.',
                _fallback: true,
            };
        }
    }
    async function getSeedAdminContact() {
        const u = await loadUsers();
        return u.adminContact || '관리자에게 문의 바랍니다.';
    }

    async function listEffectiveUsers() {
        const u = await loadUsers();
        const seedSet = new Set((u.registeredEmails || []).map(normalize));
        const adminSet = new Set((u.admins || []).map(normalize));
        return Array.from(seedSet).sort().map((e) => ({
            email: e,
            origin: adminSet.has(e) ? 'admin' : 'user',
            isAdmin: adminSet.has(e),
        }));
    }
    // 서버에 전체 사용자 목록을 PUT — 관리자 쿠키 필요
    async function putUsers(next) {
        const r = await fetch(USERS_API, {
            method: 'PUT',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
        });
        if (!r.ok) {
            let detail = '';
            try { detail = JSON.stringify(await r.json()); } catch {}
            throw new Error('서버 저장 실패 (' + r.status + ') ' + detail);
        }
        return r.json();
    }
    async function addUser(email, opts) {
        const e = normalize(email);
        if (!isValidFormat(e)) throw new Error('올바른 이메일 형식이 아닙니다.');
        const u = await loadUsers();
        const reg = new Set((u.registeredEmails || []).map(normalize));
        const adm = new Set((u.admins || []).map(normalize));
        reg.add(e);
        if (opts && opts.admin) adm.add(e);
        await putUsers({
            registeredEmails: Array.from(reg),
            admins: Array.from(adm),
            adminContact: u.adminContact || '',
        });
        return e;
    }
    async function removeUser(email) {
        const e = normalize(email);
        const sess = getSession();
        if (sess && sess.email === e) throw new Error('현재 로그인한 본인 계정은 삭제할 수 없습니다.');
        const u = await loadUsers();
        const reg = new Set((u.registeredEmails || []).map(normalize));
        const adm = new Set((u.admins || []).map(normalize));
        reg.delete(e);
        adm.delete(e);
        await putUsers({
            registeredEmails: Array.from(reg),
            admins: Array.from(adm),
            adminContact: u.adminContact || '',
        });
        return e;
    }
    async function setAdmin(email, on) {
        const e = normalize(email);
        const u = await loadUsers();
        const reg = new Set((u.registeredEmails || []).map(normalize));
        const adm = new Set((u.admins || []).map(normalize));
        if (!reg.has(e)) throw new Error('등록되지 않은 사용자입니다.');
        if (on) adm.add(e); else adm.delete(e);
        await putUsers({
            registeredEmails: Array.from(reg),
            admins: Array.from(adm),
            adminContact: u.adminContact || '',
        });
        return e;
    }

    async function verifyEmail(email) {
        const e = normalize(email);
        if (!isValidFormat(e)) {
            return { ok: false, reason: 'invalid', message: '올바른 이메일 형식이 아닙니다.' };
        }
        // 서버에 검증 위임 — 서버가 화이트리스트를 단일 출처로 관리
        let resp = null;
        try {
            const r = await fetch('/api/login', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: e }),
            });
            try { resp = await r.json(); } catch {}
            if (r.ok && resp && resp.ok) {
                setSession(e);
                // admins 캐시 채우기 (UI 즉시 반응)
                const u = await loadUsers();
                _adminsCache = Array.isArray(u.admins) && u.admins.length
                    ? u.admins.map(normalize) : ADMIN_FALLBACK.slice();
                return { ok: true, admin: !!resp.admin };
            }
            // 401 — 미등록
            if (r.status === 401) {
                const u = await loadUsers();
                return {
                    ok: false,
                    reason: 'notRegistered',
                    message: '등록되지 않은 계정입니다. ' + (u.adminContact || '관리자에게 문의 바랍니다.'),
                };
            }
        } catch (err) {
            console.warn('[ITPEAuth] /api/login 오류:', err);
        }
        return {
            ok: false,
            reason: 'fetchFailed',
            message: '서버 인증에 실패했습니다. 네트워크 상태를 확인하거나 잠시 후 다시 시도해주세요.',
        };
    }

    // Open Redirect 방지 — 같은 origin 이고 허용된 페이지만 통과
    function safeRedirect(target) {
        const ALLOWED = ['index.html', 'flash.html', 'admin.html'];
        if (!target || typeof target !== 'string') return 'index.html';
        // 절대 URL 차단
        if (/^[a-z][a-z0-9+.\-]*:/i.test(target) || target.startsWith('//')) return 'index.html';
        // 경로 분리
        const [pathPart, query = ''] = target.split('?');
        const clean = pathPart.replace(/^\.?\/+/, '').replace(/^\.+\//, '');
        const base = clean.split('/').pop();
        if (!ALLOWED.includes(base)) return 'index.html';
        // 쿼리에 허용 문자만 (영숫자·=·&·-·_·%·.·,·:·/·공백 제외)
        const safeQuery = query
            .split('&')
            .filter((kv) => /^[A-Za-z0-9._=\-%]+(=[A-Za-z0-9._\-%]*)?$/.test(kv))
            .join('&');
        return safeQuery ? base + '?' + safeQuery : base;
    }

    // 일회성 마이그레이션 — 각 브라우저에서 한 번만 실행되어 잔재 localStorage 정리.
    // 이후 마이그레이션이 추가될 때마다 키를 증가시키고 cleanups 에 항목을 더한다.
    (function runOneShotMigrations() {
        const MIG_KEY = 'itpe.migrations';
        let done = {};
        try { done = JSON.parse(localStorage.getItem(MIG_KEY) || '{}') || {}; } catch {}
        const migrations = {
            // 2026-05-24: 사용자 화이트리스트 서버화 — 레거시 localStorage 오버레이 정리
            'remove-user-overlay-v1': () => {
                try { localStorage.removeItem('itpe.userOverlay'); } catch {}
            },
            // 2026-05-23: AI 단원 사용자 입력 잔재 정리 (시드 재배포 동기화)
            'clear-ai-user-data-v1': () => {
                ['itpe.userCards.ai',
                 'itpe.cardEdits.ai',
                 'itpe.removedJson.ai',
                 'itpe.checked.ai',
                 'itpe.hidden.ai'].forEach((k) => {
                    try { localStorage.removeItem(k); } catch {}
                });
            },
            // 2026-05-23: SW v34 강제 갱신 — Vercel Blob 동기화 코드 반영 못 받은 사용자 우회
            'force-sw-refresh-v34': async () => {
                if ('serviceWorker' in navigator) {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(regs.map((r) => r.update().catch(() => false)));
                    } catch {}
                }
            },
            // 2026-05-23: 단원 진입 항상 모드 선택 강제 + lastPosition 자동 복귀 제거 (v42)
            'always-mode-select-v42': async () => {
                if ('serviceWorker' in navigator) {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const r of regs) {
                            try { await r.update(); } catch {}
                        }
                    } catch {}
                }
                if (window.caches && caches.keys) {
                    try {
                        const keys = await caches.keys();
                        // 옛 캐시(v41 이하) 제거
                        const oldKeys = keys.filter((k) => k.startsWith('itpe-flash-v') && k !== 'itpe-flash-v42');
                        await Promise.all(oldKeys.map((k) => caches.delete(k).catch(() => false)));
                    } catch {}
                }
            },
        };
        let changed = false;
        for (const id of Object.keys(migrations)) {
            if (done[id]) continue;
            try { migrations[id](); done[id] = Date.now(); changed = true; } catch {}
        }
        if (changed) {
            try { localStorage.setItem(MIG_KEY, JSON.stringify(done)); } catch {}
        }
    })();

    // 보호 페이지에서만 게이트 작동 — login.html / reset.html 은 통과
    const path = location.pathname.toLowerCase();
    const isOpenPage = path.endsWith('/login.html') || path.endsWith('/reset.html');
    // admins 사전 로드 (관리자 UI 노출 결정 전에 완료되도록)
    ensureAdminsLoaded().catch(() => {});
    if (isOpenPage) return;

    if (!getSession()) {
        const redirect = location.pathname + location.search;
        location.replace('login.html?redirect=' + encodeURIComponent(redirect));
        return;
    }

    // 세션은 있지만 서버 쿠키가 만료/소실됐을 수 있음 — 페이지 로드 시 1회 자동 재발급.
    // 폐기/미등록 이메일이면 401 받고 자동 로그아웃 (서버를 단일 출처로 강제).
    (async function refreshServerSession() {
        try {
            const sess = getSession();
            if (!sess || !sess.email) return;
            const r = await fetch('/api/login', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: sess.email }),
            });
            if (r.status === 401) {
                // 서버가 더 이상 인정 안 함 — 로컬 세션 정리
                try { localStorage.removeItem(SESSION_KEY); } catch {}
                location.replace('login.html?reason=revoked');
            }
        } catch {
            // 네트워크 실패는 무시 — 캐시된 SW 가 처리하거나 다음 로드에 재시도
        }
    })();
})();
