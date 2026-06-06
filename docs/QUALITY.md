# QUALITY.md — 품질 기준표 및 평가 기록

## 품질 기준 (Definition of Done)

모든 코드 변경은 아래를 만족해야 "완료"로 선언한다.

| # | 기준 | 확인 방법 |
|---|---|---|
| 1 | 기존 동작 보존 — 요청되지 않은 동작 변경 없음 | diff 리뷰, 영향 범위 명시 |
| 2 | `npm run check` 통과 (구문 + 데이터 무결성) | 출력 제시 |
| 3 | `npm test` 통과 | 출력 제시 |
| 4 | UI 변경 시 화면 증거 제시 | 스크린샷 (Playwright 도입 후 자동화) |
| 5 | 커밋 컨벤션 준수 + 관련 파일만 커밋 | `git show --stat` |
| 6 | 보안 규칙 위반 없음 (innerHTML·CSP·비밀정보) | SECURITY.md 체크 |
| 7 | 규모 있는 작업은 exec-plan 기록 | `docs/exec-plans/` |

## 평가 기록

### 2026-06-06 — 기준선(Baseline) 평가

| 영역 | 점수(5) | 근거 |
|---|---|---|
| 기능 완성도 | 5 | 학습·검색·인쇄·동기화·AI생성 — 사용자가 최적화 완료 선언 |
| 성능 | 4 | 정적 읽기·외부 호출 없음. 쓰기 반영 30초~1분 지연(수용됨) |
| 보안 | 4 | CSP·HMAC 세션·XSS 의식 패턴. 자동 보안 검사는 부재 |
| 테스트 | 2→3 | 0개 → check.mjs + 데이터·구문 테스트 도입 (E2E 미도입) |
| 문서화 | 1→4 | MIGRATION.md 만 → AGENTS/ARCHITECTURE/SECURITY/docs 체계 구축 |
| 구조 | 3 | flash.js 2,636줄·admin.js 1,860줄 비대 — 분할은 P5 과제 |
| 자동화 | 1→4 | 없음 → 훅 + npm scripts + CI 도입 |

차기 목표: 테스트 4 (Playwright 3흐름 + 스크린샷), 구조 4 (flash.js 모듈 분할).
