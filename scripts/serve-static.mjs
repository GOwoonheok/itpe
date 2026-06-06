// E2E 용 제로 의존성 정적 서버 — 운영 코드 아님(테스트 하네스 전용).
// /api/* 는 404 JSON 을 반환 → 프런트가 번들 데이터(data/*.json) 폴백으로 동작.
// 사용: node scripts/serve-static.mjs  (PORT 환경변수, 기본 4173)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        let pathname = decodeURIComponent(url.pathname);

        // API 는 정적 서버에 없음 — 404 (프런트 폴백 경로 활성화)
        if (pathname.startsWith('/api/')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'static server — no api' }));
            return;
        }

        if (pathname === '/') pathname = '/index.html';
        // 경로 탈출 방지
        const filePath = join(ROOT, normalize(pathname).replace(/^([.][.][\\/])+/, ''));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

        const st = await stat(filePath).catch(() => null);
        if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }

        const body = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(body);
    } catch (e) {
        res.writeHead(500);
        res.end(String(e?.message || e));
    }
});

server.listen(PORT, () => {
    console.log(`static server ready http://localhost:${PORT}`);
});
