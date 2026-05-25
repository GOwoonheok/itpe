# Vercel Blob → GitHub commits 마이그레이션 가이드

이 프로젝트는 모든 영속 데이터(카드, 단원, 화이트리스트, AI 프롬프트) 를 **번들 파일** + **GitHub commits** 로 운영합니다. Vercel Blob 의존성과 비용은 없습니다.

## 동작 모델

- **읽기**: `data/cards/*.json`, `data/index.json`, `data/users.json`, `data/ai-prompts/*.txt` 를 콜드 스타트 시 파일 시스템에서 직접 로드. API 응답 시 Blob/외부 호출 없음.
- **쓰기**: 관리자가 저장하면 백엔드가 **GitHub Contents API** 로 해당 파일을 커밋. Vercel 이 그 커밋을 감지해 자동 재배포. 약 30초~1분 후 새 콜드 스타트에서 새 데이터가 반영됨.
- **이미지**: 현재 비활성 (410). 나중에 Cloudflare R2 등으로 별도 추가.

## 환경변수 (Vercel 프로젝트 Settings → Environment Variables)

| Name | 필수 | 값 |
| ---- | ---- | -- |
| `GITHUB_TOKEN` | ✅ | GitHub **fine-grained Personal Access Token**. Repository access: 이 repo. Permissions: **Contents: Read and write**. |
| `GITHUB_OWNER` | ✅ | 예) `whko337` |
| `GITHUB_REPO`  | ✅ | 예) `itpe` |
| `GITHUB_BRANCH`| 권장 | 기본 `main`. 다른 브랜치를 운영 브랜치로 쓰면 그 이름. |
| `ADMIN_SESSION_SECRET` | ✅ | HMAC 쿠키 서명 시크릿 (랜덤 64자 권장). 미설정이면 로그인 불가. |
| `GEMINI_API_KEY` 또는 `OPENAI_API_KEY` | 선택 | AI 카드 자동 채우기용 (없어도 앱 작동). |

위 4개 GitHub 변수가 모두 설정되어야 저장 기능이 활성화됩니다. 미설정 시 PUT 요청은 503 `storage not configured` 응답을 반환하고, 사용자에게 안내됩니다.

## 셋업 절차

### 1) GitHub repo 준비
```bash
# 현재 디렉터리에서
cd C:\01vive\itpe
git init -b main
git add .
git commit -m "init: ITPE Flash"
# 빈 GitHub repo (private 권장) 를 먼저 웹에서 생성 후
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

### 2) Vercel ↔ GitHub 연결
- Vercel 대시보드 → 이 프로젝트(itpe) → Settings → Git
- "Connect Git Repository" → 위에서 만든 repo 선택
- Production branch: `main` (또는 운영 브랜치)

### 3) Fine-grained PAT 발급
- https://github.com/settings/personal-access-tokens/new
- Resource owner: 본인 또는 organization
- Repository access: **Only select repositories** → 위 repo 만 선택
- Permissions → **Repository permissions** → **Contents: Read and write**
- (이외 권한은 모두 No access)
- Expiration: 6~12 개월 권장 (만료 직전 알림 옴, 재발급 필요)
- 발급된 토큰(`github_pat_...`) 을 안전한 곳에 보관

### 4) Vercel 환경변수 설정
Project → Settings → Environment Variables 에서 위 표대로 4개 + 시크릿 추가. **Production / Preview / Development 모두 체크.**

### 5) 재배포
환경변수 변경 후 새 배포가 자동으로 시작되지 않으면 Deployments 화면에서 최신 배포의 ⋯ → Redeploy.

### 6) 동작 확인
- 사이트 접속 → 로그인 → 어드민 메뉴 진입
- 단원 카드 추가 또는 엑셀 업로드
- 응답 메시지: "커밋됨 — Vercel 재배포 후 약 30초~1분 뒤 반영됩니다."
- GitHub 의 commit 탭에서 새 커밋 확인
- 1~2분 후 페이지 새로고침 → 새 데이터 노출

### 7) 기존 Vercel Blob 스토어 삭제 (선택)
모든 기능이 정상 동작 확인되면 Vercel 대시보드 → Storage → Blob 스토어 삭제. 이후 청구 없음.

## 트레이드오프 / 주의사항

| 항목 | 동작 |
| ---- | ---- |
| 저장 → 다른 기기 반영 | 약 30초 ~ 1분 (Vercel 재배포 대기) |
| 동시 저장 충돌 | GitHub Contents API 가 SHA 충돌 시 409 반환 → 클라이언트가 다시 시도 필요. 개인 사용 시 거의 발생 안 함. |
| Vercel 배포 한도 | Hobby 기준 100배포/일 — 사실상 무제한. 한도 도달 시 다음 배포는 다음날 가능. |
| 이미지 | 현재 비활성. R2 도입 시 별도 PR. |
| 백업 | 모든 데이터가 git 이력에 자동 보존됨. 잘못 저장 시 `git revert <sha>` 후 push. |
| 비밀 데이터 | 토큰·PII 는 절대 data/ 에 넣지 말 것 — repo 가 private 이라도 PAT 으로 우회 가능. |

## 롤백 (긴급)

GitHub 에서 잘못된 commit 이 들어간 경우:
```bash
git revert <bad-commit-sha>
git push
```
재배포 후 자동 복구.

또는 GitHub 웹에서 잘못된 파일 직접 편집·커밋해도 동일하게 자동 재배포됩니다.

## 의존성

이전:
```json
"@vercel/blob": "^2.0.0"
```
제거됨. `npm install` 한 번 실행해 lockfile 갱신:
```bash
cd C:\01vive\itpe
npm install
git add package-lock.json
git commit -m "chore(deps): remove @vercel/blob"
git push
```
