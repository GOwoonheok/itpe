// 관리자 도구 — 세 페이지에서 다른 역할 수행.
//
// index.html  (시트 목록)  ▸ 관리자만, 시트 목록에 "12. 관리자 도구" 진입 항목 추가
// admin.html  (관리자 페이지) ▸ 엑셀 일괄 관리 + 사용자 관리 풀 UI
// flash.html  (모드 선택)    ▸ 이 단원 한정 엑셀 업로드 + 4단계 진행
//
// 권한: ADMINS 배열에 포함된 이메일만 관리자 기능 사용 가능.
// 비관리자가 admin.html 에 접근하면 알림 후 시트 목록으로 리다이렉트.
(function () {
    const COLS = ['단원ID', '단원명', '분류', '토픽', '내용', '두음', '키워드', '이미지수', '출처'];
    const COL_WIDTHS = [10, 10, 14, 24, 50, 36, 28, 8, 8];
    const UNIT_COLS = ['분류', '토픽', '내용', '두음', '키워드'];
    const UNIT_COL_WIDTHS = [14, 24, 50, 36, 28];
    // CDN 라이브러리 — 무결성 해시(SRI) 검증 적용
    const CDN = {
        xlsx: {
            url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
            integrity: 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
            global: 'XLSX',
        },
        jszip: {
            url: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
            integrity: 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG',
            global: 'JSZip',
        },
    };

    const sess = window.ITPEAuth && window.ITPEAuth.getSession();
    const email = sess && sess.email ? sess.email.toLowerCase().trim() : null;
    const isAdmin = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());

    function loadCdnScript(name) {
        const cfg = CDN[name];
        if (!cfg) return Promise.reject(new Error('unknown lib: ' + name));
        if (window[cfg.global]) return Promise.resolve(window[cfg.global]);
        if (cfg._promise) return cfg._promise;
        cfg._promise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = cfg.url;
            s.async = true;
            s.crossOrigin = 'anonymous';
            s.integrity = cfg.integrity;
            s.referrerPolicy = 'no-referrer';
            s.onload = () => resolve(window[cfg.global]);
            s.onerror = () => reject(new Error(name + ' 라이브러리 로드 실패 (무결성 검증 실패 가능)'));
            document.head.appendChild(s);
        });
        return cfg._promise;
    }
    const loadXlsx  = () => loadCdnScript('xlsx');
    const loadJSZip = () => loadCdnScript('jszip');

    // ───────────── 공용 헬퍼 ─────────────
    async function loadIndex() {
        const res = await fetch('data/index.json', { cache: 'no-store' });
        return res.json();
    }
    async function loadJsonCards(unit) {
        try {
            const res = await fetch(`data/cards/${unit.file}`, { cache: 'no-store' });
            return await res.json();
        } catch { return []; }
    }
    function loadUserCards(unitId) {
        try {
            const raw = localStorage.getItem('itpe.userCards.' + unitId);
            return raw ? (JSON.parse(raw) || []) : [];
        } catch { return []; }
    }
    function saveUserCards(unitId, cards) {
        localStorage.setItem('itpe.userCards.' + unitId, JSON.stringify(cards));
    }
    function cardToRow(card, unit, source) {
        const imgs = Array.isArray(card.images) ? card.images.length : (card.image ? 1 : 0);
        return {
            [COLS[0]]: unit.id, [COLS[1]]: unit.name,
            [COLS[2]]: card.category ?? '',
            [COLS[3]]: card.topic ?? card.q ?? '',
            [COLS[4]]: card.definition ?? card.a ?? '',
            [COLS[5]]: card.mnemonic ?? '',
            [COLS[6]]: card.keyword ?? '',
            [COLS[7]]: imgs, [COLS[8]]: source,
        };
    }
    function rowToCard(row) {
        const get = (k) => String(row[k] ?? '').trim();
        // 토픽 — 셀 안의 줄바꿈·다중 공백을 한 칸으로 정규화해 한 줄로 통합
        const topicRaw = String(row['토픽'] ?? '');
        const topic = topicRaw.replace(/\s+/g, ' ').trim();
        if (!topic) return null;
        return {
            category:   get('분류'),
            topic,
            // '내용' 컬럼 우선, '정의'는 옛 호환
            definition: get('내용') || get('정의'),
            mnemonic:   get('두음'),
            keyword:    get('키워드'),
            // 옛 엑셀 호환 — 추가설명 컬럼 있으면 가져옴 (없으면 빈)
            extra:      get('추가설명'),
            userId: 'u' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            createdAt: new Date().toISOString(),
        };
    }
    function normalizeTopic(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    function cardTopic(c) { return c.topic ?? c.q ?? ''; }
    function downloadWorkbook(wb, filename) {
        XLSX.writeFile(wb, filename, { bookType: 'xlsx', compression: true });
    }
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    // 카드용 안정 키 (flash.js와 같은 규칙)
    function cardKey(c) {
        if (!c) return '';
        if (c.userId) return 'u:' + c.userId;
        const t = (c.topic ?? c.q ?? '').slice(0, 60);
        return 'j:' + t;
    }
    function loadRemovedJson(uid) {
        try {
            const raw = localStorage.getItem('itpe.removedJson.' + uid);
            return raw ? (JSON.parse(raw) || []) : [];
        } catch { return []; }
    }
    function loadCardEditsLocal(uid) {
        try {
            const raw = localStorage.getItem('itpe.cardEdits.' + uid);
            return raw ? (JSON.parse(raw) || {}) : {};
        } catch { return {}; }
    }

    // 배포용 카드 객체 — 디바이스 전용 메타(userId, createdAt 등) 제거
    function packCardForJson(card) {
        const out = {};
        const topic = card.topic ?? card.q ?? '';
        const def   = card.definition ?? card.a ?? '';
        if (topic) out.topic = topic;
        if (def)   out.definition = def;
        if (card.mnemonic) out.mnemonic = card.mnemonic;
        if (card.keyword)  out.keyword  = card.keyword;
        if (card.extra)    out.extra    = card.extra;
        if (Array.isArray(card.images) && card.images.length) out.images = card.images.slice();
        else if (card.image) out.image = card.image;
        return out;
    }
    function todayTag() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    }
    function tick(ms) { return new Promise((r) => setTimeout(r, ms)); }
    function setStatus(id, msg, kind) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'admin-status' + (kind ? ' admin-status-' + kind : '');
    }

    // ============================================================
    // 1) index.html — 하단 툴바 중앙에 관리자 아이콘 버튼
    // ============================================================
    function bootIndexEntry() {
        if (!isAdmin) return;
        const mid = document.getElementById('nav-mid');
        if (!mid || document.getElementById('btn-admin-go')) return;
        const a = document.createElement('a');
        a.id = 'btn-admin-go';
        a.className = 'nav-admin-btn';
        a.href = 'admin.html';
        a.setAttribute('aria-label', '관리자 도구');
        const icon = document.createElement('span');
        icon.className = 'nav-admin-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🛠';
        const lbl = document.createElement('span');
        lbl.className = 'nav-admin-label';
        lbl.textContent = '관리자';
        a.append(icon, lbl);
        mid.appendChild(a);
    }

    // ============================================================
    // 2) admin.html — 풀 관리자 UI
    // ============================================================
    function renderNotAdmin(root) {
        while (root.firstChild) root.removeChild(root.firstChild);
        const wrap = document.createElement('div');
        wrap.className = 'empty-state admin-empty';
        const p1 = document.createElement('p');
        p1.textContent = '관리자 권한이 필요합니다.';
        const p2 = document.createElement('p');
        p2.className = 'admin-empty-link';
        const a = document.createElement('a');
        a.href = 'index.html';
        a.textContent = '시트 목록으로 돌아가기';
        p2.appendChild(a);
        wrap.append(p1, p2);
        root.appendChild(wrap);
    }
    function renderAdminUI(root) {
        // 정적 골격은 DOM API 로 안전하게 조립 (사용자 입력 절대 보간 안 함)
        while (root.firstChild) root.removeChild(root.firstChild);

        // 패널 1 — 엑셀/JSON 관리
        const p1 = h('section', 'admin-panel');
        p1.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('📊 엑셀 일괄 관리')),
            h('span', 'admin-badge', t(email || ''))
        ));
        p1.appendChild(h('p', 'admin-hint', t('JSON 카드는 영향 없이 사용자 추가 카드만 관리됩니다.')));
        const btns = h('div', 'admin-btns');
        btns.appendChild(makeBtn('admin-btn admin-btn-tpl',  'btn-tpl',  '📥 템플릿 다운로드'));
        const upLabel = h('label', 'admin-btn admin-btn-up', t('📤 엑셀 업로드'));
        upLabel.setAttribute('for', 'admin-import-file');
        const upInput = document.createElement('input');
        upInput.id = 'admin-import-file';
        upInput.type = 'file';
        upInput.accept = '.xlsx,.xls';
        upInput.hidden = true;
        upLabel.appendChild(upInput);
        btns.appendChild(upLabel);
        btns.appendChild(makeBtn('admin-btn admin-btn-dl',   'btn-export',      '📊 엑셀 다운로드'));
        btns.appendChild(makeBtn('admin-btn admin-btn-json', 'btn-export-json', '⬇ JSON 일괄 다운로드'));
        p1.appendChild(btns);
        const st1 = h('p', 'admin-status'); st1.id = 'admin-status'; p1.appendChild(st1);
        root.appendChild(p1);

        // 패널 2 — 사용자 관리
        const p2 = h('section', 'admin-panel');
        const cnt = h('span', 'user-mgmt-count', t('…')); cnt.id = 'user-count';
        p2.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('👤 사용자 관리')),
            cnt
        ));
        p2.appendChild(h('p', 'admin-hint', t('등록된 이메일만 로그인 가능합니다. 사용자 목록은 Vercel Blob 에 저장되어 모든 기기에서 즉시 공유됩니다.')));
        const ul = h('ul', 'user-list'); ul.id = 'user-list'; p2.appendChild(ul);
        const form = h('form', 'user-add'); form.id = 'user-add-form';
        const input = document.createElement('input');
        input.className = 'form-input';
        input.type = 'email';
        input.id = 'user-add-input';
        input.maxLength = 256;
        input.autocomplete = 'off';
        input.placeholder = '새 이메일 추가';
        form.appendChild(input);
        form.appendChild(makeBtn('admin-btn admin-btn-up', '', '추가', 'submit'));
        p2.appendChild(form);
        p2.appendChild(h('p', 'user-mgmt-hint', t('이메일은 서버(Vercel Blob)에 저장되며 로그인 시 화이트리스트로 검증됩니다.')));
        const st2 = h('p', 'admin-status'); st2.id = 'user-status'; p2.appendChild(st2);
        root.appendChild(p2);
    }
    function h(tag, cls, ...children) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        children.forEach((c) => {
            if (c == null) return;                        // null/undefined 무시
            if (typeof c === 'string' || typeof c === 'number') {
                el.appendChild(document.createTextNode(String(c)));
                return;
            }
            if (c instanceof Node) el.appendChild(c);
        });
        return el;
    }
    function t(s) { return document.createTextNode(String(s)); }
    function makeBtn(cls, id, label, type) {
        const b = document.createElement('button');
        b.className = cls;
        if (id) b.id = id;
        b.type = type || 'button';
        b.textContent = label;
        return b;
    }

    // 🔑 서버 동기화 상태 패널 — 쿠키 기반 인증으로 전환됨.
    // 시크릿 입력 UI 는 제거되고 현재 세션 상태와 연결 테스트만 노출.
    function renderApiSecretPanel() {
        const root = document.getElementById('admin-root');
        if (!root || !window.ITPEAdmin) return;

        const isAdminSession = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());

        const panel = h('section', 'admin-panel');
        panel.id = 'api-secret-panel';
        panel.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('☁ 서버 동기화 (Vercel Blob)')),
            h('span', 'admin-badge api-status ' + (isAdminSession ? 'badge-on' : 'badge-off'),
                t(isAdminSession ? '✅ 활성 (쿠키 세션)' : '⚠ 관리자 로그인 필요')
            )
        ));

        const banner = h('div', 'sync-banner ' + (isAdminSession ? 'sync-on' : 'sync-off'));
        if (isAdminSession) {
            banner.appendChild(h('p', 'sync-banner-title', t('☁ 서버 저장 활성 — 모든 기기 공유')));
            banner.appendChild(h('p', 'sync-banner-desc',
                t('관리자 로그인 시 발급된 HttpOnly 쿠키로 인증됩니다. 카드·이미지·단원·AI 프롬프트 변경이 자동으로 Vercel Blob 에 저장되어, 다른 PC·핸드폰에서도 즉시 같은 데이터를 봅니다. 클라이언트에는 시크릿이 저장되지 않습니다.')));
        } else {
            banner.appendChild(h('p', 'sync-banner-title', t('⚠ 비관리자 — 읽기 전용')));
            banner.appendChild(h('p', 'sync-banner-desc',
                t('관리자 이메일로 로그인하면 자동으로 서버 저장이 활성화됩니다.')));
        }
        panel.appendChild(banner);

        const btns = h('div', 'admin-btns', null);
        btns.style.marginTop = '10px';
        btns.appendChild(makeBtn('admin-btn admin-btn-dl', 'api-test-btn', '🔬 연결 테스트', 'button'));
        btns.appendChild(makeBtn('admin-btn admin-btn-tpl', 'api-logout-btn', '🚪 관리자 로그아웃', 'button'));
        panel.appendChild(btns);

        const st = h('p', 'admin-status'); st.id = 'api-secret-status';
        panel.appendChild(st);
        root.appendChild(panel);

        document.getElementById('api-test-btn').addEventListener('click', async () => {
            setStatus('api-secret-status', '서버 연결 테스트 중…');
            const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            try {
                const r = await window.ITPEAdmin.uploadImage(tinyPng);
                if (r && r.url) {
                    setStatus('api-secret-status', '✅ 연결 성공! 쿠키 세션 정상.\n업로드 URL: ' + r.url, 'ok');
                } else {
                    setStatus('api-secret-status', '⚠ 응답에 url 없음: ' + JSON.stringify(r), 'err');
                }
            } catch (e) {
                const status = e?.status;
                const reason = e?.detail?.reason;
                let hint = '';
                if (status === 401) hint = ' (관리자 로그아웃 상태이거나 쿠키 만료 — 다시 로그인 필요)';
                setStatus('api-secret-status', '❌ 연결 실패: ' + (e?.message || e) + (reason ? ' [' + reason + ']' : '') + hint, 'err');
            }
        });
        document.getElementById('api-logout-btn').addEventListener('click', async () => {
            if (!confirm('관리자 세션을 종료하고 로그인 화면으로 이동합니다. 계속할까요?')) return;
            try {
                window.ITPEAuth.signOut();
            } catch (e) {
                setStatus('api-secret-status', '로그아웃 실패: ' + (e?.message || e), 'err');
            }
        });
    }

    // 🤖 AI 시스템 프롬프트 편집 패널 — admin.html 전용 (kind='full'|'def')
    function renderAiPromptPanel(kind) {
        const root = document.getElementById('admin-root');
        if (!root || !window.ITPEAdmin) return;
        const k = (kind === 'def') ? 'def' : 'full';
        const title = (k === 'def') ? '✏ AI 정의 전용 프롬프트' : '🤖 AI 시스템 프롬프트 (전체)';
        const badge = (k === 'def') ? '정의만 재생성' : 'Gemini 2.5 Flash';
        const hint  = (k === 'def')
            ? '카드 추가 모달의 "AI 채우기 (정의)" 버튼이 사용하는 프롬프트입니다. 30자 이내 정의 한 줄만 생성. 빈 값 저장 = 기본값 복원.'
            : 'AI 자동 생성(jm 단원 + 카드 추가 모달 "AI 채우기")에서 사용할 프롬프트입니다. 빈 값으로 저장하면 기본값 복원. Vercel Blob 저장.';
        const ids = {
            panel:   'ai-prompt-panel-'   + k,
            input:   'ai-prompt-input-'   + k,
            load:    'ai-prompt-load-'    + k,
            save:    'ai-prompt-save-'    + k,
            reset:   'ai-prompt-reset-'   + k,
            status:  'ai-prompt-status-'  + k,
            defPre:  'ai-prompt-default-' + k,
        };

        const panel = h('section', 'admin-panel');
        panel.id = ids.panel;
        panel.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t(title)),
            h('span', 'admin-badge', t(badge))
        ));
        panel.appendChild(h('p', 'admin-hint', t(hint)));
        const ta = document.createElement('textarea');
        ta.id = ids.input;
        ta.className = 'form-input form-area';
        ta.rows = (k === 'def') ? 10 : 14;
        ta.placeholder = '시스템 프롬프트 (기본값 사용 시 비워두기)';
        panel.appendChild(ta);
        const btns = h('div', 'admin-btns', null);
        btns.style.marginTop = '8px';
        btns.appendChild(makeBtn('admin-btn admin-btn-dl',   ids.load,  '📥 현재 값 불러오기', 'button'));
        btns.appendChild(makeBtn('admin-btn admin-btn-up',   ids.save,  '💾 저장 (Blob)',       'button'));
        btns.appendChild(makeBtn('admin-btn admin-btn-tpl',  ids.reset, '↺ 기본값으로 복원',    'button'));
        panel.appendChild(btns);
        const st = h('p', 'admin-status'); st.id = ids.status;
        panel.appendChild(st);
        const dump = h('details', 'ai-prompt-default');
        const sum = document.createElement('summary'); sum.textContent = '기본 프롬프트 보기';
        dump.appendChild(sum);
        const pre = document.createElement('pre'); pre.id = ids.defPre; pre.className = 'ai-prompt-default-pre';
        dump.appendChild(pre);
        panel.appendChild(dump);
        root.appendChild(panel);

        document.getElementById(ids.load).addEventListener('click',  () => loadAiPrompt(k));
        document.getElementById(ids.save).addEventListener('click',  () => saveAiPrompt(k));
        document.getElementById(ids.reset).addEventListener('click', () => resetAiPrompt(k));
        if (window.ITPEAdmin.isAdminWithSecret()) loadAiPrompt(k);
    }

    async function loadAiPrompt(kind) {
        const k = (kind === 'def') ? 'def' : 'full';
        const ta  = document.getElementById('ai-prompt-input-'   + k);
        const pre = document.getElementById('ai-prompt-default-' + k);
        const statusId = 'ai-prompt-status-' + k;
        setStatus(statusId, '불러오는 중…');
        try {
            const r = await fetch('/api/ai-prompt?kind=' + k + '&_t=' + Date.now(), {
                cache: 'no-store',
                credentials: 'include',
            });
            if (!r.ok) {
                if (r.status === 401) { setStatus(statusId, '관리자 권한 없음 — 다시 로그인 필요', 'err'); return; }
                throw new Error('HTTP ' + r.status);
            }
            const j = await r.json();
            ta.value = j.prompt || '';
            if (pre) pre.textContent = j.defaultPrompt || '';
            setStatus(statusId,
                j.isDefault ? '✓ 기본 프롬프트 사용 중 (' + j.length + '자)' : '✓ 사용자 정의 프롬프트 로드됨 (' + j.length + '자)',
                'ok'
            );
        } catch (e) {
            setStatus(statusId, '로드 실패: ' + (e?.message || e), 'err');
        }
    }
    async function saveAiPrompt(kind) {
        const k = (kind === 'def') ? 'def' : 'full';
        const ta = document.getElementById('ai-prompt-input-' + k);
        const statusId = 'ai-prompt-status-' + k;
        const prompt = ta.value || '';
        setStatus(statusId, '저장 중…');
        try {
            const r = await fetch('/api/ai-prompt', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, kind: k }),
            });
            if (!r.ok) {
                let detail = ''; try { detail = JSON.stringify(await r.json()); } catch {}
                throw new Error('HTTP ' + r.status + ' ' + detail);
            }
            const j = await r.json();
            setStatus(statusId,
                j.reset ? '✓ 기본값으로 복원됨' : '✓ 저장 완료 (' + j.length + '자) — 1분 내 적용',
                'ok'
            );
        } catch (e) {
            setStatus(statusId, '저장 실패: ' + (e?.message || e), 'err');
        }
    }
    async function resetAiPrompt(kind) {
        const k = (kind === 'def') ? 'def' : 'full';
        if (!confirm('사용자 정의 프롬프트를 삭제하고 기본값으로 복원합니다. 계속할까요?')) return;
        document.getElementById('ai-prompt-input-' + k).value = '';
        await saveAiPrompt(k);
        await loadAiPrompt(k);
    }

    // ─────────────────────────────────────────────────────────────
    // 📚 단원(시트) 관리 패널 — admin.html 전용
    // GET /api/units → 로드, PUT /api/units → 저장
    // ─────────────────────────────────────────────────────────────
    let unitsState = []; // 편집 중인 단원 배열

    function renderUnitsPanel() {
        const root = document.getElementById('admin-root');
        if (!root || !window.ITPEAdmin) return;

        const panel = h('section', 'admin-panel');
        panel.id = 'units-panel';
        panel.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('📚 단원(시트) 관리')),
            h('span', 'admin-badge', t('순서·추가·삭제·이름변경'))
        ));
        panel.appendChild(h('p', 'admin-hint', t(
            '단원 목록을 추가·삭제·이동(↑↓)할 수 있습니다. 저장하면 Vercel Blob (units.json) 에 반영되어 모든 기기에서 즉시 보입니다. ' +
            'ID(영문 소문자/숫자/-) 는 카드 저장 키(파일명) 가 되므로 신중하게. 기존 ID 의 이름·이모지·색은 변경 가능.'
        )));

        const list = document.createElement('div');
        list.id = 'units-list';
        list.className = 'units-list';
        panel.appendChild(list);

        // 추가 폼
        const addForm = h('div', 'units-add');
        addForm.style.cssText = 'display:grid; grid-template-columns: 100px 1fr 60px 90px 1fr 90px; gap:6px; margin-top:10px; align-items:end;';
        addForm.appendChild(labeled('ID', mkInput('units-add-id', 'id (예: cd)', 16)));
        addForm.appendChild(labeled('이름', mkInput('units-add-name', '이름 (예: 클라우드)', 40)));
        addForm.appendChild(labeled('이모지', mkInput('units-add-emoji', '☁️', 8)));
        addForm.appendChild(labeled('색상', mkInput('units-add-color', '#2980b9', 24)));
        addForm.appendChild(labeled('설명', mkInput('units-add-desc', '설명 (선택)', 120)));
        const addBtn = makeBtn('admin-btn admin-btn-up', 'units-add-btn', '+ 추가', 'button');
        addBtn.style.height = '36px';
        addForm.appendChild(addBtn);
        panel.appendChild(addForm);

        // 액션 버튼
        const actions = h('div', 'admin-btns', null);
        actions.style.marginTop = '12px';
        actions.appendChild(makeBtn('admin-btn admin-btn-dl',  'units-load',  '📥 다시 불러오기', 'button'));
        actions.appendChild(makeBtn('admin-btn admin-btn-up',  'units-save',  '💾 저장 (Blob)',  'button'));
        actions.appendChild(makeBtn('admin-btn admin-btn-tpl', 'units-reset', '↺ 시드(번들)로 복원', 'button'));
        panel.appendChild(actions);

        const st = h('p', 'admin-status'); st.id = 'units-status';
        panel.appendChild(st);

        root.appendChild(panel);

        document.getElementById('units-load').addEventListener('click',  loadUnits);
        document.getElementById('units-save').addEventListener('click',  saveUnits);
        document.getElementById('units-reset').addEventListener('click', resetUnits);
        addBtn.addEventListener('click', addUnitFromForm);
        loadUnits();
    }

    function labeled(label, input) {
        const wrap = document.createElement('div');
        const lab = document.createElement('label');
        lab.textContent = label;
        lab.className = 'admin-hint';
        lab.style.cssText = 'display:block; margin-bottom:2px; font-size:0.78rem;';
        lab.setAttribute('for', input.id);
        wrap.appendChild(lab);
        wrap.appendChild(input);
        return wrap;
    }
    function mkInput(id, ph, maxLen) {
        const i = document.createElement('input');
        i.id = id; i.type = 'text'; i.className = 'form-input';
        i.placeholder = ph;
        if (maxLen) i.maxLength = maxLen;
        i.style.cssText = 'width:100%; padding:6px 8px; font-size:0.9rem;';
        return i;
    }

    function renderUnitsList() {
        const list = document.getElementById('units-list');
        if (!list) return;
        list.replaceChildren();
        if (unitsState.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'admin-hint';
            empty.textContent = '단원이 없습니다. 아래에서 추가하세요.';
            list.appendChild(empty);
            return;
        }
        unitsState.forEach((u, i) => {
            const row = h('div', 'units-row');
            row.style.cssText = 'display:grid; grid-template-columns: 28px 70px 100px 1fr 50px 90px 1fr 140px; gap:6px; padding:6px 4px; align-items:center; border-bottom:1px solid var(--border, #2a2f3a);';

            const idx = document.createElement('span');
            idx.textContent = String(i + 1);
            idx.style.cssText = 'color:var(--muted, #888); text-align:right; font-variant-numeric:tabular-nums;';
            row.appendChild(idx);

            const idEl = document.createElement('code');
            idEl.textContent = u.id;
            idEl.style.cssText = 'font-size:0.82rem; color:var(--muted, #aaa); overflow:hidden; text-overflow:ellipsis;';
            row.appendChild(idEl);

            row.appendChild(mkRowInput(u, 'emoji', '이모지', 8));
            row.appendChild(mkRowInput(u, 'name',  '이름',  40));
            row.appendChild(mkRowColor(u));
            row.appendChild(mkRowInput(u, 'description', '설명', 120));

            const cnt = document.createElement('span');
            cnt.textContent = (typeof u.count === 'number') ? (u.count + ' 카드') : '';
            cnt.className = 'admin-hint';
            cnt.style.cssText = 'font-size:0.78rem; text-align:right;';
            row.appendChild(cnt);

            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex; gap:4px; justify-content:flex-end;';
            const up   = mkSmallBtn('↑', '위로');
            const dn   = mkSmallBtn('↓', '아래로');
            const del  = mkSmallBtn('🗑', '삭제');
            up.disabled = (i === 0);
            dn.disabled = (i === unitsState.length - 1);
            up.addEventListener('click',  () => moveUnit(i, -1));
            dn.addEventListener('click',  () => moveUnit(i, +1));
            del.addEventListener('click', () => deleteUnit(i));
            btns.appendChild(up); btns.appendChild(dn); btns.appendChild(del);
            row.appendChild(btns);

            list.appendChild(row);
        });
    }
    function mkRowInput(unit, field, ph, maxLen) {
        const i = document.createElement('input');
        i.type = 'text'; i.className = 'form-input';
        i.placeholder = ph;
        i.value = unit[field] || '';
        if (maxLen) i.maxLength = maxLen;
        i.style.cssText = 'width:100%; padding:4px 6px; font-size:0.85rem;';
        i.addEventListener('input', () => { unit[field] = i.value; });
        return i;
    }
    function mkRowColor(unit) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; gap:4px; align-items:center;';
        const c = document.createElement('input');
        c.type = 'color';
        c.value = (unit.color && /^#[0-9a-fA-F]{6}$/.test(unit.color)) ? unit.color : '#2980b9';
        c.style.cssText = 'width:32px; height:28px; padding:0; border:1px solid var(--border, #444); border-radius:4px; cursor:pointer;';
        c.addEventListener('input', () => { unit.color = c.value; });
        wrap.appendChild(c);
        return wrap;
    }
    function mkSmallBtn(label, title) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.className = 'admin-btn';
        b.style.cssText = 'padding:4px 8px; font-size:0.85rem; min-width:32px;';
        return b;
    }

    function moveUnit(i, dir) {
        const j = i + dir;
        if (j < 0 || j >= unitsState.length) return;
        const [u] = unitsState.splice(i, 1);
        unitsState.splice(j, 0, u);
        renderUnitsList();
    }
    function deleteUnit(i) {
        const u = unitsState[i];
        if (!u) return;
        if (!confirm('단원 "' + (u.name || u.id) + '" 을(를) 목록에서 제거합니다. (카드 데이터는 Blob 에 남아있음) 계속할까요?')) return;
        unitsState.splice(i, 1);
        renderUnitsList();
    }
    function addUnitFromForm() {
        const id    = (document.getElementById('units-add-id').value    || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16);
        const name  = (document.getElementById('units-add-name').value  || '').trim().slice(0, 40);
        const emoji = (document.getElementById('units-add-emoji').value || '').trim().slice(0, 8);
        const color = (document.getElementById('units-add-color').value || '').trim().slice(0, 24);
        const desc  = (document.getElementById('units-add-desc').value  || '').trim().slice(0, 120);
        if (!id)   { setStatus('units-status', 'ID 필수 (영문 소문자·숫자·-)', 'err'); return; }
        if (!name) { setStatus('units-status', '이름 필수', 'err'); return; }
        if (unitsState.some((u) => u.id === id)) { setStatus('units-status', '중복된 ID: ' + id, 'err'); return; }
        unitsState.push({ id, name, emoji, color: color || '#2980b9', description: desc, file: id + '.json', count: 0 });
        ['units-add-id', 'units-add-name', 'units-add-emoji', 'units-add-color', 'units-add-desc']
            .forEach((eid) => { const el = document.getElementById(eid); if (el) el.value = ''; });
        renderUnitsList();
        setStatus('units-status', '✓ "' + name + '" 추가됨 (저장 전이라 아직 반영 안 됨)', 'ok');
    }

    async function loadUnits() {
        setStatus('units-status', '불러오는 중…');
        try {
            const r = await fetch('/api/units?_t=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            unitsState = Array.isArray(j.units) ? j.units.map((u) => ({ ...u })) : [];
            renderUnitsList();
            setStatus('units-status', '✓ ' + unitsState.length + '개 단원 (' + j.source + ')', 'ok');
        } catch (e) {
            setStatus('units-status', '로드 실패: ' + (e?.message || e), 'err');
        }
    }
    async function saveUnits() {
        if (!window.ITPEAdmin || !window.ITPEAdmin.isAdminWithSecret()) {
            setStatus('units-status', '관리자 권한 없음 — 다시 로그인 필요', 'err'); return;
        }
        setStatus('units-status', '저장 중…');
        try {
            const r = await fetch('/api/units', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ units: unitsState }),
            });
            if (!r.ok) {
                let detail = ''; try { detail = JSON.stringify(await r.json()); } catch {}
                throw new Error('HTTP ' + r.status + ' ' + detail);
            }
            const j = await r.json();
            setStatus('units-status', '✓ ' + j.count + '개 저장됨 — 메인 화면 새로고침 시 반영', 'ok');
        } catch (e) {
            setStatus('units-status', '저장 실패: ' + (e?.message || e), 'err');
        }
    }
    async function resetUnits() {
        if (!window.ITPEAdmin || !window.ITPEAdmin.isAdminWithSecret()) {
            setStatus('units-status', '관리자 권한 없음', 'err'); return;
        }
        if (!confirm('단원 목록을 번들 시드(data/index.json)로 되돌립니다. 사용자 정의 단원 목록이 삭제됩니다. 계속할까요?')) return;
        setStatus('units-status', '복원 중…');
        try {
            const r = await fetch('/api/units', {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            await loadUnits();
            setStatus('units-status', '✓ 시드로 복원됨', 'ok');
        } catch (e) {
            setStatus('units-status', '복원 실패: ' + (e?.message || e), 'err');
        }
    }

    function bootAdminPage() {
        const root = document.getElementById('admin-root');
        if (!root) return;

        if (!isAdmin) {
            renderNotAdmin(root);
            return;
        }
        renderAdminUI(root);
        renderApiSecretPanel();
        renderUnitsPanel();
        renderAiPromptPanel('full');
        renderAiPromptPanel('def');
        // (시크릿 입력 패널 제거됨 — 로그인 시 쿠키 자동 발급)

        document.getElementById('btn-tpl').addEventListener('click', doBulkTemplate);
        document.getElementById('btn-export').addEventListener('click', doBulkExport);
        document.getElementById('btn-export-json').addEventListener('click', doExportJsonBundle);
        document.getElementById('admin-import-file').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) doBulkImport(f);
            e.target.value = '';
        });
        document.getElementById('user-add-form').addEventListener('submit', onAddUser);
        renderUserList();
    }

    async function doBulkTemplate() {
        setStatus('admin-status', '템플릿 생성 중…');
        try {
            await loadXlsx();
            const idx = await loadIndex();
            const rows = (idx.units || []).map((u) => ({
                [COLS[0]]: u.id, [COLS[1]]: u.name,
                [COLS[2]]: '분류 (선택)',
                [COLS[3]]: '예시: 토픽명',
                [COLS[4]]: '내용 (정의)',
                [COLS[5]]: '두음 (선택)',
                [COLS[6]]: '쉼표로 구분된 키워드 (선택)',
                [COLS[7]]: '', [COLS[8]]: '',
            }));
            for (let i = 0; i < 30; i++) rows.push({});
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
            ws['!cols'] = COL_WIDTHS.map((w) => ({ wch: w }));
            XLSX.utils.book_append_sheet(wb, ws, '카드');
            const ref = (idx.units || []).map((u) => ({ '단원ID': u.id, '단원명': u.name, '설명': u.description || '' }));
            const wsRef = XLSX.utils.json_to_sheet(ref);
            wsRef['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 24 }];
            XLSX.utils.book_append_sheet(wb, wsRef, '단원목록');
            downloadWorkbook(wb, `ITPE_template_${todayTag()}.xlsx`);
            setStatus('admin-status', '템플릿 다운로드 완료', 'ok');
        } catch (e) {
            console.error(e); setStatus('admin-status', '템플릿 생성 실패: ' + e.message, 'err');
        }
    }

    async function doBulkImport(file) {
        setStatus('admin-status', `업로드 중… ${file.name}`);
        try {
            await loadXlsx();
            const idx = await loadIndex();
            const unitById = new Map((idx.units || []).map((u) => [u.id, u]));
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const sheet = wb.Sheets['카드'] || wb.Sheets[wb.SheetNames[0]];
            if (!sheet) throw new Error('시트를 찾을 수 없습니다.');
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            // 1) 단원별로 그룹화 (단원ID 검증)
            const groups = {};
            const warnings = [];
            let emptyTopicCount = 0;
            for (const row of rows) {
                const unitId = String(row[COLS[0]] || '').trim();
                if (!unitId) continue;
                if (!unitById.has(unitId)) { warnings.push(`'${unitId}'`); continue; }
                const card = rowToCard(row);
                if (!card) { emptyTopicCount++; continue; }
                (groups[unitId] ||= []).push(card);
            }

            // 2) 단원별 중복 제거 (기존 JSON+user 토픽 vs 업로드 토픽, 업로드 내 중복도 제외)
            const stats = {}; // { unitId: { newCount, dupCount } }
            for (const unitId of Object.keys(groups)) {
                const unit = unitById.get(unitId);
                const existingTopics = new Set();
                const jsonCards = await loadJsonCards(unit);
                const userCards = loadUserCards(unitId);
                jsonCards.forEach((c) => existingTopics.add(normalizeTopic(cardTopic(c))));
                userCards.forEach((c) => existingTopics.add(normalizeTopic(cardTopic(c))));

                const fresh = [];
                const seenInUpload = new Set();
                let dup = 0;
                for (const card of groups[unitId]) {
                    const n = normalizeTopic(card.topic);
                    if (existingTopics.has(n) || seenInUpload.has(n)) { dup++; continue; }
                    seenInUpload.add(n);
                    fresh.push(card);
                }
                stats[unitId] = { fresh, dup, before: userCards.length, current: userCards };
            }

            const touched = Object.keys(stats).filter((id) => stats[id].fresh.length > 0);
            const totalNew = Object.values(stats).reduce((s, x) => s + x.fresh.length, 0);
            const totalDup = Object.values(stats).reduce((s, x) => s + x.dup, 0);

            if (totalNew === 0) {
                const msg = `추가할 신규 카드가 없습니다. (중복 ${totalDup}, 빈 토픽 ${emptyTopicCount}` +
                            (warnings.length ? `, 알 수 없는 단원 ${warnings.length}` : '') + ')';
                setStatus('admin-status', msg, 'err');
                return;
            }

            const confirmMsg =
                `${touched.length}개 단원에 신규 ${totalNew}장을 추가합니다.\n` +
                `· 중복 제외: ${totalDup}장\n` +
                `· 빈 토픽 무시: ${emptyTopicCount}장` +
                (warnings.length ? `\n· 알 수 없는 단원ID: ${warnings.length}건` : '') +
                `\n\n계속하시겠습니까?`;
            if (!confirm(confirmMsg)) { setStatus('admin-status', '업로드 취소됨'); return; }

            // 3) 누적 추가 (REPLACE 아님)
            touched.forEach((id) => {
                const merged = [...stats[id].current, ...stats[id].fresh];
                saveUserCards(id, merged);
            });

            const warnTxt = warnings.length ? ` · 알 수 없는 단원 ${warnings.length}건` : '';
            setStatus('admin-status',
                `업로드 완료 — ${touched.length}개 단원에 신규 ${totalNew}장 추가 · 중복 ${totalDup}장 제외${warnTxt}\n` +
                `▶ JSON zip 자동 다운로드 중…`,
                'ok');

            // 자동으로 JSON 일괄 다운로드 — 사용자는 zip 받아 data/ 덮어쓰고 vercel --prod 만
            await doExportJsonBundle({ silent: true });
            setStatus('admin-status',
                `✓ 완료 — ${touched.length}개 단원 / 신규 ${totalNew}장 추가, JSON zip 다운로드됨\n` +
                `   → zip 풀어 C:\\01vive\\itpe\\data\\ 덮어쓰기 후 'npx vercel --prod' 실행`,
                'ok');
        } catch (e) {
            console.error(e); setStatus('admin-status', '업로드 실패: ' + e.message, 'err');
        }
    }

    // ⬇ JSON 파일 일괄 다운로드 — 배포 가능한 data/ 폴더 상태로 zip
    async function doExportJsonBundle(opts) {
        const silent = !!(opts && opts.silent);
        if (!silent) setStatus('admin-status', 'JSON 파일들 생성 중…');
        try {
            const JSZip = await loadJSZip();
            const idx = await loadIndex();
            const units = idx.units || [];

            const zip = new JSZip();
            const counts = {};
            let totalCards = 0;
            let userPromoted = 0;
            let editedCount = 0;
            let removedCount = 0;

            for (const u of units) {
                const jsonCards = await loadJsonCards(u);
                const removedKeys = new Set(loadRemovedJson(u.id));
                const editsMap = loadCardEditsLocal(u.id);
                const userCards = loadUserCards(u.id);

                // JSON 카드: 옮긴 카드 제외, 편집 사항 병합
                const baseCards = jsonCards
                    .filter((c) => !removedKeys.has(cardKey(c)))
                    .map((c) => {
                        const k = cardKey(c);
                        if (editsMap[k]) { editedCount++; return { ...c, ...editsMap[k] }; }
                        return c;
                    });

                removedCount += removedKeys.size;
                userPromoted += userCards.length;

                const combined = [...baseCards, ...userCards].map(packCardForJson);
                counts[u.id] = combined.length;
                totalCards += combined.length;

                zip.file(`cards/${u.file}`, JSON.stringify(combined, null, 4) + '\n');
            }

            // index.json 의 count 자동 갱신 + 메타는 유지
            const newIndex = {
                ...idx,
                units: units.map((u) => ({ ...u, count: counts[u.id] ?? u.count ?? 0 })),
            };
            zip.file('index.json', JSON.stringify(newIndex, null, 4) + '\n');

            // README 동봉 — 사용자가 zip 풀어 어떻게 배포하는지 안내
            zip.file('README.txt',
                `ITPE Flash — JSON 일괄 다운로드 (${new Date().toISOString().slice(0,10)})\n\n` +
                `사용 방법\n` +
                `  1) 이 zip 을 풀면 index.json 과 cards/ 폴더가 나옵니다.\n` +
                `  2) 두 항목을 그대로 C:\\01vive\\itpe\\data\\ 안에 덮어쓰세요.\n` +
                `  3) PowerShell 에서:  cd C:\\01vive\\itpe ; npx vercel --prod\n\n` +
                `포함된 변경분\n` +
                `  · 사용자 추가 카드(승격): ${userPromoted}장\n` +
                `  · JSON 카드 수정 병합: ${editedCount}장\n` +
                `  · 이동으로 제외된 JSON 카드: ${removedCount}장\n` +
                `  · 단원 총 ${units.length}개, 카드 ${totalCards}장\n\n` +
                `주의\n` +
                `  · 이미지 dataURL 은 JSON 파일에 그대로 들어갑니다(파일 크기 증가).\n` +
                `  · 배포 후 사용자별 localStorage 사용자 카드는 그대로 남아있으니, 동일 토픽이면\n` +
                `    학습 화면에서 중복으로 보일 수 있습니다. 필요 시 사용자가 reset.html 로 정리.\n`
            );

            const blob = await zip.generateAsync({ type: 'blob' });
            const tag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            downloadBlob(blob, `ITPE_data_${tag}.zip`);

            if (!silent) {
                setStatus('admin-status',
                    `JSON 일괄 다운로드 완료 — ${units.length}개 단원, 총 ${totalCards}장 ` +
                    `(사용자 승격 ${userPromoted}, JSON 수정 ${editedCount}, 이동 제외 ${removedCount})`,
                    'ok'
                );
            }
        } catch (e) {
            console.error(e);
            setStatus('admin-status', 'JSON 다운로드 실패: ' + e.message, 'err');
        }
    }

    async function doBulkExport() {
        setStatus('admin-status', '전체 카드 모으는 중…');
        try {
            await loadXlsx();
            const idx = await loadIndex();
            const rows = [];
            for (const u of (idx.units || [])) {
                const jsonCards = await loadJsonCards(u);
                const userCards = loadUserCards(u.id);
                jsonCards.forEach((c) => rows.push(cardToRow(c, u, 'json')));
                userCards.forEach((c) => rows.push(cardToRow(c, u, 'user')));
            }
            if (rows.length === 0) { setStatus('admin-status', '내보낼 카드가 없습니다.', 'err'); return; }
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
            ws['!cols'] = COL_WIDTHS.map((w) => ({ wch: w }));
            XLSX.utils.book_append_sheet(wb, ws, '카드');
            downloadWorkbook(wb, `ITPE_export_${todayTag()}.xlsx`);
            setStatus('admin-status', `다운로드 완료 — 총 ${rows.length}장`, 'ok');
        } catch (e) {
            console.error(e); setStatus('admin-status', '다운로드 실패: ' + e.message, 'err');
        }
    }

    async function renderUserList() {
        const list = document.getElementById('user-list');
        const cntEl = document.getElementById('user-count');
        if (!list) return;
        const users = await window.ITPEAuth.listEffectiveUsers();
        while (list.firstChild) list.removeChild(list.firstChild);
        if (cntEl) cntEl.textContent = users.length + '명';
        users.forEach((u) => {
            const li = document.createElement('li');
            li.className = 'user-item';
            const isSelf = u.email === email;

            const emailEl = document.createElement('span');
            emailEl.className = 'user-email';
            emailEl.textContent = u.email;

            const originEl = document.createElement('span');
            originEl.className = 'user-origin';
            originEl.textContent = u.isAdmin ? '관리자' : '사용자';
            if (u.isAdmin) originEl.style.color = '#6f9bff';

            const adminToggle = document.createElement('button');
            adminToggle.type = 'button';
            adminToggle.className = 'admin-btn';
            adminToggle.style.cssText = 'padding:4px 8px; font-size:0.8rem;';
            adminToggle.textContent = u.isAdmin ? '👑 해제' : '👑 권한';
            adminToggle.title = u.isAdmin ? '관리자 권한 해제' : '관리자 권한 부여';
            if (isSelf && u.isAdmin) {
                adminToggle.disabled = true;
                adminToggle.title = '본인 관리자 권한은 해제할 수 없습니다';
            } else {
                adminToggle.addEventListener('click', () => onToggleAdmin(u.email, !u.isAdmin));
            }

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'user-del';
            delBtn.textContent = '삭제';
            if (isSelf) {
                delBtn.disabled = true;
                delBtn.setAttribute('aria-label', '본인은 삭제 불가');
            } else {
                delBtn.addEventListener('click', () => onRemoveUser(u.email));
            }

            li.append(emailEl, originEl, adminToggle, delBtn);
            list.appendChild(li);
        });
    }
    async function onAddUser(e) {
        e.preventDefault();
        const input = document.getElementById('user-add-input');
        const v = input.value.trim();
        if (!v) { setStatus('user-status', '이메일을 입력하세요.', 'err'); return; }
        setStatus('user-status', '서버에 저장 중…', 'ok');
        try {
            const added = await window.ITPEAuth.addUser(v);
            input.value = '';
            await renderUserList();
            setStatus('user-status', `✓ 사용자 추가됨: ${added} — 모든 기기 즉시 반영`, 'ok');
        } catch (err) {
            const m = err?.message || String(err);
            if (/401/.test(m)) {
                setStatus('user-status', '❌ 권한 만료 — 로그아웃 후 다시 로그인하세요.', 'err');
            } else {
                setStatus('user-status', '❌ 사용자 추가 실패: ' + m, 'err');
            }
        }
    }
    async function onRemoveUser(emailToRemove) {
        if (!confirm(`'${emailToRemove}' 사용자를 제거하시겠습니까?`)) return;
        try {
            await window.ITPEAuth.removeUser(emailToRemove);
            await renderUserList();
            setStatus('user-status', `사용자 제거됨: ${emailToRemove}`, 'ok');
        } catch (err) {
            setStatus('user-status', '사용자 제거 실패: ' + err.message, 'err');
        }
    }
    async function onToggleAdmin(email, makeAdmin) {
        const verb = makeAdmin ? '부여' : '해제';
        if (!confirm(`'${email}' 의 관리자 권한을 ${verb}합니다. 계속할까요?`)) return;
        try {
            await window.ITPEAuth.setAdmin(email, makeAdmin);
            await renderUserList();
            setStatus('user-status', `관리자 권한 ${verb}됨: ${email}`, 'ok');
        } catch (err) {
            setStatus('user-status', `권한 변경 실패: ` + err.message, 'err');
        }
    }

    // ============================================================
    // 3) flash.html — 모드 선택 화면의 단원별 관리자
    // ============================================================
    function bootFlashAdmin() {
        if (!isAdmin) return;
        const panel = document.getElementById('unit-admin');
        if (!panel) return;
        panel.hidden = false;
        const unitId = new URLSearchParams(location.search).get('unit');
        if (!unitId) return;
        let unit = null;

        (async () => {
            const idx = await loadIndex();
            unit = (idx.units || []).find((u) => u.id === unitId);
            if (!unit) return;
            document.getElementById('unit-admin-name').textContent = unit.name + (unit.description ? ` (${unit.description})` : '');
            await refreshCounts();
        })();

        document.getElementById('unit-tpl').addEventListener('click', () => doUnitTemplate(unit));
        document.getElementById('unit-import-file').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) doUnitImport(unit, f);
            e.target.value = '';
        });
        const dlBtn = document.getElementById('unit-download');
        if (dlBtn) dlBtn.addEventListener('click', () => doUnitDownload(unit));
        const clearBtn = document.getElementById('unit-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => doUnitClear(unit));

        // ✨ AI 토픽 자동 생성 패널 — jm 단원 전용 우선 노출 (다른 단원도 동작은 함)
        const aiPanel = document.getElementById('ai-panel');
        if (aiPanel) {
            aiPanel.hidden = false; // 관리자에게 모든 단원에서 노출 (jm 권장)
            const aiInput = document.getElementById('ai-input');
            const aiBtn = document.getElementById('ai-generate');
            const aiResults = document.getElementById('ai-results');
            aiBtn.addEventListener('click', () => doAiGenerate(unit, aiInput, aiResults, aiBtn));
            // 🔧 프롬프트 편집 — details 펼침 시 자동 로드 + 저장 버튼
            bindInlinePromptEditor();
        }

        function bindInlinePromptEditor() {
            const ta       = document.getElementById('jm-ai-prompt-input');
            const loadBtn  = document.getElementById('jm-ai-prompt-load');
            const saveBtn  = document.getElementById('jm-ai-prompt-save');
            const resetBtn = document.getElementById('jm-ai-prompt-reset');
            const kindSel  = document.getElementById('jm-ai-prompt-kind');
            if (!ta || !loadBtn || !saveBtn || !resetBtn) return;

            function currentKind() {
                const v = (kindSel && kindSel.value) || 'full';
                return (v === 'def') ? 'def' : 'full';
            }

            async function load() {
                const kind = currentKind();
                setStatus('jm-ai-prompt-status', '불러오는 중… (' + kind + ')');
                try {
                    if (!window.ITPEAdmin || !window.ITPEAdmin.isAdminWithSecret()) {
                        setStatus('jm-ai-prompt-status', '관리자 로그인 필요', 'err');
                        return;
                    }
                    const r = await fetch('/api/ai-prompt?kind=' + kind + '&_t=' + Date.now(), {
                        cache: 'no-store',
                        credentials: 'include',
                    });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const j = await r.json();
                    ta.value = j.prompt || '';
                    setStatus('jm-ai-prompt-status',
                        '[' + kind + '] ' + (j.isDefault ? '✓ 기본 (' + j.length + '자)' : '✓ 사용자 정의 (' + j.length + '자)'), 'ok');
                } catch (e) {
                    setStatus('jm-ai-prompt-status', '로드 실패: ' + (e?.message || e), 'err');
                }
            }
            async function save() {
                const kind = currentKind();
                setStatus('jm-ai-prompt-status', '저장 중… (' + kind + ')');
                try {
                    const r = await fetch('/api/ai-prompt', {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: ta.value || '', kind }),
                    });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const j = await r.json();
                    setStatus('jm-ai-prompt-status',
                        '[' + kind + '] ' + (j.reset ? '✓ 기본값 복원됨' : '✓ 저장 완료 (' + j.length + '자) — 1분 내 적용'), 'ok');
                } catch (e) {
                    setStatus('jm-ai-prompt-status', '저장 실패: ' + (e?.message || e), 'err');
                }
            }
            loadBtn.addEventListener('click', load);
            saveBtn.addEventListener('click', save);
            resetBtn.addEventListener('click', async () => {
                if (!confirm('현재 선택된 프롬프트(' + currentKind() + ')를 기본값으로 복원합니다. 계속할까요?')) return;
                ta.value = '';
                await save();
                await load();
            });
            // kind 바꿀 때 자동 재로드
            if (kindSel) {
                kindSel.addEventListener('change', () => {
                    if (window.ITPEAdmin && window.ITPEAdmin.isAdminWithSecret()) load();
                });
            }
            // details 열릴 때 자동 1회 로드
            const details = ta.closest('details');
            if (details) {
                details.addEventListener('toggle', () => {
                    if (details.open && !ta.value && window.ITPEAdmin && window.ITPEAdmin.isAdminWithSecret()) load();
                }, { once: false });
            }
        }

        async function doAiGenerate(u, inputEl, resultsEl, btnEl) {
            if (!u) return;
            const raw = (inputEl.value || '').trim();
            if (!raw) { setStatus('ai-status', '토픽을 입력하세요.', 'err'); return; }
            const topics = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
            if (topics.length === 0) { setStatus('ai-status', '유효한 토픽 없음.', 'err'); return; }
            if (!window.ITPEAdmin || !window.ITPEAdmin.isAdminWithSecret()) {
                setStatus('ai-status', '관리자 로그인 필요', 'err');
                return;
            }
            console.log('[ITPE AI] 벌크 생성 시작:', topics);
            setStatus('ai-status', '🤖 ' + topics.length + '개 토픽 생성 중… (Gemini 2.5 Flash)', 'ok');
            if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ 생성 중…'; }

            // 60초 timeout (벌크 20개 보통 30초 안에 끝남)
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 60000);
            try {
                const r = await fetch('/api/ai-fill', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topics }),
                    signal: controller.signal,
                });
                clearTimeout(tid);
                console.log('[ITPE AI] 응답 status:', r.status);
                if (!r.ok) {
                    let detail = ''; try { detail = JSON.stringify(await r.json()); } catch {}
                    throw new Error('HTTP ' + r.status + ' ' + detail);
                }
                const data = await r.json();
                console.log('[ITPE AI] 결과:', data);
                setStatus('ai-status',
                    '✓ ' + data.ok + '개 성공 · ' + data.fail + '개 실패 (model: ' + data.model + (data.free ? ' · 무료' : '') + ')',
                    'ok'
                );
                renderAiResults(resultsEl, data.items, u);
            } catch (err) {
                clearTimeout(tid);
                console.error('[ITPE AI] 실패:', err);
                let msg = err?.message || String(err);
                if (err?.name === 'AbortError') msg = '⏱ 시간 초과 (60초) — 토픽 줄여서 다시';
                setStatus('ai-status', '생성 실패: ' + msg, 'err');
            } finally {
                if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✨ 생성하기'; }
            }
        }

        function renderAiResults(root, items, u) {
            while (root.firstChild) root.removeChild(root.firstChild);
            if (!Array.isArray(items) || items.length === 0) return;

            const okItems = items.filter((it) => !it.error);

            // 일괄 저장 헤더
            if (okItems.length > 0) {
                const bar = document.createElement('div');
                bar.className = 'ai-results-bar';
                const saveAll = makeBtn('admin-btn admin-btn-up', '', '☁ 모두 저장 (' + okItems.length + '장)', 'button');
                saveAll.addEventListener('click', () => saveAiBatch(u, okItems));
                bar.appendChild(saveAll);
                root.appendChild(bar);
            }

            items.forEach((it, i) => {
                const box = document.createElement('div');
                box.className = 'ai-card ' + (it.error ? 'is-err' : ('conf-' + (it.confidence || 'medium')));

                const head = h('div', 'ai-card-head');
                const num = h('span', 'ai-card-num', t('#' + (i + 1)));
                head.appendChild(num);
                const topicEl = h('strong', 'ai-card-topic', t(it.topic));
                head.appendChild(topicEl);
                if (it.confidence) head.appendChild(h('span', 'ai-card-conf c-' + it.confidence, t(it.confidence)));
                box.appendChild(head);

                if (it.error) {
                    box.appendChild(h('p', 'ai-card-err', t('❌ ' + it.error)));
                } else {
                    if (it.category) box.appendChild(h('p', 'ai-card-cat', t('분류: ' + it.category)));
                    box.appendChild(h('p', 'ai-card-def', t(it.definition || '')));
                    if (it.mnemonic) box.appendChild(h('pre', 'ai-card-mn', t(it.mnemonic)));
                    if (it.keyword) box.appendChild(h('p', 'ai-card-kw', t('키워드: ' + it.keyword)));
                    if (Array.isArray(it.references) && it.references.length) {
                        const refsWrap = h('div', 'ai-card-refs');
                        refsWrap.appendChild(h('div', 'ai-card-refs-label', t('🔗 참고')));
                        it.references.forEach((r) => {
                            const a = document.createElement('a');
                            a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
                            a.textContent = r.title || r.url;
                            a.className = 'ai-card-ref-link';
                            refsWrap.appendChild(a);
                        });
                        box.appendChild(refsWrap);
                    }
                    const btnRow = h('div', 'ai-card-btns');
                    const saveOne = makeBtn('admin-btn admin-btn-up', '', '☁ 저장', 'button');
                    saveOne.addEventListener('click', () => saveAiBatch(u, [it]));
                    btnRow.appendChild(saveOne);
                    const skipBtn = makeBtn('admin-btn admin-btn-tpl', '', '✗ 폐기', 'button');
                    skipBtn.addEventListener('click', () => { box.remove(); });
                    btnRow.appendChild(skipBtn);
                    box.appendChild(btnRow);
                }
                root.appendChild(box);
            });
        }

        async function saveAiBatch(u, items) {
            if (!u || !items || items.length === 0) return;
            setStatus('ai-status', `☁ 서버 저장 중… (${items.length}장)`, 'ok');
            try {
                // 현재 단원 카드 fetch → 새 카드 추가 → PUT
                const base = await window.ITPEAdmin.fetchCards(u.id);
                const baseCards = Array.isArray(base) ? base.slice() : [];
                const existing = new Set(baseCards.map((c) => normalizeTopic(cardTopic(c))));
                const toAdd = [];
                let dup = 0;
                items.forEach((it) => {
                    const t = normalizeTopic(it.topic);
                    if (existing.has(t)) { dup++; return; }
                    existing.add(t);
                    toAdd.push({
                        category: it.category || '',
                        topic: it.topic,
                        definition: it.definition || '',
                        mnemonic: it.mnemonic || '',
                        keyword: it.keyword || '',
                        references: Array.isArray(it.references) ? it.references : [],
                        userId: 'u' + Date.now() + '-ai-' + Math.random().toString(36).slice(2, 6),
                        createdAt: new Date().toISOString(),
                        source: 'ai',                        // ✨ AI 생성 표식
                        aiGeneratedAt: new Date().toISOString(),
                        aiConfidence: it.confidence || 'medium',
                    });
                });
                if (toAdd.length === 0) {
                    setStatus('ai-status', `중복 ${dup}장 — 저장할 신규 없음.`, 'err');
                    return;
                }
                const combined = [...baseCards, ...toAdd];
                await window.ITPEAdmin.saveCards(u.id, combined);
                setStatus('ai-status', `✓ ${toAdd.length}장 저장됨 · 중복 ${dup}장 제외`, 'ok');
                await refreshCounts();
            } catch (e) {
                setStatus('ai-status', '저장 실패: ' + (e?.message || e), 'err');
            }
        }

        // 이 단원 카드 → 엑셀 다운로드 (분류·토픽·내용·두음·키워드, 행 순서 그대로)
        async function doUnitDownload(u) {
            if (!u) return;
            setStatus('unit-status', '카드 모으는 중…');
            try {
                await loadXlsx();
                let cards = [];
                try {
                    cards = (window.ITPEAdmin && window.ITPEAdmin.fetchCards)
                        ? await window.ITPEAdmin.fetchCards(u.id)
                        : await loadJsonCards(u);
                } catch { cards = await loadJsonCards(u); }
                if (!Array.isArray(cards)) cards = [];
                // 로컬 추가 카드도 합쳐(있다면)
                const localCards = loadUserCards(u.id);
                const all = [...cards, ...localCards];
                if (all.length === 0) {
                    setStatus('unit-status', '내보낼 카드가 없습니다.', 'err');
                    return;
                }
                const rows = all.map((c) => ({
                    '분류':    c.category   ?? '',
                    '토픽':    c.topic      ?? c.q ?? '',
                    '내용':    c.definition ?? c.a ?? '',
                    '두음':    c.mnemonic   ?? '',
                    '키워드':  c.keyword    ?? '',
                }));
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(rows, { header: UNIT_COLS });
                ws['!cols'] = UNIT_COL_WIDTHS.map((w) => ({ wch: w }));
                XLSX.utils.book_append_sheet(wb, ws, u.name || u.id);
                downloadWorkbook(wb, `ITPE_${u.id}_${todayTag()}.xlsx`);
                setStatus('unit-status', `✓ 다운로드 완료 — ${all.length}장 (${u.name})`, 'ok');
            } catch (e) {
                setStatus('unit-status', '다운로드 실패: ' + (e?.message || e), 'err');
            }
        }

        async function doUnitClear(u) {
            if (!u) return;
            // 1차 확인
            const c1 = confirm(
                `'${u.name}' 단원의 모든 카드를 삭제합니다.\n\n` +
                `· 서버(Vercel Blob)에서 영구 삭제됩니다\n` +
                `· 다른 기기에도 즉시 반영됩니다\n` +
                `· 되돌릴 수 없습니다\n\n` +
                `정말 진행하시겠습니까?`
            );
            if (!c1) return;
            // 2차 확인 — 단원ID 정확히 타이핑 요구
            const typed = prompt(`재확인 — 삭제하려면 단원ID 를 정확히 입력하세요:\n\n  ${u.id}\n\n(취소하려면 [취소])`);
            if (typed === null) return;
            if (String(typed).trim() !== u.id) {
                setStatus('unit-status', '단원ID 가 일치하지 않습니다. 삭제 취소됨.', 'err');
                return;
            }

            const isAdminWithSecret = !!(window.ITPEAdmin && window.ITPEAdmin.isAdminWithSecret && window.ITPEAdmin.isAdminWithSecret());
            try {
                if (isAdminWithSecret) {
                    await window.ITPEAdmin.saveCards(u.id, []);
                }
                // 로컬 캐시도 정리
                try {
                    localStorage.removeItem('itpe.userCards.' + u.id);
                    localStorage.removeItem('itpe.cardEdits.' + u.id);
                    localStorage.removeItem('itpe.removedJson.' + u.id);
                    localStorage.removeItem('itpe.checked.' + u.id);
                } catch {}
                await refreshCounts();
                setStatus('unit-status',
                    isAdminWithSecret
                        ? `✓ '${u.name}' 단원 전체 삭제 완료 — 서버·로컬 모두 비움`
                        : `✓ 로컬만 비움 — 서버 동기화는 시크릿 입력 후 가능`,
                    'ok'
                );
            } catch (e) {
                setStatus('unit-status', '삭제 실패: ' + (e?.message || e), 'err');
            }
        }

        async function refreshCounts() {
            const el = document.getElementById('unit-counts');
            try {
                // 우선 라이브 Blob/API 의 최신 수치 — Blob 갱신 즉시 반영
                let serverCount = 0;
                try {
                    if (window.ITPEAdmin && window.ITPEAdmin.fetchCards) {
                        const apiCards = await window.ITPEAdmin.fetchCards(unit.id);
                        if (Array.isArray(apiCards)) serverCount = apiCards.length;
                    } else {
                        const jsonCards = await loadJsonCards(unit);
                        serverCount = jsonCards.length;
                    }
                } catch {}
                const userCards = loadUserCards(unit.id);
                const total = serverCount + userCards.length;
                while (el.firstChild) el.removeChild(el.firstChild);
                el.appendChild(document.createTextNode('현재 카드 '));
                const strong = document.createElement('strong');
                strong.textContent = String(total);
                el.appendChild(strong);
                el.appendChild(document.createTextNode('장 · 서버 ' + serverCount + ' + 로컬 ' + userCards.length));
            } catch { el.textContent = '카드 수 확인 실패'; }
        }
        async function doUnitTemplate(u) {
            if (!u) return;
            setStatus('unit-status', '템플릿 생성 중…');
            try {
                await loadXlsx();
                const rows = [];
                rows.push({ '분류':'분류 (선택)', '토픽':'예시 토픽', '내용':'내용 (정의)', '두음':'두음 (선택)', '키워드':'쉼표 구분 키워드' });
                for (let i = 0; i < 20; i++) rows.push({});
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(rows, { header: UNIT_COLS });
                ws['!cols'] = UNIT_COL_WIDTHS.map((w) => ({ wch: w }));
                XLSX.utils.book_append_sheet(wb, ws, u.name || u.id);
                downloadWorkbook(wb, `ITPE_${u.id}_template_${todayTag()}.xlsx`);
                setStatus('unit-status', `템플릿 다운로드 완료 — ${u.name}`, 'ok');
            } catch (e) {
                console.error(e); setStatus('unit-status', '템플릿 실패: ' + e.message, 'err');
            }
        }
        function resetSteps() {
            const list = document.getElementById('step-list');
            list.hidden = false;
            list.querySelectorAll('.step').forEach((s) => s.classList.remove('is-active', 'is-done', 'is-fail'));
        }
        function markStep(key, state) {
            const s = document.querySelector(`#step-list .step[data-step="${key}"]`);
            if (!s) return;
            s.classList.remove('is-active', 'is-done', 'is-fail');
            if (state) s.classList.add('is-' + state);
        }
        function setAllPriorDone(currentKey) {
            const order = ['read', 'parse', 'validate', 'save'];
            const i = order.indexOf(currentKey);
            for (let k = 0; k < i; k++) markStep(order[k], 'done');
            markStep(currentKey, 'active');
        }
        async function doUnitImport(u, file) {
            if (!u) return;
            setStatus('unit-status', `'${file.name}' 처리 시작…`);
            resetSteps();
            try {
                setAllPriorDone('read'); await tick(80);
                const buf = await file.arrayBuffer();
                setAllPriorDone('parse'); await loadXlsx(); await tick(80);
                const wb = XLSX.read(buf, { type: 'array' });
                const sheet = wb.Sheets[u.name] || wb.Sheets[u.id] || wb.Sheets['카드'] || wb.Sheets[wb.SheetNames[0]];
                if (!sheet) throw new Error('시트를 찾을 수 없습니다.');
                const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                setAllPriorDone('validate'); await tick(80);

                // 엑셀 row 순서 그대로 카드 변환 (행 순서 = 카드 순서)
                const fresh = [];
                const seenInUpload = new Set();
                let skippedDiffUnit = 0;
                let dup = 0;
                let emptyTopic = 0;
                for (const row of rawRows) {
                    const rowUnitId = String(row['단원ID'] || '').trim();
                    if (rowUnitId && rowUnitId !== u.id) { skippedDiffUnit++; continue; }
                    const card = rowToCard(row);
                    if (!card) { emptyTopic++; continue; }
                    const n = normalizeTopic(card.topic);
                    if (seenInUpload.has(n)) { dup++; continue; }
                    seenInUpload.add(n);
                    fresh.push(card);
                }

                if (fresh.length === 0) {
                    markStep('validate', 'fail');
                    const msg =
                        `엑셀에서 카드를 찾지 못했습니다. (중복 ${dup}, 빈 토픽 ${emptyTopic}` +
                        (skippedDiffUnit ? `, 다른 단원 ${skippedDiffUnit}` : '') + ')';
                    setStatus('unit-status', msg, 'err');
                    return;
                }

                // 동기화 모드 확인
                const isAdminWithSecret = !!(window.ITPEAdmin && window.ITPEAdmin.isAdminWithSecret && window.ITPEAdmin.isAdminWithSecret());
                const modeQ =
                    `'${u.name}' 단원에 엑셀 ${fresh.length}장을 적용합니다 (엑셀 row 순서 유지).\n` +
                    `· 엑셀 내 중복 제외: ${dup}장\n` +
                    `· 빈 토픽 무시: ${emptyTopic}장` +
                    (skippedDiffUnit ? `\n· 다른 단원 무시: ${skippedDiffUnit}장` : '') +
                    `\n\n[확인] = 단원 카드를 엑셀 내용으로 교체 (서버 즉시 반영)` +
                    `\n[취소] = 업로드 중단`;
                const ok = confirm(modeQ);
                if (!ok) { markStep('validate', 'fail'); setStatus('unit-status', '업로드 취소됨'); return; }

                setAllPriorDone('save'); await tick(80);
                // 단원 카드를 엑셀 내용 그대로 교체 (row 순서 유지)
                if (isAdminWithSecret) {
                    // Vercel Blob 에 PUT — 즉시 다른 기기 동기화
                    try {
                        await window.ITPEAdmin.saveCards(u.id, fresh);
                    } catch (err) {
                        markStep('save', 'fail');
                        setStatus('unit-status', '서버 저장 실패: ' + (err?.message || err), 'err');
                        return;
                    }
                    // 로컬 캐시 정리 — 옛 userCards/cardEdits/removedJson 제거 (이제 Blob 단일 소스)
                    try {
                        localStorage.removeItem('itpe.userCards.' + u.id);
                        localStorage.removeItem('itpe.cardEdits.' + u.id);
                        localStorage.removeItem('itpe.removedJson.' + u.id);
                    } catch {}
                } else {
                    // 시크릿 미설정 — 로컬 추가만
                    const userCards = loadUserCards(u.id);
                    const merged = [...userCards, ...fresh];
                    saveUserCards(u.id, merged);
                }
                markStep('save', 'done');
                await refreshCounts();
                setStatus('unit-status',
                    isAdminWithSecret
                        ? `✓ 완료 — ${fresh.length}장 (엑셀 순서) 서버 저장. 다른 기기에서 즉시 보입니다.`
                        : `✓ 로컬 저장 완료 — ${fresh.length}장. (시크릿 미설정으로 다른 기기와 공유 안 됨)`,
                    'ok'
                );
            } catch (e) {
                const active = document.querySelector('#step-list .step.is-active');
                if (active) active.classList.replace('is-active', 'is-fail');
                setStatus('unit-status', '업로드 실패: ' + e.message, 'err');
            }
        }
    }

    // ───────────── 부트 디스패치 ─────────────
    function boot() {
        // admin.html (id="admin-root") 최우선
        if (document.getElementById('admin-root')) { bootAdminPage(); return; }
        // flash.html mode-screen
        if (document.getElementById('unit-admin')) bootFlashAdmin();
        // index.html sheet list
        if (document.getElementById('sheet-list')) bootIndexEntry();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
