// 학습 시트 PDF 출력 — 단원별 카드 + 첫 페이지 목차(진짜 페이지번호) → Paged.js → 인쇄
// 흐름: (?units= 이면 /api/cards 로드 / 아니면 데모) → 카드 렌더 → 목차 생성
//       → Paged.js 페이지 분할 → 각 카드의 실제 페이지번호를 목차에 채움 → window.print()
(function () {
    const root = document.getElementById('print-root');
    const params = new URLSearchParams(location.search);
    const wanted = (params.get('units') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const autoPrint = params.get('auto') !== '0';

    // ========= 데모 데이터 (?units= 없을 때 — 레이아웃·페이지번호 빠른 확인용) =========
    const DEMO = [
        { name: '경영·컨설팅', cards: [
            { category: '암호', topic: '보안개요', definition: '정보를 보호하는 기본 원리와 공격기법에 대한 개요.',
              mnemonic: '[암호화] 원리, 공격기법 / 대칭키=비밀키(스트림·블록: Feistel-DES/SEED, SPN-AES/ARIA/LEA) / 공개키(소인수분해 RSA, 이산대수 DSA·디피헬만, 타원곡선 ECC) / 단방향(해시, MAC-HMAC, MDC-MD5).' },
            { topic: 'ISO 27001', definition: '정보보안 경영시스템(ISMS) 국제표준.', mnemonic: 'PDCA 기반 ISMS / 부속서 A 통제항목 / 인증심사.' },
            { topic: '방화벽', definition: '네트워크 경계에서 트래픽을 필터링하는 보안 장치.', mnemonic: '패킷필터 / 상태기반 / 프록시 / 차세대(NGFW).' },
            { topic: 'IDS/IPS', definition: '침입 탐지/방지 시스템.', mnemonic: '시그니처 기반 / 이상행위 기반 / 인라인 차단.' },
            { topic: 'VPN', definition: '공중망 위 가상 사설망.', mnemonic: 'IPSec(AH·ESP, 터널·전송) / SSL VPN.' },
            { topic: 'PKI', definition: '공개키 기반구조.', mnemonic: 'CA·RA·CRL·OCSP / 인증서 X.509 / 전자서명.' },
            { topic: '접근통제', definition: '주체의 객체 접근을 통제하는 메커니즘.', mnemonic: 'DAC / MAC / RBAC / ABAC.' },
            { topic: '해시함수', definition: '임의 길이를 고정 길이로 매핑하는 단방향 함수.', mnemonic: '역상저항·2차역상·충돌저항 / SHA-2, SHA-3.' },
        ]},
        { name: '정보보안 · 보안', cards: [
            { topic: 'DDoS', definition: '분산 서비스 거부 공격.', mnemonic: '대역소진(UDP/ICMP flood) / 자원소진(SYN flood) / L7(HTTP flood).' },
            { topic: 'OWASP Top 10', definition: '웹 앱 주요 보안 위협 목록.', mnemonic: 'Injection / Broken Auth / XSS / SSRF.' },
            { topic: '제로트러스트', definition: '"절대 신뢰하지 않고 항상 검증" 보안 모델.', mnemonic: '최소권한 / 마이크로세그멘테이션 / 지속검증.' },
            { topic: 'SIEM', definition: '보안 정보·이벤트 관리.', mnemonic: '로그수집·상관분석·경보 / SOAR 연계.' },
            { topic: '랜섬웨어', definition: '데이터를 암호화하고 금전을 요구하는 악성코드.', mnemonic: '백업 3-2-1 / EDR / 망분리.' },
            { topic: '전자서명', definition: '서명자 신원과 무결성을 보장하는 디지털 서명.', mnemonic: '개인키 서명 / 공개키 검증 / 부인방지.' },
        ]},
    ];

    // ========= 유틸 =========
    function cardTitle(c) {
        const t = c.topic != null ? c.topic : (c.q != null ? c.q : '');
        return String(t || '(무제)');
    }
    function resolveImageSrc(src) {
        if (!src) return '';
        if (src.startsWith('data:') || /^https?:/.test(src) || src.includes('/')) return src;
        return 'data/images/' + src;
    }
    function getCardImages(c) {
        if (Array.isArray(c.images) && c.images.length) return c.images;
        if (c.image) return [c.image];
        return [];
    }

    // ========= 데이터 로드 (/api → 번들 폴백) =========
    function loadUnits() {
        return fetch('/api/units?_t=' + Date.now(), { cache: 'no-store' })
            .then((r) => r.ok ? r.json() : Promise.reject())
            .catch(() => fetch('data/index.json', { cache: 'no-cache' }).then((r) => r.json()))
            .then((d) => Array.isArray(d.units) ? d.units : []);
    }
    function loadAllCards(units) {
        return fetch('/api/cards?_t=' + Date.now(), { cache: 'no-store' })
            .then((r) => r.ok ? r.json() : Promise.reject())
            .catch(async () => {
                const all = {};
                await Promise.all(units.map((u) =>
                    fetch('data/cards/' + u.file, { cache: 'no-cache' })
                        .then((r) => r.ok ? r.json() : [])
                        .then((arr) => { all[u.id] = Array.isArray(arr) ? arr : []; })
                        .catch(() => { all[u.id] = []; })
                ));
                return all;
            });
    }

    // ========= 카드 렌더 =========
    function addField(parent, label, value) {
        const v = String(value == null ? '' : value).trim();
        if (!v) return;
        const w = document.createElement('div'); w.className = 'card-field';
        const l = document.createElement('span'); l.className = 'field-label'; l.textContent = label;
        const b = document.createElement('div'); b.className = 'field-body'; b.textContent = v;
        w.append(l, b); parent.appendChild(w);
    }
    function renderCard(c, id, n) {
        const art = document.createElement('article'); art.className = 'card'; art.id = id;
        const head = document.createElement('div'); head.className = 'card-head';
        const numEl = document.createElement('span'); numEl.className = 'card-num'; numEl.textContent = n;
        head.appendChild(numEl);
        if (c.category) {
            const e = document.createElement('span'); e.className = 'card-cat'; e.textContent = c.category;
            head.appendChild(e);
        }
        const topicEl = document.createElement('span'); topicEl.className = 'card-topic'; topicEl.textContent = cardTitle(c);
        head.appendChild(topicEl);
        art.appendChild(head);

        addField(art, '정의', c.definition != null ? c.definition : (c.a != null ? c.a : ''));
        addField(art, '기술', c.mnemonic != null ? c.mnemonic : '');

        const images = getCardImages(c);
        if (images.length) {
            const box = document.createElement('div'); box.className = 'card-images';
            images.forEach((src) => {
                const url = resolveImageSrc(src); if (!url) return;
                const img = document.createElement('img'); img.src = url; img.alt = cardTitle(c);
                img.onerror = () => img.remove();
                box.appendChild(img);
            });
            art.appendChild(box);
        }
        return art;
    }

    // groups: [{ name, cards:[...] }] → DOM 렌더, 목차용 메타 반환
    function renderGroups(groups) {
        root.innerHTML = '';
        let seq = 0;
        const tocGroups = [];
        groups.forEach((g) => {
            const cards = Array.isArray(g.cards) ? g.cards : [];
            if (!cards.length) return;
            const sec = document.createElement('section'); sec.className = 'unit';
            const h = document.createElement('h2'); h.className = 'unit-title'; h.textContent = g.name;
            sec.appendChild(h);
            const box = document.createElement('div'); box.className = 'cards';
            const entries = [];
            cards.forEach((c) => {
                seq++;
                const id = 'c-' + seq;
                box.appendChild(renderCard(c, id, seq));
                entries.push({ id, n: seq, title: cardTitle(c) });
            });
            sec.appendChild(box);
            root.appendChild(sec);
            tocGroups.push({ name: g.name, entries });
        });
        return tocGroups;
    }

    // ========= 목차 =========
    function buildToc(tocGroups) {
        const sec = document.createElement('section'); sec.className = 'toc';
        const h = document.createElement('h1'); h.className = 'toc-title'; h.textContent = '카드 목록';
        sec.appendChild(h);
        tocGroups.forEach((g) => {
            const gh = document.createElement('h2'); gh.className = 'toc-group'; gh.textContent = g.name;
            sec.appendChild(gh);
            g.entries.forEach((e) => {
                const a = document.createElement('a'); a.className = 'toc-entry'; a.href = '#' + e.id; a.dataset.target = e.id;
                const num = document.createElement('span'); num.className = 'toc-n'; num.textContent = e.n + '.';
                const t = document.createElement('span'); t.className = 'toc-text'; t.textContent = e.title;
                const dots = document.createElement('span'); dots.className = 'toc-dots';
                const p = document.createElement('span'); p.className = 'toc-page'; p.textContent = '';
                a.append(num, t, dots, p);
                sec.appendChild(a);
            });
        });
        root.insertBefore(sec, root.firstChild);   // 목차를 맨 앞에
    }

    // ========= Paged.js 분할 후 목차 페이지번호 채우기 → 인쇄 =========
    function paginateThenPrint() {
        const hasPaged = window.Paged && typeof window.Paged.Previewer === 'function';
        if (!hasPaged) {
            console.warn('[print] Paged.js 미로드 — 페이지번호 없이 인쇄');
            if (autoPrint) setTimeout(() => window.print(), 300);
            return;
        }
        const html = root.innerHTML;
        root.remove();   // 원본 제거(중복 방지) — Paged.js 가 document.body 에 분할 페이지를 그림
        const previewer = new window.Paged.Previewer();
        previewer.preview(html, ['css/print.css'], document.body)
            .then(() => { fillTocPages(); if (autoPrint) setTimeout(() => window.print(), 400); })
            .catch((err) => {
                console.error('[print] Paged.js 실패 — 원본 복구 후 인쇄', err);
                document.body.appendChild(root);
                if (autoPrint) setTimeout(() => window.print(), 300);
            });
    }
    function fillTocPages() {
        document.querySelectorAll('.toc-entry').forEach((entry) => {
            const id = entry.dataset.target;
            const el = id && document.getElementById(id);
            const page = el && el.closest('.pagedjs_page');
            const n = page ? page.getAttribute('data-page-number') : '';
            const ps = entry.querySelector('.toc-page');
            if (ps) ps.textContent = n || '';
        });
    }

    // ========= 이미지 로드 대기 (최대 3초) =========
    function waitImages(cb) {
        const imgs = Array.from(root.querySelectorAll('img'));
        if (!imgs.length) { cb(); return; }
        let pending = imgs.length, done = false;
        const fin = () => { if (done) return; done = true; cb(); };
        imgs.forEach((im) => {
            if (im.complete) { if (--pending === 0) fin(); return; }
            const h = () => { if (--pending === 0) fin(); };
            im.addEventListener('load', h, { once: true });
            im.addEventListener('error', h, { once: true });
        });
        setTimeout(fin, 3000);
    }

    // ========= 마무리 공통 =========
    function finalize(groups) {
        const tocGroups = renderGroups(groups);
        if (!tocGroups.length) {
            root.innerHTML = '<div class="print-empty">출력할 카드가 없습니다. (단원을 선택했는지, 카드가 등록됐는지 확인하세요)</div>';
            return;
        }
        buildToc(tocGroups);
        waitImages(paginateThenPrint);
    }

    // 수동 인쇄 버튼
    const btn = document.getElementById('btn-print-now');
    if (btn) btn.addEventListener('click', () => window.print());

    // ========= 부트 =========
    // flash 화면이 넘긴 선택(전체/체크) — localStorage 로 정확한 카드 목록을 그대로 전달받아 렌더
    if (params.get('req') === '1') {
        try {
            const raw = localStorage.getItem('itpe.printReq');
            const req = raw ? JSON.parse(raw) : null;
            if (req && Array.isArray(req.cards) && req.cards.length) {
                finalize([{ name: req.name || '학습 시트', cards: req.cards }]);
            } else {
                root.innerHTML = '<div class="print-empty">출력할 카드가 없습니다.</div>';
            }
        } catch (e) {
            console.error('[print] printReq parse fail', e);
            root.innerHTML = '<div class="print-empty">출력 데이터를 불러오지 못했습니다.</div>';
        }
    } else if (wanted.length) {
        loadUnits()
            .then((units) => loadAllCards(units).then((all) => {
                const picked = units.filter((u) => wanted.includes(u.id));
                const groups = picked.map((u) => ({
                    name: u.description ? (u.name + ' · ' + u.description) : u.name,
                    cards: Array.isArray(all[u.id]) ? all[u.id] : [],
                }));
                finalize(groups);
            }))
            .catch((err) => {
                console.error('[print] load fail', err);
                root.innerHTML = '<div class="print-empty">데이터를 불러오지 못했습니다.</div>';
            });
    } else {
        finalize(DEMO);   // 데모 모드
    }
})();
