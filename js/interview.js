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
        print:       document.getElementById('iv-print'),
        progressBar: document.getElementById('iv-progress-bar'),
        progressNum: document.getElementById('iv-progress-num'),
        badge:       document.getElementById('iv-badge'),
        question:    document.getElementById('iv-question'),
        reveal:      document.getElementById('iv-reveal'),
        hint:        document.getElementById('iv-hint'),
        answer:      document.getElementById('iv-answer'),
        prev:        document.getElementById('iv-prev'),
        next:        document.getElementById('iv-next'),
        ttsBar:      document.getElementById('iv-tts'),
        ttsQ:        document.getElementById('iv-tts-q'),
        ttsA:        document.getElementById('iv-tts-a'),
        ttsRate:     document.getElementById('iv-tts-rate'),
        introScreen: document.getElementById('iv-intro-screen'),
        introHome:   document.getElementById('iv-intro-home'),
        introEdit:   document.getElementById('iv-intro-edit'),
        introCard:   document.getElementById('iv-intro-card'),
        introBar:    document.getElementById('iv-intro-bar'),
        introNum:    document.getElementById('iv-intro-num'),
        introToolbar: document.getElementById('iv-intro-toolbar'),
        introPrev:   document.getElementById('iv-intro-prev'),
        introNext:   document.getElementById('iv-intro-next'),
        introSpeak:  document.getElementById('iv-intro-speak')
    };

    // ── 음성 낭독(TTS) — js/tts.js 래퍼 위의 화면 연동 ────
    var tts = window.ITPETts || null;
    var ttsSource = null;   // 'q' | 'a' | 'intro' — 지금 읽고 있는 대상(버튼 라벨 동기화용)

    function ttsAvailable() { return !!(tts && tts.supported()); }
    function ttsStop() {
        if (tts) tts.stop();
        ttsSource = null;
        syncTts();
    }
    // 같은 대상을 다시 누르면 정지(토글). 다른 대상이면 그쪽으로 갈아탄다.
    function ttsPlay(src, text) {
        if (!ttsAvailable()) return;
        if (ttsSource === src && tts.isSpeaking()) { ttsStop(); return; }
        tts.stop();
        ttsSource = src;
        if (!tts.speak(text)) ttsSource = null;
        syncTts();
    }
    function syncTts() {
        var on = ttsAvailable() && tts.isSpeaking();
        if (els.ttsQ) els.ttsQ.textContent = (on && ttsSource === 'q') ? '■ 정지' : '🔊 질문';
        if (els.ttsA) els.ttsA.textContent = (on && ttsSource === 'a') ? '■ 정지' : '🔊 답변';
        if (els.introSpeak) els.introSpeak.textContent = (on && ttsSource === 'intro') ? '■ 정지' : '▶ 듣기';
    }
    function buildRateSelect() {
        var sel = document.createElement('select');
        [['0.8', '0.8x'], ['1', '1.0x'], ['1.2', '1.2x'], ['1.5', '1.5x']].forEach(function (o) {
            var op = document.createElement('option');
            op.value = o[0];
            op.textContent = o[1];
            if (tts && parseFloat(o[0]) === tts.getRate()) op.selected = true;
            sel.appendChild(op);
        });
        sel.addEventListener('change', function () { if (tts) tts.setRate(sel.value); });
        return sel;
    }
    if (tts) {
        tts.onChange(function (activeNow) {
            if (!activeNow) ttsSource = null;
            syncTts();
        });
    }

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
        { key: 'about', label: '자기소개', hint: '1분 — 초기·중기·현재 3단 + 정량성과',
          seed: '안녕하십니까. 경력 중심으로 소개드리겠습니다.\n\n저는 25년 2개월간 공공정보화의 기획과 예산, 조달 발주체계를 담당해 온 발주자입니다.\n\n초기 7년은 전자정부지원사업입니다. BPR·ISP 로드맵과 대가산정, 감리·PMO로 사업 품질을 잡았습니다.\n\n중기 6년은 90억 규모 e-발주평가시스템입니다. 대면평가가 막히자 온라인 제출과 화상평가를 도입했습니다. DRM과 안면인식으로 보안과 본인확인을 자동화했습니다. 온라인 100% 전환과 연간 약 350억을 절감했습니다. 국정자원 화재 때는 하도급지킴이 DR로 추석 하도급 대금 약 7조 원을 차질 없이 집행했습니다.\n\n현재는 조달AX 기본계획을 세우고 있습니다. RAG와 sLLM에 사람 검토를 결합한 규정 질의응답을 설계했고, 정부 30대 핵심과제로 추진 중입니다.\n\n정부조달의 벽 앞에서 돌아서는 IT 기업의 어려움을 정책과 기술로 풀어내는 기술사가 되겠습니다. 감사합니다.' },
        { key: 'aspiration', label: '마지막 포부', hint: '40초 — 국가적·사회적 2축, 강하고 자신감 있게',
          seed: '마지막으로 포부를 말씀드리겠습니다. 국가적으로 하나, 사회적으로 하나입니다.\n\n첫째, 국가적으로는 AI 시대의 발주 표준을 세우겠습니다. 지금 기준은 코드 기준이라 데이터와 모델 성능을 담지 못합니다. 제가 규모산정과 평가 기준을 다시 만들겠습니다.\n\n둘째, 사회적으로는 현장의 갈등을 푸는 기술사가 되겠습니다. 수요기관은 더 넣자 하고 업체는 못 한다 합니다. 과업변경이 생기면 감이 아니라 기준으로 판단하겠습니다. 절차는 과업심의로, 근거는 요구사항 추적으로 남기겠습니다.\n\n정책과 기술, 두 언어를 다 하는 기술사가 되겠습니다. 감사합니다.' },
        { key: 'ethics', label: '기술사 윤리강령 6항', hint: '두문자: 국·자·정·사·신·비',
          seed: '기술사 윤리강령 6항 — ①국가·사회 봉사 ②자기개발(계속교육) ③정직·공정 ④사명감 ⑤신의·성실 ⑥비밀유지. 두문자 「국·자·정·사·신·비」. 조달 종사자 핵심 덕목은 국가·사회 봉사와 비밀유지(입찰 공정성·사전정보 유출 방지).\n\n기술사법 제3조 직무(윤리강령과 별개 암기) — 계획·연구·설계·분석·시험·운영·평가 + 지도·감리·기술판단·기술중재·기술자문.' },
        { key: 'numbers', label: '수치근거·두문자 암기', hint: '즉답용 숫자 카드',
          seed: '총경력 25년 2월 — 조달정보화AX 2년5개월 / AI발주지원 3년6개월 / e-발주평가 6년8개월 / 전자정부지원 7년1개월 / 행정정보공유 5년6개월.\n\ne-발주평가 사업비 90억 · 온라인 100% 전환 · 절감 연간 약 350억(인쇄·제본비 + 출장비 + 평가 운영비를 연간 입찰 건수로 합산한 추정치) · 하도급 대금 약 7조원 집행 · RFP 작성 평균 10일 단축 · 정부 30대 핵심과제.\n\n자격 — 정보처리기사 2006-06-05 / PMP 2008-09-23.' }
    ];
    function getIntro() {
        var saved = lsGet(INTRO_KEY, null);
        var out = {};
        INTRO_SECTIONS.forEach(function (s) {
            var v = (saved && typeof saved[s.key] === 'string') ? saved[s.key] : null;
            // 저장값이 비어 있으면 기본 원고로 되돌린다 — 내용을 비우면 최신 기본값을 다시 볼 수 있다.
            out[s.key] = (v && v.trim()) ? v : s.seed;
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
        // '인쇄하기' 카드 — A4 답변집·요약본 출력 (독립 페이지, 새 탭)
        cards.push({
            cat: 'print', mode: null, emoji: '🖨', name: '인쇄하기',
            desc: '답변집·회독 요약본을 A4로 뽑아 보기', count: null,
            meta: '상세 · 요약 선택', special: 'print'
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
            if (c.meta) meta.textContent = c.meta;
            else if (c.count === null) meta.textContent = '작성 · 저장';
            else if (c.special === 'bookmarks') meta.textContent = c.count + '문항 · 내가 고른 카드';
            else meta.textContent = c.count + '문항 · ' + (c.mode === 'shuffle' ? '셔플' : '순서');

            btn.appendChild(emoji);
            btn.appendChild(name);
            btn.appendChild(desc);
            btn.appendChild(meta);
            btn.addEventListener('click', function () {
                if (c.special === 'print') { openPrint('all'); return; }
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
        ttsStop();
        state.cat = null;
        els.studyScreen.hidden = true;
        els.introScreen.hidden = true;
        els.toolbar.hidden = true;
        els.introToolbar.hidden = true;
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
        els.introToolbar.hidden = true;
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

        // 카드가 바뀌면 읽던 음성은 멈춘다. 답변 낭독은 정답 공개 후에만.
        ttsStop();
        if (els.ttsBar) els.ttsBar.hidden = !ttsAvailable();
        if (els.ttsA) els.ttsA.disabled = true;

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
        if (els.ttsA) els.ttsA.disabled = false;
    }

    // 답변 낭독 — 4단을 순서대로 이어 읽는다(키워드·압박대응은 제외).
    function answerText(item) {
        return PARTS.map(function (p) { return (item[p.key] || '').toString().trim(); })
            .filter(Boolean);
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

    // ── 인쇄 (독립 페이지 interview-print.html · 새 탭) ──
    // 범위만 넘기고 형식(상세/요약)·압박대응 포함 여부는 인쇄 페이지 도구막대에서 고른다.
    function openPrint(cat) {
        var c = cat || state.cat || 'all';
        if (c === 'bookmarks' && getBookmarks().length === 0) c = 'all';
        window.open('interview-print.html?cat=' + encodeURIComponent(c) + '&density=full',
            '_blank', 'noopener');
    }

    // ── 소개하기 — 카드 1장씩 넘기며 낭독, ✏ 로 그 자리에서 수정 ──
    var introIdx = 0;
    var introEdit = false;   // ✏ 상태는 카드를 넘겨도 유지(연속 수정 편의)

    function renderIntroCard() {
        var s = INTRO_SECTIONS[introIdx];
        if (!s) return;
        var data = getIntro();
        clearEl(els.introCard);

        var badge = document.createElement('span');
        badge.className = 'iv-badge';
        badge.textContent = s.label;
        els.introCard.appendChild(badge);

        var hint = document.createElement('p');
        hint.className = 'iv-intro-hint';
        hint.textContent = s.hint;
        els.introCard.appendChild(hint);

        if (introEdit) {
            var ta = document.createElement('textarea');
            ta.className = 'iv-intro-ta';
            ta.value = data[s.key] || '';
            ta.setAttribute('rows', '12');
            ta.setAttribute('data-key', s.key);
            ta.addEventListener('input', function () {
                var cur = getIntro();
                cur[s.key] = ta.value;
                lsSet(INTRO_KEY, cur);
            });
            els.introCard.appendChild(ta);
        } else {
            var body = document.createElement('div');
            body.className = 'iv-intro-body';
            (data[s.key] || '').split(/\n{2,}/).forEach(function (para) {
                var t = para.trim();
                if (!t) return;
                var p = document.createElement('p');
                p.textContent = t;
                body.appendChild(p);
            });
            els.introCard.appendChild(body);
        }

        if (ttsAvailable()) {
            var row = document.createElement('div');
            row.className = 'iv-tts';
            var lab = document.createElement('span');
            lab.className = 'iv-tts-label';
            lab.textContent = '낭독 속도';
            row.appendChild(lab);
            row.appendChild(buildRateSelect());
            els.introCard.appendChild(row);
        }

        var n = INTRO_SECTIONS.length;
        els.introNum.textContent = (introIdx + 1) + ' / ' + n;
        els.introBar.style.width = ((introIdx + 1) / n) * 100 + '%';
        els.introPrev.disabled = introIdx <= 0;
        els.introNext.disabled = introIdx >= n - 1;
        els.introSpeak.disabled = !ttsAvailable();
        els.introEdit.setAttribute('aria-pressed', introEdit ? 'true' : 'false');
        els.introEdit.classList.toggle('is-on', introEdit);
        syncTts();
    }

    function introGo(delta) {
        var next = introIdx + delta;
        if (next < 0 || next >= INTRO_SECTIONS.length) return;
        ttsStop();
        introIdx = next;
        renderIntroCard();
    }
    function introToggleEdit() {
        introEdit = !introEdit;
        renderIntroCard();
        if (introEdit) {
            var ta = els.introCard.querySelector('.iv-intro-ta');
            if (ta) ta.focus();
        }
    }
    function introSpeakCurrent() {
        var s = INTRO_SECTIONS[introIdx];
        if (!s) return;
        ttsPlay('intro', getIntro()[s.key] || '');
    }

    function showIntroScreen() {
        ttsStop();
        introIdx = 0;
        renderIntroCard();
        els.modeScreen.hidden = true;
        els.studyScreen.hidden = true;
        els.toolbar.hidden = true;
        els.introToolbar.hidden = false;
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
    if (els.print) els.print.addEventListener('click', function () { openPrint(state.cat); });
    if (els.introHome) els.introHome.addEventListener('click', function () { showModeScreen(); });

    // TTS — 문항(질문·답변) / 소개하기 카드
    if (els.ttsQ) els.ttsQ.addEventListener('click', function () {
        var item = currentItem();
        if (item) ttsPlay('q', item.question || '');
    });
    if (els.ttsA) els.ttsA.addEventListener('click', function () {
        var item = currentItem();
        if (item && state.revealed) ttsPlay('a', answerText(item));
    });
    if (els.ttsRate) {
        if (tts) els.ttsRate.value = String(tts.getRate());
        els.ttsRate.addEventListener('change', function () { if (tts) tts.setRate(els.ttsRate.value); });
    }
    if (els.introEdit) els.introEdit.addEventListener('click', introToggleEdit);
    if (els.introPrev) els.introPrev.addEventListener('click', function () { introGo(-1); });
    if (els.introNext) els.introNext.addEventListener('click', function () { introGo(1); });
    if (els.introSpeak) els.introSpeak.addEventListener('click', introSpeakCurrent);
})();
