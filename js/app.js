// 시트 목록 화면 + 공통 하단 툴바 (메뉴 화면 컨텍스트)
(function () {
    const list  = document.getElementById('sheet-list');
    const empty = document.getElementById('empty-state');

    // 상태
    const state = {
        units: [],
        // 시트 목록 화면에서 선택(하이라이트)된 단원 (Enter로 진입)
        selected: 0,
    };

    // 폰트 크기 (전역 공유)
    initFontSize();

    // 우선 /api/units (관리자가 수정한 동적 목록) → 폴백 data/index.json
    fetch('/api/units?_t=' + Date.now(), { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error('api/units ' + r.status)))
        .catch(() => fetch('data/index.json', { cache: 'no-cache' }).then((r) => r.json()))
        .then((data) => {
            state.units = Array.isArray(data.units) ? data.units : [];
            if (maybeAutoResume()) return;   // 마지막 본 카드로 자동 복귀 (리다이렉트됨)
            render();
        })
        .catch((err) => {
            console.error('[ITPE] units load fail', err);
            list.hidden = true;
            empty.hidden = false;
        });

    // 앱 재접속(홈 진입) 시 마지막 본 카드로 자동 복귀.
    //   - flash 의 '메뉴' 버튼으로 목록을 명시적으로 열면(itpe.toList) 이 세션 동안 복귀 안 함 → 목록 유지
    //     (목록에서 새로고침해도 카드로 튕기지 않음). 앱 재실행은 새 세션이라 다시 복귀.
    //   - 저장된 단원이 현재 목록에 없으면(삭제됨) 건너뜀.
    function maybeAutoResume() {
        try {
            if (sessionStorage.getItem('itpe.toList') === '1') return false;
            const raw = localStorage.getItem('itpe.lastPosition');
            if (!raw) return false;
            const saved = JSON.parse(raw);
            if (!saved || !saved.unitId || !saved.cardKey) return false;
            if (!state.units.some((u) => u.id === saved.unitId)) return false;
            const mode = saved.mode === 'random' ? 'random' : 'sequence';
            // replace — 뒤로가기로 홈에 와도 다시 튕기지 않게 히스토리 오염 방지
            location.replace('flash.html?unit=' + encodeURIComponent(saved.unitId) + '&mode=' + mode);
            return true;
        } catch { return false; }
    }

    function render() {
        list.innerHTML = '';
        list.removeAttribute('aria-busy');
        const metaEls = {};
        state.units.forEach((u, i) => {
            const a = document.createElement('a');
            a.className = 'sheet-item';
            a.href = `flash.html?unit=${encodeURIComponent(u.id)}`;
            a.dataset.idx = i;
            a.dataset.unitId = u.id;

            const num = document.createElement('span');
            num.className = 'sheet-num';
            num.textContent = String(i + 1);

            const nameWrap = document.createElement('span');
            nameWrap.className = 'sheet-name';
            const shortEl = document.createElement('span');
            shortEl.className = 'sheet-name-short';
            shortEl.textContent = u.name || '';
            nameWrap.appendChild(shortEl);
            if (u.description) {
                const descEl = document.createElement('span');
                descEl.className = 'sheet-name-desc';
                descEl.textContent = u.description;
                nameWrap.appendChild(descEl);
            }

            const meta = document.createElement('span');
            meta.className = 'sheet-meta';
            meta.textContent = '… 카드';
            metaEls[u.id] = meta;

            a.append(num, nameWrap, meta);
            list.appendChild(a);
        });
        document.dispatchEvent(new CustomEvent('itpe:sheetlist-ready', { detail: { count: state.units.length } }));
        // 실제 카드 수를 단원별로 계산해 갱신 (JSON − 이동제거 + 사용자추가)
        refreshRealCounts(metaEls);
    }

    function loadLocalArray(key) {
        try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) || []) : []; }
        catch { return []; }
    }
    function realCountFor(unit, jsonCards) {
        const removed = new Set(loadLocalArray('itpe.removedJson.' + unit.id));
        const userCards = loadLocalArray('itpe.userCards.' + unit.id);
        const jsonAlive = jsonCards.filter((c) => {
            const k = c.userId ? 'u:' + c.userId : 'j:' + String(c.topic ?? c.q ?? '').slice(0, 60);
            return !removed.has(k);
        });
        return jsonAlive.length + userCards.length;
    }
    // 이동/삭제 직후 갯수 현행화 힌트 — 서버(재배포 ~1분)가 따라잡을 때까지 기대값 우선 표시.
    const COUNT_HINT_TTL = 5 * 60 * 1000; // 5분
    function loadCountHints() {
        try { const raw = localStorage.getItem('itpe.countHints'); return raw ? (JSON.parse(raw) || {}) : {}; }
        catch { return {}; }
    }
    function saveCountHints(map) {
        try {
            if (map && Object.keys(map).length) localStorage.setItem('itpe.countHints', JSON.stringify(map));
            else localStorage.removeItem('itpe.countHints');
        } catch {}
    }
    // 서버 계산값 serverN 에 힌트 적용 → 표시할 갯수 반환. hints/dirty 는 참조로 갱신.
    function applyCountHint(unitId, serverN, hints, now, dirtyRef) {
        const h = hints[unitId];
        if (!h || typeof h.count !== 'number') return serverN;
        if ((now - (h.ts || 0)) > COUNT_HINT_TTL || serverN === h.count) {
            delete hints[unitId]; dirtyRef.dirty = true;   // 만료 또는 서버 반영 완료 → 폐기
            return serverN;
        }
        return h.count;   // 서버 지연 중 — 기대값 표시
    }

    function refreshRealCounts(metaEls) {
        const hints = loadCountHints();
        const now = Date.now();
        const dirtyRef = { dirty: false };
        // /api/cards 한 번 호출로 전체 단원 카운트 처리 (시드 + Blob 자동 폴백)
        fetch('/api/cards?_t=' + Date.now(), { cache: 'no-store' })
            .then((r) => r.ok ? r.json() : null)
            .then((all) => {
                if (!all || typeof all !== 'object') throw new Error('bad response');
                state.units.forEach((u) => {
                    const el = metaEls[u.id];
                    if (!el) return;
                    const cards = Array.isArray(all[u.id]) ? all[u.id] : [];
                    const n = applyCountHint(u.id, realCountFor(u, cards), hints, now, dirtyRef);
                    el.textContent = n + ' 카드';
                });
                if (dirtyRef.dirty) saveCountHints(hints);
            })
            .catch(() => {
                // 폴백 — 번들 JSON 개별 조회
                state.units.forEach((u) => {
                    const el = metaEls[u.id];
                    if (!el) return;
                    fetch('data/cards/' + u.file, { cache: 'no-cache' })
                        .then((r) => r.ok ? r.json() : [])
                        .then((cards) => {
                            const serverN = realCountFor(u, Array.isArray(cards) ? cards : []);
                            const n = applyCountHint(u.id, serverN, hints, now, dirtyRef);
                            el.textContent = n + ' 카드';
                            if (dirtyRef.dirty) saveCountHints(hints);
                        })
                        .catch(() => { el.textContent = (u.count ?? 0) + ' 카드'; });
                });
            });
    }

    // ============ 하단 툴바 ============
    document.getElementById('btn-menu').addEventListener('click', () => {
        // 이미 메뉴 화면이므로 맨 위로
        document.querySelector('.app-content').scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.getElementById('btn-find').addEventListener('click', () => openGlobalFind());

    // ============ 전체 카드 검색 모달 ============
    const findModal = document.getElementById('global-find-modal');
    const findInput = document.getElementById('global-find-input');
    const findList  = document.getElementById('global-find-list');
    const findCount = document.getElementById('global-find-count');
    let allCardsCache = null;

    async function ensureAllCardsLoaded() {
        if (allCardsCache) return allCardsCache;
        try {
            const r = await fetch('/api/cards?_t=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const all = await r.json();
            const flat = [];
            state.units.forEach((u) => {
                const cards = Array.isArray(all[u.id]) ? all[u.id] : [];
                cards.forEach((c, i) => flat.push({ unit: u, cardIdx: i, card: c }));
            });
            allCardsCache = flat;
            return flat;
        } catch (e) {
            console.warn('[ITPE] 전체 검색 데이터 로드 실패', e);
            return [];
        }
    }

    function openGlobalFind() {
        findInput.value = '';
        renderFindResults('');
        findModal.hidden = false;
        setTimeout(() => findInput.focus(), 50);
        // 미리 데이터 로드
        ensureAllCardsLoaded().catch(() => {});
    }
    function closeGlobalFind() { findModal.hidden = true; }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, (ch) =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
    }
    function highlightFrag(text, needle) {
        const out = document.createDocumentFragment();
        const src = String(text);
        if (!needle) { out.appendChild(document.createTextNode(src)); return out; }
        const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(safe, 'gi');
        let last = 0; let m;
        while ((m = re.exec(src)) !== null) {
            if (m.index > last) out.appendChild(document.createTextNode(src.slice(last, m.index)));
            const mk = document.createElement('mark');
            mk.textContent = m[0];
            out.appendChild(mk);
            last = m.index + m[0].length;
            if (m[0].length === 0) re.lastIndex++;
        }
        if (last < src.length) out.appendChild(document.createTextNode(src.slice(last)));
        return out;
    }

    async function renderFindResults(q) {
        const needle = (q || '').trim().toLowerCase();

        // 빈 검색어 — 결과 안 보이고 안내만
        while (findList.firstChild) findList.removeChild(findList.firstChild);
        if (!needle) {
            findCount.textContent = '0';
            const hint = document.createElement('div');
            hint.className = 'find-empty';
            hint.style.padding = '40px 16px';
            hint.style.lineHeight = '1.7';
            hint.innerHTML = ''; // safety
            hint.appendChild(document.createTextNode('🔍 검색어를 입력하세요'));
            const sub = document.createElement('div');
            sub.style.fontSize = '0.78rem';
            sub.style.color = 'var(--text-dim)';
            sub.style.marginTop = '8px';
            sub.textContent = '분류 · 토픽 · 정의 · 내용 · 키워드 어디든 매칭';
            hint.appendChild(sub);
            findList.appendChild(hint);
            return;
        }

        const items = await ensureAllCardsLoaded();
        const matches = items.filter(({ card, unit }) => {
            const hay = [
                card.category, card.topic, card.q, card.definition, card.a,
                card.mnemonic, card.keyword, card.extra, unit.name, unit.description
            ].filter(Boolean).join(' \n ').toLowerCase();
            return hay.includes(needle);
        });
        findCount.textContent = matches.length;
        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'find-empty';
            empty.textContent = '일치하는 카드가 없습니다.';
            findList.appendChild(empty);
            return;
        }
        const frag = document.createDocumentFragment();
        matches.slice(0, 100).forEach(({ unit, card }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'find-item';

            const unitTag = document.createElement('span');
            unitTag.className = 'find-num';
            unitTag.textContent = unit.name || unit.id;

            const text = document.createElement('span');
            text.className = 'find-text';
            const topicEl = document.createElement('span');
            topicEl.className = 'find-topic';
            const topicLine = (card.category ? card.category + ' / ' : '') + (card.topic ?? card.q ?? '');
            topicEl.appendChild(highlightFrag(topicLine, needle));
            const snipEl = document.createElement('span');
            snipEl.className = 'find-snippet';
            const snippet = String(card.definition ?? card.a ?? card.keyword ?? card.mnemonic ?? '')
                .replace(/\s+/g, ' ').trim().slice(0, 90);
            snipEl.appendChild(highlightFrag(snippet, needle));
            text.append(topicEl, snipEl);

            const arrow = document.createElement('span');
            arrow.className = 'find-star off';
            arrow.textContent = '→';

            btn.append(unitTag, text, arrow);
            btn.addEventListener('click', () => {
                const topicKey = (card.topic ?? card.q ?? '').slice(0, 60);
                location.href = 'flash.html?unit=' + encodeURIComponent(unit.id)
                    + '&mode=sequence&topic=' + encodeURIComponent(topicKey);
            });
            frag.appendChild(btn);
        });
        if (matches.length > 100) {
            const more = document.createElement('div');
            more.className = 'find-empty';
            more.style.color = 'var(--text-dim)';
            more.textContent = '… 외 ' + (matches.length - 100) + '개 (검색어를 더 좁혀주세요)';
            frag.appendChild(more);
        }
        findList.appendChild(frag);
    }

    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            renderFindResults(findInput.value);
        }
    });
    findInput.addEventListener('input', () => {
        // 짧은 디바운스
        clearTimeout(findInput._debounce);
        findInput._debounce = setTimeout(() => renderFindResults(findInput.value), 200);
    });
    document.getElementById('global-find-close').addEventListener('click', closeGlobalFind);
    findModal.addEventListener('click', (e) => { if (e.target === findModal) closeGlobalFind(); });
    document.addEventListener('keydown', (e) => {
        if (!findModal.hidden && e.key === 'Escape') closeGlobalFind();
    });

    // Enter 누르면 선택된(또는 첫) 단원 진입 (좌·우 Enter 모두)
    document.querySelectorAll('[data-act="enter"]').forEach((b) => b.addEventListener('click', () => {
        const u = state.units[state.selected] || state.units[0];
        if (u) location.href = `flash.html?unit=${encodeURIComponent(u.id)}`;
    }));
    // Prev 는 시트 목록 화면에서 비활성 (둘 다)
    document.querySelectorAll('[data-act="prev"]').forEach((b) => b.disabled = true);

    function jumpTo(n) {
        const u = state.units[n - 1];
        if (!u) { alert(`1~${state.units.length} 사이 번호를 입력하세요.`); return; }
        location.href = `flash.html?unit=${encodeURIComponent(u.id)}`;
    }

    // 계정 표시 (툴바 내부) + 로그아웃 버튼 연결
    try {
        const sess = window.ITPEAuth && window.ITPEAuth.getSession();
        const emailEl = document.getElementById('nav-account-email');
        if (sess && sess.email && emailEl) {
            // 작은 화면에서도 잘 보이도록 @앞 로컬파트만 노출 (전체는 title 로)
            const local = sess.email.split('@')[0];
            emailEl.textContent = local;
            emailEl.title = sess.email;
            emailEl.hidden = false;
        }
        const navLogout = document.getElementById('btn-logout-nav');
        if (navLogout) {
            navLogout.addEventListener('click', () => {
                if (confirm('로그아웃하시겠습니까?')) window.ITPEAuth.signOut();
            });
        }
    } catch {}

    // 서비스워커 등록
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        });
    }

    // ============ 폰트 크기 (공통) ============
    function initFontSize() {
        const fz = parseInt(localStorage.getItem('itpe.fz') || '0', 10);
        document.body.dataset.fz = String(fz);
    }
    function stepFontSize(delta) {
        let fz = parseInt(document.body.dataset.fz || '0', 10) + delta;
        fz = Math.max(-2, Math.min(3, fz));
        document.body.dataset.fz = String(fz);
        localStorage.setItem('itpe.fz', String(fz));
    }
})();
