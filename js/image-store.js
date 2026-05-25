// 이미지 저장 추상 레이어.
// 현재: 클라이언트에서 압축 후 dataURL 반환 → /api/upload-image 가 R2 업로드.
//
// 압축 정책 — 스냅샷 글자/도식 가독성 우선 + 저장·전송량 최소화
//   글자 가독성은 '해상도'가 좌우 → 해상도는 넉넉히, 품질·목표용량은 낮춰 WebP 로 "선명하되 작게".
//   · 최대 변(maxDim)   : 1000px (스냅샷 빽빽한 글자도 알아볼 수 있게. 800→1000 상향)
//   · 시작 품질         : 0.55   (WebP 는 저품질에서도 글자 에지 유지)
//   · 목표 크기         : 120KB  (이 이하 되도록 적응 압축. 150→120 하향)
//   · 적응 압축 단계    : (1) quality 0.55 → minQuality 까지 단계 하강
//                         (2) 더 못 줄면 해상도 0.85x 축소 + quality 0.50 부터 재시도
//   · 품질 하한선       : 0.40  (이하로는 글자가 뭉개져 가독성↓ — '보이기 적절' 보장)
//   · 해상도 하한선     : 560px (글자 읽기 가능한 최소선)
//   · 포맷              : WebP 우선 (텍스트·도식에 강함), JPEG 폴백
//   · 스킵 조건         : SVG 그대로, 16KB 미만 원본 그대로 (재인코딩 역효과 방지)
//   · 안전망            : 압축 결과가 원본보다 크면 원본 사용
(function () {
    const DEFAULTS = {
        maxDim: 1000,
        quality: 0.55,
        targetBytes: 120 * 1024,
        minQuality: 0.40,
        minDim: 560,
        qualityStep: 0.08,
        dimStep: 0.85,
        maxAttempts: 9,
        skipUnder: 16 * 1024,
        preferFormat: 'image/webp',
        fallbackFormat: 'image/jpeg',
    };

    let webpSupported = null;
    function checkWebPSupport() {
        if (webpSupported !== null) return webpSupported;
        try {
            const c = document.createElement('canvas');
            c.width = c.height = 1;
            const url = c.toDataURL('image/webp');
            webpSupported = url.startsWith('data:image/webp');
        } catch { webpSupported = false; }
        return webpSupported;
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(file);
        });
    }
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = src;
        });
    }
    function dataUrlBytes(dataUrl) {
        // base64 길이로 대략 바이트 계산 (data:...;base64, 헤더 제외 후 × 0.75)
        const i = dataUrl.indexOf(',');
        const payload = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
        return Math.floor(payload.length * 3 / 4);
    }
    function fmtBytes(b) {
        if (b < 1024) return b + 'B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
        return (b / 1024 / 1024).toFixed(2) + 'MB';
    }

    async function compressFile(file, opts = {}) {
        if (!file || !file.size) {
            throw new Error('빈 파일 — 클립보드에 이미지 데이터가 없습니다 (size: ' + (file && file.size) + ')');
        }
        let cfg = { ...DEFAULTS, ...opts };
        const originalSize = file.size;
        const fileType = (file.type || '').toLowerCase();

        // 대용량 원본 — 해상도(가독성)는 지키되 시작 품질만 낮춰 적응 루프가 빨리 수렴하게.
        //   (스냅샷은 보통 1MB+ PNG 이므로 여기서 해상도를 깎으면 글자가 흐려짐 → 해상도 유지)
        if (originalSize > 1024 * 1024) {
            cfg = { ...cfg, quality: Math.min(cfg.quality, 0.52) };
        }
        if (originalSize > 3 * 1024 * 1024) {
            cfg = { ...cfg, maxDim: Math.min(cfg.maxDim, 900), quality: 0.5 };
        }

        // SVG: 벡터라 재인코딩 불필요
        if (fileType === 'image/svg+xml') {
            const url = await fileToDataUrl(file);
            return { dataUrl: url, originalSize, compressedSize: dataUrlBytes(url), format: 'svg', skipped: true };
        }
        // 알려진 image MIME 이고 충분히 작은 파일만 그대로 통과 (클립보드 빈 MIME 케이스 방지)
        const KNOWN = /^image\/(jpeg|jpg|png|gif|webp)$/;
        if (KNOWN.test(fileType) && originalSize < cfg.skipUnder) {
            const url = await fileToDataUrl(file);
            return { dataUrl: url, originalSize, compressedSize: dataUrlBytes(url), format: fileType, skipped: true };
        }

        // dataURL 유효성 — 콤마 뒤 페이로드가 충분히 있는지
        function isValidDataUrl(s) {
            if (typeof s !== 'string') return false;
            const i = s.indexOf(',');
            if (i < 0) return false;
            return s.length - i - 1 > 32;
        }

        // 그 외(클립보드 빈 MIME, 알 수 없는 타입, 큰 파일) — 모두 canvas 재인코딩으로 강제 표준화
        const src = await fileToDataUrl(file);
        const img = await loadImage(src);
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > cfg.maxDim || h > cfg.maxDim) {
            const r = cfg.maxDim / Math.max(w, h);
            w = Math.round(w * r);
            h = Math.round(h * r);
        }
        // 캔버스 인코딩 — quality 인자 가변
        // iOS Safari·모바일은 canvas 크기 한도(보통 16MP). 너무 크면 단계적 축소 재시도.
        const tryEncode = (cw, ch, q) => {
            const canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = ch;
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            let fmt = checkWebPSupport() ? cfg.preferFormat : cfg.fallbackFormat;
            let out = '';
            try { out = canvas.toDataURL(fmt, q); } catch { out = ''; }
            if (!isValidDataUrl(out) || !out.startsWith('data:' + fmt)) {
                fmt = cfg.fallbackFormat;
                try { out = canvas.toDataURL(fmt, q); } catch { out = ''; }
            }
            return { out, fmt };
        };

        // 적응 압축 루프
        //   1) 초기 시도: maxDim · 시작 quality
        //   2) 목표 초과 시 quality 단계 하강 (minQuality 까지)
        //   3) quality 하한 도달해도 큰 경우 dim 0.85x 축소 + quality 0.55 로 리셋 후 반복
        //   4) attempts/하한선 도달하면 그때까지 최선의 결과 사용
        const TARGET = cfg.targetBytes;
        const HARD_MAX = 3 * 1024 * 1024;  // API 한도 4MB · 절대 한도
        let q = cfg.quality;
        let result = tryEncode(w, h, q);
        let bestResult = result;
        let bestSize = isValidDataUrl(result.out) ? dataUrlBytes(result.out) : Infinity;
        let attempts = 1;

        while (
            attempts < cfg.maxAttempts
            && (!isValidDataUrl(result.out) || bestSize > TARGET)
        ) {
            // 안전 — 절대 한도 초과면 무조건 dim 축소
            const exceedsHard = isValidDataUrl(result.out) && dataUrlBytes(result.out) > HARD_MAX;

            if (q > cfg.minQuality && !exceedsHard) {
                // Phase 1: quality 단계 하강
                q = Math.max(cfg.minQuality, q - cfg.qualityStep);
            } else if (Math.min(w, h) > cfg.minDim) {
                // Phase 2: dim 축소 + quality 약간 회복 (저화질 + 저해상 동시 효과)
                w = Math.max(cfg.minDim, Math.round(w * cfg.dimStep));
                h = Math.max(cfg.minDim, Math.round(h * cfg.dimStep));
                q = Math.min(cfg.quality - 0.05, 0.55);  // 새 해상도에서 살짝 보수적으로
            } else {
                break;  // 더 줄일 곳 없음
            }

            result = tryEncode(w, h, q);
            if (isValidDataUrl(result.out)) {
                const size = dataUrlBytes(result.out);
                if (size < bestSize) { bestResult = result; bestSize = size; }
            }
            attempts++;
        }

        result = bestResult;
        let out = result.out;
        let format = result.fmt;
        // canvas 완전 실패 시 원본 dataURL 그대로 사용 (이미 표준 형식)
        if (!isValidDataUrl(out)) {
            if (isValidDataUrl(src)) {
                out = src;
                format = file.type || 'image/png';
            } else {
                throw new Error('이미지 인코딩 실패 — 더 작은 이미지로 다시 시도하세요.');
            }
        }
        let outSize = dataUrlBytes(out);
        // 안전망: 압축이 더 크면 원본 유지 (단 원본이 유효한 dataURL 일 때만)
        if (outSize >= originalSize && isValidDataUrl(src)) {
            out = src;
            outSize = dataUrlBytes(src);
            format = file.type || format;
        }
        return { dataUrl: out, originalSize, compressedSize: outSize, format, skipped: false };
    }

    // 관리자 모드면 압축 결과를 /api/upload-image 로 보내 Blob URL 받기
    // 시크릿 없거나 호출 실패 시 dataURL 폴백 (이 기기에서만 보임)
    let warnedNoSecret = false;
    function formatUploadError(e, dataUrl) {
        const status = e?.status;
        const d = e?.detail || {};
        // 클라이언트 측 dataUrl 진단 정보
        const preview = (dataUrl || '').slice(0, 80);
        const len = (dataUrl || '').length;
        let title, body;
        if (status === 401) {
            title = '🔒 시크릿 인증 실패';
            body = '입력한 ADMIN_API_SECRET 값이 Vercel 환경변수와 다릅니다.\nadmin.html → 🔑 서버 동기화 설정 → 시크릿 다시 입력하세요.';
        } else if (status === 413) {
            title = '📦 이미지 용량 초과';
            body = '이미지가 너무 큽니다 (' + (d.size || 'N/A') + ' bytes). 더 작은 해상도로 다시 시도하세요.';
        } else if (status === 415) {
            title = '🖼 지원 안 되는 형식';
            body = '선언 MIME: ' + (d.declared || '?') + '\n감지 MIME: ' + (d.detected || '?')
                + '\n허용: jpeg/png/gif/webp/svg\n첫 바이트: ' + (d.firstBytes || '?');
        } else if (status === 400) {
            title = '🪨 dataURL 형식 문제';
            body = '서버: ' + (d.error || '?') + '\n힌트: ' + (d.hint || d.reason || '-')
                + '\n받은 길이: ' + (d.length || len)
                + '\n받은 시작: ' + (d.preview || preview)
                + '\n클라이언트 길이: ' + len
                + '\n클라이언트 시작: ' + preview;
        } else if (status === 410) {
            title = '🚫 이미지 업로드 비활성';
            body = '이미지 업로드 기능이 일시 중단됨. 텍스트 카드만 저장 가능.';
        } else if (status === 503) {
            title = '⚙ R2 미설정';
            body = '이미지 저장소 환경변수 미설정.\nmissing: ' + ((d.missing || []).join(', ') || '?')
                + '\n관리자: Vercel 환경변수 추가 후 재배포 필요.';
        } else {
            title = '☁ 서버 에러 ' + (status || '?');
            body = JSON.stringify(d).slice(0, 300);
        }
        return title + '\n\n' + body;
    }

    async function tryRemoteUpload(dataUrl) {
        try {
            const isAdmin = !!(window.ITPEAuth && window.ITPEAuth.isAdmin && window.ITPEAuth.isAdmin());
            if (!isAdmin) return null;
            // 클라이언트 측 표준 dataURL 사전 검증 — 비표준이면 미리 차단
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:') || !dataUrl.includes(',')) {
                alert('내부 오류 — 이미지가 표준 dataURL 형식이 아닙니다.\n시작: ' + (dataUrl||'').slice(0, 80) + '\n길이: ' + (dataUrl||'').length);
                return null;
            }
            const r = await window.ITPEAdmin.uploadImage(dataUrl);
            // R2 (pub-*.r2.dev / 커스텀 도메인) · 또는 그 외 https 이미지 URL 도 수용
            if (r && r.url && /^https:\/\/[^\s]+\.(webp|jpe?g|png|gif|svg)(\?[^\s]*)?$/i.test(r.url)) {
                return r.url;
            }
            return null;
        } catch (e) {
            alert(formatUploadError(e, dataUrl));
            return null;
        }
    }

    window.ImageStore = {
        // file → 저장된 이미지 식별자 (Blob URL 또는 dataURL)
        async save(file, opts) {
            const r = await compressFile(file, opts);
            const url = await tryRemoteUpload(r.dataUrl);
            return url || r.dataUrl;
        },
        // file → 상세 압축 결과 + 가능하면 원격 URL
        async saveWithStats(file, opts) {
            const r = await compressFile(file, opts);
            const url = await tryRemoteUpload(r.dataUrl);
            return { ...r, dataUrl: url || r.dataUrl, remote: !!url };
        },
        fmtBytes,
        defaults: { ...DEFAULTS },
    };
})();
