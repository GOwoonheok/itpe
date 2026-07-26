// 면접자료 A4 출력 — 상세 답변집(1단) / 회독 요약본(2단) + 블록 목차(실제 페이지번호).
// 흐름: data/interview/*.json 로드 → 전역 연번 부여 → 범위 필터 → 카테고리·블록 그룹 렌더
//       → 목차 생성 → Paged.js 페이지 분할 → 블록의 실제 페이지번호를 목차에 채움 → 인쇄 대기.
// 옵션(범위·형식·압박대응)은 URL 파라미터가 단일 진실 — 변경 시 같은 URL 로 재진입(reload)한다.
// 클래식 스크립트 IIFE (ESM 금지). interview.js 와 공유 전역 없음.
(function () {
    'use strict';

    var root = document.getElementById('ivp-root');
    var params = new URLSearchParams(location.search);

    var VALID_CATS = ['career', 'expected', 'all', 'bookmarks'];
    var opt = {
        cat: VALID_CATS.indexOf(params.get('cat')) !== -1 ? params.get('cat') : 'all',
        density: params.get('density') === 'brief' ? 'brief' : 'full',
        guard: params.get('guard') !== '0',
        auto: params.get('auto') === '1'
    };
    document.body.className = opt.density === 'brief' ? 'is-brief' : 'is-full';

    // 4단 구술 답변 정의 — interview.js 의 PARTS 와 동일 순서
    var PARTS = [
        { key: 'restate',   label: '복명복창', cls: 'p-restate' },
        { key: 'structure', label: '구조화',   cls: 'p-structure' },
        { key: 'concept',   label: '개념',     cls: 'p-concept' },
        { key: 'case',      label: '실사례',   cls: 'p-case' }
    ];

    var BM_KEY = 'iv:bookmarks';
    function getBookmarks() {
        try {
            var a = JSON.parse(localStorage.getItem(BM_KEY) || '[]');
            return Array.isArray(a) ? a : [];
        } catch (e) { return []; }
    }

    var state = { manifest: null, byCat: {}, seq: {}, order: [] };

    // ── 유틸 ─────────────────────────────────────────────
    function fetchJSON(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error(url + ' ' + r.status);
            return r.json();
        });
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function txt(v) { return String(v == null ? '' : v).trim(); }
    // 두괄식 결론 = 첫 문장. 마침표를 못 찾으면 앞부분만 잘라 쓴다.
    function firstSentence(s) {
        var t = txt(s);
        if (!t) return '';
        var m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
        if (m) return m[0].trim();
        return t.length > 140 ? t.slice(0, 140) + '…' : t;
    }
    function catName(id) {
        if (id === 'all') return '전체';
        if (id === 'bookmarks') return '⭐ 선택토픽';
        var c = (state.manifest && state.manifest.categories || []).filter(function (x) { return x.id === id; })[0];
        return c ? c.name : id;
    }
    function today() {
        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    }

    // ── 도구막대 ─────────────────────────────────────────
    function buildUrl(next) {
        var o = { cat: opt.cat, density: opt.density, guard: opt.guard };
        Object.keys(next || {}).forEach(function (k) { o[k] = next[k]; });
        var qs = 'cat=' + encodeURIComponent(o.cat) + '&density=' + o.density + (o.guard ? '' : '&guard=0');
        return location.pathname + '?' + qs;
    }
    function reloadWith(next) { location.replace(buildUrl(next)); }

    function initToolbar() {
        var sel = document.getElementById('ivp-cat');
        var counts = {
            career: (state.byCat.career || []).length,
            expected: (state.byCat.expected || []).length,
            all: state.order.length,
            bookmarks: pick('bookmarks').length
        };
        var opts = [
            { v: 'career', t: '이력연계' },
            { v: 'expected', t: '예상토픽' },
            { v: 'all', t: '전체' },
            { v: 'bookmarks', t: '⭐ 선택토픽' }
        ];
        opts.forEach(function (o) {
            var op = el('option', null, o.t + ' (' + counts[o.v] + '문항)');
            op.value = o.v;
            if (o.v === opt.cat) op.selected = true;
            sel.appendChild(op);
        });
        sel.addEventListener('change', function () { reloadWith({ cat: sel.value }); });

        Array.prototype.forEach.call(document.querySelectorAll('.ivp-seg button'), function (b) {
            var d = b.getAttribute('data-density');
            b.classList.toggle('is-on', d === opt.density);
            b.addEventListener('click', function () { if (d !== opt.density) reloadWith({ density: d }); });
        });

        var gchk = document.getElementById('ivp-guard');
        gchk.checked = opt.guard;
        gchk.disabled = opt.density === 'brief';   // 요약본에는 압박대응을 싣지 않음
        gchk.addEventListener('change', function () { reloadWith({ guard: gchk.checked }); });

        document.getElementById('ivp-print').addEventListener('click', function () { window.print(); });
    }

    // ── 데이터 ───────────────────────────────────────────
    // 전역 연번 = 매니페스트 카테고리 순서의 데이터 순서(이력연계 1~, 예상토픽 이어서).
    // 셔플·필터와 무관하게 고정 — 요약본에서 막힌 번호를 상세본에서 그대로 찾을 수 있다.
    function assignSeq() {
        var n = 0;
        (state.manifest.categories || []).forEach(function (c) {
            (state.byCat[c.id] || []).forEach(function (it) {
                n++;
                state.seq[it.id] = n;
                state.order.push(it);
            });
        });
    }
    function pick(cat) {
        if (cat === 'all') return state.order.slice();
        if (cat === 'bookmarks') {
            var set = getBookmarks();
            return state.order.filter(function (it) { return set.indexOf(it.id) !== -1; });
        }
        return (state.byCat[cat] || []).slice();
    }

    // ── 문항 렌더 ────────────────────────────────────────
    function renderFull(item, n) {
        var art = el('article', 'ivp-item');
        art.id = 'q-' + n;

        var row = el('div', 'ivp-q-row');
        row.appendChild(el('span', 'ivp-n', String(n)));
        row.appendChild(el('h3', 'ivp-q', txt(item.question)));
        if (item.prob != null && item.prob !== '') row.appendChild(el('span', 'ivp-prob', item.prob + '%'));
        art.appendChild(row);

        PARTS.forEach(function (p) {
            var t = txt(item[p.key]);
            if (!t) return;
            var box = el('div', 'ivp-part ' + p.cls);
            box.appendChild(el('span', 'ivp-lab', p.label));
            var body = el('div', 'ivp-txt');
            t.split(/\n{2,}/).forEach(function (para) {
                var s = para.trim();
                if (s) body.appendChild(el('p', null, s));
            });
            box.appendChild(body);
            art.appendChild(box);
        });

        var kws = Array.isArray(item.keywords) ? item.keywords.filter(Boolean) : [];
        if (kws.length) {
            var kbox = el('div', 'ivp-kws');
            kws.forEach(function (k) { kbox.appendChild(el('span', 'ivp-kw', '#' + k)); });
            art.appendChild(kbox);
        }

        if (opt.guard) {
            var guards = Array.isArray(item.followupGuard) ? item.followupGuard.filter(Boolean) : [];
            var pit = txt(item.pitfall);
            if (guards.length || pit) {
                var g = el('div', 'ivp-guard');
                g.appendChild(el('div', 'ivp-guard-h', '면접관 압박 대응'));
                if (guards.length) {
                    var ul = el('ul', 'ivp-guard-list');
                    guards.forEach(function (x) { ul.appendChild(el('li', null, x)); });
                    g.appendChild(ul);
                }
                if (pit) g.appendChild(el('p', 'ivp-pit', '⚠ ' + pit));
                art.appendChild(g);
            }
        }

        var refs = Array.isArray(item.references) ? item.references.filter(Boolean) : [];
        if (refs.length) art.appendChild(el('div', 'ivp-refs', '참고 · ' + refs.join('  ·  ')));

        return art;
    }

    function renderBrief(item, n) {
        var art = el('article', 'ivp-item is-brief');
        art.id = 'q-' + n;

        var row = el('div', 'ivp-q-row');
        row.appendChild(el('span', 'ivp-n', String(n)));
        row.appendChild(el('h3', 'ivp-q', txt(item.question)));
        art.appendChild(row);

        var s = txt(item.structure);
        if (s) art.appendChild(el('div', 'ivp-brief-s', '▶ ' + s));
        var c = firstSentence(item.concept);
        if (c) art.appendChild(el('div', 'ivp-brief-c', c));

        var kws = Array.isArray(item.keywords) ? item.keywords.filter(Boolean) : [];
        if (kws.length) {
            var kbox = el('div', 'ivp-kws');
            kws.forEach(function (k) { kbox.appendChild(el('span', 'ivp-kw', '#' + k)); });
            art.appendChild(kbox);
        }
        return art;
    }

    // ── 그룹 렌더 (카테고리 → 블록) ──────────────────────
    function groupItems(items) {
        var cats = [];
        var byCatKey = {};
        items.forEach(function (it) {
            var cn = txt(it.category) || '문항';
            var g = byCatKey[cn];
            if (!g) { g = byCatKey[cn] = { name: cn, blocks: [], byBlock: {} }; cats.push(g); }
            var bn = txt(it.block) || '기타';
            var b = g.byBlock[bn];
            if (!b) { b = g.byBlock[bn] = { name: bn, items: [] }; g.blocks.push(b); }
            b.items.push(it);
        });
        return cats;
    }

    function renderBody(groups) {
        var bid = 0;
        var toc = [];
        groups.forEach(function (g) {
            var sec = el('section', 'ivp-cat');
            sec.appendChild(el('h1', 'ivp-cat-title', g.name));
            var flow = el('div', 'ivp-flow');
            var tocBlocks = [];
            g.blocks.forEach(function (b) {
                bid++;
                var h = el('h2', 'ivp-block-title', b.name);
                h.id = 'b-' + bid;
                flow.appendChild(h);
                b.items.forEach(function (it) {
                    var n = state.seq[it.id] || 0;
                    flow.appendChild(opt.density === 'brief' ? renderBrief(it, n) : renderFull(it, n));
                });
                tocBlocks.push({ id: h.id, name: b.name, count: b.items.length });
            });
            sec.appendChild(flow);
            root.appendChild(sec);
            toc.push({ name: g.name, blocks: tocBlocks });
        });
        return toc;
    }

    // ── 목차 ─────────────────────────────────────────────
    function buildToc(toc, total) {
        var sec = el('section', 'ivp-toc');
        var kind = opt.density === 'brief' ? '회독 요약본' : '면접 답변집';
        sec.appendChild(el('h1', 'ivp-toc-title', kind + ' — ' + catName(opt.cat)));
        sec.appendChild(el('p', 'ivp-toc-sub',
            '총 ' + total + '문항 · ' +
            (opt.density === 'brief' ? '질문 + 구조화 + 두괄식 결론 + 키워드' : '4단 구술 답변 전문' + (opt.guard ? ' + 압박 대응' : '')) +
            ' · ' + today()));

        var list = el('div', 'ivp-toc-list');
        toc.forEach(function (g) {
            var n = g.blocks.reduce(function (s, b) { return s + b.count; }, 0);
            list.appendChild(el('div', 'ivp-toc-cat', g.name + ' (' + n + '문항)'));
            g.blocks.forEach(function (b) {
                var a = el('a', 'ivp-toc-entry');
                a.href = '#' + b.id;
                a.setAttribute('data-target', b.id);
                a.appendChild(el('span', 'ivp-toc-text', b.name));
                a.appendChild(el('span', 'ivp-toc-cnt', b.count + '문항'));
                a.appendChild(el('span', 'ivp-toc-dots'));
                a.appendChild(el('span', 'ivp-toc-page'));
                list.appendChild(a);
            });
        });
        sec.appendChild(list);
        sec.appendChild(el('div', 'ivp-toc-note',
            '문항 번호는 이력연계 → 예상토픽 데이터 순서의 고정 번호입니다. 요약본에서 막힌 번호를 답변집에서 같은 번호로 찾으세요.'));
        root.insertBefore(sec, root.firstChild);
    }

    // ── 진행 표시 ────────────────────────────────────────
    var pageCount = 0;
    function showProgress() {
        if (document.getElementById('ivp-progress')) return;
        var ov = el('div');
        ov.id = 'ivp-progress';
        var inner = el('div');
        inner.appendChild(el('div', null, '📄 지면 구성 중…'));
        var n = el('div', null, '0쪽');
        n.id = 'ivp-pp';
        inner.appendChild(n);
        inner.appendChild(el('div', null, '문항이 많으면 수십 초 걸릴 수 있어요'));
        ov.appendChild(inner);
        document.body.appendChild(ov);
    }
    function hideProgress() {
        var ov = document.getElementById('ivp-progress');
        if (ov) ov.remove();
    }
    if (window.Paged && window.Paged.registerHandlers) {
        try {
            window.Paged.registerHandlers(class extends window.Paged.Handler {
                afterPageLayout() {
                    pageCount++;
                    var e = document.getElementById('ivp-pp');
                    if (e) e.textContent = pageCount + '쪽';
                }
            });
        } catch (e) {}
    }

    // ── Paged.js 분할 → 목차 페이지번호 → 인쇄 ───────────
    function paginate(bigJob) {
        var hasPaged = window.Paged && typeof window.Paged.Previewer === 'function';
        if (!hasPaged) {
            console.warn('[iv-print] Paged.js 미로드 — 페이지번호 없이 진행');
            done();
            return;
        }
        var html = root.innerHTML;
        root.remove();   // 원본 제거(중복 방지) — Paged.js 가 document.body 에 분할 페이지를 그린다
        if (bigJob) showProgress();
        new window.Paged.Previewer()
            .preview(html, ['css/interview-print.css'], document.body)
            .then(function () { hideProgress(); numberPages(); fillTocPages(); done(); })
            .catch(function (err) {
                hideProgress();
                console.error('[iv-print] Paged.js 실패 — 원본 복구', err);
                document.body.appendChild(root);
                done();
            });
    }
    function numberPages() {
        Array.prototype.forEach.call(document.querySelectorAll('.pagedjs_page'), function (pageEl) {
            var P = parseInt(pageEl.getAttribute('data-page-number'), 10) || 0;
            Array.prototype.forEach.call(pageEl.querySelectorAll('.ivp-block-title'), function (h) {
                if (!h.dataset.page) h.dataset.page = String(P);
            });
            var box = pageEl.querySelector('.pagedjs_pagebox') || pageEl;
            box.appendChild(el('div', 'ivp-pageno', '— ' + P + ' —'));
        });
    }
    function fillTocPages() {
        Array.prototype.forEach.call(document.querySelectorAll('.ivp-toc-entry'), function (a) {
            var t = a.getAttribute('data-target');
            var h = t && document.getElementById(t);
            var slot = a.querySelector('.ivp-toc-page');
            if (slot) slot.textContent = (h && h.dataset.page) ? h.dataset.page : '';
        });
    }
    function done() {
        document.body.setAttribute('data-ivp-ready', '1');   // E2E·디버깅용 완료 신호
        if (opt.auto) setTimeout(function () { window.print(); }, 400);
    }

    // ── 부트 ─────────────────────────────────────────────
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
            assignSeq();
            initToolbar();

            var items = pick(opt.cat);
            var kind = opt.density === 'brief' ? '회독요약본' : '면접답변집';
            document.title = 'ITPE_' + kind + '_' + catName(opt.cat).replace(/[^가-힣A-Za-z0-9]/g, '') + '_' + today();

            if (!items.length) {
                root.appendChild(el('div', 'ivp-empty',
                    opt.cat === 'bookmarks'
                        ? '선택토픽이 비어 있습니다 — 면접 학습 화면에서 ☆ 를 눌러 담은 뒤 다시 인쇄하세요.'
                        : '출력할 문항이 없습니다.'));
                done();
                return;
            }
            var toc = renderBody(groupItems(items));
            buildToc(toc, items.length);
            paginate(items.length > 40);
        })
        .catch(function (err) {
            console.error('[iv-print] 데이터 로드 실패', err);
            root.appendChild(el('div', 'ivp-empty', '문항 데이터를 불러오지 못했습니다. data/interview/ 를 확인하세요.'));
            done();
        });
})();
