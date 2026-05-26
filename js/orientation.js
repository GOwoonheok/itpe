// 화면 회전 정책 (best-effort)
//   · 큰 화면(태블릿/노트패드): 자동회전 허용 — manifest orientation:any 가 처리, JS 잠금 안 함
//   · 폰(짧은 변 < 600px): 세로(portrait) 고정 시도
//
// 한계(브라우저 차이):
//   · screen.orientation.lock() 은 설치형 PWA(standalone) 또는 전체화면에서만 동작.
//     일반 브라우저 탭에서는 거부될 수 있어 try/catch 로 무시(폰이 기기 설정을 따름).
//   · iOS Safari 는 screen.orientation.lock 미지원 → 폰 세로고정 불가(무시).
(function () {
    // 기기 화면의 '짧은 변' — 회전과 무관하게 일정. 폰/태블릿 구분 기준.
    function shortSidePx() {
        var w = (window.screen && window.screen.width)  || window.innerWidth  || 0;
        var h = (window.screen && window.screen.height) || window.innerHeight || 0;
        return Math.min(w, h);
    }
    function isPhone() {
        return shortSidePx() < 600;   // 폰: 보통 360~430 / 태블릿: 600~834
    }

    function apply() {
        try {
            var so = window.screen && window.screen.orientation;
            if (isPhone()) {
                // 폰 — 세로 고정 시도 (지원/권한 없으면 조용히 무시)
                if (so && typeof so.lock === 'function') {
                    var p = so.lock('portrait');
                    if (p && typeof p.catch === 'function') p.catch(function () {});
                }
            } else {
                // 태블릿/노트패드 — 자동회전 허용 (혹시 걸린 잠금 해제)
                if (so && typeof so.unlock === 'function') {
                    try { so.unlock(); } catch (e) {}
                }
            }
        } catch (e) { /* 미지원 환경 — 무시 */ }
    }

    apply();
})();
