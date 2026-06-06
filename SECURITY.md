# SECURITY.md — ITPE Flash 보안 규칙

## 인증 모델

- **화이트리스트**: `data/users.json` 에 등록된 이메일만 로그인 가능. 관리자 플래그 별도.
- **세션**: `ADMIN_SESSION_SECRET` 로 HMAC 서명한 쿠키 (`api/_auth.js`).
  시크릿 미설정 시 로그인 자체가 불가(500) — 로컬 `vercel dev` 는 셸 환경변수로 직접 주입.
- **관리자 쓰기**: 관리자 + 시크릿 검증을 통과해야 GitHub 커밋·R2 쓰기 가능.
  클라이언트의 `isAdmin` 표시는 UI 용일 뿐 — **권한 검사는 항상 서버(API)에서**.

## 코드 규칙 (위반 금지)

1. **사용자/카드 데이터를 innerHTML 에 넣지 않는다** — DOM 노드 조립
   (`createElement` + `textContent`) 사용. 기존 패턴: `highlightNodes()` (flash.js).
2. **새 외부 출처(스크립트·스타일·API) 추가 시 CSP 검토 필수** — `vercel.json` 의
   Content-Security-Policy 에 등록되지 않은 출처는 차단된다. 기본 방침은 자체 호스팅
   (예: Paged.js 를 `js/vendor/` 로 자체 호스팅).
3. **비밀정보를 `data/` 와 클라이언트 코드에 넣지 않는다** — repo 가 private 이어도
   PAT 으로 우회 가능. 토큰·키는 Vercel 환경변수에만.
4. **API 입력은 신뢰하지 않는다** — 경로·파일명 파라미터는 화이트리스트 검증
   (단원 id 등), 크기 제한 유지.

## 보안 헤더 (`vercel.json` — 변경 시 신중)

- CSP: `default-src 'self'` + cdn.jsdelivr.net(스크립트·폰트) + hangeul.pstatic.net(폰트),
  `img-src https:` (R2 이미지), `frame-ancestors 'none'`, `upgrade-insecure-requests`
- HSTS(preload), X-Frame-Options DENY, nosniff, COOP/CORP same-origin
- `sw.js` 는 no-store (서비스워커 즉시 갱신 보장)

## 환경변수 취급

| 변수 | 민감도 | 비고 |
|---|---|---|
| `GITHUB_TOKEN` | 높음 | fine-grained PAT, 이 repo Contents R/W 만. 만료 6~12개월 — 만료 시 저장 기능 503 |
| `ADMIN_SESSION_SECRET` | 높음 | 유출 시 세션 위조 가능 → 즉시 교체(전 세션 무효화됨) |
| `GEMINI_API_KEY` | 중간 | 무료 한도 — 유출 시 한도 소진 피해 |
| R2 자격증명 | 중간 | 이미지 버킷 한정 |

## 사고 대응

- 잘못된 데이터 커밋: `git revert <sha>` → 푸시 → 자동 재배포 복구 (MIGRATION.md 참조)
- 토큰 유출 의심: GitHub PAT 폐기·재발급 → Vercel 환경변수 교체 → 재배포
- 의심 로그인: `data/users.json` 화이트리스트에서 제거 후 시크릿 교체
