// /api/upload-image
//   POST  body: { dataUrl: "data:image/webp;base64,..." }
//   → 410 Gone (현재 비활성화)
//
// 이미지 업로드는 향후 Cloudflare R2 또는 다른 무료 저장소로 재구현 예정.
// Vercel Blob 의존성을 제거하면서 잠정 차단.

import { verifyAdminRequest } from './_auth.js';

export const config = {
    api: {
        bodyParser: { sizeLimit: '6mb' },
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method not allowed' });
    }
    // 인증은 그대로 검증 (정보 노출 방지)
    const auth = await verifyAdminRequest(req);
    if (!auth.ok) return res.status(401).json({ error: 'unauthorized', reason: auth.reason });

    return res.status(410).json({
        error: 'image upload disabled',
        reason: 'storage-migration',
        hint: '이미지 업로드 기능은 점검 중입니다. 텍스트 카드만 사용해 주세요.',
    });
}
