// 관리자 인증 — HttpOnly SameSite=Strict 서명 쿠키 기반.
// 클라이언트는 시크릿을 보유하지 않음. 서버가 로그인 시 쿠키만 발급.
//
// 쿠키 포맷: v1.<email-base64url>.<expiry-ms>.<hmac-hex>
//   hmac = HMAC-SHA256(SECRET, 'v1.' + email-base64url + '.' + expiry-ms)
//
// CSRF 방지: SameSite=Strict + Origin 헤더 검증
//
// 사용자 화이트리스트는 번들 data/users.json 에서 읽음.
// 저장은 /api/users 가 GitHub commit 으로 수행 → 재배포 후 새 콜드스타트가 새 값 로드.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const COOKIE_NAME = 'itpe_admin';
const COOKIE_VERSION = 'v1';
const MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30일

// 번들 users.json 을 1회 로드 (Function 콜드스타트 시).
// 저장(/api/users PUT) 은 GitHub commit → 재배포 → 새 콜드스타트가 새 값 자동 반영.
let USERS = { registeredEmails: ['whko337@gmail.com'], admins: ['whko337@gmail.com'] };
try {
    const u = JSON.parse(readFileSync(join(process.cwd(), 'data', 'users.json'), 'utf8'));
    if (u && typeof u === 'object') USERS = u;
} catch {}

function normalize(e) { return String(e || '').toLowerCase().trim(); }
function isValidEmail(e) {
    return typeof e === 'string' && /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(e);
}

export async function isAdminEmail(email) {
    const n = normalize(email);
    if (!isValidEmail(n)) return false;
    const list = Array.isArray(USERS.admins) ? USERS.admins.map(normalize) : [];
    return list.includes(n);
}
export async function isRegisteredEmail(email) {
    const n = normalize(email);
    if (!isValidEmail(n)) return false;
    const list = Array.isArray(USERS.registeredEmails) ? USERS.registeredEmails.map(normalize) : [];
    return list.includes(n);
}
// 호환 stub — 옛 인터페이스 유지 (Blob 캐시 무효화 호출처에서 사용)
export function invalidateUserCache() {}

// 현재 콜드스타트에서 알고 있는 사용자 목록을 반환 (다른 핸들러에서 활용)
export function getKnownUsers() { return USERS; }

function getSecret() {
    return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_API_SECRET || '';
}

function b64urlEncode(s) {
    return Buffer.from(String(s), 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
    try {
        const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
        return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
    } catch { return ''; }
}

function sign(payload) {
    const secret = getSecret();
    if (!secret) throw new Error('server secret not configured');
    return createHmac('sha256', secret).update(payload).digest('hex');
}

export function buildCookieValue(email) {
    const e = b64urlEncode(String(email).toLowerCase().trim());
    const exp = String(Date.now() + MAX_AGE_SEC * 1000);
    const payload = COOKIE_VERSION + '.' + e + '.' + exp;
    const sig = sign(payload);
    return payload + '.' + sig;
}

export function setAdminCookie(res, email) {
    const value = buildCookieValue(email);
    const cookie = [
        COOKIE_NAME + '=' + value,
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Path=/',
        'Max-Age=' + MAX_AGE_SEC,
    ].join('; ');
    res.setHeader('Set-Cookie', cookie);
}

export function clearAdminCookie(res) {
    const cookie = [
        COOKIE_NAME + '=',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Path=/',
        'Max-Age=0',
    ].join('; ');
    res.setHeader('Set-Cookie', cookie);
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    String(header).split(/;\s*/).forEach((p) => {
        const i = p.indexOf('=');
        if (i <= 0) return;
        const k = p.slice(0, i).trim();
        const v = p.slice(i + 1).trim();
        if (k) out[k] = v;
    });
    return out;
}

function constantTimeEqHex(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    try {
        return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch { return false; }
}

async function verifyCookieValue(value) {
    if (typeof value !== 'string' || value.length < 20) return null;
    const parts = value.split('.');
    if (parts.length !== 4) return null;
    const [ver, emailB64, expStr, sig] = parts;
    if (ver !== COOKIE_VERSION) return null;
    const payload = ver + '.' + emailB64 + '.' + expStr;
    let expected;
    try { expected = sign(payload); } catch { return null; }
    if (!constantTimeEqHex(sig, expected)) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Date.now()) return null;
    const email = b64urlDecode(emailB64);
    if (!(await isAdminEmail(email))) return null;
    return { email, exp };
}

// 보호된 메서드 (POST/PUT/PATCH/DELETE) 에서 호출.
// 1) Origin/Referer 가 같은 호스트인지 확인 (CSRF)
// 2) 쿠키 서명 검증 + 만료 확인 + 화이트리스트 확인
export async function verifyAdminRequest(req) {
    const method = String(req.method || '').toUpperCase();
    const isWrite = (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE');
    if (isWrite) {
        const origin = req.headers.origin || '';
        const referer = req.headers.referer || '';
        const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
        const allowed = host && (
            origin.toLowerCase().endsWith('//' + host) ||
            origin.toLowerCase().endsWith('//' + host.split(':')[0]) ||
            referer.toLowerCase().includes('//' + host) ||
            origin === '' && referer === ''
        );
        if (!allowed && origin) {
            return { ok: false, reason: 'cross-origin', origin, host };
        }
    }
    const cookies = parseCookies(req.headers.cookie || '');
    const cv = cookies[COOKIE_NAME];
    const session = cv ? await verifyCookieValue(cv) : null;
    if (!session) return { ok: false, reason: 'no-session' };
    return { ok: true, email: session.email, exp: session.exp };
}

// 등록 사용자(관리자 포함) 누구나 — 쿠키 서명·만료·등록여부 확인. {email}|null.
async function verifyCookieAnyUser(value) {
    if (typeof value !== 'string' || value.length < 20) return null;
    const parts = value.split('.');
    if (parts.length !== 4) return null;
    const [ver, emailB64, expStr, sig] = parts;
    if (ver !== COOKIE_VERSION) return null;
    const payload = ver + '.' + emailB64 + '.' + expStr;
    let expected;
    try { expected = sign(payload); } catch { return null; }
    if (!constantTimeEqHex(sig, expected)) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Date.now()) return null;
    const email = b64urlDecode(emailB64);
    if (!(await isRegisteredEmail(email))) return null;
    return { email, exp };
}

// 사용자 단위 인증(관리자 아니어도 OK) — 사용자별 상태 저장 등에 사용.
// 관리자 전용 작업에는 절대 사용 금지(그건 verifyAdminRequest).
export async function verifyUserRequest(req) {
    const method = String(req.method || '').toUpperCase();
    const isWrite = (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE');
    if (isWrite) {
        const origin = req.headers.origin || '';
        const referer = req.headers.referer || '';
        const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
        const allowed = host && (
            origin.toLowerCase().endsWith('//' + host) ||
            origin.toLowerCase().endsWith('//' + host.split(':')[0]) ||
            referer.toLowerCase().includes('//' + host) ||
            (origin === '' && referer === '')
        );
        if (!allowed && origin) return { ok: false, reason: 'cross-origin' };
    }
    const cookies = parseCookies(req.headers.cookie || '');
    const cv = cookies[COOKIE_NAME];
    const session = cv ? await verifyCookieAnyUser(cv) : null;
    if (!session) return { ok: false, reason: 'no-session' };
    const admin = await isAdminEmail(session.email);
    return { ok: true, email: session.email, isAdmin: admin };
}

// 모든 등록 사용자에게 동일 서명 쿠키 발급 (관리자 여부는 검증 시점에 화이트리스트로 판별)
export function setUserCookie(res, email) { return setAdminCookie(res, email); }
