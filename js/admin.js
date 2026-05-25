// 관리자 도구 — 세 페이지에서 다른 역할 수행.
//
// index.html  (시트 목록)  ▸ 관리자만, 시트 목록에 "12. 관리자 도구" 진입 항목 추가
// admin.html  (관리자 페이지) ▸ 엑셀 일괄 관리 + 사용자 관리 풀 UI
// flash.html  (모드 선택)    ▸ 이 단원 한정 엑셀 업로드 + 4단계 진행
//
// 권한: ADMINS 배열에 포함된 이메일만 관리자 기능 사용 가능.
// 비관리자가 admin.html 에 접근하면 알림 후 시트 목록으로 리다이렉트.
(function () {
    // 엑셀 컬럼 — UI 라벨 매핑:
    //   '정의' = card.definition  (옛 라벨 '내용')
    //   '내용' = card.mnemonic    (옛 라벨 '두음', 두음·핵심요약·구성요소)
    //   '이미지' = first https URL → =IMAGE() 수식
    // 옛 엑셀 (내용=definition, 두음=mnemonic) 업로드도 rowToCard 에서 자동 인식.
    const COLS = ['단원ID', '단원명', '분류', '토픽', '정의', '내용', '키워드', '이미지', '출처'];
    const COL_WIDTHS = [10, 10, 8, 18, 28, 42, 22, 25, 8];
    const UNIT_COLS = ['분류', '토픽', '정의', '내용', '키워드', '이미지'];
    const UNIT_COL_WIDTHS = [8, 18, 28, 42, 22, 25];
    // CDN 라이브러리 — 무결성 해시(SRI) 검증 적용
    // xlsx-js-style: SheetJS Community fork — 동일 API + 셀 스타일 (정렬·wrap·색·테두리) 지원
    const CDN = {
        xlsx: {
            url: 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
            integrity: 'sha384-OUW9euuUyxyHcAhTqbhI+Iyb8LMssXt/cpz0yXhs9UWG2/R/uaWdakx/4cfww7Vb',
            global: 'XLSX',
        },
        jszip: {
            url: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
            integrity: 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG',
            global: 'JSZip',
        },
    };

    // 스타일 프리셋 — 모든 export 에서 재사용
    const STYLE_HEADER = {
        font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: '2F80ED' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
            top:    { style: 'thin', color: { rgb: '888888' } },
            bottom: { style: 'thin', color: { rgb: '888888' } },
            left:   { style: 'thin', color: { rgb: '888888' } },
            right:  { style: 'thin', color: { rgb: '888888' } },
        },
    };
    const STYLE_CELL = {
        font: { sz: 11 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
            top:    { style: 'thin', color: { rgb: 'DDDDDD' } },
            bottom: { style: 'thin', color: { rgb: 'DDDDDD' } },
            left:   { style: 'thin', color: { rgb: 'DDDDDD' } },
            right:  { style: 'thin', color: { rgb: 'DDDDDD' } },
        },
    };
    // 긴 텍스트(내용·두음) 는 좌측 정렬이 가독성 ↑ — 가운데 정렬은 짧은 셀에만 적합
    const STYLE_CELL_LEFT = {
        ...STYLE_CELL,
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true, indent: 1 },
    };

    // 시트의 모든 셀에 스타일 적용 + 컬럼 너비 + 행 높이 자동
    // longCols: 좌측 정렬할 컬럼 헤더명 배열 (예: ['내용', '두음'])
    function applySheetStyles(ws, headers, widths, longCols) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        const longSet = new Set(longCols || []);
        const longIdx = new Set();
        headers.forEach((h, i) => { if (longSet.has(h)) longIdx.add(i); });

        // 헤더 행 (0) 과 본문 (1~)
        for (let R = range.s.r; R <= range.e.r; R++) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[addr]) ws[addr] = { v: '', t: 's' };
                if (R === 0) {
                    ws[addr].s = STYLE_HEADER;
                } else {
                    ws[addr].s = longIdx.has(C) ? STYLE_CELL_LEFT : STYLE_CELL;
                }
            }
        }
        // 컬럼 너비
        ws['!cols'] = widths.map((w) => ({ wch: w }));
        // 행 높이 — 헤더 24pt, 본문 자동(wrap 시 늘어남), 명시 50pt 정도 권장
        const rows = [{ hpt: 28 }];  // 헤더
        for (let r = 1; r <= range.e.r; r++) rows.push({ hpt: 60 });
        ws['!rows'] = rows;
    }

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
        // 이미지: 첫 번째 https URL (R2 등) → =IMAGE() 수식. Excel 365 / Excel Web 에서 인라인 렌더링.
        // data:image base64 는 제외 (수식에 못 넣음). 이미지 없으면 빈 칸.
        const firstHttpsImg = (Array.isArray(card.images) ? card.images : [])
            .find((s) => typeof s === 'string' && /^https:\/\//i.test(s));
        return {
            [COLS[0]]: unit.id, [COLS[1]]: unit.name,
            [COLS[2]]: card.category ?? '',
            [COLS[3]]: card.topic ?? card.q ?? '',
            [COLS[4]]: card.definition ?? card.a ?? '',
            [COLS[5]]: card.mnemonic ?? '',
            [COLS[6]]: card.keyword ?? '',
            // 빈 셀로 두고 export 시 수식을 따로 주입 (json_to_sheet 가 수식을 못 만들기 때문)
            [COLS[7]]: firstHttpsImg || '',
            [COLS[8]]: source,
        };
    }

    // export 후 — '이미지' 컬럼의 URL 셀들을 =IMAGE() 수식으로 변환
    function injectImageFormulas(ws, headers) {
        const imgIdx = headers.indexOf('이미지');
        if (imgIdx < 0) return;
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r + 1; R <= range.e.r; R++) {  // 헤더 제외
            const addr = XLSX.utils.encode_cell({ r: R, c: imgIdx });
            const cell = ws[addr];
            if (!cell || !cell.v) continue;
            const url = String(cell.v);
            if (!/^https:\/\//i.test(url)) continue;
            // Excel 의 IMAGE 함수: =IMAGE("url", [alt_text], [sizing])  sizing=1 stretch fit
            // 내장 escape — URL 안의 큰따옴표 차단
            const safe = url.replace(/"/g, '');
            ws[addr] = {
                t: 's',                                  // 문자열로 두되 f 필드로 수식 표시
                f: `IMAGE("${safe}", "", 1)`,
                v: url,                                  // Excel 2019 등 비호환 환경 폴백
                s: ws[addr].s,                            // 스타일 보존
            };
        }
    }
    function rowToCard(row) {
        const get = (k) => String(row[k] ?? '').trim();
        // 토픽 — 셀 안의 줄바꿈·다중 공백을 한 칸으로 정규화해 한 줄로 통합
        const topicRaw = String(row['토픽'] ?? '');
        const topic = topicRaw.replace(/\s+/g, ' ').trim();
        if (!topic) return null;
        // 새 포맷: 정의=card.definition, 내용=card.mnemonic
        // 옛 포맷: 내용=card.definition, 두음=card.mnemonic
        // 헤더 존재 여부로 자동 인식 (정의 컬럼 있으면 새 포맷).
        const hasNew = Object.prototype.hasOwnProperty.call(row, '정의');
        const hasOld = Object.prototype.hasOwnProperty.call(row, '두음');
        let definition, mnemonic;
        if (hasNew) {
            definition = get('정의');
            mnemonic   = get('내용');     // 새 포맷에선 '내용' 컬럼이 mnemonic
        } else if (hasOld) {
            definition = get('내용');     // 옛 포맷
            mnemonic   = get('두음');
        } else {
            // 둘 다 없음 — 정의/내용 둘 중 있는 것 사용
            definition = get('정의') || get('내용');
            mnemonic   = '';
        }
        return {
            category:   get('분류'),
            topic,
            definition,
            mnemonic,
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
    // 패널 — 엑셀 일괄 관리
    function renderBulkExcelPanel() {
        const root = document.getElementById('admin-root');
        if (!root) return;
        const p = h('section', 'admin-panel');
        p.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('📊 엑셀 일괄 관리'))
        ));
        p.appendChild(h('p', 'admin-hint', t('단원별 카드를 엑셀 한 번에 내려받기·올리기. JSON 일괄 다운로드는 백업용.')));
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
        btns.appendChild(makeBtn('admin-btn admin-btn-json', 'btn-export-json', '⬇ JSON 백업'));
        p.appendChild(btns);
        const st = h('p', 'admin-status'); st.id = 'admin-status'; p.appendChild(st);
        root.appendChild(p);
    }

    // 패널 — 사용자(화이트리스트) 관리
    function renderUsersPanel() {
        const root = document.getElementById('admin-root');
        if (!root) return;
        const p = h('section', 'admin-panel');
        const cnt = h('span', 'user-mgmt-count', t('…')); cnt.id = 'user-count';
        p.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('👤 사용자 화이트리스트')),
            cnt
        ));
        p.appendChild(h('p', 'admin-hint', t('등록된 이메일만 로그인 가능합니다. 저장 시 GitHub commit → 재배포 후 약 1분 내 반영.')));
        const ul = h('ul', 'user-list'); ul.id = 'user-list'; p.appendChild(ul);
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
        p.appendChild(form);
        const st = h('p', 'admin-status'); st.id = 'user-status'; p.appendChild(st);
        root.appendChild(p);
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

    // 패널 — 관리자 세션 상태 (최상단)
    function renderSessionPanel() {
        const root = document.getElementById('admin-root');
        if (!root || !window.ITPEAdmin) return;
        const isAdminSession = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());

        const panel = h('section', 'admin-panel');
        panel.id = 'session-panel';
        panel.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('🔐 관리자 세션')),
            h('span', 'admin-badge api-status ' + (isAdminSession ? 'badge-on' : 'badge-off'),
                t(isAdminSession ? '✅ ' + (email || '로그인됨') : '⚠ 비관리자')
            )
        ));
        panel.appendChild(h('p', 'admin-hint', t(
            isAdminSession
                ? '저장은 GitHub commit → 재배포 후 약 1분 내 모든 기기 반영. 이미지는 Cloudflare R2 에 업로드.'
                : '관리자 이메일로 로그인하면 저장 기능이 활성화됩니다.'
        )));

        const btns = h('div', 'admin-btns');
        btns.style.marginTop = '10px';
        btns.appendChild(makeBtn('admin-btn admin-btn-dl', 'api-test-btn', '🔬 이미지 업로드 테스트', 'button'));
        btns.appendChild(makeBtn('admin-btn admin-btn-tpl', 'api-logout-btn', '🚪 로그아웃', 'button'));
        panel.appendChild(btns);

        const st = h('p', 'admin-status'); st.id = 'api-secret-status';
        panel.appendChild(st);
        root.appendChild(panel);

        document.getElementById('api-test-btn').addEventListener('click', async () => {
            setStatus('api-secret-status', '이미지 업로드 테스트 중…');
            const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            try {
                const r = await window.ITPEAdmin.uploadImage(tinyPng);
                if (r && r.url) {
                    setStatus('api-secret-status', '✅ 성공 — R2 정상.\n' + r.url, 'ok');
                } else {
                    setStatus('api-secret-status', '⚠ 응답에 url 없음: ' + JSON.stringify(r), 'err');
                }
            } catch (e) {
                const status = e?.status;
                const reason = e?.detail?.reason;
                let hint = '';
                if (status === 401) hint = ' (쿠키 만료 — 다시 로그인)';
                if (status === 503) hint = ' (R2 환경변수 미설정)';
                setStatus('api-secret-status', '❌ 실패: ' + (e?.message || e) + (reason ? ' [' + reason + ']' : '') + hint, 'err');
            }
        });
        document.getElementById('api-logout-btn').addEventListener('click', async () => {
            if (!confirm('관리자 세션을 종료합니다. 계속할까요?')) return;
            try { window.ITPEAuth.signOut(); }
            catch (e) { setStatus('api-secret-status', '로그아웃 실패: ' + (e?.message || e), 'err'); }
        });
    }

    // 🤖 AI 시스템 프롬프트 편집 패널 — admin.html 전용 (kind='full'|'def')
    // 패널 — AI 프롬프트 (전체 / 정의 전용 탭으로 통합)
    function renderAiPromptPanel() {
        const root = document.getElementById('admin-root');
        if (!root || !window.ITPEAdmin) return;
        let activeKind = 'full';

        const panel = h('section', 'admin-panel');
        panel.id = 'ai-prompt-panel';
        panel.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('🤖 AI 시스템 프롬프트')),
            h('span', 'admin-badge', t('Gemini 2.5 Flash'))
        ));

        // 탭 선택 (full / def)
        const tabs = h('div', 'ai-prompt-tabs');
        const tabFull = makeBtn('ai-prompt-tab is-active', 'ai-prompt-tab-full', '카드 전체 생성', 'button');
        const tabDef  = makeBtn('ai-prompt-tab',           'ai-prompt-tab-def',  '정의만 재생성',  'button');
        tabs.appendChild(tabFull); tabs.appendChild(tabDef);
        panel.appendChild(tabs);

        const hint = h('p', 'admin-hint'); hint.id = 'ai-prompt-hint';
        panel.appendChild(hint);

        const ta = document.createElement('textarea');
        ta.id = 'ai-prompt-input';
        ta.className = 'form-input form-area';
        ta.rows = 12;
        ta.placeholder = '시스템 프롬프트 (기본값 사용 시 비워두기)';
        panel.appendChild(ta);

        const btns = h('div', 'admin-btns'); btns.style.marginTop = '8px';
        btns.appendChild(makeBtn('admin-btn admin-btn-dl',  'ai-prompt-load',  '📥 불러오기', 'button'));
        btns.appendChild(makeBtn('admin-btn admin-btn-up',  'ai-prompt-save',  '💾 저장',     'button'));
        btns.appendChild(makeBtn('admin-btn admin-btn-tpl', 'ai-prompt-reset', '↺ 기본값',   'button'));
        panel.appendChild(btns);

        const st = h('p', 'admin-status'); st.id = 'ai-prompt-status';
        panel.appendChild(st);

        const dump = h('details', 'ai-prompt-default');
        const sum = document.createElement('summary'); sum.textContent = '기본 프롬프트 보기';
        dump.appendChild(sum);
        const pre = document.createElement('pre'); pre.id = 'ai-prompt-default'; pre.className = 'ai-prompt-default-pre';
        dump.appendChild(pre);
        panel.appendChild(dump);
        root.appendChild(panel);

        function setHint(k) {
            hint.textContent = (k === 'def')
                ? '카드 추가 모달의 "AI 채우기 (정의)" 가 사용. 30자 이내 정의 한 줄만 생성.'
                : '"AI 채우기" 가 카드 한 장(분류·정의·내용·키워드·출처) 전체를 생성.';
        }
        function selectTab(k) {
            activeKind = k;
            tabFull.classList.toggle('is-active', k === 'full');
            tabDef.classList.toggle('is-active',  k === 'def');
            setHint(k);
            loadAiPromptInto(k);
        }
        tabFull.addEventListener('click', () => selectTab('full'));
        tabDef.addEventListener('click',  () => selectTab('def'));

        document.getElementById('ai-prompt-load').addEventListener('click',  () => loadAiPromptInto(activeKind));
        document.getElementById('ai-prompt-save').addEventListener('click',  () => saveAiPromptUnified(activeKind));
        document.getElementById('ai-prompt-reset').addEventListener('click', () => resetAiPromptUnified(activeKind));

        // 초기 로드
        setHint('full');
        if (window.ITPEAdmin.isAdminWithSecret()) loadAiPromptInto('full');
    }

    async function loadAiPromptInto(kind) {
        const k = (kind === 'def') ? 'def' : 'full';
        const ta = document.getElementById('ai-prompt-input');
        const pre = document.getElementById('ai-prompt-default');
        const statusId = 'ai-prompt-status';
        setStatus(statusId, '불러오는 중…');
        try {
            const r = await fetch('/api/ai-prompt?kind=' + k + '&_t=' + Date.now(), {
                cache: 'no-store', credentials: 'include',
            });
            if (!r.ok) {
                if (r.status === 401) { setStatus(statusId, '관리자 권한 없음', 'err'); return; }
                throw new Error('HTTP ' + r.status);
            }
            const j = await r.json();
            ta.value = j.prompt || '';
            if (pre) pre.textContent = j.defaultPrompt || '';
            setStatus(statusId,
                j.isDefault ? '✓ 기본값 사용 중 (' + j.length + '자)' : '✓ 사용자 정의 (' + j.length + '자)',
                'ok'
            );
        } catch (e) {
            setStatus(statusId, '로드 실패: ' + (e?.message || e), 'err');
        }
    }
    async function saveAiPromptUnified(kind) {
        const k = (kind === 'def') ? 'def' : 'full';
        const ta = document.getElementById('ai-prompt-input');
        const statusId = 'ai-prompt-status';
        setStatus(statusId, '저장 중…');
        try {
            const r = await fetch('/api/ai-prompt', {
                method: 'PUT', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: ta.value || '', kind: k }),
            });
            if (!r.ok) {
                let d = ''; try { d = JSON.stringify(await r.json()); } catch {}
                throw new Error('HTTP ' + r.status + ' ' + d);
            }
            const j = await r.json();
            setStatus(statusId,
                j.reset ? '✓ 기본값으로 복원 (재배포 후 ~1분)' : '✓ 저장 완료 (' + j.length + '자, 재배포 후 ~1분)',
                'ok'
            );
        } catch (e) {
            setStatus(statusId, '저장 실패: ' + (e?.message || e), 'err');
        }
    }
    async function resetAiPromptUnified(kind) {
        if (!confirm('사용자 정의를 삭제하고 기본값으로 복원합니다. 계속할까요?')) return;
        const ta = document.getElementById('ai-prompt-input');
        if (ta) ta.value = '';
        await saveAiPromptUnified(kind);
        await loadAiPromptInto(kind);
    }

    // ─────────────────────────────────────────────────────────────
    // 🧹 R2 orphan 이미지 정리 패널
    // GET  /api/cleanup-orphans → 미리보기 (어떤 파일이 삭제될지)
    // POST /api/cleanup-orphans → 실제 삭제
    // ─────────────────────────────────────────────────────────────
    function fmtBytes(b) {
        if (b == null) return '?';
        if (b < 1024) return b + 'B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
        return (b / 1024 / 1024).toFixed(2) + 'MB';
    }

    function renderImageCleanupPanel() {
        const root = document.getElementById('admin-root');
        if (!root || !window.ITPEAdmin) return;
        const panel = h('section', 'admin-panel');
        panel.id = 'cleanup-panel';
        panel.appendChild(h('div', 'admin-head',
            h('h2', 'admin-title', t('🧹 R2 사용 안 하는 이미지 정리')),
            h('span', 'admin-badge', t('orphan 청소'))
        ));
        panel.appendChild(h('p', 'admin-hint',
            t('카드에서 제거되거나 카드 자체가 삭제됐는데 R2 스토리지엔 남아있는 이미지를 찾아 제거합니다. ') +
            t('먼저 [미리보기] 로 어떤 파일이 대상인지 확인 후 [삭제 실행] 하세요. 안전: 카드 JSON 에 참조된 URL 은 절대 안 지웁니다.')
        ));
        const btns = h('div', 'admin-btns');
        btns.style.marginTop = '10px';
        btns.appendChild(makeBtn('admin-btn admin-btn-dl', 'cleanup-preview-btn', '📋 미리보기',     'button'));
        btns.appendChild(makeBtn('admin-btn admin-btn-tpl','cleanup-execute-btn', '🗑 삭제 실행',    'button'));
        panel.appendChild(btns);
        const st = h('p', 'admin-status'); st.id = 'cleanup-status';
        panel.appendChild(st);
        const list = h('div', 'admin-hint'); list.id = 'cleanup-list';
        list.style.marginTop = '8px';
        list.style.fontFamily = 'monospace';
        list.style.fontSize = '0.85em';
        list.style.whiteSpace = 'pre-wrap';
        panel.appendChild(list);
        root.appendChild(panel);

        async function preview() {
            setStatus('cleanup-status', '미리보기 조회 중…');
            document.getElementById('cleanup-list').textContent = '';
            try {
                const r = await fetch('/api/cleanup-orphans', window.ITPEAdmin.fetchOpts());
                const j = await r.json();
                if (!r.ok) {
                    setStatus('cleanup-status', '❌ 실패: ' + (j.error || r.status) + (j.detail ? ' · ' + j.detail : ''), 'err');
                    return;
                }
                setStatus('cleanup-status',
                    `📊 카드 참조 ${j.inUseCount}개 / R2 전체 ${j.totalCount}개 / ` +
                    `🗑 orphan ${j.orphanCount}개 (${fmtBytes(j.orphanSize)})`, 'ok');
                if (j.orphanCount > 0) {
                    const sample = (j.orphanSample || []).join('\n');
                    const more = j.orphanCount > j.orphanSample.length
                        ? `\n… 외 ${j.orphanCount - j.orphanSample.length}개`
                        : '';
                    document.getElementById('cleanup-list').textContent =
                        '삭제 예정 목록 (상위 ' + j.orphanSample.length + '개):\n' + sample + more;
                }
            } catch (e) {
                setStatus('cleanup-status', '❌ 오류: ' + (e?.message || e), 'err');
            }
        }
        async function execute() {
            if (!confirm('카드에서 참조되지 않는 R2 이미지 파일을 영구 삭제합니다.\n\n· 카드에 사용 중인 이미지는 안전 (절대 안 지움)\n· 되돌릴 수 없음\n\n계속할까요?')) return;
            setStatus('cleanup-status', '삭제 실행 중… (큰 양이면 몇 초 걸림)');
            try {
                const r = await fetch('/api/cleanup-orphans', window.ITPEAdmin.fetchOpts({ method: 'POST' }));
                const j = await r.json();
                if (!r.ok) {
                    setStatus('cleanup-status', '❌ 실패: ' + (j.error || r.status) + (j.detail ? ' · ' + j.detail : ''), 'err');
                    return;
                }
                setStatus('cleanup-status',
                    `✅ 삭제 완료 — ${j.deletedCount}개 (${fmtBytes(j.freedBytes)} 확보)` +
                    (j.failedCount ? ` · 실패 ${j.failedCount}개` : ''), 'ok');
                document.getElementById('cleanup-list').textContent = '';
            } catch (e) {
                setStatus('cleanup-status', '❌ 오류: ' + (e?.message || e), 'err');
            }
        }
        document.getElementById('cleanup-preview-btn').addEventListener('click', preview);
        document.getElementById('cleanup-execute-btn').addEventListener('click', execute);
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
            '단원을 추가·삭제·이동(↑↓). 저장 시 GitHub commit → 재배포 후 ~1분 내 반영. ' +
            'ID(영문 소문자/숫자/-) 는 카드 파일명이 되므로 신중하게. 이름·이모지·색은 변경 가능.'
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
        // 기존 내용 한 번 비우고 새 순서로 조립
        while (root.firstChild) root.removeChild(root.firstChild);

        // 패널 순서:
        //   1) 세션 상태 (최상단)
        //   2) 단원 관리 (자주 쓰는 것)
        //   3) 엑셀 일괄
        //   4) 사용자 화이트리스트
        //   5) AI 프롬프트 (탭 통합)
        //   6) R2 이미지 정리 (유지보수 — 맨 아래)
        renderSessionPanel();
        renderUnitsPanel();
        renderBulkExcelPanel();
        renderUsersPanel();
        renderAiPromptPanel();
        renderImageCleanupPanel();

        // 이벤트 바인딩 (DOM 추가 후)
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
                [COLS[4]]: '정의 (30자 이내)',
                [COLS[5]]: '내용 (두음·핵심요약, 선택)',
                [COLS[6]]: '쉼표로 구분된 키워드 (선택)',
                [COLS[7]]: '', [COLS[8]]: '',
            }));
            for (let i = 0; i < 30; i++) rows.push({});
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
            applySheetStyles(ws, COLS, COL_WIDTHS, ['정의', '내용', '키워드']);
            XLSX.utils.book_append_sheet(wb, ws, '카드');
            const ref = (idx.units || []).map((u) => ({ '단원ID': u.id, '단원명': u.name, '설명': u.description || '' }));
            const wsRef = XLSX.utils.json_to_sheet(ref);
            applySheetStyles(wsRef, ['단원ID', '단원명', '설명'], [10, 14, 30], ['설명']);
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
            applySheetStyles(ws, COLS, COL_WIDTHS, ['정의', '내용', '키워드']);
            injectImageFormulas(ws, COLS);
            XLSX.utils.book_append_sheet(wb, ws, '카드');
            downloadWorkbook(wb, `ITPE_export_${todayTag()}.xlsx`);
            setStatus('admin-status', `다운로드 완료 — 총 ${rows.length}장 (Excel 365 에서 이미지 자동 표시)`, 'ok');
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
        // 패널 자체는 기본 숨김 — 토글 버튼으로만 활성화
        const unitId = new URLSearchParams(location.search).get('unit');
        if (!unitId) return;
        let unit = null;

        // 🛠 관리자 도구 토글 & 나가기 — 위/아래 두 버튼이 동일 동작
        const toggleBtn = document.getElementById('admin-tools-toggle');
        const exitBtn   = document.getElementById('admin-tools-exit');
        const adminSections = ['unit-admin', 'autodef-panel', 'ai-panel'];
        function setAdminToolsOpen(open) {
            adminSections.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.hidden = !open;
            });
            if (toggleBtn) toggleBtn.hidden = open;
            if (exitBtn)   exitBtn.hidden   = !open;
            // 열 때마다 autodef 패널 상태 갱신
            if (open && window.ITPEFlash && typeof window.ITPEFlash.refreshAutoDef === 'function') {
                try { window.ITPEFlash.refreshAutoDef(); } catch {}
            }
        }
        if (toggleBtn) {
            toggleBtn.hidden = false;     // 관리자에게 토글 노출
            toggleBtn.addEventListener('click', () => setAdminToolsOpen(true));
        }
        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                setAdminToolsOpen(false);
                // 모드 선택 화면 상단으로 스크롤
                try { document.getElementById('mode-screen')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
            });
        }

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
        // ✨ AI 패널 — 이벤트 바인딩만 (토글로 가시성 제어)
        if (aiPanel) {
            const aiInput = document.getElementById('ai-input');
            const aiBtn = document.getElementById('ai-generate');
            const aiResults = document.getElementById('ai-results');
            aiBtn.addEventListener('click', () => doAiGenerate(unit, aiInput, aiResults, aiBtn));
            bindInlinePromptEditor();
        }
        // 🤖 빈 정의 자동 생성 패널 — 이벤트는 flash.js 가, 가시성은 토글이 담당

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
                // 현재 단원 카드 fetch → 신규 추가 + 기존 토픽은 덮어쓰기
                const base = await window.ITPEAdmin.fetchCards(u.id);
                const baseCards = Array.isArray(base) ? base.slice() : [];
                // 정규화된 토픽 → baseCards 인덱스 맵
                const idxByTopic = new Map();
                baseCards.forEach((c, i) => idxByTopic.set(normalizeTopic(cardTopic(c)), i));

                let added = 0, updated = 0;
                items.forEach((it) => {
                    const tNorm = normalizeTopic(it.topic);
                    const aiFields = {
                        category: it.category || '',
                        topic: it.topic,
                        definition: it.definition || '',
                        mnemonic: it.mnemonic || '',
                        keyword: it.keyword || '',
                        references: Array.isArray(it.references) ? it.references : [],
                        source: 'ai',
                        aiGeneratedAt: new Date().toISOString(),
                        aiConfidence: it.confidence || 'medium',
                    };
                    if (idxByTopic.has(tNorm)) {
                        // 기존 카드 덮어쓰기 — 식별자/이미지/생성일 보존
                        const i = idxByTopic.get(tNorm);
                        const prev = baseCards[i] || {};
                        baseCards[i] = {
                            ...prev,
                            ...aiFields,
                            userId: prev.userId || ('u' + Date.now() + '-ai-' + Math.random().toString(36).slice(2, 6)),
                            createdAt: prev.createdAt || new Date().toISOString(),
                            editedAt: new Date().toISOString(),
                            images: prev.images,  // 기존 이미지 유지 (AI는 이미지 생성 안 함)
                        };
                        updated++;
                    } else {
                        baseCards.push({
                            ...aiFields,
                            userId: 'u' + Date.now() + '-ai-' + Math.random().toString(36).slice(2, 6),
                            createdAt: new Date().toISOString(),
                        });
                        idxByTopic.set(tNorm, baseCards.length - 1);
                        added++;
                    }
                });
                if (added === 0 && updated === 0) {
                    setStatus('ai-status', '저장할 항목 없음.', 'err');
                    return;
                }
                await window.ITPEAdmin.saveCards(u.id, baseCards);
                setStatus('ai-status', `✓ 신규 ${added}장 추가 · 기존 ${updated}장 갱신`, 'ok');
                await refreshCounts();
            } catch (e) {
                setStatus('ai-status', '저장 실패: ' + (e?.message || e), 'err');
            }
        }

        // 이 단원 카드 → 엑셀 다운로드 (분류·토픽·정의·내용·키워드, 행 순서 그대로)
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
                const rows = all.map((c) => {
                    const firstImg = (Array.isArray(c.images) ? c.images : [])
                        .find((s) => typeof s === 'string' && /^https:\/\//i.test(s));
                    return {
                        '분류':    c.category   ?? '',
                        '토픽':    c.topic      ?? c.q ?? '',
                        '정의':    c.definition ?? c.a ?? '',
                        '내용':    c.mnemonic   ?? '',
                        '키워드':  c.keyword    ?? '',
                        '이미지':  firstImg || '',
                    };
                });
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(rows, { header: UNIT_COLS });
                applySheetStyles(ws, UNIT_COLS, UNIT_COL_WIDTHS, ['정의', '내용', '키워드']);
                injectImageFormulas(ws, UNIT_COLS);
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
                `· 서버에서 영구 삭제됩니다 (GitHub commit)\n` +
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
                rows.push({ '분류':'분류 (선택)', '토픽':'예시 토픽', '정의':'정의 (30자 이내)', '내용':'내용 (두음·핵심요약, 선택)', '키워드':'쉼표 구분 키워드', '이미지':'' });
                for (let i = 0; i < 20; i++) rows.push({});
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(rows, { header: UNIT_COLS });
                applySheetStyles(ws, UNIT_COLS, UNIT_COL_WIDTHS, ['정의', '내용', '키워드']);
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
                    // 서버에 PUT — GitHub commit → 재배포 후 ~1분 내 반영
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
