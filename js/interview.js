// 면접 모드 — 문항 출제 + 4단 구술 답변뷰 (interview.html 전용).
// 클래식 스크립트 IIFE (ESM 금지). flash.js 와 완전 격리 — 공유 전역 없음.
// 데이터: data/interview/index.json(매니페스트) + 카테고리별 *.json.
(function () {
    'use strict';

    // 4단 구술 답변 정의 — 레퍼런스(itpe-interview) 구조 채택.
    var PARTS = [
        { key: 'restate',   label: '복명복창', hint: '답변 시작 멘트', cls: 'iv-restate' },
        { key: 'structure', label: '구조화',   hint: '답변 목차',     cls: 'iv-structure' },
        { key: 'concept',   label: '개념',     hint: '핵심 개념 설명', cls: 'iv-concept' },
        { key: 'case',      label: '실사례',   hint: '실무 경험/사례', cls: 'iv-case' }
    ];

    var els = {
        modeScreen:  document.getElementById('iv-mode-screen'),
        modeList:    document.getElementById('iv-mode-list'),
        foot:        document.getElementById('iv-foot'),
        studyScreen: document.getElementById('iv-study-screen'),
        toolbar:     document.getElementById('iv-toolbar'),
        catTitle:    document.getElementById('iv-cat-title'),
        home:        document.getElementById('iv-home'),
        shuffle:     document.getElementById('iv-shuffle'),
        progressBar: document.getElementById('iv-progress-bar'),
        progressNum: document.getElementById('iv-progress-num'),
        badge:       document.getElementById('iv-badge'),
        question:    document.getElementById('iv-question'),
        reveal:      document.getElementById('iv-reveal'),
        hint:        document.getElementById('iv-hint'),
        answer:      document.getElementById('iv-answer'),
        prev:        document.getElementById('iv-prev'),
        next:        document.getElementById('iv-next')
    };

    var state = {
        manifest: null,
        byCat: {},        // { career: [...], expected: [...] }
        items: [],        // 현재 출제 중인 문항 배열
        order: [],        // 출제 순서 인덱스
        idx: 0,
        cat: null,        // 'career' | 'expected' | 'all'
        mode: 'sequence', // 'sequence' | 'shuffle'
        revealed: false
    };

    // ── 유틸 ─────────────────────────────────────────────
    function fetchJSON(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error(url + ' ' + r.status);
            return r.json();
        });
    }
    function shuffle(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }
    function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    // ── 초기화 ───────────────────────────────────────────
    fetchJSON('data/interview/index.json')
        .then(function (manifest) {
            state.manifest = manifest;
            var cats = Array.isArray(manifest.categories) ? manifest.categories : [];
            return Promise.all(cats.map(function (c) {
                return fetchJSON('data/interview/' + c.file).then(function (items) {
                    state.byCat[c.id] = Array.isArray(items) ? items : [];
                });
            }));
        })
        .then(function () {
            renderModeScreen();
            // 딥링크 복원 — ?cat=&mode=
            var url = new URL(location.href);
            var cat = url.searchParams.get('cat');
            var mode = url.searchParams.get('mode');
            if (cat && (cat === 'all' || state.byCat[cat])) {
                startStudy(cat, mode || null, false);
            } else {
                showModeScreen();
            }
        })
        .catch(function (err) {
            console.error('[interview] 데이터 로드 실패', err);
            if (els.foot) els.foot.textContent = '문항 데이터를 불러오지 못했습니다. data/interview/ 를 확인하세요.';
        });

    // ── 모드 선택 화면 ───────────────────────────────────
    function catItems(catId) {
        if (catId === 'all') {
            var all = [];
            Object.keys(state.byCat).forEach(function (k) { all = all.concat(state.byCat[k]); });
            return all;
        }
        return state.byCat[catId] || [];
    }

    function renderModeScreen() {
        clearEl(els.modeList);
        var cards = (state.manifest.categories || []).map(function (c) {
            return {
                cat: c.id, mode: c.mode || 'sequence', emoji: c.emoji || '📗',
                name: c.name, desc: c.description || '', count: (state.byCat[c.id] || []).length,
                accent: false
            };
        });
        // 합성 '전체' 카드
        cards.push({
            cat: 'all', mode: 'shuffle', emoji: '🔀', name: '전체',
            desc: '모든 문항을 무작위로 출제', count: catItems('all').length, accent: true
        });

        cards.forEach(function (c) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'iv-mode-card' + (c.accent ? ' is-accent' : '');
            btn.setAttribute('data-cat', c.cat);
            btn.setAttribute('data-mode', c.mode);

            var emoji = document.createElement('div');
            emoji.className = 'iv-mode-emoji';
            emoji.textContent = c.emoji;

            var name = document.createElement('div');
            name.className = 'iv-mode-name';
            name.textContent = c.name;

            var desc = document.createElement('div');
            desc.className = 'iv-mode-desc';
            desc.textContent = c.desc;

            var meta = document.createElement('div');
            meta.className = 'iv-mode-meta';
            meta.textContent = c.count + '문항 · ' + (c.mode === 'shuffle' ? '셔플' : '순서');

            btn.appendChild(emoji);
            btn.appendChild(name);
            btn.appendChild(desc);
            btn.appendChild(meta);
            btn.addEventListener('click', function () { startStudy(c.cat, c.mode, true); });
            els.modeList.appendChild(btn);
        });

        var total = catItems('all').length;
        if (els.foot) els.foot.textContent = '총 ' + total + '문항 · 오프라인 사용 가능';
    }

    function showModeScreen() {
        state.cat = null;
        els.studyScreen.hidden = true;
        els.toolbar.hidden = true;
        els.modeScreen.hidden = false;
        history.replaceState(null, '', location.pathname);
    }

    // ── 학습 화면 ───────────────────────────────────────
    function startStudy(cat, mode, pushUrl) {
        state.items = catItems(cat);
        if (!state.items.length) return;
        state.cat = cat;
        state.mode = (mode === 'shuffle' || mode === 'sequence') ? mode
            : (cat === 'all' ? 'shuffle' : 'sequence');
        buildOrder();
        state.idx = 0;
        state.revealed = false;

        var name = cat === 'all' ? '전체'
            : ((state.manifest.categories || []).filter(function (c) { return c.id === cat; })[0] || {}).name || cat;
        els.catTitle.textContent = name;

        els.modeScreen.hidden = true;
        els.studyScreen.hidden = false;
        els.toolbar.hidden = false;

        if (pushUrl !== false) {
            history.replaceState(null, '', location.pathname + '?cat=' + encodeURIComponent(cat) + '&mode=' + state.mode);
        }
        render();
    }

    function buildOrder() {
        state.order = state.items.map(function (_, i) { return i; });
        if (state.mode === 'shuffle') shuffle(state.order);
    }

    function currentItem() { return state.items[state.order[state.idx]]; }

    function render() {
        var item = currentItem();
        if (!item) return;
        var n = state.items.length;

        els.progressNum.textContent = (state.idx + 1) + ' / ' + n;
        els.progressBar.style.width = (n ? ((state.idx + 1) / n) * 100 : 0) + '%';
        els.badge.textContent = item.category || state.catTitle.textContent;
        els.question.textContent = item.question || '';

        state.revealed = false;
        els.answer.hidden = true;
        clearEl(els.answer);
        els.reveal.hidden = false;
        els.hint.hidden = false;

        els.prev.disabled = state.idx <= 0;
        els.next.disabled = state.idx >= n - 1;

        // 학습 영역 상단으로 스크롤
        try { els.studyScreen.scrollIntoView({ block: 'start' }); } catch (e) {}
    }

    function revealAnswer() {
        if (state.revealed) return;
        var item = currentItem();
        if (!item) return;
        state.revealed = true;
        els.reveal.hidden = true;
        els.hint.hidden = true;
        clearEl(els.answer);

        PARTS.forEach(function (p) {
            var text = (item[p.key] || '').toString().trim();
            if (!text) return;
            var part = document.createElement('div');
            part.className = 'iv-part ' + p.cls;

            var head = document.createElement('div');
            head.className = 'iv-part-head';
            var chip = document.createElement('span');
            chip.className = 'iv-chip';
            chip.textContent = p.label;
            var hint = document.createElement('span');
            hint.className = 'iv-hint-label';
            hint.textContent = p.hint;
            head.appendChild(chip);
            head.appendChild(hint);

            var body = document.createElement('div');
            body.className = 'iv-part-body';
            text.split(/\n{2,}/).forEach(function (para) {
                var pEl = document.createElement('p');
                pEl.textContent = para.trim();
                body.appendChild(pEl);
            });

            part.appendChild(head);
            part.appendChild(body);
            els.answer.appendChild(part);
        });

        // 참고 링크 (선택)
        var refs = Array.isArray(item.references) ? item.references.filter(Boolean) : [];
        if (refs.length) {
            var box = document.createElement('div');
            box.className = 'iv-refs';
            refs.forEach(function (r, i) {
                if (i) box.appendChild(document.createTextNode('  ·  '));
                if (/^https?:\/\//.test(r)) {
                    var a = document.createElement('a');
                    a.href = r; a.target = '_blank'; a.rel = 'noopener noreferrer';
                    a.textContent = r;
                    box.appendChild(a);
                } else {
                    box.appendChild(document.createTextNode(r));
                }
            });
            els.answer.appendChild(box);
        }

        els.answer.hidden = false;
    }

    function go(delta) {
        var n = state.items.length;
        var next = state.idx + delta;
        if (next < 0 || next >= n) return;
        state.idx = next;
        render();
    }

    function reshuffle() {
        if (state.mode === 'shuffle') buildOrder();  // 재셔플
        state.idx = 0;                                 // 순서 모드는 처음으로
        render();
    }

    // ── 이벤트 ───────────────────────────────────────────
    els.reveal.addEventListener('click', revealAnswer);
    els.prev.addEventListener('click', function () { go(-1); });
    els.next.addEventListener('click', function () { go(1); });
    els.home.addEventListener('click', function () { renderModeScreen(); showModeScreen(); });
    els.shuffle.addEventListener('click', reshuffle);
})();
