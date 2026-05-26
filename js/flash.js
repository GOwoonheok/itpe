// 카드 학습 화면 — 토픽/정의/내용/키워드 4섹션, 이미지 확대, 섹션 숨기기, 하단 툴바
(function () {
    const params = new URLSearchParams(location.search);
    const unitId = params.get('unit');
    const initialMode = params.get('mode'); // 'random' | 'sequence' | null
    const initialTopic = params.get('topic'); // 시트 목록 검색 결과로 점프 시
    const initialFilter = params.get('filter'); // 'ai' 면 AI 생성 카드만

    const els = {
        modeScreen: document.getElementById('mode-screen'),
        studyScreen: document.getElementById('study-screen'),
        chipRow:   document.getElementById('chip-row'),
        progress:  document.getElementById('card-progress'),
        unitName:  document.getElementById('card-unit'),
        thumbs:    document.getElementById('card-thumbs'),
        imgToggle: document.getElementById('card-img-toggle'),
        imgToggleCount: document.getElementById('card-img-toggle-count'),
        secTopic:  document.getElementById('sec-topic'),
        secDef:    document.getElementById('sec-def'),
        secMn:     document.getElementById('sec-mn'),
        secKw:     document.getElementById('sec-kw'),
        secRef:    document.getElementById('sec-ref'),
        sections:  document.querySelectorAll('.card-section'),
        chipHide:  document.getElementById('chip-hide'),
        chipCheck: document.getElementById('chip-check'),
        btnFilterChecked: document.getElementById('btn-filter-checked'),
        btnFilterAll:     document.getElementById('btn-filter-all'),
        filterCnt: document.getElementById('filter-count'),
        hidePanel: document.getElementById('hide-panel'),
        overlay:   document.getElementById('image-overlay'),
        overlayImg:document.getElementById('image-overlay-img'),
        overlayClose: document.getElementById('img-close'),
        overlayCounter: document.getElementById('img-counter'),
        btnTimer:   document.getElementById('btn-timer'),
        timerLabel: document.getElementById('timer-label'),
        timerPop:   document.getElementById('timer-popover'),
        btnTts:     document.getElementById('btn-tts'),
        ttsLabel:   document.getElementById('tts-label'),
        ttsPop:     document.getElementById('tts-popover'),
    };

    // 자동 넘김 상태
    let autoSec = 0;
    let autoTimer = null;

    // TTS 상태: 'off' | 'td' | 'all'
    let ttsMode = 'off';
    let lastSpokenCardIdx = -1;
    let ttsVoice = null;
    const synth = window.speechSynthesis;

    // 오버레이(확대) 상태
    const ovState = { images: [], idx: 0 };

    const state = {
        unit: null,
        jsonCards: [],
        userCards: [],
        cards: [],
        order: [],
        idx: 0,
        mode: null,
        hidden: { topic: false, definition: false, mnemonic: false, keyword: false, extra: false },
        continuousImages: false,
        checked: new Set(),       // 체크된 카드 키 집합
        filterChecked: false,     // "체크만 보기" 모드
        filterAi: false,          // "AI 생성만 보기" 모드
    };

    initFontSize();
    syncToolbarHeight();
    window.addEventListener('resize', syncToolbarHeight);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', syncToolbarHeight);

    if (!unitId) return showError('단원 정보가 없습니다. 시트 목록으로 돌아가세요.');

    // 데이터 로드 — /api/units 우선, 실패 시 번들 폴백
    // indexData: 다음 .then 체인에서도 참조 (notebooklmUrl 등 전역 메타용)
    let indexData = null;
    fetch('/api/units?_t=' + Date.now(), { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error('units ' + r.status)))
        .catch(() => fetch('data/index.json', { cache: 'no-cache' }).then((r) => r.json()))
        .then((data) => {
            indexData = data;                                       // 스코프 외부에 보관
            state.unit = (data.units || []).find((u) => u.id === unitId);
            if (!state.unit) throw new Error('단원 없음: ' + unitId);
            return fetch('/api/cards?unit=' + encodeURIComponent(unitId) + '&_t=' + Date.now(), { cache: 'no-store' })
                .then((r) => {
                    if (r.ok) return r;
                    // 폴백
                    return fetch('data/cards/' + state.unit.file, { cache: 'no-cache' });
                });
        })
        .then((r) => r.json())
        .then((cards) => {
            // JSON 카드 중 옮긴 카드 제외(removedJson) + 관리자 수정 사항 병합(cardEdits)
            const removed = new Set(loadRemovedJson(unitId));
            const edits = loadCardEdits(unitId);
            const rawJson = (Array.isArray(cards) ? cards : [])
                .filter((c) => !removed.has(cardKey(c)));
            state.jsonCards = Object.keys(edits).length
                ? rawJson.map((c) => {
                    const k = cardKey(c);
                    return edits[k] ? { ...c, ...edits[k] } : c;
                })
                : rawJson;
            state.userCards = loadUserCards();
            state.cards = buildCards();
            state.checked = loadChecked();
            // 카드 0장이어도 모드 선택 화면(엑셀 업로드 등 관리자 도구 포함)은 노출

            // 📓 NotebookLM URL — data/index.json 의 전역 메타. 있으면 툴바 버튼 노출.
            state.notebooklmUrl = (indexData && typeof indexData.notebooklmUrl === 'string' && indexData.notebooklmUrl.trim()) || '';
            const nlmBtn = document.getElementById('btn-nlm');
            if (nlmBtn) nlmBtn.hidden = !state.notebooklmUrl;

            // 🤖 빈 정의 자동 생성 패널 갱신 — cards 가 채워진 시점
            if (window.ITPEFlash && window.ITPEFlash.refreshAutoDef) {
                try { window.ITPEFlash.refreshAutoDef(); } catch {}
            }

            // 이전 학습 위치 복원 시도 (같은 단원일 때만)
            const saved = loadLastPosition();
            const savedSameUnit = saved && saved.unitId === unitId;
            if (savedSameUnit && typeof saved.filterChecked === 'boolean') {
                state.filterChecked = saved.filterChecked;
            }
            rebuildOrder();

            // 카드 없으면 학습 모드 직행 무시하고 모드 선택 화면 보여줌
            if (state.cards.length === 0) {
                showModeSelect();
                return;
            }

            // URL filter=ai → AI 생성 카드만 보기
            if (initialFilter === 'ai') state.filterAi = true;

            // 단원 진입 정책: URL에 명시적 mode 가 있을 때만 학습 화면 직행.
            if (initialMode === 'random' || initialMode === 'sequence') {
                state.mode = initialMode;
                if (state.mode === 'random') shuffleOrder();
                // URL ?topic= 으로 시트 검색에서 점프한 경우 그 카드로 이동
                if (initialTopic) {
                    const ci = state.cards.findIndex((c) => {
                        const t = (c.topic ?? c.q ?? '').slice(0, 60);
                        return t === initialTopic;
                    });
                    if (ci >= 0) {
                        const pos = state.order.indexOf(ci);
                        if (pos >= 0) state.idx = pos;
                    }
                } else if (savedSameUnit) {
                    resumeCardIfPossible(saved);
                }
                showStudy();
                render();
            } else if (savedSameUnit && saved.cardKey
                       && state.cards.some((c) => cardKey(c) === saved.cardKey)) {
                // 명시적 mode 가 없어도 — 이 단원에 마지막 본 카드가 남아 있으면 학습 화면으로 복귀.
                state.mode = (saved.mode === 'random') ? 'random' : 'sequence';
                if (state.mode === 'random') shuffleOrder();
                resumeCardIfPossible(saved);
                // 새로고침해도 유지되도록 URL 에 mode 반영
                try {
                    const url = new URL(location.href);
                    url.searchParams.set('mode', state.mode);
                    history.replaceState(null, '', url);
                } catch {}
                showStudy();
                render();
            } else {
                showModeSelect();
            }
        })
        .catch((err) => { console.error(err); showError('카드 데이터를 불러오지 못했습니다.'); });

    // ============ 모드 선택 ============
    function showModeSelect() {
        els.modeScreen.hidden = false;
        els.studyScreen.hidden = true;
        els.chipRow.hidden = true;
        // 학습 카드가 아닌 화면 — '그림' 버튼 숨김
        const contBtn = document.getElementById('btn-cont');
        if (contBtn) contBtn.hidden = true;
        // AI 카드 수 카운트 노출
        try {
            const aiCount = state.cards.filter((c) => c && c.source === 'ai').length;
            const aiBtn = document.querySelector('.mode-option.mode-ai');
            const aiCountEl = document.getElementById('mode-ai-count');
            if (aiBtn) {
                if (aiCount > 0) { aiBtn.hidden = false; if (aiCountEl) aiCountEl.textContent = String(aiCount); }
                else { aiBtn.hidden = true; }
            }
        } catch {}
    }
    document.querySelectorAll('.mode-option').forEach((b) => {
        b.addEventListener('click', () => {
            if (state.cards.length === 0) {
                alert('이 단원에 카드가 없습니다.\n\n아래 "📤 엑셀 업로드" 또는 학습 화면 "+추가"로 먼저 카드를 등록하세요.');
                return;
            }
            // ✨ AI 필터 옵션
            if (b.dataset.filter === 'ai') {
                state.filterAi = true;
            } else {
                state.filterAi = false;
            }
            state.mode = b.dataset.mode;
            rebuildOrder();
            if (state.filterAi && state.order.length === 0) {
                state.filterAi = false;
                alert('AI 생성 카드가 없습니다.');
                rebuildOrder();
                return;
            }
            if (state.mode === 'random') shuffleOrder();
            const url = new URL(location.href);
            url.searchParams.set('mode', state.mode);
            if (state.filterAi) url.searchParams.set('filter', 'ai');
            else url.searchParams.delete('filter');
            history.replaceState(null, '', url);
            showStudy();
            render();
        });
    });

    function showStudy() {
        els.modeScreen.hidden = true;
        els.studyScreen.hidden = false;
        els.chipRow.hidden = false;
    }

    function shuffleOrder() {
        for (let i = state.order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
        }
        state.idx = 0;
    }

    function currentCard() {
        return state.cards[state.order[state.idx]];
    }

    // 체크용 안정 키: 사용자 카드는 userId, JSON 카드는 토픽 해시
    function cardKey(c) {
        if (!c) return '';
        if (c.userId) return 'u:' + c.userId;
        const t = (c.topic ?? c.q ?? '').slice(0, 60);
        return 'j:' + t;
    }
    function isChecked(c) { return state.checked.has(cardKey(c)); }
    // 카드 목록 구성 — json 카드(고정 순서) + 유저 카드.
    // 유저 카드에 afterKey 가 있으면 해당 앵커 카드 '바로 뒤'에 삽입(현재 토픽 다음에 추가).
    // 앵커가 없거나(레거시) 앵커를 못 찾으면 맨 끝에 붙인다.
    function buildCards() {
        const byAnchor = new Map();   // afterKey -> [userCards]
        const tail = [];
        for (const uc of state.userCards) {
            if (uc && uc.afterKey) {
                if (!byAnchor.has(uc.afterKey)) byAnchor.set(uc.afterKey, []);
                byAnchor.get(uc.afterKey).push(uc);
            } else {
                tail.push(uc);
            }
        }
        const result = [];
        const emit = (card) => {
            result.push(card);
            const followers = byAnchor.get(cardKey(card));
            if (followers) {
                byAnchor.delete(cardKey(card));   // 중복 방지
                for (const f of followers) emit(f);   // 체인(유저카드 뒤 유저카드)도 지원
            }
        };
        for (const c of state.jsonCards) emit(c);
        for (const arr of byAnchor.values()) for (const f of arr) result.push(f);  // 앵커 분실분
        for (const t of tail) result.push(t);
        return result;
    }
    function rebuildOrder() {
        let indices = state.cards.map((_, i) => i);
        if (state.filterChecked) {
            indices = indices.filter((i) => isChecked(state.cards[i]));
        }
        if (state.filterAi) {
            indices = indices.filter((i) => state.cards[i] && state.cards[i].source === 'ai');
        }
        state.order = indices;
        if (state.mode === 'random') shuffleOrderKeepIdx();
        if (state.idx >= state.order.length) state.idx = Math.max(0, state.order.length - 1);
    }
    function shuffleOrderKeepIdx() {
        // 단순 셔플 (현재 위치 유지 시도는 생략)
        for (let i = state.order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
        }
    }

    // ============ 렌더링 ============
    function render() {
        const c = currentCard();
        if (!c) return;

        const total = state.order.length;
        els.progress.textContent = state.filterChecked
            ? `[${state.idx + 1}/${total} ★]`
            : `[${state.idx + 1}/${total}]`;
        els.unitName.textContent = state.unit?.name || '';
        updateCheckUI();

        // 호환: 분류·토픽·정의·내용·키워드 (+추가설명은 숨김 유지)
        const cat   = c.category ?? '';
        const topic = c.topic ?? c.q ?? '';
        const def   = c.definition ?? c.a ?? '';
        const mn    = c.mnemonic ?? '';
        const kw    = c.keyword ?? '';
        const ex    = c.extra ?? '';
        const images = getCardImages(c);

        // 카드 헤더 한 줄 — "분류명 >> 토픽명" (토픽명만 군청색 강조)
        renderTopicHeader(cat, topic);
        setSectionContent('definition', els.secDef,   def,       '정의가 비어 있습니다');
        markAiDefinition(c);
        setSectionContent('mnemonic',   els.secMn,    mn,        '내용이 비어 있습니다');
        setSectionContent('keyword',    els.secKw,    kw,        '키워드가 비어 있습니다');
        // 참고자료 — 링크 리스트 (있을 때만 표시)
        renderReferences(c.references);

        // 다중 이미지 썸네일
        renderThumbs(images);

        // '그림' 버튼 — 현재 카드에 이미지가 있을 때만 노출
        const contBtn = document.getElementById('btn-cont');
        if (contBtn) contBtn.hidden = images.length === 0;

        // 숨기기 상태 반영
        applyHideState();

        // TTS — 카드가 실제로 바뀌었을 때만 재발화
        tryTtsSpeak();

        // 마지막 학습 위치 저장
        saveLastPosition();
    }

    function getCardImages(c) {
        if (Array.isArray(c.images) && c.images.length) return c.images;
        if (c.image) return [c.image];
        return [];
    }
    function resolveImageSrc(src) {
        if (!src) return '';
        if (src.startsWith('data:') || /^https?:/.test(src) || src.includes('/')) return src;
        return `data/images/${src}`;
    }
    // 이미지 버튼 — 클릭 시 즉시 풀스크린 오버레이 페이저로 진입.
    // 카드 본문 영역에 썸네일은 표시하지 않음 (본문 가시성 우선).
    function renderThumbs(images) {
        // 썸네일 영역은 항상 숨김 — 오버레이만 사용
        els.thumbs.hidden = true;
        while (els.thumbs.firstChild) els.thumbs.removeChild(els.thumbs.firstChild);
        if (!images.length) {
            els.imgToggle.hidden = true;
            return;
        }
        els.imgToggle.hidden = false;
        els.imgToggleCount.textContent = String(images.length);
        els.imgToggle.classList.remove('is-on');
    }

    function toggleSectionVisible(key, visible) {
        const sec = document.querySelector(`.card-section[data-key="${key}"]`);
        if (sec) sec.style.display = visible ? '' : 'none';
    }
    function setSectionContent(key, bodyEl, value, placeholder) {
        const sec = document.querySelector(`.card-section[data-key="${key}"]`);
        if (!sec) return;
        sec.style.display = '';
        const hasValue = !!(value && String(value).trim());
        sec.classList.toggle('is-empty', !hasValue);
        bodyEl.textContent = hasValue ? value : placeholder;
    }
    // 카드 참고자료 — refs 가 있으면 링크 리스트로 렌더
    function renderReferences(refs) {
        const sec = document.querySelector('.card-section[data-key="references"]');
        if (!sec) return;
        const body = els.secRef;
        while (body.firstChild) body.removeChild(body.firstChild);
        const list = Array.isArray(refs) ? refs.filter((r) => r && r.url) : [];
        if (list.length === 0) {
            sec.hidden = true;
            return;
        }
        sec.hidden = false;
        list.forEach((r) => {
            const item = document.createElement('div');
            item.className = 'card-ref-item';
            const a = document.createElement('a');
            a.href = r.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = r.title || r.url;
            item.appendChild(a);
            if (r.note) {
                const note = document.createElement('div');
                note.className = 'card-ref-note';
                note.textContent = r.note;
                item.appendChild(note);
            }
            body.appendChild(item);
        });
    }

    // 답변 형식·언어 유도 지시문 — 토픽 뒤에 붙여 질의.
    //   (정의=개조식, 관련 기술요소, 구성요소, 활용방안 측면으로 한국어 간단 요약)
    const TOPIC_SEARCH_SUFFIX = ' 에 대해 한국어로 간단히 요약 정리해줘: ① 정의(개조식 2줄), ② 관련 기술요소 : 간단설명, ③ 구성요소: 간단설명, ④ 활용방안 측면';
    // 토픽 옆 검색 아이콘 — 사용자가 골라서 사용. {q}=encodeURIComponent(토픽+지시문).
    //   🔎 Perplexity: 새 탭에서 자동 조회 (로그인 불필요)
    //   🤖 Claude    : 새 대화에 질문 프리필 (로그인 필요·유료 OK, Enter 로 전송)
    const TOPIC_SEARCHERS = [
        { icon: '🔎', title: '이 토픽 Perplexity 조회 (자동 검색)', url: 'https://www.perplexity.ai/search?q={q}' },
        { icon: '🤖', title: '이 토픽 Claude 질문 (새 대화)',        url: 'https://claude.ai/new?q={q}' },
    ];
    function openTopicSearch(urlTemplate, topic) {
        const t = (topic || '').trim();
        if (!t) return;
        const q = encodeURIComponent(t + TOPIC_SEARCH_SUFFIX);
        window.open(urlTemplate.replace('{q}', q), '_blank', 'noopener,noreferrer');
    }

    // 카드 헤더 — 분류명(일반) + ">>" + 토픽명(군청색) + 🔎 빠른검색
    function renderTopicHeader(cat, topic) {
        const sec = document.querySelector('.card-section[data-key="topic"]');
        if (!sec) return;
        sec.style.display = '';
        const body = els.secTopic;
        while (body.firstChild) body.removeChild(body.firstChild);
        const hasTopic = !!(topic && String(topic).trim());
        sec.classList.toggle('is-empty', !hasTopic);
        if (cat && String(cat).trim()) {
            const catEl = document.createElement('span');
            catEl.className = 'th-cat';
            catEl.textContent = String(cat).trim();
            body.appendChild(catEl);
            const sep = document.createElement('span');
            sep.className = 'th-sep';
            sep.textContent = ' >> ';
            body.appendChild(sep);
        }
        const tEl = document.createElement('span');
        tEl.className = 'th-topic';
        tEl.textContent = hasTopic ? topic : '주제를 입력하세요';
        body.appendChild(tEl);
        // 토픽 옆 검색 아이콘들 — 🔎 Perplexity(자동 조회) · 🤖 Claude(질문). 골라서 사용.
        if (hasTopic) {
            for (const s of TOPIC_SEARCHERS) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'th-search';
                btn.textContent = s.icon;
                btn.setAttribute('aria-label', s.title);
                btn.title = s.title;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openTopicSearch(s.url, topic);
                });
                body.appendChild(btn);
            }
        }
        // AI 표시는 토픽 헤더가 아니라 '정의' 라벨 옆에 작게 (markAiDefinition)
    }

    // AI 생성 카드면 '정의' 라벨 옆에 작은 ✨AI 마커 표시 (아니면 제거)
    function markAiDefinition(c) {
        const sec = document.querySelector('.card-section[data-key="definition"]');
        if (!sec) return;
        const label = sec.querySelector('.card-section-label');
        if (!label) return;
        const old = label.querySelector('.def-ai-mark');
        if (old) old.remove();
        if (c && c.source === 'ai') {
            const mark = document.createElement('span');
            mark.className = 'def-ai-mark';
            if (c.aiConfidence) mark.classList.add('conf-' + c.aiConfidence);
            mark.textContent = '✨AI';
            mark.title = 'AI 생성 정의' + (c.aiGeneratedAt ? ' · ' + c.aiGeneratedAt.slice(0, 10) : '');
            label.appendChild(mark);
        }
    }

    function applyHideState() {
        els.sections.forEach((sec) => {
            const k = sec.dataset.key;
            sec.classList.toggle('is-hidden', !!state.hidden[k]);
        });
    }

    function updateCheckUI() {
        const c = currentCard();
        const on = !!c && isChecked(c);
        els.chipCheck.classList.toggle('is-on', on);
        els.chipCheck.textContent = on ? '체크됨' : '체크';
        const cnt = state.checked.size;
        els.filterCnt.textContent = cnt > 0 ? `(${cnt})` : '';
        els.btnFilterChecked.classList.toggle('is-on', state.filterChecked);
        els.btnFilterAll.classList.toggle('is-on', !state.filterChecked);
        els.btnFilterChecked.disabled = (cnt === 0);
    }

    // 이미지 버튼 — 풀스크린 오버레이 페이저 진입
    if (els.imgToggle) {
        els.imgToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const c = currentCard();
            if (!c) return;
            const images = getCardImages(c);
            if (images.length === 0) return;
            openImageOverlay(images, 0);
        });
    }

    // ============ 네비게이션 ============
    function go(delta) {
        const ni = state.idx + delta;
        if (ni < 0 || ni >= state.cards.length) return;
        state.idx = ni;
        render();
    }
    function jumpTo(n) {
        if (n < 1 || n > state.cards.length) {
            alert(`1~${state.cards.length} 사이 번호를 입력하세요.`);
            return;
        }
        state.idx = n - 1;
        render();
    }

    // ============ 하단 툴바 ============
    document.getElementById('btn-menu').addEventListener('click', () => {
        // '목록 보기'를 명시 — 시트 목록에서 마지막 카드로 자동 복귀하지 않도록 1회 표시
        try { sessionStorage.setItem('itpe.toList', '1'); } catch {}
        location.href = 'index.html';
    });
    // 좌·우 대칭 Prev / Enter (양 손 엄지 모두 닿도록)
    document.querySelectorAll('[data-act="prev"]').forEach((b) => b.addEventListener('click', () => { go(-1); kickAutoTimer(); }));
    document.querySelectorAll('[data-act="enter"]').forEach((b) => b.addEventListener('click', () => { go(+1); kickAutoTimer(); }));
    document.getElementById('btn-plus').addEventListener('click', () => stepFontSize(+1));
    document.getElementById('btn-minus').addEventListener('click', () => stepFontSize(-1));
    document.getElementById('btn-find').addEventListener('click', openFindModal);
    document.getElementById('btn-cont').addEventListener('click', () => {
        // 🖼 — 현재 카드의 이미지만 풀스크린 페이저로 (다른 카드 이미지 섞이지 않음)
        const c = currentCard();
        if (!c) return;
        const images = getCardImages(c);
        if (images.length === 0) {
            try { ttsToast('🖼 이 카드에는 이미지가 없습니다', 'info'); } catch {}
            return;
        }
        openImageOverlay(images, 0);
    });

    // 📓 NotebookLM — 현재 토픽을 클립보드에 복사 후 노트북 새 탭으로 열기
    //   NotebookLM 은 URL 로 query 주입 불가 → 클립보드 + 토스트로 우회
    //   사용자는 NotebookLM 채팅창 클릭 → Ctrl+V → Enter 로 검색
    {
        const nlmBtn = document.getElementById('btn-nlm');
        if (nlmBtn) nlmBtn.addEventListener('click', async () => {
            const url = state.notebooklmUrl;
            if (!url) { ttsToast('NotebookLM URL 미설정', 'err'); return; }
            const c = currentCard();
            const topic = (c && (c.topic ?? c.q) || '').trim();
            if (!topic) {
                window.open(url, '_blank', 'noopener,noreferrer');
                ttsToast('📓 NotebookLM 열림 (토픽 없음)', 'info');
                return;
            }
            // 클립보드 복사 — 권한 거부 시에도 새 탭은 무조건 열어줌
            let copied = false;
            try {
                await navigator.clipboard.writeText(topic);
                copied = true;
            } catch {}
            window.open(url, '_blank', 'noopener,noreferrer');
            ttsToast(
                copied
                    ? `📓 "${topic}" 클립보드 복사됨 — 새 탭의 채팅창에 Ctrl+V → Enter`
                    : `📓 NotebookLM 열림. 채팅창에 "${topic}" 직접 입력`,
                'ok'
            );
        });
    }

    // ============ 항목숨기기 / 카드모드 ============
    els.chipHide.addEventListener('click', () => {
        els.hidePanel.classList.toggle('is-open');
    });
    els.hidePanel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
            state.hidden[cb.dataset.key] = cb.checked;
            applyHideState();
            saveHiddenState();
            // 모달이 열려 있으면 폼의 dim 상태도 즉시 갱신
            if (!addModal.hidden) {
                const row = addModal.querySelector(`.form-row[data-key="${cb.dataset.key}"]`);
                if (row) row.classList.toggle('is-dim', cb.checked);
            }
        });
    });
    restoreHiddenState();

    // ============ ★ 체크 / 체크만 보기 ============
    els.chipCheck.addEventListener('click', () => {
        const c = currentCard();
        if (!c) return;
        const k = cardKey(c);
        if (state.checked.has(k)) state.checked.delete(k);
        else state.checked.add(k);
        saveChecked();
        // 필터 모드에서 체크 해제 시 현재 카드가 빠질 수 있으니 순서 재구성
        if (state.filterChecked) {
            const wasIdx = state.idx;
            rebuildOrder();
            if (state.order.length === 0) {
                // 필터 비어버리면 전체 모드로 자동 복귀
                state.filterChecked = false;
                rebuildOrder();
            } else if (wasIdx >= state.order.length) {
                state.idx = state.order.length - 1;
            }
        }
        render();
    });

    function setFilter(onlyChecked) {
        if (onlyChecked && state.checked.size === 0) {
            alert('체크된 카드가 없습니다. ★ 체크 버튼으로 카드를 표시하세요.');
            return;
        }
        if (state.filterChecked === onlyChecked) return;
        state.filterChecked = onlyChecked;
        state.idx = 0;
        rebuildOrder();
        if (state.order.length === 0) {
            state.filterChecked = false;
            rebuildOrder();
            alert('표시할 카드가 없어 전체 보기로 돌아갑니다.');
        }
        render();
    }
    els.btnFilterChecked.addEventListener('click', () => setFilter(true));
    els.btnFilterAll.addEventListener('click', () => setFilter(false));

    // ============ 자동 넘김 타이머 ============
    const TIMER_KEY = 'itpe.autoSec';
    function scheduleNextTick() {
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
        if (autoSec <= 0) return;
        autoTimer = setTimeout(() => {
            if (state.order.length === 0) { scheduleNextTick(); return; }
            const last = state.order.length - 1;
            state.idx = state.idx >= last ? 0 : state.idx + 1;
            render();
            scheduleNextTick();
        }, autoSec * 1000);
    }
    function stopAutoTimer() {
        if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    }
    function kickAutoTimer() {
        // 사용자 네비게이션 시 타이머 리셋해 새 카드에 N초 다시 보장
        if (autoSec > 0) scheduleNextTick();
    }
    function setAutoSec(sec) {
        autoSec = Math.max(0, sec | 0);
        try { localStorage.setItem(TIMER_KEY, String(autoSec)); } catch {}
        if (autoSec > 0) scheduleNextTick(); else stopAutoTimer();
        updateTimerUI();
    }
    function fmtSec(sec) {
        if (sec >= 60) return (sec % 60 === 0) ? `${sec/60}분` : `${(sec/60).toFixed(1)}분`;
        return `${sec}초`;
    }
    function updateTimerUI() {
        if (autoSec > 0) {
            els.btnTimer.classList.add('is-on');
            els.timerLabel.textContent = fmtSec(autoSec);
        } else {
            els.btnTimer.classList.remove('is-on');
            els.timerLabel.textContent = ''; // 끄짐 — 아이콘만
        }
        els.timerPop.querySelectorAll('.timer-opt').forEach((o) => {
            o.classList.toggle('is-on', parseInt(o.dataset.sec, 10) === autoSec);
        });
    }
    function showTimerPopover() {
        els.timerPop.hidden = false;
        const btnRect = els.btnTimer.getBoundingClientRect();
        const popRect = els.timerPop.getBoundingClientRect();
        let left = btnRect.left + (btnRect.width / 2) - (popRect.width / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
        els.timerPop.style.left = left + 'px';
        els.timerPop.style.bottom = (window.innerHeight - btnRect.top + 8) + 'px';
    }
    function hideTimerPopover() { els.timerPop.hidden = true; }
    function toggleTimerPopover() { if (els.timerPop.hidden) showTimerPopover(); else hideTimerPopover(); }

    els.btnTimer.addEventListener('click', (e) => { e.stopPropagation(); toggleTimerPopover(); });
    els.timerPop.addEventListener('click', (e) => {
        const opt = e.target.closest('.timer-opt');
        if (!opt) return;
        setAutoSec(parseInt(opt.dataset.sec, 10));
        hideTimerPopover();
    });
    document.addEventListener('click', (e) => {
        if (!els.timerPop.hidden && !els.timerPop.contains(e.target) && !els.btnTimer.contains(e.target)) {
            hideTimerPopover();
        }
    });
    // 페이지 가시성 변경 시 백그라운드에서 누적 안 되도록 정지/재개
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { stopAutoTimer(); if (synth) synth.cancel(); }
        else if (autoSec > 0) scheduleNextTick();
    });
    // 복원
    try {
        const saved = parseInt(localStorage.getItem(TIMER_KEY) || '0', 10);
        if (saved > 0) setAutoSec(saved); else updateTimerUI();
    } catch { updateTimerUI(); }

    // ============ TTS 음성 읽기 ============
    const TTS_KEY = 'itpe.ttsMode';
    const TTS_LABELS = { off: '소리', td: '토픽·정의', all: '전체' };

    // 한국어 자연 보이스 우선순위 선택
    function pickKoreanVoice() {
        if (!synth) return null;
        const voices = synth.getVoices();
        const ko = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('ko'));
        if (ko.length === 0) return null;
        // 1) 자연/뉴럴/온라인 보이스 → 일반적으로 품질 ↑
        const naturalRe = /(Natural|Neural|Online|Wavenet|Studio|HD)/i;
        let v = ko.find((x) => naturalRe.test(x.name));
        if (v) return v;
        // 2) 알려진 자연스러운 보이스 이름 우선
        const preferNames = ['Google', 'Microsoft', 'Heami', 'SunHi', 'InJoon', 'Yuna', '나래', '서연'];
        for (const name of preferNames) {
            v = ko.find((x) => x.name.includes(name));
            if (v) return v;
        }
        // 3) ko-KR 우선 (ko-XX 보다)
        v = ko.find((x) => x.lang.toLowerCase() === 'ko-kr');
        if (v) return v;
        return ko[0];
    }
    function refreshTtsVoice() { ttsVoice = pickKoreanVoice(); }

    // 발화용 텍스트 정제 — 자연스러운 운율을 위해 기호·줄바꿈·괄호 정돈
    function cleanForTts(text) {
        if (!text) return '';
        return String(text)
            .replace(/\[([^\]]+)\]/g, ', $1, ')     // [목적] → ', 목적, '
            .replace(/\(([^)]+)\)/g, ' $1 ')         // (괄호) → 괄호
            .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, ', ')      // 번호 마커 → 쉼표
            .replace(/[·•]/g, ', ')                  // 가운뎃점 → 쉼표
            .replace(/[/]/g, ' 또는 ')               // 슬래시 → '또는'
            .replace(/[\n\r]+/g, '. ')               // 줄바꿈 → 마침표
            .replace(/\.\s*\./g, '. ')               // 중복 마침표 정리
            .replace(/\s+/g, ' ')                    // 공백 정리
            .replace(/\s*,\s*/g, ', ')               // 쉼표 주변 공백
            .replace(/\s+\./g, '.')                  // 마침표 앞 공백
            .trim();
    }

    // 모바일 TTS 잠금 해제 — iOS Safari·Android Chrome·PWA 호환
    let ttsUnlocked = false;
    let pendingResumeTimer = null;
    let ttsErrorNoticeShown = false;

    // 환경 진단 — 화면 상단 짧은 토스트로 사용자에게 안내
    function ttsToast(msg, kind) {
        try {
            const id = 'tts-toast';
            let el = document.getElementById(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);' +
                    'background:#1c1c1ee8;color:#fff;padding:10px 16px;border-radius:10px;' +
                    'font-size:0.86rem;font-weight:700;z-index:200;max-width:90vw;text-align:center;' +
                    'box-shadow:0 6px 20px #000a;border:1px solid #ffffff22;backdrop-filter:blur(8px);';
                document.body.appendChild(el);
            }
            el.textContent = msg;
            el.style.background = kind === 'err' ? '#c0392bee' : (kind === 'ok' ? '#1e9f50ee' : '#1c1c1ee8');
            clearTimeout(el._t);
            el._t = setTimeout(() => { el && el.parentNode && el.parentNode.removeChild(el); }, 3500);
        } catch {}
    }

    function ttsUnlockOnce() {
        if (ttsUnlocked || !synth) return;
        try {
            // iOS 는 가끔 첫 utterance 가 무시됨 → 빈 utterance 2개를 큐에 넣어 안전 unlock
            const u1 = new SpeechSynthesisUtterance(' ');
            u1.lang = 'ko-KR'; u1.volume = 0; u1.rate = 1;
            synth.speak(u1);
            const u2 = new SpeechSynthesisUtterance(' ');
            u2.lang = 'ko-KR'; u2.volume = 0; u2.rate = 1;
            synth.speak(u2);
            ttsUnlocked = true;
        } catch {}
    }
    // 안드로이드 크롬은 ~15초 후 발화가 멈출 수 있어 주기적 resume + iOS WKWebView 안전망
    function keepAliveResume() {
        if (pendingResumeTimer) clearInterval(pendingResumeTimer);
        if (!synth) return;
        pendingResumeTimer = setInterval(() => {
            if (synth.speaking && !document.hidden) {
                try { synth.resume(); } catch {}
            }
        }, 10000);
    }
    // 환경 사전 점검 — 사용자가 "소리" 켤 때 호출
    function diagnoseTts() {
        if (!synth) {
            ttsToast('이 브라우저는 음성 합성을 지원하지 않습니다.', 'err');
            return false;
        }
        // iOS PWA standalone 모드 감지
        const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
            || window.navigator.standalone === true;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS && isStandalone) {
            ttsToast('홈 화면 PWA에선 iOS 제약으로 소리가 안 날 수 있어요. Safari 브라우저에서 직접 열어보세요.', 'err');
        }
        // 한국어 보이스 없으면 안내
        const voices = synth.getVoices();
        const hasKo = voices.some((v) => v.lang && v.lang.toLowerCase().startsWith('ko'));
        if (voices.length > 0 && !hasKo) {
            ttsToast('한국어 음성이 설치돼 있지 않아 영문 음성으로 읽을 수 있습니다.', 'err');
        }
        return true;
    }

    function tryTtsSpeak() {
        if (!synth || ttsMode === 'off') return;
        const ci = state.order[state.idx];
        if (ci === lastSpokenCardIdx) return;
        ttsSpeakCurrentCard();
    }
    function ttsSpeakCurrentCard() {
        if (!synth || ttsMode === 'off') return;
        const c = currentCard();
        if (!c) return;
        lastSpokenCardIdx = state.order[state.idx];

        const topic = cleanForTts(c.topic ?? c.q ?? '');
        const def   = cleanForTts(c.definition ?? c.a ?? '');
        const mn    = cleanForTts(c.mnemonic ?? '');
        const kw    = cleanForTts(c.keyword ?? '');
        const ex    = cleanForTts(c.extra ?? '');

        const parts = [];
        if (topic) parts.push('토픽. ' + topic + '.');
        if (def)   parts.push('정의. ' + def + '.');
        if (ttsMode === 'all') {
            if (mn) parts.push('내용. ' + mn + '.');
            if (kw) parts.push('키워드. ' + kw + '.');
            if (ex) parts.push('추가설명. ' + ex + '.');
        }
        const text = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (!text) return;

        // 보이스가 비동기로 늦게 로드되는 모바일 환경에서 voiceschanged 이후 재시도
        if (!ttsVoice) refreshTtsVoice();

        // 모바일 호환 — 단일 utterance, cancel 후 짧은 지연
        synth.cancel();
        const doSpeak = () => {
            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = 'ko-KR';
            utter.rate  = 0.96;
            utter.pitch = 1.0;
            utter.volume = 1.0;
            if (ttsVoice) utter.voice = ttsVoice;
            utter.onend  = () => { if (pendingResumeTimer) { clearInterval(pendingResumeTimer); pendingResumeTimer = null; } };
            utter.onerror = (e) => {
                // iOS Safari 흔한 에러: not-allowed (user gesture 부재), interrupted, audio-busy
                const err = e?.error || 'unknown';
                if (!ttsErrorNoticeShown) {
                    ttsErrorNoticeShown = true;
                    if (err === 'not-allowed' || err === 'audio-busy' || err === 'synthesis-failed') {
                        ttsToast('소리 재생이 차단됐어요. 화면을 한 번 더 탭하거나 시스템 음량/무음 스위치를 확인해주세요.', 'err');
                    }
                }
            };
            try { synth.speak(utter); } catch {}
            keepAliveResume();
        };
        setTimeout(doSpeak, 60);
    }
    function setTtsMode(mode) {
        if (!['off','td','all'].includes(mode)) mode = 'off';
        ttsMode = mode;
        try { localStorage.setItem(TTS_KEY, mode); } catch {}
        if (synth) synth.cancel();
        lastSpokenCardIdx = -1;
        ttsErrorNoticeShown = false;
        updateTtsUI();
        if (ttsMode !== 'off') {
            // 이 호출은 사용자 클릭 콜백 안 — 모바일 잠금 해제 적기
            diagnoseTts();
            ttsUnlockOnce();
            // iOS 는 unlock 후 짧은 지연 두면 안정적
            setTimeout(() => ttsSpeakCurrentCard(), 100);
        } else if (pendingResumeTimer) {
            clearInterval(pendingResumeTimer);
            pendingResumeTimer = null;
        }
    }
    function updateTtsUI() {
        const on = ttsMode !== 'off';
        els.btnTts.classList.toggle('is-on', on);
        // 꺼진 상태면 라벨 비움 (아이콘만), 켜진 상태만 짧은 라벨 표시
        els.ttsLabel.textContent = on ? (TTS_LABELS[ttsMode] || '') : '';
        els.ttsPop.querySelectorAll('.tts-opt').forEach((o) => {
            o.classList.toggle('is-on', o.dataset.tts === ttsMode);
        });
    }
    function showTtsPopover() {
        els.ttsPop.hidden = false;
        const btnRect = els.btnTts.getBoundingClientRect();
        const popRect = els.ttsPop.getBoundingClientRect();
        let left = btnRect.left + (btnRect.width / 2) - (popRect.width / 2);
        left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
        els.ttsPop.style.left = left + 'px';
        els.ttsPop.style.bottom = (window.innerHeight - btnRect.top + 8) + 'px';
    }
    function hideTtsPopover() { els.ttsPop.hidden = true; }
    function toggleTtsPopover() { if (els.ttsPop.hidden) showTtsPopover(); else hideTtsPopover(); }

    els.btnTts.addEventListener('click', (e) => { e.stopPropagation(); toggleTtsPopover(); });
    els.ttsPop.addEventListener('click', (e) => {
        const opt = e.target.closest('.tts-opt');
        if (!opt) return;
        setTtsMode(opt.dataset.tts);
        hideTtsPopover();
    });
    document.addEventListener('click', (e) => {
        if (!els.ttsPop.hidden && !els.ttsPop.contains(e.target) && !els.btnTts.contains(e.target)) {
            hideTtsPopover();
        }
    });
    // 보이스 로드는 비동기 — onvoiceschanged 시점에 자연 보이스 재선택
    if (synth) {
        refreshTtsVoice();
        synth.onvoiceschanged = () => { refreshTtsVoice(); };
    }
    // 복원 (저장값이 옛 'ke' 면 'all' 로 보정)
    try {
        let saved = localStorage.getItem(TTS_KEY) || 'off';
        if (!['off','td','all'].includes(saved)) saved = 'off';
        ttsMode = saved;
        updateTtsUI();
    } catch { updateTtsUI(); }


    // ============ 이미지 확대 (다중 지원) ============
    let overlayEndArmed = false; // 마지막 이미지 한 번 터치 후 "다시 터치 시 닫음" 대기
    function openImageOverlay(images, idx) {
        ovState.images = images.slice();
        ovState.idx = Math.max(0, Math.min(idx | 0, images.length - 1));
        overlayEndArmed = false;
        showOverlayImage();
        els.overlay.classList.add('is-open');
    }
    function showOverlayImage() {
        const total = ovState.images.length;
        if (!total) return closeOverlay();
        els.overlayImg.src = resolveImageSrc(ovState.images[ovState.idx]);
        if (total > 1) {
            els.overlayCounter.hidden = false;
            els.overlayCounter.textContent = `${ovState.idx + 1} / ${total}`;
        } else {
            els.overlayCounter.hidden = true;
        }
    }
    function closeOverlay() {
        els.overlay.classList.remove('is-open');
    }
    els.overlay.addEventListener('click', (e) => {
        if (e.target === els.overlayClose) { closeOverlay(); return; }
        const total = ovState.images.length;
        if (total === 0) { closeOverlay(); return; }
        // 마지막 이미지: 1번째 터치 — 안내 + 닫기 대기. 2번째 터치 — 닫음.
        if (ovState.idx >= total - 1) {
            if (overlayEndArmed) {
                closeOverlay();
                return;
            }
            overlayEndArmed = true;
            // 닫기 안내 토스트 + 카운터 시각 강조
            try { ttsToast('마지막 이미지 — 한 번 더 터치하면 닫힙니다', 'info'); } catch {}
            if (els.overlayCounter) els.overlayCounter.classList.add('end-armed');
            return;
        }
        ovState.idx += 1;
        overlayEndArmed = false;
        if (els.overlayCounter) els.overlayCounter.classList.remove('end-armed');
        showOverlayImage();
    });
    els.overlayClose.addEventListener('click', (e) => { e.stopPropagation(); closeOverlay(); });

    // ============ 키보드 / 스와이프 ============
    document.addEventListener('keydown', (e) => {
        // 모달이 열려 있으면 학습 단축키 차단 (입력 방해 방지)
        if (!addModal.hidden) {
            if (e.key === 'Escape') closeAddModal();
            return;
        }
        if (!findModal.hidden) {
            if (e.key === 'Escape') closeFindModal();
            return;
        }
        if (!moveModal.hidden) {
            if (e.key === 'Escape') closeMoveModal();
            return;
        }
        if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
        if (els.overlay.classList.contains('is-open')) {
            if (e.key === 'Escape') closeOverlay();
            else if (e.key === 'ArrowLeft' && ovState.images.length > 1) {
                ovState.idx = (ovState.idx - 1 + ovState.images.length) % ovState.images.length;
                showOverlayImage();
            }
            else if (e.key === 'ArrowRight' && ovState.images.length > 1) {
                ovState.idx = (ovState.idx + 1) % ovState.images.length;
                showOverlayImage();
            }
            return;
        }
        if (e.key === 'Escape') { closeOverlay(); els.hidePanel.classList.remove('is-open'); hideTimerPopover(); }
        else if (e.key === 'ArrowLeft')  { go(-1); kickAutoTimer(); }
        else if (e.key === 'ArrowRight') { go(+1); kickAutoTimer(); }
        else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(+1); kickAutoTimer(); }
    });

    let touchStartX = null;
    document.addEventListener('touchstart', (e) => {
        if (e.target.closest('.toolbar') || e.target.closest('.chip-row') || e.target.closest('.hide-panel')) return;
        touchStartX = e.touches[0].clientX;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
        if (touchStartX == null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 60) { if (dx < 0) go(+1); else go(-1); kickAutoTimer(); }
        touchStartX = null;
    });

    // ============ 학습 위치 영속화 (재로그인·복귀 시 자동 이동) ============
    const POS_KEY = 'itpe.lastPosition';
    function saveLastPosition() {
        if (!state.unit || !state.cards.length || !state.order.length) return;
        const c = currentCard();
        if (!c) return;
        try {
            localStorage.setItem(POS_KEY, JSON.stringify({
                unitId: state.unit.id,
                cardKey: cardKey(c),
                mode: state.mode || 'sequence',
                filterChecked: !!state.filterChecked,
                timestamp: Date.now(),
            }));
        } catch {}
    }
    function loadLastPosition() {
        try {
            const raw = localStorage.getItem(POS_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }
    function resumeCardIfPossible(saved) {
        if (!saved || !saved.cardKey) return;
        // state.cards 에서 cardKey 매칭되는 인덱스 찾기
        const ci = state.cards.findIndex((c) => cardKey(c) === saved.cardKey);
        if (ci < 0) return;
        const pos = state.order.indexOf(ci);
        if (pos >= 0) state.idx = pos;
    }

    // ============ 상태 영속화 ============
    // 체크는 '계정별'로 저장 — 같은 기기에서 계정이 달라도 섞이지 않고, 재로그인해도 유지.
    //   키: itpe.checked.<email>.<unitId>  (로그아웃은 세션만 지우므로 체크는 보존됨)
    function checkedAcct() {
        try {
            const s = window.ITPEAuth && window.ITPEAuth.getSession && window.ITPEAuth.getSession();
            return (s && s.email) ? s.email.toLowerCase().trim() : 'anon';
        } catch { return 'anon'; }
    }
    function checkedKey() { return 'itpe.checked.' + checkedAcct() + '.' + unitId; }
    function saveChecked() {
        try { localStorage.setItem(checkedKey(), JSON.stringify([...state.checked])); } catch {}
    }
    function loadChecked() {
        try {
            let raw = localStorage.getItem(checkedKey());
            // 레거시(계정 비구분) 키에서 1회 이관 — 기존 체크 보존
            if (raw == null) {
                const legacy = localStorage.getItem('itpe.checked.' + unitId);
                if (legacy != null) raw = legacy;
            }
            return new Set(raw ? JSON.parse(raw) : []);
        } catch { return new Set(); }
    }
    function saveHiddenState() {
        try { localStorage.setItem('itpe.hidden.' + unitId, JSON.stringify(state.hidden)); } catch {}
    }
    function restoreHiddenState() {
        try {
            const raw = localStorage.getItem('itpe.hidden.' + unitId);
            if (!raw) return;
            const obj = JSON.parse(raw);
            Object.assign(state.hidden, obj);
            els.hidePanel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
                cb.checked = !!state.hidden[cb.dataset.key];
            });
        } catch {}
    }

    // ============ 사용자 추가 카드 ============
    function loadUserCards() {
        try {
            const raw = localStorage.getItem('itpe.userCards.' + unitId);
            return raw ? (JSON.parse(raw) || []) : [];
        } catch { return []; }
    }
    function saveUserCards() {
        try {
            localStorage.setItem('itpe.userCards.' + unitId, JSON.stringify(state.userCards));
            return true;
        } catch (e) {
            console.error('[ITPE] 카드 저장 실패', e);
            const isQuota = e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || '');
            if (isQuota) {
                alert('저장 공간이 가득 찼습니다. 이미지를 줄이거나 기존 추가 카드를 정리해주세요.\n(localStorage 약 5MB 한도)');
            } else {
                alert('카드 저장에 실패했습니다: ' + (e.message || e));
            }
            return false;
        }
    }

    const addModal = document.getElementById('add-modal');
    const addInputs = ['add-cat', 'add-topic', 'add-def', 'add-mn', 'add-kw'].map((id) => document.getElementById(id));
    const [inCat, inTopic, inDef, inMn, inKw] = addInputs;
    const fileInput = document.getElementById('add-img-file');
    const imgGrid   = document.getElementById('add-img-grid');
    const imgInfo   = document.getElementById('add-img-info');
    const addImgState = { images: [], originalBytes: 0, compressedBytes: 0 }; // [dataURL]
    // 편집 모드 상태 — 신규 추가 시 null
    const editState = { mode: 'add', originalCard: null, originalKey: null };
    const addTitle = document.getElementById('add-title');

    function setModalMode(mode, card) {
        editState.mode = mode;
        editState.originalCard = card || null;
        editState.originalKey  = card ? cardKey(card) : null;
        if (mode === 'edit' && card) {
            addTitle.textContent = '카드 수정';
            inCat.value   = card.category ?? '';
            inTopic.value = card.topic ?? card.q ?? '';
            inDef.value   = card.definition ?? card.a ?? '';
            inMn.value    = card.mnemonic ?? '';
            inKw.value    = card.keyword ?? '';
            const imgs = getCardImages(card).map(resolveImageSrc);
            addImgState.images = imgs.slice();
            addImgState.originalBytes = 0;
            addImgState.compressedBytes = 0;
        } else {
            addTitle.textContent = '새 카드 추가';
            addInputs.forEach((el) => (el.value = ''));
            addImgState.images = [];
            addImgState.originalBytes = 0;
            addImgState.compressedBytes = 0;
        }
        renderAddImgPreview();
    }

    function openAddModal() {
        if (!state.unit) return;
        // 안전장치 — 관리자만 카드 추가 가능. UI 버튼은 이미 숨김 처리지만 만일을 대비.
        const isAdmin = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
        if (!isAdmin) {
            alert('카드 추가는 관리자만 사용할 수 있습니다.');
            return;
        }
        setModalMode('add', null);
        addModal.querySelectorAll('.form-row[data-key]').forEach((row) => {
            const k = row.dataset.key;
            row.classList.toggle('is-dim', !!state.hidden[k]);
        });
        // 서버 동기화 상태 표시
        updateSyncStatusHint();
        // ✨ AI 채우기 버튼 — 관리자 + 시크릿 시에만 노출
        updateAiFillVisibility();
        addModal.hidden = false;
        setTimeout(() => inTopic.focus(), 50);
    }
    function updateAiFillVisibility() {
        const row = document.getElementById('modal-ai-row');
        if (!row) return;
        const isAdmin = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
        row.hidden = !isAdmin;
    }
    // ✏ 정의만 재생성 버튼 — 토픽 기준 30자 이내 정의를 새로 받아 덮어씀
    (function bindAiDefOnlyBtn() {
        const btn = document.getElementById('modal-ai-def');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const topic = (inTopic.value || '').trim();
            if (!topic) {
                alert('토픽을 먼저 입력하세요.');
                inTopic.focus();
                return;
            }
            if (!window.ITPEAdmin || !window.ITPEAdmin.isAdminWithSecret()) {
                alert('관리자 로그인이 필요합니다.');
                return;
            }
            if (inDef.value.trim() && !confirm('현재 내용을 새 정의로 덮어씁니다.\n계속할까요?')) return;
            const original = btn.textContent;
            btn.disabled = true; btn.textContent = '⏳ 생성 중…';
            try {
                const r = await fetch('/api/ai-fill', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic, mode: 'def' }),
                });
                if (!r.ok) {
                    let detail = ''; try { detail = JSON.stringify(await r.json()); } catch {}
                    throw new Error('HTTP ' + r.status + ' ' + detail);
                }
                const data = await r.json();
                const it = (data.items || [])[0];
                if (!it || it.error) throw new Error(it?.error || '응답 비어있음');
                if (!it.definition) throw new Error('정의 누락');
                inDef.value = it.definition;
                inDef.focus();
                // 30자 초과 시 경고
                const overflow = it.definition.length > 30;
                ttsToast(
                    (overflow ? '⚠ ' : '✏ ') + '정의 (' + it.definition.length + '자)' + (overflow ? ' — 30자 초과' : ''),
                    overflow ? 'err' : 'ok'
                );
            } catch (e) {
                ttsToast('❌ 정의 생성 실패: ' + (e?.message || e), 'err');
            } finally {
                btn.disabled = false; btn.textContent = original;
            }
        });
    })();

    // AI 채우기 버튼 핸들러 — 토픽 입력 후 빈 칸만 자동 채움
    (function bindAiFillBtn() {
        const btn = document.getElementById('modal-ai-fill');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const topic = (inTopic.value || '').trim();
            if (!topic) {
                alert('토픽을 먼저 입력하세요.');
                inTopic.focus();
                return;
            }
            if (!window.ITPEAdmin || !window.ITPEAdmin.isAdminWithSecret()) {
                alert('관리자 로그인이 필요합니다.');
                return;
            }
            btn.disabled = true;
            const original = btn.textContent;
            btn.textContent = '⏳ 생성 중…';
            try {
                const r = await fetch('/api/ai-fill', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic }),
                });
                if (!r.ok) {
                    let detail = ''; try { detail = JSON.stringify(await r.json()); } catch {}
                    throw new Error('HTTP ' + r.status + ' ' + detail);
                }
                const data = await r.json();
                const it = (data.items || [])[0];
                if (!it || it.error) throw new Error(it?.error || '응답 비어있음');
                // 빈 칸만 채움 — 사용자 입력 보존
                if (!inCat.value.trim() && it.category) inCat.value = it.category;
                if (!inDef.value.trim() && it.definition) inDef.value = it.definition;
                if (!inMn.value.trim() && it.mnemonic) inMn.value = it.mnemonic;
                if (!inKw.value.trim() && it.keyword) inKw.value = it.keyword;
                // references 는 카드 객체에 저장 (모달엔 미입력 — 저장 시 합쳐짐)
                if (Array.isArray(it.references) && it.references.length) {
                    editState._aiReferences = it.references.slice();
                }
                ttsToast('✨ AI 채움 완료 (' + (it.confidence || 'medium') + ' 확신도)', 'ok');
            } catch (e) {
                ttsToast('❌ AI 실패: ' + (e?.message || e), 'err');
            } finally {
                btn.disabled = false;
                btn.textContent = original;
            }
        });
    })();
    function updateSyncStatusHint() {
        const el = document.getElementById('add-img-sync-status');
        if (!el) return;
        const isAdmin = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
        if (isAdmin) {
            el.textContent = '☁ 서버 저장 ON — 다른 PC·핸드폰에서도 보임';
            el.style.color = '#6cd07a';
        } else {
            el.textContent = '📱 이미지는 이 기기에만 저장됩니다 (관리자만 서버 공유 가능)';
            el.style.color = 'var(--text-dim)';
        }
    }
    function openEditModal() {
        if (!state.unit) return;
        // 안전장치 — 관리자만 카드 수정 가능.
        const isAdmin = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
        if (!isAdmin) {
            alert('카드 수정은 관리자만 사용할 수 있습니다.');
            return;
        }
        const c = currentCard();
        if (!c) return;
        setModalMode('edit', c);
        addModal.querySelectorAll('.form-row[data-key]').forEach((row) => {
            const k = row.dataset.key;
            row.classList.toggle('is-dim', !!state.hidden[k]);
        });
        updateSyncStatusHint();
        addModal.hidden = false;
        setTimeout(() => inTopic.focus(), 50);
    }
    function closeAddModal() {
        addModal.hidden = true;
        setModalMode('add', null);
    }

    function renderAddImgPreview() {
        while (imgGrid.firstChild) imgGrid.removeChild(imgGrid.firstChild);
        const n = addImgState.images.length;
        if (n === 0) {
            imgGrid.hidden = true;
            imgInfo.textContent = '선택된 이미지 없음';
            return;
        }
        imgGrid.hidden = false;
        const fmt = window.ImageStore?.fmtBytes || ((b) => Math.round(b/1024) + 'KB');
        const orig = addImgState.originalBytes;
        const comp = addImgState.compressedBytes;
        // 원격 URL = http(s) 로 시작 (R2 · 옛 Blob · 일반 https 이미지 호스트 등). dataURL 은 로컬로 간주.
        const remoteN = addImgState.images.filter((s) => /^https?:\/\//i.test(s)).length;
        const localN = n - remoteN;
        const statusTxt = remoteN > 0 && localN === 0
            ? `☁ 서버 ${remoteN}장 (다른 기기와 공유)`
            : remoteN === 0 && localN > 0
                ? `📱 로컬 ${localN}장 (이 기기에만 저장)`
                : `☁ 서버 ${remoteN}장 · 📱 로컬 ${localN}장`;
        if (orig > 0 && comp > 0 && comp < orig) {
            const saved = Math.round((1 - comp / orig) * 100);
            imgInfo.textContent = `${n}장 · ${fmt(comp)} · ${statusTxt} (압축 ${saved}%)`;
        } else {
            imgInfo.textContent = `${n}장 · ${fmt(comp || orig)} · ${statusTxt}`;
        }
        addImgState.images.forEach((src, idx) => {
            const item = document.createElement('div');
            item.className = 'add-img-item';
            const img = document.createElement('img');
            img.src = src;
            img.loading = 'lazy';
            img.decoding = 'async';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'add-img-remove';
            btn.textContent = '×';
            btn.setAttribute('aria-label', '제거');
            btn.addEventListener('click', () => {
                // 제거 시 통계도 정확히 재계산
                addImgState.images.splice(idx, 1);
                if (addImgState.images.length === 0) {
                    addImgState.originalBytes = 0;
                    addImgState.compressedBytes = 0;
                } else {
                    // 단순 보정 — 평균 단위로 차감
                    const avgComp = addImgState.compressedBytes / (addImgState.images.length + 1);
                    const avgOrig = addImgState.originalBytes / (addImgState.images.length + 1);
                    addImgState.compressedBytes -= Math.round(avgComp);
                    addImgState.originalBytes   -= Math.round(avgOrig);
                }
                renderAddImgPreview();
            });
            item.append(img, btn);
            imgGrid.appendChild(item);
        });
    }

    // 이미지 1장 첨부 — 파일·붙여넣기·드래그 공통 진입점
    async function attachImageBlob(blob, fallbackName) {
        if (!blob) throw new Error('blob 없음');
        if (!blob.size || blob.size === 0) {
            throw new Error('빈 이미지 (클립보드 데이터 없음, ' + blob.size + 'B) — 캡처 다시 시도');
        }
        const inferredType = (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/png';
        const f = blob instanceof File
            ? (blob.type ? blob : new File([blob], fallbackName || ('paste-' + Date.now() + '.png'), { type: inferredType }))
            : new File([blob], fallbackName || ('paste-' + Date.now() + '.png'), { type: inferredType });
        const r = await window.ImageStore.saveWithStats(f);
        // dataUrl 유효성 검증 — 콤마 뒤 32byte 미만이면 빈 결과로 간주
        const u = r && r.dataUrl;
        const okStartsData = typeof u === 'string' && u.startsWith('data:');
        const okUrl = typeof u === 'string' && /^https?:\/\//.test(u);
        let okPayload = false;
        if (okStartsData) {
            const i = u.indexOf(',');
            okPayload = i >= 0 && (u.length - i - 1) > 32;
        }
        if (!(okPayload || okUrl)) {
            console.warn('[ITPE] 이미지 인코딩 결과 비정상', { length: (u||'').length, preview: (u||'').slice(0,80), originalSize: blob.size });
            throw new Error('이미지 인코딩 실패 — 원본 ' + Math.round(blob.size/1024) + 'KB / 결과 ' + (u||'').length + 'B (빈 base64)');
        }
        addImgState.images.push(r.dataUrl);
        addImgState.originalBytes   += r.originalSize   || 0;
        addImgState.compressedBytes += r.compressedSize || 0;
        renderAddImgPreview();
        return true;
    }

    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
        let added = 0;
        for (const f of files) {
            try {
                if (await attachImageBlob(f, f.name)) added++;
            } catch (err) {
                ttsToast('❌ ' + f.name + ': ' + (err?.message || err), 'err');
            }
        }
        if (added > 0) ttsToast('🖼 이미지 ' + added + '장 첨부됨', 'ok');
        e.target.value = '';
    });

    // 📋 클립보드 다시 시도 버튼 — paste 이벤트 없이 직접 navigator.clipboard.read() 호출.
    // Snip 캡처가 placeholder 0byte 로 잡혔을 때 / paste 이벤트가 막혔을 때 / 확장이 가로챘을 때
    // 안전한 폴백 경로를 사용자 손에 쥐어주는 용도.
    const clipboardBtn = document.getElementById('add-img-clipboard');
    if (clipboardBtn) {
        clipboardBtn.addEventListener('click', async () => {
            if (!navigator.clipboard || !navigator.clipboard.read) {
                ttsToast('❌ 이 브라우저는 클립보드 API 미지원 — 다른 브라우저(Chrome/Edge)로 시도', 'err');
                return;
            }
            ttsToast('📋 클립보드 읽는 중…', 'info');
            try {
                const blobs = await readClipboardImagesWithRetry(4, 200);
                if (blobs.length === 0) {
                    ttsToast(
                        '❌ 클립보드에 이미지 없음 — Snip(Shift+Win+S) 캡처 후 "캡처됨" 알림이 사라지기 전에 다시 시도하거나, 캡처 후 편집기 열고 Ctrl+C 한 번 더',
                        'err'
                    );
                    return;
                }
                ttsToast('📋 ' + blobs.length + '장 발견 — 처리 중…', 'info');
                let added = 0;
                for (let i = 0; i < blobs.length; i++) {
                    try {
                        const ok = await attachImageBlob(blobs[i], 'clip-' + Date.now() + '-' + i + '.png');
                        if (ok) added++;
                    } catch (e) {
                        ttsToast('❌ ' + (e?.message || e), 'err');
                    }
                }
                if (added > 0) ttsToast('✅ 클립보드 ' + added + '/' + blobs.length + '장 첨부 완료', 'ok');
            } catch (e) {
                const msg = e?.message || String(e);
                // NotAllowedError — 포커스/권한 안내
                if (/NotAllowed|denied/i.test(msg)) {
                    ttsToast('🔒 클립보드 권한 거부됨 — 사이트 권한에서 "클립보드 읽기" 허용 필요. 또는 페이지를 클릭해 포커스 후 다시 시도.', 'err');
                } else {
                    ttsToast('❌ 클립보드 읽기 실패: ' + msg, 'err');
                }
            }
        });
    }

    // 클립보드 paste — 모달에서 Ctrl+V 시 스크린샷 즉시 첨부
    // capture phase + modal 직접 등록 → textarea/input 포커스 상태에서도 우선 처리
    function extractImagesSync(cd) {
        const blobs = [];
        if (!cd) return blobs;
        // 콘솔 진단 — 어떤 항목이 들어왔는지 모두 표시
        const itemSummary = [];
        if (cd.items && cd.items.length) {
            for (let i = 0; i < cd.items.length; i++) {
                const it = cd.items[i];
                itemSummary.push({ idx: i, kind: it.kind, type: it.type });
                if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
                    const b = it.getAsFile();
                    if (b) blobs.push(b);
                }
            }
        }
        if (blobs.length === 0 && cd.files && cd.files.length) {
            for (let i = 0; i < cd.files.length; i++) {
                const f = cd.files[i];
                itemSummary.push({ idx: 'file' + i, type: f.type, size: f.size });
                if (f.type && f.type.startsWith('image/')) blobs.push(f);
            }
        }
        const itemStr = itemSummary.map(s => '[' + s.idx + ':' + s.kind + '/' + s.type + (s.size != null ? '/' + s.size + 'B' : '') + ']').join(' ');
        const blobStr = blobs.map(b => 'type=' + (b.type || '?') + ' size=' + b.size + 'B').join(' | ');
        console.log('[ITPE paste] items: ' + itemStr + '  →  blobs: ' + blobStr);
        return blobs;
    }
    // navigator.clipboard.read() 로 이미지 회수 — 재시도 포함 (Snip 캡처 직후 placeholder 회피)
    async function readClipboardImagesWithRetry(maxTries = 4, delayMs = 180) {
        if (!navigator.clipboard || !navigator.clipboard.read) return [];
        const out = [];
        let lastErr = null;
        for (let attempt = 1; attempt <= maxTries; attempt++) {
            try {
                // 포커스 없으면 NotAllowedError — 모달이 떠있을 때 사용자 클릭이 보장. 보조로 focus 한 번
                try { window.focus(); } catch {}
                const items = await navigator.clipboard.read();
                let gotThisRound = 0;
                for (const item of items) {
                    for (const type of (item.types || [])) {
                        if (type && type.startsWith('image/')) {
                            try {
                                const b = await item.getType(type);
                                if (b && b.size > 0) { out.push(b); gotThisRound++; }
                            } catch (e) { lastErr = e; }
                        }
                    }
                }
                if (gotThisRound > 0) {
                    console.log(`[ITPE clipboard] retry ${attempt}: got ${gotThisRound} valid blob(s)`);
                    return out;
                }
                console.log(`[ITPE clipboard] retry ${attempt}: 0 valid, waiting ${delayMs}ms`);
            } catch (e) {
                lastErr = e;
                console.warn(`[ITPE clipboard] retry ${attempt} error:`, e?.message || e);
            }
            if (attempt < maxTries) await new Promise((r) => setTimeout(r, delayMs));
        }
        if (lastErr) console.warn('[ITPE clipboard] all retries failed, last error:', lastErr?.message || lastErr);
        return out;
    }

    async function processPastedBlobs(blobs) {
        // 0byte blob (Snip 캡처 직후 placeholder · 확장 간섭 등) 필터링 + 폴백 재시도
        let validBlobs = blobs.filter((b) => b && b.size > 0);

        if (validBlobs.length === 0 && blobs.length > 0) {
            ttsToast('⚠ 클립보드 이미지가 0byte — 재시도 (최대 0.7초)…', 'info');
            const recovered = await readClipboardImagesWithRetry();
            validBlobs = recovered;
        }

        if (validBlobs.length === 0) {
            ttsToast(
                '❌ 클립보드 비어있음 (0byte) — [📋 클립보드 다시 시도] 버튼을 눌러보세요. 그래도 안 되면 Snip 캡처 후 "캡처됨" 알림 클릭해서 편집기에서 Ctrl+C 다시 실행, 또는 클립보드 확장(Ditto, AnkiConnect 등) 비활성화 확인.',
                'err'
            );
            return;
        }

        ttsToast('📋 ' + validBlobs.length + '장 처리 중…', 'info');
        let added = 0;
        let lastError = '';
        for (let i = 0; i < validBlobs.length; i++) {
            const blob = validBlobs[i];
            const sizeKb = Math.round(blob.size / 1024);
            const fmt = blob.type || '(MIME 없음)';
            try {
                ttsToast('🔧 (' + (i + 1) + '/' + validBlobs.length + ') ' + fmt + ' · ' + sizeKb + 'KB 압축 중…', 'info');
                const ok = await attachImageBlob(blob, 'screenshot-' + Date.now() + '-' + added + '.png');
                if (ok) added++;
                else lastError = '압축/업로드 결과 무효';
            } catch (e) {
                lastError = e?.message || String(e);
            }
        }
        if (added > 0) {
            ttsToast('✅ 스크린샷 ' + added + '/' + validBlobs.length + '장 첨부 완료', 'ok');
        } else {
            ttsToast('❌ 첨부 실패: ' + (lastError || '원인 미상') + ' — F12 콘솔 확인', 'err');
        }
    }
    let pasteHandling = false;
    function onModalPaste(e) {
        // 모달이 열려 있을 때만 paste 인터셉트
        if (addModal.hidden) return;
        // 같은 이벤트 두 핸들러(addModal + window)에서 두 번 호출 방지
        if (pasteHandling) return;
        const blobs = extractImagesSync(e.clipboardData);
        if (blobs.length === 0) return; // 이미지 없으면 기본 텍스트 paste 그대로
        e.preventDefault();
        e.stopPropagation();
        pasteHandling = true;
        // 비동기 처리 후 플래그 해제
        Promise.resolve(processPastedBlobs(blobs)).finally(() => { pasteHandling = false; });
    }
    addModal.addEventListener('paste', onModalPaste, true);
    window.addEventListener('paste', onModalPaste, true);

    // 드래그&드롭 — 이미지 파일 끌어다 놓기 지원
    if (imgGrid && imgGrid.parentElement) {
        const dropZone = imgGrid.parentElement;
        ['dragover','dragenter'].forEach((evt) => dropZone.addEventListener(evt, (e) => { e.preventDefault(); }));
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
            let added = 0;
            for (const f of files) {
                try {
                    if (await attachImageBlob(f, f.name)) added++;
                } catch (err) {
                    ttsToast('❌ ' + f.name + ': ' + (err?.message || err), 'err');
                }
            }
            if (added > 0) ttsToast('📥 드래그 이미지 ' + added + '장 첨부됨', 'ok');
        });
    }

    // ============ 서버 동기화 (관리자) ============
    function packCardForServer(c) {
        if (!c) return null;
        const out = {};
        if (c.category)   out.category   = c.category;
        const topic = c.topic ?? c.q ?? '';
        if (topic) out.topic = topic;
        if (c.definition ?? c.a) out.definition = c.definition ?? c.a;
        if (c.mnemonic)   out.mnemonic   = c.mnemonic;
        if (c.keyword)    out.keyword    = c.keyword;
        if (c.extra)      out.extra      = c.extra;
        if (Array.isArray(c.images) && c.images.length) out.images = c.images.slice();
        else if (c.image) out.images = [c.image];
        if (Array.isArray(c.references) && c.references.length) {
            out.references = c.references
                .filter((r) => r && r.url)
                .map((r) => ({ title: r.title || r.url, url: r.url, ...(r.note ? { note: r.note } : {}) }));
            if (out.references.length === 0) delete out.references;
        }
        if (c.userId)    out.userId    = c.userId;
        if (c.createdAt) out.createdAt = c.createdAt;
        if (c.editedAt)  out.editedAt  = c.editedAt;
        if (c.source)         out.source        = c.source;
        if (c.aiGeneratedAt)  out.aiGeneratedAt = c.aiGeneratedAt;
        if (c.aiConfidence)   out.aiConfidence  = c.aiConfidence;
        return out;
    }
    async function pushToServerIfAdmin() {
        if (!window.ITPEAdmin || !window.ITPEAdmin.isAdminWithSecret || !window.ITPEAdmin.isAdminWithSecret()) {
            return false;
        }
        if (!state.unit) return false;
        try {
            const cards = state.cards.map(packCardForServer).filter(Boolean);
            await window.ITPEAdmin.saveCards(state.unit.id, cards);
            // 성공 시 localStorage 의 옛 흐름(userCards/cardEdits/removedJson) 자동 정리.
            // Blob 이 단일 소스가 되어 다음 로드 시 중복 노출 방지.
            try {
                localStorage.removeItem('itpe.userCards.' + state.unit.id);
                localStorage.removeItem('itpe.cardEdits.' + state.unit.id);
                localStorage.removeItem('itpe.removedJson.' + state.unit.id);
            } catch {}
            // 메모리 상태도 통합 — 모든 카드를 jsonCards 한 집합으로 (다음 GET 결과와 일치)
            state.jsonCards = state.cards.slice();
            state.userCards = [];
            return true;
        } catch (e) {
            alert('서버 저장 실패: ' + (e?.message || e) + '\n로컬엔 반영됐지만 다른 기기로 동기화되지 않았습니다.');
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 🤖 빈 정의 자동 생성 — 관리자 전용 백그라운드 서비스
    //   · 단원 안 카드 중 definition 이 빈 카드를 찾아 /api/ai-fill (mode=def) 로 1장씩 채움
    //   · 1.2초 간격 (Gemini rate-limit 회피 + 정중함)
    //   · 10장마다 자동 commit (GitHub) — 마지막은 무조건 commit
    //   · 페이지 떠나면 남은 변경 commit 후 중단
    //   · 다른 사용자가 동시 학습 중이어도 in-memory 상태와 충돌 없음 (관리자 본인 기기 기준)
    // ─────────────────────────────────────────────────────────────
    const autoDef = {
        running: false,
        total: 0,
        done: 0,
        failed: 0,
        pendingCommit: 0,    // 마지막 commit 후 채운 카드 수
        BATCH_COMMIT: 10,
        DELAY_MS: 1200,
    };

    function isAdminNow() {
        return !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
    }

    function countEmptyDefinitions() {
        let n = 0;
        for (const c of state.cards) {
            const def = (c && (c.definition ?? c.a)) || '';
            const topic = (c && (c.topic ?? c.q)) || '';
            if (topic.trim() && !def.trim()) n++;
        }
        return n;
    }

    function refreshAutoDefPanel() {
        const panel = document.getElementById('autodef-panel');
        if (!panel) return;
        if (!isAdminNow()) { panel.hidden = true; return; }

        const startBtn = document.getElementById('autodef-start');
        const stopBtn  = document.getElementById('autodef-stop');
        const countEl  = document.getElementById('autodef-count');
        const statusEl = document.getElementById('autodef-status');
        if (!startBtn || !stopBtn || !countEl || !statusEl) return;

        const empties = countEmptyDefinitions();
        if (autoDef.running) {
            countEl.textContent = autoDef.done + '/' + autoDef.total;
            startBtn.hidden = true;
            stopBtn.hidden = false;
            const remaining = autoDef.total - autoDef.done;
            statusEl.textContent = `생성 중… 완료 ${autoDef.done} · 남음 ${remaining}` +
                (autoDef.failed ? ` · 실패 ${autoDef.failed}` : '');
            statusEl.className = 'admin-status admin-status-info';
        } else {
            countEl.textContent = empties + '장';
            startBtn.hidden = false;
            stopBtn.hidden = true;
            startBtn.disabled = (empties === 0);
            if (empties === 0) {
                statusEl.textContent = '✓ 모든 카드에 정의가 있음';
                statusEl.className = 'admin-status admin-status-ok';
            } else {
                statusEl.textContent = `정의가 없는 카드 ${empties}장 — [시작] 누르면 백그라운드로 채웁니다.`;
                statusEl.className = 'admin-status';
            }
        }
    }

    async function autoDefCommit() {
        if (!isAdminNow() || !state.unit) return false;
        try {
            const cards = state.cards.map(packCardForServer).filter(Boolean);
            await window.ITPEAdmin.saveCards(state.unit.id, cards);
            // 메모리 상태 일치화 (다음 GET 과 동일)
            state.jsonCards = state.cards.slice();
            state.userCards = [];
            autoDef.pendingCommit = 0;
            return true;
        } catch (e) {
            console.warn('[autodef] commit failed (계속 진행)', e);
            return false;
        }
    }

    async function startAutoDef() {
        if (autoDef.running) return;
        if (!isAdminNow()) { alert('관리자만 사용 가능합니다.'); return; }
        if (!state.unit) return;

        // 대상 카드 인덱스 수집 (인덱스로 보관 — state.cards 가 재구성돼도 추적 가능하도록 ID 기반)
        const targets = [];
        state.cards.forEach((c, i) => {
            const def = (c && (c.definition ?? c.a)) || '';
            const topic = (c && (c.topic ?? c.q)) || '';
            if (topic.trim() && !def.trim()) targets.push({ idx: i, card: c, topic: topic.trim() });
        });
        if (targets.length === 0) return;

        autoDef.running = true;
        autoDef.total = targets.length;
        autoDef.done = 0;
        autoDef.failed = 0;
        autoDef.pendingCommit = 0;
        refreshAutoDefPanel();
        ttsToast('🤖 빈 정의 ' + targets.length + '장 자동 생성 시작', 'info');

        for (let i = 0; i < targets.length; i++) {
            if (!autoDef.running) break;
            const t = targets[i];
            // 카드가 여전히 존재하고 여전히 비어있는지 재확인 (다른 흐름이 채웠을 수 있음)
            if (!t.card || (t.card.definition && t.card.definition.trim())) continue;

            try {
                const r = await fetch('/api/ai-fill', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: t.topic, mode: 'def' }),
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const j = await r.json();
                const item = j.items && j.items[0];
                if (item && item.definition && !item.error) {
                    t.card.definition = String(item.definition).trim();
                    if (item.confidence) t.card.aiConfidence = item.confidence;
                    if (!t.card.source) t.card.source = 'ai';
                    t.card.aiGeneratedAt = new Date().toISOString();
                    autoDef.done++;
                    autoDef.pendingCommit++;

                    // 5장마다 가벼운 토스트 (스팸 방지)
                    if (autoDef.done % 5 === 0) {
                        ttsToast(`🤖 ${autoDef.done}/${autoDef.total} 생성됨`, 'info');
                    }

                    // 10장마다 commit
                    if (autoDef.pendingCommit >= autoDef.BATCH_COMMIT) {
                        await autoDefCommit();
                    }
                } else {
                    autoDef.failed++;
                }
            } catch (e) {
                autoDef.failed++;
                console.warn('[autodef] 카드 실패', t.topic, e?.message || e);
            }
            refreshAutoDefPanel();

            // 정중한 간격 (Gemini RPM 회피)
            await new Promise((res) => setTimeout(res, autoDef.DELAY_MS));
        }

        // 마무리 commit (남은 변경분)
        if (autoDef.pendingCommit > 0) await autoDefCommit();

        const wasRunning = autoDef.running;
        autoDef.running = false;

        // 화면 갱신 — 새 정의가 학습 화면에 즉시 보이도록
        try { rebuildOrder(); render(); } catch {}

        refreshAutoDefPanel();
        if (wasRunning) {
            ttsToast(`✅ 자동 생성 완료 — 성공 ${autoDef.done} · 실패 ${autoDef.failed}`, 'ok');
        } else {
            ttsToast(`⏸ 중지됨 — 완료 ${autoDef.done}/${autoDef.total}`, 'info');
        }
    }

    function stopAutoDef() {
        autoDef.running = false;
    }

    // 페이지 떠나기 직전 — 진행 중이면 commit 트라이 (best effort)
    window.addEventListener('beforeunload', () => {
        if (autoDef.running && autoDef.pendingCommit > 0) {
            // 동기 호출은 불가 — sendBeacon 미지원이므로 그냥 멈춤 (다음 진입 시 이어서)
            autoDef.running = false;
        }
    });

    // 패널 버튼 바인딩 (DOM 이 준비되면)
    function bindAutoDefButtons() {
        const start = document.getElementById('autodef-start');
        const stop  = document.getElementById('autodef-stop');
        if (start && !start._bound) { start.addEventListener('click', startAutoDef); start._bound = true; }
        if (stop  && !stop._bound)  { stop.addEventListener('click',  stopAutoDef);  stop._bound  = true; }
    }
    if (document.readyState !== 'loading') bindAutoDefButtons();
    else document.addEventListener('DOMContentLoaded', bindAutoDefButtons);

    // admin.js bootFlashAdmin 가 호출 — 카드 로드된 뒤 패널 상태 갱신
    window.ITPEFlash = Object.assign(window.ITPEFlash || {}, {
        refreshAutoDef: () => { bindAutoDefButtons(); refreshAutoDefPanel(); },
        // admin.js doUnitClear 가 호출 — 현재 단원이 비워졌으면 학습 화면을 즉시 빈 상태로.
        notifyUnitCleared: (clearedId) => {
            if (clearedId !== unitId) return;
            state.jsonCards = [];
            state.userCards = [];
            state.cards = [];
            state.order = [];
            state.idx = 0;
            try { state.checked.clear(); saveChecked(); } catch {}
            try { showModeSelect(); } catch {}
        },
    });

    // 토픽 중복 체크 — 자기 자신은 제외. 중복 시 기존 카드 정보 알려주고 false 반환.
    function checkTopicDuplicate(topic, originalCard) {
        const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const target = norm(topic);
        if (!target) return null;
        for (const c of state.cards) {
            // 편집 모드 — 자기 자신은 제외
            if (originalCard) {
                if (c === originalCard) continue;
                if (c.userId && c.userId === originalCard.userId) continue;
                if (!c.userId && !originalCard.userId
                    && norm(c.topic ?? c.q) === norm(originalCard.topic ?? originalCard.q)) continue;
            }
            if (norm(c.topic ?? c.q) === target) {
                return c;
            }
        }
        return null;
    }

    // 입력 검증 — 길이 제한 + 제어문자 차단 (XSS·SQLi·CRLF Injection 사전 차단)
    const FIELD_LIMITS = { category: 100, topic: 200, definition: 2000, mnemonic: 1000, keyword: 500, extra: 2000 };
    function sanitizeField(value, max) {
        if (typeof value !== 'string') return '';
        // NULL·제어문자(0-31, except \n\r\t) 제거
        const cleaned = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
        return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
    }
    function validateImageDataUrl(src) {
        if (typeof src !== 'string' || src.length === 0) return false;
        // 일반 https image URL (R2 · 커스텀 도메인 · 옛 Vercel Blob 등)
        if (/^https:\/\/[^\s]+\.(webp|jpe?g|png|gif|svg)(\?[^\s]*)?$/i.test(src)) return true;
        // 모든 data:image/... base64 (이 기기에만 저장)
        if (/^data:image\/[a-z+]+(;[a-z0-9-]+=[^;,]+)*;base64,/i.test(src)) return true;
        return false;
    }

    function saveNewCard() {
        const topic = sanitizeField(inTopic.value, FIELD_LIMITS.topic);
        if (!topic) { alert('토픽은 필수입니다.'); inTopic.focus(); return; }

        // 토픽 중복 검사 — 편집 모드면 자기 자신 제외
        const original = editState.mode === 'edit' ? editState.originalCard : null;
        const dup = checkTopicDuplicate(topic, original);
        if (dup) {
            const defPreview = String(dup.definition ?? dup.a ?? '').slice(0, 80);
            alert(
                '⚠ 같은 토픽 이름이 이미 존재합니다.\n\n' +
                '【기존 카드】\n' +
                '  토픽: ' + (dup.topic ?? dup.q ?? '') + '\n' +
                '  정의: ' + (defPreview || '(없음)') + '\n\n' +
                '다른 이름으로 등록하거나 기존 카드를 수정하세요.'
            );
            inTopic.focus();
            inTopic.select && inTopic.select();
            return;
        }

        const fields = {
            category:   sanitizeField(inCat.value, FIELD_LIMITS.category),
            topic,
            definition: sanitizeField(inDef.value, FIELD_LIMITS.definition),
            mnemonic:   sanitizeField(inMn.value,  FIELD_LIMITS.mnemonic),
            keyword:    sanitizeField(inKw.value,  FIELD_LIMITS.keyword),
        };
        // 이미지 dataURL MIME 화이트리스트 검증
        const validImgs = addImgState.images.filter(validateImageDataUrl);
        const imgs = validImgs.length ? validImgs.slice() : null;

        // ─── 편집 모드 ───
        if (editState.mode === 'edit' && editState.originalCard) {
            const orig = editState.originalCard;
            const updated = { ...orig, ...fields };
            if (imgs && imgs.length) updated.images = imgs;
            else { delete updated.images; delete updated.image; }
            updated.editedAt = new Date().toISOString();

            if (orig.userId) {
                // 사용자 카드 — 직접 수정
                const i = state.userCards.findIndex((c) => c.userId === orig.userId);
                if (i >= 0) {
                    state.userCards[i] = updated;
                    if (!saveUserCards()) return;
                }
            } else {
                // JSON 카드 — cardEdits 오버레이에 저장
                const editsMap = loadCardEdits(unitId);
                editsMap[editState.originalKey] = {
                    topic: fields.topic,
                    definition: fields.definition,
                    mnemonic: fields.mnemonic,
                    keyword: fields.keyword,
                    extra: fields.extra,
                    images: imgs || undefined,
                    editedAt: Date.now(),
                };
                saveCardEditsMap(unitId, editsMap);
            }

            // jsonCards 도 갱신해 화면 반영
            const ji = state.jsonCards.findIndex((c) => cardKey(c) === editState.originalKey);
            if (ji >= 0) {
                state.jsonCards[ji] = { ...state.jsonCards[ji], ...fields, images: imgs };
            }
            state.cards = buildCards();
            rebuildOrder();
            // 동일 카드 유지 — 토픽이 바뀌어 cardKey 변하면 위치를 다시 찾음
            const keepIdx = orig.userId
                ? state.cards.findIndex((c) => c.userId === orig.userId)
                : state.cards.findIndex((c) => cardKey(c) === editState.originalKey);
            const pos = keepIdx >= 0 ? state.order.indexOf(keepIdx) : 0;
            state.idx = pos >= 0 ? pos : 0;
            render();
            closeAddModal();
            ttsToast('✎ 카드 수정됨', 'ok');
            // 관리자면 서버에 자동 동기화 (다른 PC·핸드폰에도 즉시 반영)
            pushToServerIfAdmin();
            return;
        }

        // ─── 신규 추가 모드 ───
        // 현재 보고 있던 카드 → 새 카드를 이 카드 '바로 뒤'에 삽입하기 위한 앵커
        const anchorCard = (els.studyScreen && !els.studyScreen.hidden) ? currentCard() : null;
        const card = {
            ...fields,
            userId: 'u' + Date.now(),
            createdAt: new Date().toISOString(),
        };
        if (anchorCard) card.afterKey = cardKey(anchorCard);   // 현재 토픽 다음 위치에 추가
        if (imgs && imgs.length) card.images = imgs;
        // AI 채우기로 받은 참고자료 자동 부착 + AI 생성 표식
        if (Array.isArray(editState._aiReferences) && editState._aiReferences.length) {
            card.references = editState._aiReferences.slice();
            card.source = 'ai';
            card.aiGeneratedAt = new Date().toISOString();
            delete editState._aiReferences;
        }

        state.userCards.push(card);
        if (!saveUserCards()) {
            state.userCards.pop();
            return;
        }
        state.cards = buildCards();
        const newCardIdxInCards = state.cards.indexOf(card);   // 앵커 뒤에 삽입된 실제 위치
        state.checked.add(cardKey(card));
        saveChecked();
        rebuildOrder();
        state.idx = state.order.indexOf(newCardIdxInCards);
        if (state.idx < 0) state.idx = state.order.length - 1;
        if (els.studyScreen.hidden) showStudy();
        render();
        closeAddModal();
        ttsToast('➕ 카드 추가됨 — 총 ' + state.cards.length + '장', 'ok');
        // 관리자면 서버 동기화
        pushToServerIfAdmin();
    }

    // ============ 카드 이동 (다른 단원으로) ============
    const moveModal = document.getElementById('move-modal');
    const moveList  = document.getElementById('move-list');
    const moveCur   = document.getElementById('move-current');
    let allUnits = [];

    async function ensureUnitsLoaded() {
        if (allUnits.length) return;
        try {
            let data = null;
            try {
                const r = await fetch('/api/units?_t=' + Date.now(), { cache: 'no-store' });
                if (r.ok) data = await r.json();
            } catch {}
            if (!data) data = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
            allUnits = data.units || [];
        } catch (e) { console.error(e); }
    }

    function openMoveModal() {
        const c = currentCard();
        if (!c) return;
        ensureUnitsLoaded().then(() => {
            const topic = c.topic ?? c.q ?? '(제목 없음)';
            const kind = c.userId ? '사용자 카드' : 'JSON 카드';
            // textContent 기반 DOM 조립 — XSS 방지
            while (moveCur.firstChild) moveCur.removeChild(moveCur.firstChild);
            moveCur.appendChild(document.createTextNode('옮길 카드: '));
            const s1 = document.createElement('strong');
            s1.textContent = topic;
            moveCur.appendChild(s1);
            const k = document.createElement('span');
            k.className = 'move-kind';
            k.textContent = ' (' + kind + ')';
            moveCur.appendChild(k);
            moveCur.appendChild(document.createElement('br'));
            moveCur.appendChild(document.createTextNode('현재 단원: '));
            const s2 = document.createElement('strong');
            s2.textContent = state.unit?.name || unitId;
            moveCur.appendChild(s2);
            renderMoveList(c);
            moveModal.hidden = false;
        });
    }
    function closeMoveModal() { moveModal.hidden = true; }

    function renderMoveList(card) {
        while (moveList.firstChild) moveList.removeChild(moveList.firstChild);
        const frag = document.createDocumentFragment();
        allUnits.forEach((u, i) => {
            if (u.id === unitId) return; // 현재 단원 제외
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'find-item';
            btn.dataset.unitId = u.id;
            let userCount = 0;
            try {
                const raw = localStorage.getItem('itpe.userCards.' + u.id);
                userCount = raw ? (JSON.parse(raw) || []).length : 0;
            } catch {}

            const numEl = document.createElement('span');
            numEl.className = 'find-num';
            numEl.textContent = String(i + 1);

            const textEl = document.createElement('span');
            textEl.className = 'find-text';
            const topicEl = document.createElement('span');
            topicEl.className = 'find-topic';
            topicEl.textContent = u.name || '';
            const snipEl = document.createElement('span');
            snipEl.className = 'find-snippet';
            snipEl.textContent = (u.description || '') + ' · 사용자 ' + userCount + '장';
            textEl.append(topicEl, snipEl);

            const starEl = document.createElement('span');
            starEl.className = 'find-star off';
            starEl.textContent = '↪';

            btn.append(numEl, textEl, starEl);
            btn.addEventListener('click', () => confirmMove(card, u));
            frag.appendChild(btn);
        });
        moveList.appendChild(frag);
    }

    // 메인화면(시트 목록) 갯수 즉시 현행화용 힌트.
    // 이동/삭제 직후 서버(재배포 ~1분)·오버레이 정리 사이의 공백 동안
    // app.js refreshRealCounts 가 이 기대값을 우선 표시 → 서버가 따라잡으면 자동 폐기.
    function setCountHint(uid, count) {
        if (!uid || typeof count !== 'number' || count < 0) return;
        try {
            const raw = localStorage.getItem('itpe.countHints');
            const map = raw ? (JSON.parse(raw) || {}) : {};
            map[uid] = { count, ts: Date.now() };
            localStorage.setItem('itpe.countHints', JSON.stringify(map));
        } catch {}
    }

    function confirmMove(card, destUnit) {
        const topicTxt = card.topic ?? card.q ?? '';
        const hasSecret = !!(window.ITPEAdmin && window.ITPEAdmin.isAdminWithSecret && window.ITPEAdmin.isAdminWithSecret());
        const msg = hasSecret
            ? `'${topicTxt}' 카드를 '${destUnit.name}' 단원으로 옮깁니다.\n\n` +
              `· 현재 단원에서 영구 삭제됩니다\n· 대상 단원에 추가됩니다\n· 서버에 즉시 반영 (다른 기기 포함)\n\n계속하시겠습니까?`
            : `'${topicTxt}' 카드를 '${destUnit.name}' 단원으로 옮깁니다.\n\n⚠ 시크릿 미설정 — 이 기기에만 적용됩니다.\n계속하시겠습니까?`;
        if (!confirm(msg)) return;
        try {
            // 이동할 카드 객체 — 메타 보존, userId 새로 부여 (서로 다른 단원 간 충돌 방지)
            const moved = {
                category:   card.category ?? '',
                topic:      card.topic ?? card.q ?? '',
                definition: card.definition ?? card.a ?? '',
                mnemonic:   card.mnemonic ?? '',
                keyword:    card.keyword ?? '',
                extra:      card.extra ?? '',
                images:     (card.images && card.images.length) ? card.images.slice() : (card.image ? [card.image] : undefined),
                userId:     'u' + Date.now() + '-mv-' + Math.random().toString(36).slice(2, 6),
                createdAt:  card.createdAt || new Date().toISOString(),
                movedFromUnit: unitId,
            };
            if (!moved.images) delete moved.images;
            if (!moved.category) delete moved.category;

            // 1) 현재 단원에서 양쪽 컬렉션 모두 매칭하여 제거 (PUT cleanup 후에도 안전)
            const k = cardKey(card);
            const hasUserId = !!card.userId;
            const matches = (x) => {
                if (x === card) return true;
                if (hasUserId && x.userId === card.userId) return true;
                if (!hasUserId && cardKey(x) === k) return true;
                return false;
            };
            const beforeJ = state.jsonCards.length;
            const beforeU = state.userCards.length;
            state.jsonCards = state.jsonCards.filter((x) => !matches(x));
            state.userCards = state.userCards.filter((x) => !matches(x));
            const removed = (beforeJ - state.jsonCards.length) + (beforeU - state.userCards.length);
            if (removed === 0) {
                alert('현재 단원에서 카드를 찾지 못했습니다.');
                return;
            }

            // 시크릿 없으면 로컬 호환 처리 (사용자 카드면 saveUserCards, JSON 카드면 removedJson 오버레이)
            if (!hasSecret) {
                if (hasUserId) {
                    try { saveUserCards(); } catch {}
                } else {
                    const rmKey = 'itpe.removedJson.' + unitId;
                    let removedArr = [];
                    try { removedArr = JSON.parse(localStorage.getItem(rmKey) || '[]') || []; } catch {}
                    if (!removedArr.includes(k)) removedArr.push(k);
                    try { localStorage.setItem(rmKey, JSON.stringify(removedArr)); } catch {}
                }
                // 대상 단원 localStorage 에 추가
                const destKey = 'itpe.userCards.' + destUnit.id;
                const destRaw = localStorage.getItem(destKey);
                const destArr = destRaw ? (JSON.parse(destRaw) || []) : [];
                destArr.push(moved);
                try { localStorage.setItem(destKey, JSON.stringify(destArr)); } catch {}
            }

            state.checked.delete(k);
            saveChecked();
            state.cards = buildCards();

            const wasIdx = state.idx;
            rebuildOrder();

            // 출발 단원 갯수 현행화 힌트 (이동으로 1장 빠진 새 갯수)
            setCountHint(unitId, state.cards.length);

            const lastEmpty = state.order.length === 0;
            if (!lastEmpty) {
                state.idx = Math.min(wasIdx, state.order.length - 1);
                render();
            }
            closeMoveModal();

            // 시크릿 있으면 양쪽 단원 모두 Blob 동기화
            if (hasSecret) {
                ttsToast('☁ 이동 중 — 양쪽 단원 서버 동기화…', 'info');
                (async () => {
                    try {
                        // 현재 단원 → 카드 제거 상태로 PUT (pushToServerIfAdmin 이 자동 cleanup 까지 처리)
                        await pushToServerIfAdmin();
                        // 대상 단원 → 서버 현재 카드 + moved 한 장 추가하여 PUT
                        const destBase = await window.ITPEAdmin.fetchCards(destUnit.id);
                        const destCards = Array.isArray(destBase) ? destBase.slice() : [];
                        destCards.push(moved);
                        const destPacked = destCards.map(packCardForServer).filter(Boolean);
                        await window.ITPEAdmin.saveCards(destUnit.id, destPacked);
                        // 도착 단원 갯수 현행화 힌트 (서버 기준 새 갯수)
                        setCountHint(destUnit.id, destPacked.length);
                        ttsToast('✅ 이동 완료 — ' + destUnit.name + ' 으로 ' + topicTxt, 'ok');
                    } catch (e) {
                        ttsToast('❌ 이동 서버 저장 실패: ' + (e?.message || e), 'err');
                    }
                    if (lastEmpty) {
                        alert('이 단원에 남은 카드가 없습니다. 시트 목록으로 돌아갑니다.');
                        location.href = 'index.html';
                    }
                })();
            } else {
                ttsToast('📱 로컬 이동 완료 (서버 동기화 X)', 'ok');
                if (lastEmpty) {
                    alert('이 단원에 남은 카드가 없습니다. 시트 목록으로 돌아갑니다.');
                    location.href = 'index.html';
                }
            }
        } catch (e) {
            alert('이동 실패: ' + e.message);
        }
    }
    function loadRemovedJson(uid) {
        try {
            const raw = localStorage.getItem('itpe.removedJson.' + uid);
            return raw ? (JSON.parse(raw) || []) : [];
        } catch { return []; }
    }
    function loadCardEdits(uid) {
        try {
            const raw = localStorage.getItem('itpe.cardEdits.' + uid);
            return raw ? (JSON.parse(raw) || {}) : {};
        } catch { return {}; }
    }
    function saveCardEditsMap(uid, map) {
        localStorage.setItem('itpe.cardEdits.' + uid, JSON.stringify(map));
    }

    document.getElementById('chip-move').addEventListener('click', openMoveModal);
    document.getElementById('move-close').addEventListener('click', closeMoveModal);
    moveModal.addEventListener('click', (e) => { if (e.target === moveModal) closeMoveModal(); });

    // ============ 찾기 모달 ============
    const findModal = document.getElementById('find-modal');
    const findInput = document.getElementById('find-input');
    const findList  = document.getElementById('find-list');
    const findCount = document.getElementById('find-count');

    function getCardHay(c) {
        return [c.topic, c.q, c.definition, c.a, c.mnemonic, c.keyword, c.extra]
            .filter(Boolean).join(' \n ').toLowerCase();
    }
    // 검색 강조 — innerHTML 사용 없이 DOM 노드 배열로 반환 (XSS 무관)
    function highlightNodes(text, needle) {
        const out = document.createDocumentFragment();
        const src = String(text);
        if (!needle) { out.appendChild(document.createTextNode(src)); return out; }
        const safeNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(safeNeedle, 'gi');
        let last = 0;
        let m;
        while ((m = re.exec(src)) !== null) {
            if (m.index > last) out.appendChild(document.createTextNode(src.slice(last, m.index)));
            const mark = document.createElement('mark');
            mark.textContent = m[0];
            out.appendChild(mark);
            last = m.index + m[0].length;
            if (m[0].length === 0) re.lastIndex++; // 빈 매치 방어
        }
        if (last < src.length) out.appendChild(document.createTextNode(src.slice(last)));
        return out;
    }
    function snippetFor(c, needle) {
        const t = c.definition || c.a || c.mnemonic || c.extra || c.keyword || '';
        const flat = String(t).replace(/\s+/g, ' ').trim();
        if (!needle) return flat.slice(0, 80);
        const idx = flat.toLowerCase().indexOf(needle.toLowerCase());
        if (idx < 0) return flat.slice(0, 80);
        const start = Math.max(0, idx - 20);
        return (start > 0 ? '… ' : '') + flat.slice(start, start + 80);
    }
    function renderFindList() {
        const q = findInput.value.trim().toLowerCase();
        const currentCardIdx = state.order[state.idx];
        let matches = state.cards.map((c, i) => ({ c, i }));
        if (q) matches = matches.filter(({ c }) => getCardHay(c).includes(q));

        findCount.textContent = matches.length;
        while (findList.firstChild) findList.removeChild(findList.firstChild);
        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'find-empty';
            empty.textContent = '일치하는 카드가 없습니다.';
            findList.appendChild(empty);
            return;
        }
        const frag = document.createDocumentFragment();
        matches.forEach(({ c, i }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'find-item' + (i === currentCardIdx ? ' is-current' : '');
            btn.dataset.cardIdx = i;
            const topic = c.topic || c.q || '(제목 없음)';
            const isCk = isChecked(c);

            const numEl = document.createElement('span');
            numEl.className = 'find-num';
            numEl.textContent = String(i + 1);

            const textEl = document.createElement('span');
            textEl.className = 'find-text';
            const topicEl = document.createElement('span');
            topicEl.className = 'find-topic';
            topicEl.appendChild(highlightNodes(topic, q));
            const snipEl = document.createElement('span');
            snipEl.className = 'find-snippet';
            snipEl.appendChild(highlightNodes(snippetFor(c, q), q));
            textEl.append(topicEl, snipEl);

            const starEl = document.createElement('span');
            starEl.className = 'find-star' + (isCk ? '' : ' off');
            starEl.textContent = '★';

            btn.append(numEl, textEl, starEl);
            btn.addEventListener('click', () => jumpToCardIdx(i));
            frag.appendChild(btn);
        });
        findList.appendChild(frag);
    }
    function jumpToCardIdx(cardIdx) {
        // state.order 안에 있는지 확인 — 필터 모드면 빠져있을 수 있음
        let pos = state.order.indexOf(cardIdx);
        if (pos < 0) {
            state.filterChecked = false;
            rebuildOrder();
            pos = state.order.indexOf(cardIdx);
        }
        state.idx = pos >= 0 ? pos : 0;
        closeFindModal();
        render();
    }
    function openFindModal() {
        if (!state.cards.length) { alert('카드가 없습니다.'); return; }
        findInput.value = '';
        renderFindList();
        findModal.hidden = false;
        setTimeout(() => findInput.focus(), 50);
    }
    function closeFindModal() {
        findModal.hidden = true;
    }
    // 입력 중에는 목록 갱신하지 않고, Enter 누르면 검색어로 필터 적용
    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            renderFindList();
        }
    });
    document.getElementById('find-close').addEventListener('click', closeFindModal);
    findModal.addEventListener('click', (e) => { if (e.target === findModal) closeFindModal(); });

    // 추가·수정·삭제 칩 — 관리자에게만 노출. 일반 사용자는 읽기 전용.
    const isAdminUser = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
    const chipAdd  = document.getElementById('chip-add');
    const chipEdit = document.getElementById('chip-edit');
    const chipDel  = document.getElementById('chip-del');
    if (chipAdd) {
        if (isAdminUser) {
            chipAdd.hidden = false;
            chipAdd.addEventListener('click', openAddModal);
        } else {
            chipAdd.hidden = true;
        }
    }
    if (chipEdit && isAdminUser) {
        chipEdit.hidden = false;
        chipEdit.addEventListener('click', openEditModal);
    }
    if (chipDel && isAdminUser) {
        chipDel.hidden = false;
        chipDel.addEventListener('click', deleteCurrentCard);
    }

    // 현재 카드 삭제 (관리자 전용). 서버 카드면 PUT 으로 영구 반영, 사용자 카드면 로컬 제거.
    function deleteCurrentCard() {
        // 안전장치 — UI 칩은 관리자에게만 노출되지만 외부 호출 차단용.
        const isAdmin = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
        if (!isAdmin) {
            alert('카드 삭제는 관리자만 사용할 수 있습니다.');
            return;
        }
        const c = currentCard();
        if (!c) return;
        const topic = c.topic ?? c.q ?? '(제목 없음)';
        const hasSecret = !!(window.ITPEAdmin && window.ITPEAdmin.isAdminWithSecret && window.ITPEAdmin.isAdminWithSecret());
        const msg = hasSecret
            ? `🗑 카드 "${topic}" 를 삭제합니다.\n\n` +
              `· 서버에서 영구 삭제됩니다 (GitHub commit)\n` +
              `· 재배포 후 ~1분 내 다른 기기에 반영됩니다\n` +
              `· 되돌릴 수 없습니다\n\n계속하시겠습니까?`
            : `🗑 카드 "${topic}" 를 삭제합니다.\n\n` +
              `⚠ 시크릿 미설정 — 이 기기에서만 사라집니다.\n` +
              `· 서버에는 그대로 남고 다른 기기에서 다시 보입니다\n` +
              `· 서버 반영하려면: admin.html → 🔑 시크릿 입력 후 다시 시도\n\n계속하시겠습니까?`;
        if (!confirm(msg)) return;
        try {
            const k = cardKey(c);
            const hasUserId = !!c.userId;

            // 양쪽 컬렉션에서 안전하게 제거 — PUT cleanup 으로 모든 카드가 jsonCards 로 합쳐진 케이스도 대응.
            // 매칭 우선순위: 1) 같은 객체 참조  2) userId 일치  3) cardKey 일치
            const matches = (x) => {
                if (x === c) return true;
                if (hasUserId && x.userId === c.userId) return true;
                if (!hasUserId && cardKey(x) === k) return true;
                return false;
            };
            const beforeJ = state.jsonCards.length;
            const beforeU = state.userCards.length;
            state.jsonCards = state.jsonCards.filter((x) => !matches(x));
            state.userCards = state.userCards.filter((x) => !matches(x));
            const removedJ = beforeJ - state.jsonCards.length;
            const removedU = beforeU - state.userCards.length;

            if (removedJ === 0 && removedU === 0) {
                alert('삭제할 카드를 찾지 못했습니다 (key=' + k + ')');
                return;
            }

            // 옛 흐름 호환 — soft-delete 오버레이는 시크릿 없을 때만 의미. 시크릿 있으면 어차피 Blob PUT.
            if (!hasSecret && !hasUserId) {
                const rmKey = 'itpe.removedJson.' + unitId;
                let removed = [];
                try { removed = JSON.parse(localStorage.getItem(rmKey) || '[]') || []; } catch {}
                if (!removed.includes(k)) removed.push(k);
                try { localStorage.setItem(rmKey, JSON.stringify(removed)); } catch {}
            }
            // 로컬 userCards 변경 사항 저장 (시크릿 없거나, 옛 저장 호환)
            if (removedU > 0) {
                try { saveUserCards(); } catch {}
            }
            // 체크 상태 정리
            state.checked.delete(k);
            saveChecked();

            state.cards = buildCards();
            const wasIdx = state.idx;
            rebuildOrder();
            if (state.order.length === 0) {
                ttsToast('🗑 마지막 카드 삭제 — 시트 목록으로 이동', 'ok');
                // 서버에도 빈 단원으로 PUT (관리자+시크릿이면)
                if (hasSecret) {
                    pushToServerIfAdmin().finally(() => { location.href = 'index.html'; });
                } else {
                    location.href = 'index.html';
                }
                return;
            }
            state.idx = Math.min(wasIdx, state.order.length - 1);
            render();
            ttsToast('🗑 카드 삭제됨 — 남은 카드 ' + state.cards.length + '장', 'ok');
            // 관리자면 서버 동기화
            pushToServerIfAdmin();
        } catch (e) {
            alert('삭제 실패: ' + (e?.message || e));
        }
    }
    document.getElementById('add-close').addEventListener('click', closeAddModal);
    document.getElementById('add-cancel').addEventListener('click', closeAddModal);
    document.getElementById('add-save').addEventListener('click', saveNewCard);
    addModal.addEventListener('click', (e) => { if (e.target === addModal) closeAddModal(); });

    function showError(msg) {
        els.modeScreen.hidden = true;
        els.studyScreen.hidden = false;
        els.chipRow.hidden = true;
        els.secTopic.textContent = msg;
        ['def','mn','ex'].forEach((s) => document.getElementById('sec-' + s).textContent = '');
        els.progress.textContent = '[0/0]';
    }

    // ============ 폰트 크기 (공통) ============
    // 글자크기: 연속 step(--font-size-step) 인라인 설정. + 는 사실상 무제한(상한 30),
    // − 는 본문이 10px 에 닿는 지점에서 멈춤(하한 -6). 실제 10px 바닥은 CSS max(10px,…) 가 보장.
    function applyFz(fz) {
        document.body.dataset.fz = String(fz);
        document.body.style.setProperty('--font-size-step', String(fz));
    }
    function initFontSize() {
        const fz = parseInt(localStorage.getItem('itpe.fz') || '0', 10) || 0;
        applyFz(Math.max(-6, Math.min(30, fz)));
    }
    function syncToolbarHeight() {
        const tb = document.getElementById('toolbar');
        if (!tb) return;
        document.documentElement.style.setProperty('--toolbar-h', tb.offsetHeight + 'px');
    }
    function stepFontSize(delta) {
        let fz = (parseInt(localStorage.getItem('itpe.fz') || '0', 10) || 0) + delta;
        fz = Math.max(-6, Math.min(30, fz));   // + 무제한(상한 30) · − 는 10px 부근에서 멈춤
        applyFz(fz);
        localStorage.setItem('itpe.fz', String(fz));
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        });
    }
})();
