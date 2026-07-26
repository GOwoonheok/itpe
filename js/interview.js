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
        bookmark:    document.getElementById('iv-bookmark'),
        progressBar: document.getElementById('iv-progress-bar'),
        progressNum: document.getElementById('iv-progress-num'),
        badge:       document.getElementById('iv-badge'),
        question:    document.getElementById('iv-question'),
        reveal:      document.getElementById('iv-reveal'),
        hint:        document.getElementById('iv-hint'),
        answer:      document.getElementById('iv-answer'),
        prev:        document.getElementById('iv-prev'),
        next:        document.getElementById('iv-next'),
        introScreen: document.getElementById('iv-intro-screen'),
        introHome:   document.getElementById('iv-intro-home'),
        introList:   document.getElementById('iv-intro-list')
    };

    // ── localStorage (선택토픽 북마크 · 소개하기) ──────────
    var BM_KEY = 'iv:bookmarks';
    var INTRO_KEY = 'iv:intro';
    function lsGet(key, fallback) {
        try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
        catch (e) { return fallback; }
    }
    function lsSet(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    }
    function getBookmarks() {
        var a = lsGet(BM_KEY, []);
        return Array.isArray(a) ? a : [];
    }
    function isBookmarked(id) { return getBookmarks().indexOf(id) !== -1; }
    function toggleBookmarkId(id) {
        var a = getBookmarks();
        var i = a.indexOf(id);
        if (i === -1) a.push(id); else a.splice(i, 1);
        lsSet(BM_KEY, a);
        return i === -1; // true = 추가됨
    }

    // 소개하기 섹션 정의 + 초기 시드(사용자 편집 가능)
    var INTRO_SECTIONS = [
        { key: 'about', label: '자기소개', hint: '완전 암기 — 첫 답변 자동화',
          seed: '면접번호 ○번 고운혁입니다. 저는 25년간 공공 조달 IT 분야에서 발주자로 일해 온 정보관리기술사 수검자입니다. 차세대 나라장터 950억 사업의 발주 PM으로 사업자 이탈과 국가정보자원관리원 화재를 겪으며, 발주자의 기술판단 하나가 하도급 대금 7조원의 정상 지급을 좌우한다는 것을 체감했습니다. 현재는 공공AX 기획을 총괄하며 조달 업무에 생성형 AI를 도입하고 있습니다.' },
        { key: 'aspiration', label: '마지막 포부', hint: '30초 — 발주자·수주자 기술 갭을 메우는 중간다리',
          seed: '25년간 발주자와 수주자 사이의 기술 갭이 공공 SW 품질을 무너뜨리는 것을 현장에서 봐 왔습니다. 저는 그 간극을 메우는 기술사가 되겠습니다. 하나, AI 사업은 불확실성이 커서 기존 조달·평가 체계로 담기 어렵습니다. 제가 제안해 정부 과제로 추진 중인 발주지원 플랫폼처럼 RFP 자동작성과 규모산정, 평가 기준까지 AI 시대의 발주 표준을 만들겠습니다. 둘, 순환보직으로 어려움을 겪는 발주 담당 공무원을 위해 국가 정보화사업 발주 교육과정을 개설해, 배운 것을 나누는 기술사가 되겠습니다. 감사합니다.' },
        { key: 'ethics', label: '기술사 윤리강령 6항', hint: '두문자: 국·자·정·사·신·비',
          seed: '기술사 윤리강령 6항 — ①국가·사회 봉사 ②자기개발(계속교육) ③정직·공정 ④사명감 ⑤신의·성실 ⑥비밀유지. 두문자 「국·자·정·사·신·비」. 조달 종사자 핵심 덕목은 국가·사회 봉사와 비밀유지(입찰 공정성·사전정보 유출 방지).' },
        { key: 'numbers', label: '수치근거·두문자 암기', hint: '즉답용 숫자 카드',
          seed: '총경력 25년 10월 · 차세대나라장터 950억 · e-발주평가 90억 · 하도급 대금 7조원 정상지급 · 화상평가 전환 인쇄비 등 약 335억/년 절감 · 온라인 100% 전환.' }
    ];
    function getIntro() {
        var saved = lsGet(INTRO_KEY, null);
        var out = {};
        INTRO_SECTIONS.forEach(function (s) {
            out[s.key] = (saved && typeof saved[s.key] === 'string') ? saved[s.key] : s.seed;
        });
        return out;
    }

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
            if (url.searchParams.get('intro')) {
                showIntroScreen();
            } else if (cat === 'bookmarks' && getBookmarks().length) {
                startStudy('bookmarks', 'sequence', false);
            } else if (cat && (cat === 'all' || state.byCat[cat])) {
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
    function allItems() {
        var all = [];
        Object.keys(state.byCat).forEach(function (k) { all = all.concat(state.byCat[k]); });
        return all;
    }
    function catItems(catId) {
        if (catId === 'all') return allItems();
        if (catId === 'bookmarks') {
            var set = getBookmarks();
            return allItems().filter(function (it) { return set.indexOf(it.id) !== -1; });
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
        // 합성 '선택토픽' 카드 — ★ 북마크한 문항만
        cards.push({
            cat: 'bookmarks', mode: 'sequence', emoji: '⭐', name: '선택토픽',
            desc: '★ 표시한 핵심 문항만 다시 보기', count: getBookmarks().length, special: 'bookmarks'
        });
        // '소개하기' 카드 — 자기소개·포부·윤리강령 입력저장
        cards.push({
            cat: 'intro', mode: null, emoji: '🙋', name: '소개하기',
            desc: '자기소개·포부·윤리강령 작성·저장', count: null, special: 'intro'
        });

        cards.forEach(function (c) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'iv-mode-card' + (c.accent ? ' is-accent' : '');
            btn.setAttribute('data-cat', c.cat);
            if (c.mode) btn.setAttribute('data-mode', c.mode);

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
            if (c.count === null) meta.textContent = '작성 · 저장';
            else if (c.special === 'bookmarks') meta.textContent = c.count + '문항 · 내가 고른 카드';
            else meta.textContent = c.count + '문항 · ' + (c.mode === 'shuffle' ? '셔플' : '순서');

            btn.appendChild(emoji);
            btn.appendChild(name);
            btn.appendChild(desc);
            btn.appendChild(meta);
            btn.addEventListener('click', function () {
                if (c.special === 'intro') { showIntroScreen(); return; }
                if (c.special === 'bookmarks') {
                    if (getBookmarks().length === 0) {
                        if (els.foot) els.foot.textContent = '아직 선택한 문항이 없습니다 — 학습 중 ☆ 를 눌러 담아 보세요.';
                        return;
                    }
                    startStudy('bookmarks', 'sequence', true); return;
                }
                startStudy(c.cat, c.mode, true);
            });
            els.modeList.appendChild(btn);
        });

        var total = catItems('all').length;
        if (els.foot) els.foot.textContent = '총 ' + total + '문항 · 오프라인 사용 가능';
    }

    function showModeScreen() {
        state.cat = null;
        els.studyScreen.hidden = true;
        els.introScreen.hidden = true;
        els.toolbar.hidden = true;
        els.modeScreen.hidden = false;
        renderModeScreen(); // 북마크 수 갱신
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
            : cat === 'bookmarks' ? '⭐ 선택토픽'
            : ((state.manifest.categories || []).filter(function (c) { return c.id === cat; })[0] || {}).name || cat;
        els.catTitle.textContent = name;

        els.modeScreen.hidden = true;
        els.introScreen.hidden = true;
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
        syncBookmarkBtn(item);

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

        // 키워드 칩 (답변 흐름 순) — 회독 앵커
        var kws = Array.isArray(item.keywords) ? item.keywords.filter(Boolean) : [];
        if (kws.length) {
            var kwBox = document.createElement('div');
            kwBox.className = 'iv-keywords';
            kws.forEach(function (k) {
                var chip = document.createElement('span');
                chip.className = 'iv-kw';
                chip.textContent = k;
                kwBox.appendChild(chip);
            });
            els.answer.appendChild(kwBox);
        }

        // 접이식 "면접관 압박 대응" — 꼬리질문 + 함정 (기본 접힘)
        var guards = Array.isArray(item.followupGuard) ? item.followupGuard.filter(Boolean) : [];
        var pit = (item.pitfall || '').toString().trim();
        if (guards.length || pit) {
            var det = document.createElement('details');
            det.className = 'iv-followup';
            var sum = document.createElement('summary');
            sum.textContent = '면접관 압박 대응';
            det.appendChild(sum);
            if (guards.length) {
                var ul = document.createElement('ul');
                ul.className = 'iv-guard-list';
                guards.forEach(function (g) {
                    var li = document.createElement('li');
                    li.textContent = g;
                    ul.appendChild(li);
                });
                det.appendChild(ul);
            }
            if (pit) {
                var pel = document.createElement('p');
                pel.className = 'iv-pitfall';
                pel.textContent = '⚠ ' + pit;
                det.appendChild(pel);
            }
            els.answer.appendChild(det);
        }

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

    // ── 선택토픽(★ 북마크) ───────────────────────────────
    function syncBookmarkBtn(item) {
        if (!els.bookmark) return;
        var on = item && isBookmarked(item.id);
        els.bookmark.textContent = on ? '★' : '☆';
        els.bookmark.classList.toggle('is-on', !!on);
        els.bookmark.setAttribute('aria-pressed', on ? 'true' : 'false');
        els.bookmark.setAttribute('title', on ? '선택토픽에서 빼기' : '선택토픽에 넣기');
    }
    function onToggleBookmark() {
        var item = currentItem();
        if (!item) return;
        toggleBookmarkId(item.id);
        syncBookmarkBtn(item);
    }

    // ── 소개하기 ─────────────────────────────────────────
    function renderIntro() {
        clearEl(els.introList);
        var data = getIntro();
        INTRO_SECTIONS.forEach(function (s) {
            var card = document.createElement('div');
            card.className = 'iv-intro-card';

            var head = document.createElement('div');
            head.className = 'iv-intro-head';
            var lab = document.createElement('span');
            lab.className = 'iv-intro-label';
            lab.textContent = s.label;
            var hint = document.createElement('span');
            hint.className = 'iv-intro-hint';
            hint.textContent = s.hint;
            head.appendChild(lab);
            head.appendChild(hint);

            var ta = document.createElement('textarea');
            ta.className = 'iv-intro-ta';
            ta.value = data[s.key] || '';
            ta.setAttribute('rows', '5');
            ta.setAttribute('data-key', s.key);
            ta.addEventListener('input', function () {
                var cur = getIntro();
                cur[s.key] = ta.value;
                lsSet(INTRO_KEY, cur);
            });

            card.appendChild(head);
            card.appendChild(ta);
            els.introList.appendChild(card);
        });
    }
    function showIntroScreen() {
        renderIntro();
        els.modeScreen.hidden = true;
        els.studyScreen.hidden = true;
        els.toolbar.hidden = true;
        els.introScreen.hidden = false;
        history.replaceState(null, '', location.pathname + '?intro=1');
    }

    // ── 이벤트 ───────────────────────────────────────────
    els.reveal.addEventListener('click', revealAnswer);
    els.prev.addEventListener('click', function () { go(-1); });
    els.next.addEventListener('click', function () { go(1); });
    els.home.addEventListener('click', function () { showModeScreen(); });
    els.shuffle.addEventListener('click', reshuffle);
    if (els.bookmark) els.bookmark.addEventListener('click', onToggleBookmark);
    if (els.introHome) els.introHome.addEventListener('click', function () { showModeScreen(); });
})();
