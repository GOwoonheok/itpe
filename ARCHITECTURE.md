# ARCHITECTURE.md — ITPE Flash 시스템 구조

## 전체 그림

```
[브라우저 PWA]                          [Vercel]                       [영속 저장소]
index/flash/print/admin.html   →   정적 파일 서빙                 data/*.json (Git 자체가 DB)
바닐라 JS (클래식 스크립트)     →   api/* Functions 14개    →     GitHub Contents API (쓰기=커밋)
sw.js 오프라인 캐시                  AI 채우기 (Gemini)             Cloudflare R2 (이미지·체크상태)
```

- **읽기**: `data/cards/*.json` 등을 정적 파일로 직접 로드 — API 호출 없음, 빠름.
- **쓰기**: 관리자 저장 → 백엔드가 GitHub 에 커밋 → Vercel 자동 재배포 → 30초~1분 후 반영.
- **백업·롤백**: git 이력이 곧 백업. `git revert <sha>` 후 푸시로 복구.
- 상세 운영 가이드: [MIGRATION.md](MIGRATION.md)

## 페이지 ↔ 스크립트 지도

| 페이지 | 스크립트 | 역할 |
|---|---|---|
| `index.html` | `js/app.js` | 단원(1~11) 목록 홈. 전체 카드 검색 모달, PDF 출력 모달 |
| `flash.html` | `js/flash.js` (≈2,600줄) | 학습 화면 전부 — 아래 'flash.js 내부 지도' 참조 |
| `print.html` | `js/print.js` + `css/print.css` | A4 좌·우 2단 인쇄 (Paged.js 자체 호스팅: `js/vendor/`) |
| `admin.html` | `js/admin.js` (≈1,860줄) | 관리자 — 카드 편집, 엑셀 업로드, 사용자 화이트리스트 |
| `login.html` / `reset.html` | `js/auth.js`, `js/admin-auth.js` | 인증. 세부는 [SECURITY.md](SECURITY.md) |
| 전 페이지 | `js/orientation.js`, `js/image-store.js` | 회전 제어(태블릿 자동/폰 세로), 로컬 이미지 저장 |

## flash.js 내부 지도 (단일 파일 — 수정 시 영역 확인)

| 영역 | 핵심 함수 | 설명 |
|---|---|---|
| 초기화·상태 | `state`, `buildCards()`, `rebuildOrder()` | `state.cards`(전체) / `state.order`(출제 순서 인덱스) / `state.idx`(현재 위치) |
| 모드 선택 | `showModeSelect()`, `.mode-option` 클릭 | 첫 화면. 랜덤/순서/AI만/체크만 |
| 학습 화면 | `showStudy()`, `render()`, `currentCard()` | `render()` 는 내용만 채움 — 화면 전환은 `showStudy()` 가 담당 |
| 카드 식별 | `cardKey(c)` | `u:`+userId 또는 `j:`+topic 앞 60자. 체크상태의 키 |
| 찾기 모달 | `openFindModal()`, `renderFindList()`, `jumpToCardIdx()` | 입력 즉시 검색. 관리자는 ▲▼/드래그 순서변경 + ↗단원이동 |
| 숨김/Enter | 숨김 섹션 Enter 단계별 노출 | Enter: 공개 → 다음 카드 |
| TTS·타이머 | `ttsToast()`, timer popover | 음성 읽기, 자동 넘김 |
| 카드 CRUD | add/edit 모달, `pushToServerIfAdmin()` | 관리자 저장 시 서버(GitHub 커밋) 동기화 |
| 동기화 | `syncCheckedFromServer()` | 체크상태 계정별 R2 저장 — 기기 간 동기화 |

## API 지도 (`api/`)

| 엔드포인트 | 역할 | 공통 모듈 |
|---|---|---|
| `cards.js` / `units.js` | 카드·단원 CRUD — 쓰기는 GitHub 커밋 | `_github.js` |
| `login.js` / `logout.js` / `users.js` | 화이트리스트 인증, HMAC 세션 쿠키 | `_auth.js` |
| `ai-fill.js` / `ai-prompt.js` | Gemini 카드 자동 생성, 프롬프트 편집 저장 | AI SDK |
| `upload-image.js` / `delete-images.js` / `cleanup-orphans.js` | 이미지 R2 업로드·정리 | `_r2.js` (aws4fetch) |
| `user-state.js` | 계정별 체크상태 저장 (R2) | `_r2.js` |

`_` 접두 파일은 엔드포인트가 아닌 공유 모듈 (Vercel 이 라우팅하지 않음).

## 환경변수

[MIGRATION.md](MIGRATION.md) 의 표 참조. 핵심: `GITHUB_TOKEN/OWNER/REPO/BRANCH`(저장),
`ADMIN_SESSION_SECRET`(로그인), `GEMINI_API_KEY`(AI, 선택), R2 자격증명(이미지).

## 데이터 형식 (`data/cards/*.json`)

최상위 배열. 카드 필드: `category, topic, definition, mnemonic, keyword, extra,
images[], references[], userId, createdAt, source('ai'), aiGeneratedAt`
— 레거시 호환: `q`(=topic), `a`(=definition).
무결성 규칙은 `scripts/check.mjs` 가 단일 기준 (앱의 실사용 방식 기반).

## 검증 하네스

```
편집 직후   .claude 훅 → node --check / JSON 파싱     (자동, ms)
커밋 전     npm run check  — 구문 + 데이터 무결성      (수 초)
푸시 후     GitHub Actions CI — check + test           (무료)
```
