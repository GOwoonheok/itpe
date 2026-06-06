# AGENTS.md — ITPE Flash 에이전트 작업 규칙

정보관리기술사 플래시카드 학습 PWA. 바닐라 JS(빌드 없음) + Vercel Functions.
구조는 [ARCHITECTURE.md](ARCHITECTURE.md), 보안 규칙은 [SECURITY.md](SECURITY.md) 참조.

## 절대 규칙

1. **동작 임의 변경 금지** — 현재 기능·UX는 사용자가 최적화 완료한 상태.
   사용자가 명시적으로 요청하지 않은 동작 변경·기능 제거를 하지 않는다.
   성능·구조 개선은 동작 동일성을 검증한 후에만 적용.
2. **커밋 전 검증 필수** — `npm run check` (JS 구문 + 데이터 무결성) 통과 후 커밋.
   "고쳤다"는 주장 대신 **검증 출력·테스트 통과·스크린샷** 등 증거를 제시한다.
3. **배포 = main 푸시** — Vercel이 main 을 자동 배포한다. 별도 deploy 명령 없음.
4. **푸시 전 fetch/rebase 필수** — 관리자 도구가 GitHub Contents API 로
   데이터 커밋(`chore(...)`)을 수시로 main 에 올린다. 로컬이 뒤처져 있을 수 있음.
5. **관련 파일만 커밋** — 워킹트리에 관리도구발 `data/cards/*.json` 변경이
   섞여 있는 경우가 많다. 작업한 파일만 골라서 `git add` 한다.
6. **빌드 도구·프레임워크·유료 인프라 도입 금지** — 무빌드·0원 운영이 설계 제약.

## 명령어

| 명령 | 용도 |
|---|---|
| `npm run check` | JS 구문 + 데이터 무결성 통합 검증 (커밋 전 필수, 수 초) |
| `npm test` | node:test — 데이터·구문 테스트 |
| `npm run test:e2e` | Playwright E2E — 핵심 3흐름 + 스크린샷(`test-results/screens/`). UI 변경 시 필수, 스크린샷을 증빙으로 제시 |
| `vercel dev` | 로컬 실행 — 단, `ADMIN_SESSION_SECRET` 를 셸 환경변수로 직접 주입해야 로그인 가능 (`.env.local` 무시됨) |

## 함정 (반복 실수 방지)

- **한글 파일을 PowerShell 로 읽으면 깨진다** (CP949 콘솔) — 반드시 Read 도구 사용.
  파일 자체는 정상 UTF-8 이다.
- `data/cards/*.json` 쓰기는 운영 중 관리도구가 GitHub API 커밋으로 수행 —
  로컬에서 데이터 파일을 직접 수정하는 작업은 사용자 확인 후에만.
- `js/*.js` 는 클래식 스크립트(`<script src>`)다 — ESM import/export 를 넣지 말 것.
- 카드 식별: `cardKey()` = `u:`+userId (사용자 카드) / `j:`+topic 앞 60자 (JSON 카드).
  토픽 변경은 체크상태 키를 바꾼다 — 주의.

## 커밋 컨벤션

`feat|fix|style|refactor|chore(범위): 한국어 요약 — 상세는 — 뒤에`
예) `fix(flash): 모드 선택 화면에서 찾기로 카드 선택 시 바로 해당 카드 표시`

## 문서 체계

| 위치 | 내용 |
|---|---|
| `docs/product-specs/` | 기능 명세 (기능별 1문서) |
| `docs/exec-plans/` | 작업 계획서 — 작업 전 계획, 완료 후 결과 추기 |
| `docs/references/` | 외부 서비스 설정·참조 (Vercel, R2, Gemini, 환경변수) |
| `docs/reports/` | 평가·회고 보고서 |
| `docs/QUALITY.md` | 품질 기준표 + 평가 기록 |
| `MIGRATION.md` | 데이터 저장 모델(GitHub-as-DB) 운영 가이드 |

## 검증 하네스 (자동)

- **PostToolUse 훅**: `.js/.mjs` 수정 시 자동 `node --check`, `data/*.json` 수정 시 JSON 파싱 검사 — 실패하면 즉시 피드백됨.
- **CI**: main 푸시마다 `.github/workflows/ci.yml` 이 check + test 실행.
- 규모 있는 작업은 시작 전 `docs/exec-plans/YYYY-MM-DD-주제.md` 에 계획을 쓰고, 완료 후 결과를 추기한다.
