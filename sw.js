// 개발/배포 모두 친화: 네트워크 우선, 실패 시 캐시 폴백.
// 새 코드 배포 시 사용자가 두 번 새로고침 없이도 즉시 반영되도록.
const CACHE = 'itpe-flash-v105';
const APP_SHELL = [
    './',
    './index.html',
    './flash.html',
    './login.html',
    './admin.html',
    './css/style.css',
    './js/app.js',
    './js/flash.js',
    './js/auth.js',
    './js/admin-auth.js',
    './js/image-store.js',
    './js/admin.js',
    './manifest.json',
    './icons/icon.svg',
    './icons/icon-192.svg',
    './icons/icon-512.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon-180.png',
    './icons/fire.svg',
    './data/index.json',
    './data/users.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // 동일 출처가 아닌 요청·http(s) 가 아닌 요청은 그대로 통과 (SW 개입 안 함)
    if (url.origin !== location.origin) return;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    // users.json·data·api 는 캐시하지 않음 — 인증/카드 데이터의 신선도 우선
    const isFreshData = url.pathname.endsWith('/users.json')
        || url.pathname.startsWith('/data/')
        || url.pathname.startsWith('/api/');

    event.respondWith(
        fetch(req).then((res) => {
            if (res.ok && !isFreshData) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
        }).catch(async () => {
            const cached = await caches.match(req);
            return cached || new Response('offline', { status: 503, statusText: 'offline', headers: { 'Content-Type': 'text/plain' } });
        })
    );
});
