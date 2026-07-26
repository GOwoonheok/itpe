// 음성 낭독(TTS) — Web Speech API 얇은 래퍼. 클래식 스크립트(ESM 금지), window.ITPETts 전역.
// 외부 네트워크·패키지 없음(브라우저 내장) — CSP·오프라인 제약에 영향 없음.
//
// 설계 메모
// - 크롬은 긴 utterance 를 15초쯤에서 끊는 알려진 버그가 있다.
//   → 텍스트를 문장(그리고 너무 길면 쉼표) 단위 80자 내외로 쪼개 onend 로 이어 읽고,
//     추가 안전장치로 재생 중 주기적으로 resume() 을 호출한다.
// - getVoices() 는 비동기라 첫 호출에 빈 배열일 수 있다 → voiceschanged 로 재선택.
// - 첫 speak() 는 사용자 제스처(버튼 클릭) 안에서 호출된다(iOS 요건). 이후 체인은 허용됨.
(function () {
    'use strict';

    var synth = window.speechSynthesis || null;
    var RATE_KEY = 'iv:ttsRate';
    var CHUNK = 80;          // 한 조각 최대 글자수 (한국어 ≈ 5~6자/초 → 약 14초)
    var KEEPALIVE_MS = 8000;

    var queue = [];
    var qi = 0;
    var active = false;
    var voice = null;
    var voiceBound = false;
    var keepAlive = null;
    var listeners = [];

    function supported() {
        return !!synth && typeof window.SpeechSynthesisUtterance === 'function';
    }

    // ── 음성 선택 — 한국어 · 오프라인(local) 우선 ──────────
    function pickVoice() {
        if (!supported()) return null;
        var vs = [];
        try { vs = synth.getVoices() || []; } catch (e) { return null; }
        if (!vs.length) return null;
        var ko = vs.filter(function (v) { return /^ko/i.test(v.lang || ''); });
        var local = ko.filter(function (v) { return v.localService; });
        return local[0] || ko[0] || null;
    }
    function ensureVoice() {
        if (voice || !supported()) return;
        voice = pickVoice();
        if (!voice && !voiceBound) {
            voiceBound = true;
            try {
                synth.addEventListener('voiceschanged', function () { voice = pickVoice(); });
            } catch (e) {}
        }
    }
    ensureVoice();

    // ── 속도 ─────────────────────────────────────────────
    function getRate() {
        var r = parseFloat(localStorage.getItem(RATE_KEY));
        return (r >= 0.5 && r <= 2) ? r : 1;
    }
    function setRate(r) {
        var v = parseFloat(r);
        if (!(v >= 0.5 && v <= 2)) return;
        try { localStorage.setItem(RATE_KEY, String(v)); } catch (e) {}
        if (active) { var q = queue.slice(qi); stop(); speakChunks(q); }   // 재생 중이면 남은 분량부터 새 속도로
    }

    // ── 텍스트 → 조각 ────────────────────────────────────
    function splitChunks(text) {
        var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        if (!t) return [];
        var sentences = t.match(/[^.!?。！？]+[.!?。！？]*/g) || [t];
        var out = [];
        sentences.forEach(function (s) {
            var p = s.trim();
            while (p.length > CHUNK) {
                var cut = p.lastIndexOf(',', CHUNK);
                if (cut < CHUNK / 3) cut = p.lastIndexOf(' ', CHUNK);
                if (cut < CHUNK / 3) cut = CHUNK - 1;
                out.push(p.slice(0, cut + 1).trim());
                p = p.slice(cut + 1).trim();
            }
            if (p) out.push(p);
        });
        return out;
    }

    // ── 재생 ─────────────────────────────────────────────
    function notify() {
        listeners.forEach(function (fn) { try { fn(active); } catch (e) {} });
    }
    function startKeepAlive() {
        stopKeepAlive();
        keepAlive = setInterval(function () {
            if (!synth) return;
            if (synth.speaking && !synth.paused) { try { synth.resume(); } catch (e) {} }
        }, KEEPALIVE_MS);
    }
    function stopKeepAlive() {
        if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
    }

    function speakNext() {
        if (!active) return;
        if (qi >= queue.length) { finish(); return; }
        var u = new window.SpeechSynthesisUtterance(queue[qi]);
        ensureVoice();
        if (voice) u.voice = voice;
        u.lang = (voice && voice.lang) || 'ko-KR';
        u.rate = getRate();
        u.onend = function () { qi++; speakNext(); };
        u.onerror = function () { qi++; speakNext(); };   // 조각 하나가 실패해도 계속 진행
        try { synth.speak(u); } catch (e) { finish(); }
    }
    function finish() {
        active = false;
        queue = []; qi = 0;
        stopKeepAlive();
        notify();
    }

    function speakChunks(chunks) {
        if (!supported() || !chunks.length) return false;
        try { synth.cancel(); } catch (e) {}
        queue = chunks; qi = 0; active = true;
        startKeepAlive();
        notify();
        speakNext();
        return true;
    }

    // text 는 문자열 또는 문자열 배열(단락). 배열이면 순서대로 이어 읽는다.
    function speak(text) {
        var parts = Array.isArray(text) ? text : [text];
        var chunks = [];
        parts.forEach(function (p) { chunks = chunks.concat(splitChunks(p)); });
        return speakChunks(chunks);
    }
    function stop() {
        if (!supported()) return;
        active = false;
        queue = []; qi = 0;
        stopKeepAlive();
        try { synth.cancel(); } catch (e) {}
        notify();
    }
    function isSpeaking() { return active; }
    function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

    // 페이지를 떠날 때 남은 음성 정리 (뒤로가기 후 계속 읽히는 것 방지)
    window.addEventListener('pagehide', stop);
    window.addEventListener('beforeunload', stop);

    window.ITPETts = {
        supported: supported,
        speak: speak,
        stop: stop,
        isSpeaking: isSpeaking,
        getRate: getRate,
        setRate: setRate,
        onChange: onChange,
        _splitChunks: splitChunks   // 테스트용
    };
})();
