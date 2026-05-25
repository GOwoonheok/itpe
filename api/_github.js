// GitHub Contents API 헬퍼 — Vercel Blob 대체 저장소.
//   - 환경변수: GITHUB_TOKEN (fine-grained PAT, Contents: read+write),
//               GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH (기본 'main')
//   - 저장 = 단일 파일 커밋. 커밋 → Vercel 자동 재배포 → 약 30초~1분 후 반영.
//   - 미설정 시 isConfigured() === false, commitJson()/commitText()/deletePath() 가 NOT_CONFIGURED 에러를 throw.

const GH_API = 'https://api.github.com';
const TOKEN  = process.env.GITHUB_TOKEN  || '';
const OWNER  = process.env.GITHUB_OWNER  || '';
const REPO   = process.env.GITHUB_REPO   || '';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

export function isConfigured() {
    return !!(TOKEN && OWNER && REPO);
}

export class GitHubNotConfiguredError extends Error {
    constructor() {
        super('GitHub storage not configured (set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO)');
        this.code = 'GH_NOT_CONFIGURED';
    }
}

function encodePath(path) {
    // 슬래시는 보존, 각 세그먼트만 인코딩
    return String(path).split('/').map(encodeURIComponent).join('/');
}

async function ghFetch(urlPath, init) {
    return fetch(GH_API + urlPath, {
        ...init,
        headers: {
            'Authorization': 'Bearer ' + TOKEN,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'itpe-flash',
            ...(init?.headers || {}),
        },
    });
}

// 현재 파일의 sha 가져옴 (없으면 null)
async function getCurrentSha(path) {
    const r = await ghFetch(
        `/repos/${OWNER}/${REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(BRANCH)}`,
        { cache: 'no-store' }
    );
    if (r.status === 404) return null;
    if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`github get sha failed: ${r.status} ${text}`);
    }
    const j = await r.json();
    // 디렉터리면 배열, 파일이면 객체 — 파일만 처리
    if (Array.isArray(j)) throw new Error(`path is a directory: ${path}`);
    return j.sha || null;
}

async function putFile(path, contentBytes, message) {
    if (!isConfigured()) throw new GitHubNotConfiguredError();
    const sha = await getCurrentSha(path);
    const b64 = Buffer.from(contentBytes).toString('base64');
    const body = {
        message: message || `chore(data): update ${path}`,
        content: b64,
        branch: BRANCH,
    };
    if (sha) body.sha = sha;
    const r = await ghFetch(`/repos/${OWNER}/${REPO}/contents/${encodePath(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`github put failed: ${r.status} ${text}`);
    }
    const j = await r.json();
    return {
        sha: j?.content?.sha || null,
        commit: j?.commit?.sha || null,
        path: j?.content?.path || path,
    };
}

export async function commitJson(path, data, message) {
    const text = JSON.stringify(data, null, 2) + '\n';
    return putFile(path, Buffer.from(text, 'utf8'), message);
}

export async function commitText(path, text, message) {
    return putFile(path, Buffer.from(String(text), 'utf8'), message);
}

export async function deletePath(path, message) {
    if (!isConfigured()) throw new GitHubNotConfiguredError();
    const sha = await getCurrentSha(path);
    if (!sha) return { deleted: false, reason: 'not-found' };
    const r = await ghFetch(`/repos/${OWNER}/${REPO}/contents/${encodePath(path)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: message || `chore(data): delete ${path}`,
            sha,
            branch: BRANCH,
        }),
    });
    if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`github delete failed: ${r.status} ${text}`);
    }
    return { deleted: true };
}

// 표준화된 503 응답 헬퍼 — 핸들러에서 사용
export function notConfiguredResponse(res) {
    return res.status(503).json({
        error: 'storage not configured',
        hint: 'GitHub 환경변수를 설정한 뒤 재배포가 필요합니다 (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO).',
    });
}
