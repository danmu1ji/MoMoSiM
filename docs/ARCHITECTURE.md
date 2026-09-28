# 아키텍처 — 명세 대응표

`world-player-spec.md`의 요구가 현재 코드에서 어디에 구현되어 있는지 요약한다.
"부분"으로 표시된 항목은 동작하지만 범위가 명세보다 좁다는 뜻이다.

## 1. 엔진 / 세계관 분리

| 명세 | 구현 | 상태 |
|---|---|---|
| 엔진은 특정 작품을 모른다 | `packages/engine`은 world id/이름에 의존하는 분기가 전혀 없다. 샘플 세계관은 `worlds/examples`의 외부 패키지다. | 완료 |
| World Data의 Source of Truth는 Entity Graph + 구조화 메타데이터 | `index/entities.yaml` + `parseMarkdown` → `buildEntityGraph` → `WorldData.links` | 완료 |
| Markdown 직접 편집 | 편집기 Entity/Markdown 탭, `setDocument`/`documentBody` | 완료 |
| schema가 유효성 기준 | `validateWorld` (manifest/relation/link/Fog/media/time/state 검사) + `pnpm validate` | 완료 |

## 2. World Package

| 명세 | 구현 | 상태 |
|---|---|---|
| `.😭`는 ZIP 호환 컨테이너 | `fflate` 기반 `createPackageSource` / `exportWorldPackage` | 완료 |
| manifest가 호환성을 결정 | `manifest.yaml`의 `schemaVersion`/`entry`를 읽고, 내보낼 때 `entry` 경로를 그대로 사용 | 완료 |
| 패키지 내부 구조 (lore/characters/timeline/index/assets) | 샘플 패키지가 해당 구조를 따르고, 로더는 경로를 하드코딩하지 않고 `listPaths`로 전체를 보존 | 완료 |
| 무손실 왕복 | `packageFiles`에 원본 파일 보존, `roundtrip.test.ts`가 비-`world.yaml` entry로 검증 | 완료 |

## 3. Fog / Knowledge

| 명세 | 구현 | 상태 |
|---|---|---|
| Fog는 프롬프트 문구가 아니라 접근제어 | `filterKnowledge` / `projectKnowledge` / `readDocument` / `searchProjected` | 완료 |
| 기본 차단 | 규칙이 없으면 `unknown` → 접근 불가 (`canAccess(undefined) === false`) | 완료 |
| knowledge level (full/partial/public/hidden) | `knowledgeLevel` + `knowledgeLevels`가 프롬프트에 수준을 명시 | 완료 |
| condition (timeSlice/location/…) | `knowledgeLevel`이 컨텍스트 불일치 시 `unknown` 처리, 경계용 `fogGrants`가 평가 불가 규칙을 제거 | 완료 |
| 모든 Tool/Search 호출이 Fog+Timeline 통과 | `world_search`가 Fog 규칙 + time slice를 받아 Rust(`permissions::resolve_allowed`)에서 권한을 재계산하고 allow-list로 필터 | 완료 (Tauri 경계) |
| Fog를 우회하는 Tool 금지 | 검색/Tool 결과는 모두 `filterKnowledge`/`resolve_allowed`를 거친다. | 완료 |

## 4. Timeline / State

| 명세 | 구현 | 상태 |
|---|---|---|
| Time Slice 선택 | 대화 설정 화면의 Time Slice, `resolveState` | 완료 |
| 시간대별 성격/말투 변화 | `CharacterState.personality/speech` + 샘플 `aria-after-storm` | 완료 |
| 상태 우선순위/조건 | `priority`, `conditions.situation` | 완료 |

## 5. 대화

| 명세 | 구현 | 상태 |
|---|---|---|
| 다중 캐릭터 순차 대화 | `runSequentialConversation`, UI `rollingHistory`가 각 화자 응답을 다음 요청에 포함 | 완료 |
| 화자 후보 resolver | `resolveNextSpeakers` (직접 언급 → 관계 → 최근 화자) | 완료 |
| Chat AST + 미디어 directive | `parseChatMarkdown`, `resolveMedia`, `assetUrl` | 완료 |
| 플레이어 프로필 | 대화 설정의 Player Name/Description → 프롬프트 | 완료 |
| 대화 기록 로컬 저장 | `conversations`/`messages` 테이블 + `conversation_save`/`conversation_load` 커맨드, UI `저장된 대화 불러오기` | 완료 |
| 대화별 Time Slice/참가자 저장 | `conversations` 메타(world/time_slice/player) | 완료 |

## 6. Provider

| 명세 | 구현 | 상태 |
|---|---|---|
| OpenAI 호환 스트리밍 | `OpenAICompatibleProvider` (SSE, 청크 경계 처리, `/models`) | 완료 |
| Custom Endpoint + Model 선택 | 대화 설정 화면 | 완료 |
| API Key 보관 | Tauri `keyring` 커맨드 (`credential_set`/`credential_get`) | 완료 (런타임 미검증) |
| OAuth 2.0 / PKCE | 미구현 | 미착수 |

## 7. 배너 / 탐색 모델

| 항목 | 구현 | 상태 |
|---|---|---|
| 세계관·카테고리·캐릭터 배너 | `World.banner`, `Entity.banner` + `assets/media.yaml` 참조, 로더가 파싱 | 완료 |
| 배너 없는 패키지 | `placeholderBanner`가 모노크롬(#000000/#808080/#ffffff) SVG 생성 | 완료 |
| 배너 참조 오류 | `MISSING_BANNER` 경고 (검증을 막지 않음) | 완료 |
| 카테고리/하위 카테고리 트리 | `navigation.ts` (roots, subcategoriesOf, charactersInCategory, charactersUnder, breadcrumb) | 완료 |
| 플레이어 화면 계약 | 홈=제목+2버튼 3색, 세계관 화면=상단바/배너/카테고리 레일/대화 버튼, 탐색 창=70:30, 캐릭터 선택=폴더 트리+타임라인 | 완료 |

## 8. 캐릭터 이미지

World packages may define image media for banners, portraits, and illustrations. The player resolves image IDs lazily and uses a neutral generated placeholder when an image is missing. Chat responses support text and image directives.

## 9. UI / 테마

| 명세 | 구현 | 상태 |
|---|---|---|
| 세계관 없음 = 흑백 | 홈 화면 팔레트 고정 | 완료 |
| World Theme | `world.theme.colors` → CSS 변수 (`--world-primary/secondary/accent`) | 완료 |
| Explorer 검색 | 검색어 → Fog 필터 + (Tauri 시) FTS5 검색 | 완료 |
| Entity Graph 탐색 | Entity 카드 → 내부링크 버튼 → 문서 | 완료 |
| 이미지/오디오 렌더 | `MediaNode` + `resolveMedia` | 완료 |

## 10. 세계관 데이터 제작 파이프라인

| 단계 | 도구 | 산출물 |
|---|---|---|
| 원문 수집 | 외부 수집 도구(저장소 미포함) | `research/<world>/raw/*` (각 파일 첫 줄에 SOURCE URL) |
| 미디어 목록·전사 | 외부 수집 도구 | `research/<world>/media-manifest.json` (배너/로비/보이스 + 원문 대사) |
| 이미지 가져오기 | 사용자가 제공한 파일 | `worlds/<world>/assets/images` |
| 패키지 생성 | 외부 조립 도구 | `manifest.yaml`, `world.yaml`, `index/entities.yaml`, `lore/`, `characters/`, `events/`, `timeline/`, `assets/media.yaml` |
| 패키징·검증 | `tools/build-example.ts`, `tools/validator.ts` | `.😭` 아카이브 + 오류 0 확인 |

조사는 서브에이전트(`researcher`)가 담당했고, 서브에이전트에는 웹 도구를 주지 않아 **부모가 덤프한 로컬 파일만**
근거로 쓰게 했다(추측 금지 규칙 유지). 산출물은 `research/<world>/*.md`에 남는다.

이 파이프라인은 저장소에 포함되지 않는다. 세계관 콘텐츠는 **저장소 밖에서 수집·조립**해 `.😭` 패키지로만 반입하는 것을 전제한다.

## 11. 저장소 / 도구

| 명세 | 구현 | 상태 |
|---|---|---|
| SQLite + FTS5 인덱스 | `crates/world-boundary/src/search.rs`, `packages/engine/src/sqlite-index.ts` | 완료 |
| 검증 도구 | `tools/validator.ts` | 완료 |
| 임포터 | `tools/importer` (Markdown 폴더 → `.😭`) | 완료 |
| 크롤러 | 미구현 | 미착수 |
| 로컬 DB가 World 파일을 대체하지 않음 | SQLite는 파생 인덱스/채팅 기록만 보관하고 패키지를 source of truth로 유지 | 완료 |

## 12. 명세와 다른 의도적 결정

- **패키지 분할**: 명세 §4는 `fog`, `timeline`, `prompt`, `media`, `ui`를 개별 패키지로 나열하지만,
  현재는 `packages/engine` 내부 모듈(`core.ts`, `graph.ts`, `orchestration.ts`, `media` resolver)로
  구현했다. 경계가 작은 초기 단계에서 패키지를 쪼개면 순환 의존과 보일러플레이트만 늘어나므로,
  모듈 단위로 먼저 안정화한 뒤 필요할 때 승격하는 편이 유지보수에 낫다고 판단했다.
- **Rust 경계 분리**: Fog/Time 권한 해석과 FTS5 검색을 `crates/world-boundary`로 분리해 Tauri 없이
  단위 테스트할 수 있게 했다. Tauri 커맨드는 이 크레이트를 호출하는 얇은 층이다.

## 대용량 패키지 지연 로딩 (lazy loading)

수백 MB~GB 규모 세계관을 통째로 풀면 메모리가 2배 이상 필요하다(압축 해제 사본 + assetBytes + packageFiles).
그래서 **필요한 것만 그때 읽는 구조**로 바꿨다.

1. `packages/engine/src/zip-lazy.ts` — ZIP 중앙 디렉터리만 스캔하고(`readZipDirectory`),
   엔트리는 요청 시 `readZipEntry`로 푼다(`stored`/`deflate` 지원, ZIP64는 명확히 거부).
   `createZipSource`/`decodeZipSource`가 기본으로 이 경로를 쓴다.
2. `loadWorld(source, { eagerAssets })` — 기본은 **자산 바이트를 읽지 않는다.**
   `assetFiles`(존재 여부)만 채우고, `packageFiles`에는 문서·메타데이터만 담는다.
   작은 패키지·테스트는 `eagerAssets: true`로 예전 동작을 유지한다.
3. `readAssetBytes` / `assetUrlAsync` — 자산을 요청 시 읽어 캐시하고, objectURL은 64MB LRU 상한을 넘으면 해제한다.
   `releaseAssetUrls(data)`로 세계관 전환 시 정리한다.
4. UI(`apps/desktop/src/player/lazy-asset.tsx`) — `LazyAssetImage`는 IntersectionObserver로 **화면에 들어온 이미지만** 읽는다.
   `banner-image.tsx`·`browse-overlay.tsx`·`chat-view.tsx`가 이 컴포넌트를 쓴다.
5. 내보내기(`exportWorldPackageAsync`) — 지연 로딩 상태에서도 소스에서 자산을 읽어 **전체 패키지를 복원**한다
   (동기 `exportWorldPackage`는 eager 모드·테스트용).

## 시간창 Fog (story windows)

스토리는 "그 장 시점부터 누적 공개"된다. 규칙은 세계관 수준(`world.knowledge`)에 있고,
캐릭터/상태 규칙과 합쳐 평가한다.

- 스키마: `KnowledgeCondition.fromPosition` / `untilPosition`, `FogContext.slicePosition`
- 규칙 생성: 세계관 조립 단계에서 스토리 순서 표(`story-order.yaml`)의 행 순서로
  각 스토리 엔티티에 `fromPosition`을 부여하고, 학원·동아리 카테고리는 조건 없이 `public`으로 공개한다.
- 인연 스토리(개인 기억)는 시간창 없이 항상 열람 가능.
- 앱: `main.tsx`에서 `world.knowledge + character.knowledge + state.knowledge`를 합쳐
  `filterKnowledge(..., { timeSlice, slicePosition })`로 판정하고, Rust 검색 경계에도 같은 규칙을 전달한다.

## 대화 사이클 (다화자 · 턴 넘김)

여러 캐릭터가 한 화면에서 말할 때 필요한 것은 세 가지다: **누가 말했는지 구분**, **서로 다른 목소리**,
**언제 끝낼지에 대한 판단**. 셋 다 `packages/engine/src/dialogue.ts`가 맡는다.

1. **화자 표시가 있는 기록** (`providerMessages`)
   - 화자 자신의 발언 → `assistant`, 다른 캐릭터와 플레이어 발언 → `user` + `이름: ` 접두사.
   - 같은 역할이 연속되면 한 덩어리로 합쳐 역할 교대를 지킨다(서버 호환).
   - 이 구분이 없으면 캐릭터가 자기 말과 남의 말을 구별하지 못해 답변이 서로 닮아진다.
2. **캐릭터별 샘플링 값** (`samplingFor`)
   - 캐릭터 id 해시로 temperature ±0.25, 반복 억제 ±0.2를 결정적으로 편차를 준다(재현 가능).
   - 기본값은 설정에서 바꿀 수 있고, 자동 편차는 끌 수 있다.
3. **턴 넘김 신호** (`parseNextDirective` / `visibleText`)
   - 발화자는 답변 끝에 `[[next:이름]]` 또는 `[[next:end]]`를 쓴다. 시스템 프롬프트가 이 규칙을 알려준다.
   - 엔진은 마지막 신호를 읽어 다음 화자를 정하고, **표시·저장 전에 신호를 제거**한다
     (스트리밍 중 조각난 신호도 숨긴다).
   - 신호가 없으면 그 홉에서 사이클이 끝난다 → 지시를 무시하는 모델도 무한히 이어지지 않는다.
   - 안전장치: `maxSpeakersPerCycle`(기본 8), `shouldStop()` + `AbortSignal`(멈추기 버튼).
4. **진행자 호출** (`chooseSpeaker`) — **초기 계획이 없다.** 대화를 시작할 때 참가자 목록과 최근 대화 꼬리만
   주고 **누가 말할지 또는 `end`**를 한 줄로 답하게 한다(사람이 개입하는 UI는 `멈추기` 하나뿐이다).
   그래서 한 캐릭터만 답하고 턴이 끝나거나, 아무도 답하지 않고 끝날 수도 있다(참가자가 한 명뿐이면 고를 것이
   없으므로 호출을 건너뛴다).
5. **사이클 실행** (`runConversationCycle`) — 진행자가 정한 화자부터 시작해, 이후는 답변의 신호대로
   큐에 쌓아 진행한다. 각 발언은 즉시 다음 화자의 기록에 들어가고, 이미 순서를 기다리는 화자는 중복으로
   넣지 않는다(지목한 상대가 두 번 말하는 것을 막는다).

플레이어 메시지는 `inputTurn`으로 객체를 그대로 넘겨 기록에 정확히 한 번만 들어가게 한다.

## 자격증명·설정 저장소

`apps/desktop/src/player/credential-store.ts`가 **API 키와 Provider 설정을 같은 저장소**에 넣는다.

| 항목 | 내용 |
|---|---|
| 저장 파일 | `~/.config/world-player/credentials.json` (권한 0600) — `{ secret, settings, updatedAt }` |
| API | `tools/serve.mjs`의 `/api/credentials` — `PUT`은 **보낸 필드만** 갱신한다(키만/설정만 저장 가능) |
| 폴백 순서 | 로컬 서버 파일 → 브라우저 localStorage (Tauri에서는 키만 OS 키체인) |
| 설정 필드 | `endpoint` · `model` · `temperature` · `maxTokens` · `variation` · `maxCycleSpeakers` 만 저장한다(`pickSettings`) |
| 자동 저장 | 설정 변경 후 500ms 디바운스로 저장(입력 중 매 글자마다 요청하지 않는다) |
| 시작 시 | 저장된 설정을 읽어 화면에 반영하고, 어느 백엔드에서 읽었는지 표시한다 |
