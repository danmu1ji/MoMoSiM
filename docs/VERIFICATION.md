# Verification status

이 환경에서 실제로 실행해 확인한 것과 확인하지 못한 것을 나눠 적는다. 주장의 경계를 명확히 하기 위한 문서다.

## Verified here (bounded commands)

| Area | Command | Result |
|---|---|---|
| TypeScript build | `pnpm build` | pass (packages + desktop) |
| JS unit / contract tests | `pnpm test` | **30 files / 71 tests** pass (소스만; `dist/` 사본은 vitest 설정에서 제외) |
| Sample world validation | `pnpm validate` | Echo World: manifest 1.0, 3 entities, 2 time slices, 1 media asset, **0 errors** |
| Desktop web bundle | `pnpm --filter @world-player/desktop build` | pass (vite, 플레이어 + 편집기 두 엔트리) |
| Export round trip | `pnpm exec tsx tools/checks/export-check.ts` | 아카이브가 manifest 엔트리 파일, 편집한 Markdown, 새 엔티티 문서, `index/entities.yaml`의 Fog 규칙을 보존 · 0 errors |
| Markdown import | `pnpm exec tsx tools/importer/cli.ts … && tools/checks/import-check.ts` | 3 entities imported(`[[…]]` 참조로 타입 추론), 아카이브 로드·그래프 해석 · 0 errors |
| Example package rebuild | `pnpm exec tsx tools/build-example.ts worlds/examples/echo-world …` | `.😭` 재생성, 소스와 아카이브 드리프트 없음 |
| Rust boundary tests | `cargo test --workspace` | 3 suites ok (boundary 9 + Tauri command bodies 3). `tauri.conf.json`의 `frontendDist` 경로가 존재해야 `generate_context!`가 통과하므로 `src-tauri/build.rs`가 그 경로를 자동 생성한다(프론트엔드 빌드 전에도 `cargo test` 가능) |
| Tauri crate compiles | `cargo check -p world-player --all-targets` | pass |
| Desktop binary links | `cargo build -p world-player` | pass (`target/debug/world-player`). `beforeBuildCommand`로 프론트엔드 빌드를 먼저 돌린다 |
| Local server | `node tools/serve.mjs` | `/` `/editor.html` `/api/health` 200, 자격증명 `PUT`→`GET` 왕복, 파일 권한 **0600** |
| Chat E2E with a real HTTP/SSE provider | Playwright against `vite` + `tools/checks/stub-provider.mjs` | 한 메시지 → 첫 화자 `turns=2`, 둘째 화자 `turns=3` (SSE 스트리밍) |

### Chat E2E evidence

`tools/checks/stub-provider.mjs`가 `/v1/models`와 `/v1/chat/completions`(SSE)를 구현하고 모든 요청을 기록한다.
앱 UI를 실제로 조작해 얻은 로그:

```text
{"speaker":"아리아","model":"stub-echo-1","turns":2,"stream":true,"authorization":null,"knowledge":"- 항구 구역: … | - 아리아: … | - 보린 (Fog: public — speak with matching uncertainty): …"}
{"speaker":"보린","model":"stub-echo-1","turns":3,"stream":true,"authorization":null,"knowledge":"- 항구 구역 (Fog: partial — speak with matching uncertainty): … | - 아리아 (Fog: public …): … | - 보린: …"}
```

한 번의 실행으로 **순차 다화자 기록**(turns 2→3), **화자별로 다른 Fog 지식**(그리고 그 지식에 붙은 접근 등급),
**SSE 스트리밍 조립**을 실제 provider 경로로 확인했다.

## Coverage mapped to the MVP criterion

- `packages/engine/src/conversation-e2e.test.ts` — 두 참가자가 순서대로 답하고(두 번째 요청에 첫 화자 발언 포함),
  화자마다 Fog 제한 프롬프트를 받는다.
- `src-tauri/src/main.rs` 테스트 — 실제 SQLite FTS5 파일에 대해 `world_index` + `world_search` 커맨드 본문 검증
  (`hidden` 및 다른 시점 규칙 모두 거부, 빈 규칙은 전부 거부), `conversation_save`/`conversation_load` 왕복.
- `crates/world-boundary/src/{permissions,search}.rs` — Fog/Time 해석기와 권한 적용 검색.
- `packages/engine/src/fog-grants.test.ts` — UI가 자기 지식 규칙을 경계 권한으로 투영한다.
- `packages/engine/src/prompt-levels.test.ts` — Fog 등급이 프롬프트까지 전달된다.
- `packages/engine/src/graph.test.ts` — Markdown `[[link]]` 색인, Explorer 대상 해석, `BROKEN_INTERNAL_LINK`.
- `packages/engine/src/roundtrip.test.ts`, `sample-package.test.ts` — 패키지 엔트리 보존, 소스 디렉터리와 아카이브 드리프트 없음.
- `packages/engine/src/editor.test.ts`, `tools/importer/index.test.ts` — 생성·편집·임포트 경로.
- `packages/engine/src/history.test.ts` — 채팅 턴 ↔ 저장 행 매핑.
- `packages/engine/src/zip-lazy.test.ts`, `archive-normalize.test.ts` — 지연 로딩 ZIP과 폴더 포함 아카이브 정규화.

## Player UI contract (verified in the running app)

`apps/desktop/src/player/home.test.tsx`가 세계관 로드 전 화면이 **제목 `world player`와 `세계관 불러오기`만**
렌더함을 검사하고, 디자인 토큰이 `#000000` / `#808080` / `#ffffff` 세 가지 + `color-scheme: dark`임을 검사한다.

실행 중인 앱(`vite` + 스텁 provider)을 Playwright로 조작해 확인한 순서:

1. 홈: 다크 모노크롬, 버튼 1개(계산된 색: body `#000000`/`#ffffff`, 버튼 테두리 `#808080`).
2. `echo-world.😭` 로드: 상단바(`프로필 편집 | LLM 설정`), 세계관 배너(패키지 자산, `blob:` URL),
   이름+설명, 배너 카드가 있는 카테고리 레일과 좌우 화살표, 하단 `대화 시작`. 문서 스크롤 없이 한 화면.
3. 카테고리 → 떠 있는 창: 70/30 그리드(783px/335px), 뒤로 버튼, 배너 있는 하위 목록, 오른쪽 = 배너(상단 30%) + 설명.
4. 하위 카테고리 → 같은 창에서 캐릭터 목록, 캐릭터 → 왼쪽 70% 설명 + 오른쪽 30% 배너.
5. 대화 버튼 → 선택 창: 폴더 트리(`항구 구역` → `기록 보존소` → `아리아`, `보린`), 행마다 배너,
   전체 선택/해제, 하단 Time Slice + `시작`. **열 때 선택 0명**(이전 선택이 남지 않는다).
6. `시작` → 채팅 화면, 한 메시지에 두 캐릭터가 순차 응답(`turns=2` → `turns=3`), 화자별 Fog 등급 상이.
7. 캐릭터 선택 창 재오픈 → 다시 **0명**으로 시작.

### 캐릭터 선택 창 레이아웃 (목업 반영)

카테고리 = 창 폭 전체를 채우는 가로 배너(세로 스택), 캐릭터 = 정사각 프로필 4개/행,
라벨은 모두 이미지 아래 `이름 | [설명]` 한 줄.

문제였던 것: (1) 1열 그리드, (2) 지연 로딩 이미지의 `div` 래퍼가 기존 `img` 선택자 CSS를 깨뜨림,
(3) 카테고리용 4열 그리드 규칙이 하위 카테고리까지 적용됨.

수정: `LazyAssetImage`가 **항상 `<img>` 하나만** 렌더, 창 크기 `min(1680px,97vw) × min(92vh,1100px)`,
`.cat-stack`(1열·전폭, 배너 `aspect-ratio: 5/1`), `.char-grid` 4열 + `.char-tile .thumb` 정사각(`1/1`).

실측(브라우저, 1920×1080 · 429 엔티티 세계관): 창 1680×994 · 카테고리 배너 폭 **1634px**(창 폭 전부) ·
캐릭터 **4개/행** · 썸네일 **398×398**.

## 대용량 패키지 · 지연 로딩 실측

테스트한 패키지: 엔티티 429개(캐릭터 165 · 카테고리 65 · 이벤트 199) · 30 타임 슬라이스 · 미디어 22,857개 · 압축 1.27GB.

| 모드 | 로드 | RSS |
|---|---|---|
| **지연 로딩(기본)** | **1,612ms** | **1,653MB** |
| 즉시 로딩(`eagerAssets`) | 11,498ms | 3,047MB |

→ **RAM 1,394MB 절약 · 로드 9.9초 단축.** 화면에 보이는 자산 5개를 그때 읽어 URL로 만드는 데 24ms.
작은 패키지(948MB 압축)에서도 같은 방향: 지연 1,331ms/1,284MB vs 즉시 8,964ms/2,364MB.

## 웹 서버 실행 · API 키 저장 (2026-09)

| 항목 | 결과 |
|---|---|
| 서버 | `tools/serve.mjs` — 의존성 없는 Node 서버. `apps/desktop/dist` 정적 서비스 + `/api/credentials`(GET/PUT/DELETE) + `/api/health` |
| 키 저장 | `~/.config/world-player/credentials.json` **0600**(실측 `stat -c %a` = 600). 응답은 `hasKey`만 돌려준다 |
| 앱 연결 | `apps/desktop/src/player/credential-store.ts` — 서버 → 브라우저 저장소 → OS 키체인 순 폴백, 화면에 백엔드 표시 |
| 실측 | `PUT` → 파일 생성(600) → `GET`으로 반영 확인. UI에서 "키를 저장했습니다 — 로컬 서버 파일(0600)" 표시 |

## 플레이어 / 편집기 분리 (2026-09)

| 항목 | 결과 |
|---|---|
| 플레이어 홈 | 버튼 **1개**(`세계관 불러오기`). `세계관 만들기` 제거, `?mode=edit` 편집 화면 제거 |
| 편집기 | `apps/desktop/editor.html` + `src/editor/{main.tsx,panels.tsx,fields.tsx,editor.css}` — 좌측 레일 **11개 섹션** |
| 엔진 확장 API | `setWorldMeta` · `patchEntity` · `upsertRelation/removeRelation` · `upsertState/removeState` · `upsertMediaAsset/removeMediaAsset` · `setAssetBytes/removeAssetFile` · `listDocuments/removeDocument/uniqueDocumentPath` |
| 실측 | 편집기에서 429 엔티티 세계관 로드, 11섹션 렌더, 캐릭터 패널에서 프로필·성격·연기 지침·스토리·대사·관계·변형·용어 편집 필드 표시 |
| 빌드 | vite 멀티페이지(player/editor), `pnpm --filter @world-player/desktop build` 통과 |

## 데스크톱 패키징 철회 (2026-09)

요청에 따라 데스크톱 번들(AppImage/NSIS) 배포를 **철회**하고 웹 서버 실행으로 되돌렸다.

- 삭제: `.github/workflows/release.yml`, `docs/PACKAGING.md`, `tools/package-appimage.sh`, `target/release/bundle`
- 복원: `src-tauri/tauri.conf.json` → `bundle.active: false`, `package.json`의 `app:*` 스크립트 제거
- 유지: Tauri 커맨드와 `crates/world-boundary`(Rust 단위 테스트 대상)는 그대로다. 창 실행 대신 `cargo test`로 검증한다.

## Not verified in this environment

- **데스크톱 GUI 창 실행.** Tauri 크레이트는 빌드·컴파일·단위 테스트가 통과하지만, 이 환경에 X 서버/Xvfb가 없어
  창을 띄우지 못했다. 대신 커맨드 본문을 `cargo test`로 직접 검증한다.
- **OS 키체인.** `credential_set`/`credential_get`은 Tauri `keyring` 크레이트를 쓰므로 세션 키링이 필요하다(헤드리스 미검증).
  웹 서버 모드는 파일(0600)을 쓰고, 서버가 없으면 브라우저 저장소로 폴백한다.
- **실제 벤더 API 엔드포인트.** 스트리밍은 로컬 OpenAI 호환 스텁으로 검증했고 실 벤더로는 호출하지 않았다(자격증명 미사용).
- **OAuth 2.0 / PKCE**와 명세의 **크롤러** 도구는 미구현(`docs/ARCHITECTURE.md` §9).

## 신규 클론 자립성 검증 (배포 후)

원격 저장소를 **빈 디렉터리에 새로 클론해** 저장소만으로 빌드·테스트·실행이 되는지 확인했다.

| 단계 | 결과 |
|---|---|
| `git ls-files` | **153개** (내부 수집물·설계 문서·작품별 도구 없음) |
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test` | **30 files / 71 tests** pass |
| `pnpm validate` | 예제 세계관 검증 통과 |
| `pnpm --filter @world-player/desktop build` | 성공 (플레이어 + 편집기) |
| `cargo test --workspace` | exit 0 — **9 + 3 tests** pass |
| `node tools/serve.mjs` | `/` 200 · `/editor.html` 200 · `/api/health` 200 |

이 검증에서 실제 결함 하나를 찾아 고쳤다: 새 클론에는 `apps/desktop/dist`가 없어 `cargo test`가
`generate_context!`에서 panic 했고, CI `rust` 잡도 같은 이유로 실패했을 것이다.
→ `src-tauri/build.rs`가 `frontendDist` 경로를 자동 생성하고, `verify.yml`의 rust 잡이 프론트엔드를 먼저 빌드하도록
순서를 바꾸고, `tauri.conf.json`에 `beforeBuildCommand`를 명시했다(커밋된 빌드 산출물은 두지 않는다).

### 저장소 위생

- `.gitignore`: 의존성·빌드 산출물·로그·sqlite·`*.😭`(예제 제외) 등 **일반 패턴만** 담는다.
- 특정 작품 수집물·설계 문서·파이프라인 도구는 `.git/info/exclude`(로컬 전용, 커밋되지 않음)로 제외한다.
- 커밋된 파일 전체를 문자열 검사해 특정 작품·위키·캐릭터 이름이 **0건**임을 확인했다(`git grep --cached`).
- 시크릿 파일(`.env`, `*.pem`, `credentials*.json`) 없음. API 키는 실행 사용자 홈(`~/.config/world-player/`)에만 저장된다.

## 대화 사이클 · 캐릭터별 생성 값 (2026-09-22)

사용자 피드백 3건(답변이 비슷함 / 늦게 말하는 캐릭터가 앞선 발언을 모름 / 턴당 한 번만 발언)에 대한 조치와 실측.

| 문제 | 원인 | 조치 |
|---|---|---|
| 답변이 서로 비슷함 | provider가 생성 파라미터를 아예 보내지 않아 모든 캐릭터가 같은 값으로 생성 | `SamplingOptions`를 요청에 추가(=`temperature`/`top_p`/`max_tokens`/`frequency_penalty`/`presence_penalty`), 캐릭터 id 해시로 결정적 편차(`samplingFor`) |
| 늦게 말하는 캐릭터가 앞선 발언을 모름 | 기록을 전달하긴 했지만 화자 표시 없이 전부 `assistant`로 평탄화 → 자기 말과 남의 말을 구분 불가 | `providerMessages`: 자기 발언 `assistant`, 남의 발언·플레이어 발언은 `이름: 내용` 형태의 `user`로 전달(연속 동일 역할은 병합) |
| 턴당 한 번만 발언 | 발언 계획이 사용자 메시지 1건에 고정 | `runConversationCycle`: 답변 끝의 `[[next:이름]]`/`[[next:end]]` 신호로 다음 화자와 종료를 **캐릭터가 결정**(신호는 표시 전에 제거, 무한 루프 방지 상한 포함) |

### 실측 (브라우저 + 로컬 스텁 provider, 예제 세계관)

| 항목 | 결과 |
|---|---|
| 사이클 | 한 메시지로 `아리아 → 보린 → 보린 → 보린 → 보린` 진행 후 캐릭터의 종료 신호로 정지(총 5발언) |
| 앞선 발언 인식 | 모든 요청에서 `hearsEarlierSpeakers=true`, 본문에 `방문자: …` / `아리아: …` 처럼 이름이 붙어 전달됨 |
| 캐릭터별 생성 값 | 아리아 temp 0.954 · freq 0.193 · pres 0.268 / 보린 temp 0.985 · freq 0.218 · pres 0.249 (재현 가능) |
| 신호 누출 | 화면 본문에 `next:` **0건** (스트리밍 중에도 숨김) |
| 종료 후 UI | 추가 버튼 없음(캐릭터가 정리하면 턴이 끝난다). 진행 중에만 `멈추기` 표시 |
| 중복 삽입 버그 | 플레이어 발언이 기록에 두 번 들어가던 문제를 `inputTurn`으로 수정(회귀 테스트 추가) |
| 테스트 | `pnpm test` **32 files / 100 tests** pass |
| Rust | `cargo test --workspace` 9 + 3 pass (`dist` 경로는 `src-tauri/build.rs`가 생성) |

### 후속 변경 — 초기 계획 제거(시작 화자도 LLM이 결정)

요청에 따라 "참가자 전원이 순서대로 시작"하던 초기 계획을 없앴다. 이제 대화 시작 전에 **진행자 호출**
(`chooseSpeaker`)이 참가자 목록과 최근 대화를 보고 **누가 먼저 말할지, 또는 아무도 말하지 않을지**를 정한다.
그래서 구조적으로 이런 진행이 가능해졌다.

- `[user]` → 진행자: "보린" → **보린 한 명만 답하고 턴 종료** (아리아는 말하지 않음)
- `[user]` → 진행자: "end" → **아무도 답하지 않고 턴 종료** (`endedBy: 'silent'`, 앱은 안내 문구만 표시)
- `[user]` → 진행자: "아리아" → 아리아가 `[[next:보린]]` → 보린이 `[[next:end]]` → A→B→종료

실측(브라우저 + 스텁, 진행자가 `보린`을 지목): `나: 보린 있어?` → `보린` 1건 응답 → `대화가 여기서 정리되었습니다`.
진행자 호출은 별도 1회(짧은 프롬프트, temperature 0.2)이며, 참가자가 한 명뿐이면 건너뛴다.

### 후속 수정 — 지목한 상대가 두 번 말하던 문제

2인 대화에서 초기 계획이 `[A, B]`인데 A가 `[[next:B]]`를 보내면 B가 큐에 중복으로 쌓여 **B가 연속 두 번** 말했다.
지금은 **이미 순서를 기다리는 화자는 다시 넣지 않는다**(자기 자신을 다시 지목한 경우는 허용).
그래서 `[user: 연필 있어?] → A: 난 없는데, B 넌 있어? → B: 나도 없는데, 네 서랍 찾아봐 → A: 알겠어.` 가
중복 없이 A → B → A 로 진행된다(회귀 테스트 `2인 대화에서 …`).

수동 `계속 말 시키기` 칩은 제거했다: 사이클 종료를 사람이 고르는 방식이 아니라 **대화 중인 캐릭터가 정한다**는
요구에 맞춘 것이다. 사람의 개입은 `멈추기`(강제 중단) 하나만 남겼다 — 진행과 종료는 캐릭터가 정하고, 별도의 이어붙이기 버튼은 두지 않는다.

## 설정 저장 (엔드포인트·모델·temperature) (2026-09-22)

요청: API 키처럼 엔드포인트·모델명·temperature 등도 저장될 것.

| 항목 | 결과 |
|---|---|
| 서버 파일 | `~/.config/world-player/credentials.json` → `{ secret, settings, updatedAt }`, 권한 **600** 유지 |
| 저장 내용 | `endpoint=http://127.0.0.1:9999/v1`, `model=my-model-7b`, `temperature=1.35`, `maxCycleSpeakers=5`, `variation=true` 가 파일에 기록됨 |
| 키 보존 | 기존 비밀 값 그대로(길이 73) — 설정 저장이 키를 건드리지 않음 |
| 복원(서버 경로) | **브라우저 저장소를 비우고 새로고침** → 네 값 모두 복원, 상태 표시 `저장된 설정을 불러왔습니다 — 로컬 서버 파일(0600)` |
| 부분 갱신 | `PUT`은 보낸 필드만 바꾼다(키만 저장 / 설정만 저장 모두 가능) |
| 설정만 삭제 | `DELETE /api/credentials?scope=settings` — 키는 남는다 |
| 자동 저장 | 변경 후 500ms 디바운스(입력 중 매 글자마다 요청하지 않음) |
| 테스트 | `apps/desktop/src/player/credential-store.test.ts` 5건(설정 추림·서버/브라우저 폴백·설정만 삭제·키를 브라우저에 남기지 않음) — 전체 `pnpm test` 33 files / 110 tests |
