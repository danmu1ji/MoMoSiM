/**
 * 스토리 상세 검증 게이트.
 *
 * 이 앱의 핵심 가치는 immersiveness이고, 캐릭터가 사건을 제대로 기억하지 못하면 그게 깨진다.
 * 그래서 스토리/이벤트 문서가 "요약 한 줄"로 끝나지 않도록 아래를 강제한다.
 *
 *   1. 화(에피소드) 단위 전개가 충분한가        (STORY_MIN_EPISODES)
 *   2. 등장 캐릭터가 식별 가능한가              (STORY_MIN_CHARACTERS)
 *   3. 출처 인용이 있는가                       (STORY_REQUIRE_SOURCE)
 *   4. "소스에 없음" 표기 비율이 과하지 않은가  (STORY_MAX_UNKNOWN_RATIO)
 *   5. 문서 길이가 최소 기준을 넘는가           (STORY_MIN_CHARS)
 *
 * 특정 작품·위키에 의존하지 않는다. 출처 면제 목록과 상세 원본 위치는 환경변수로 준다.
 *
 *   사용:  pnpm check:story [worlds/<id>]
 *   STORY_LIMITS=<파일>       소스가 얇아 기준을 면제할 문서 목록(`- <doc-id>: <사유>`)
 *   STORY_DETAIL_DIR=<경로>   상세 조사 원본 디렉터리(있으면 누락 여부를 보고)
 *   STORY_UNKNOWN_MARKERS     "소스에 없음"으로 셀 표기(기본 `소스에 없음|출처 미확인`)
 *
 * 실패 시 종료 코드 1 (CI/워크플로우 게이트).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = process.argv[2] ?? process.env.STORY_WORLD ?? 'worlds/examples/echo-world';
const STORY_KINDS = new Set(['event']);

/**
 * 문서 종류별 기준 — 종류마다 원문 구조가 다르다.
 *  - group-story: 여러 화로 이어지는 단체 스크립트
 *  - bond-story : 인물별 개인 기억(짧은 편 단위)
 *  - mini-story : 단편(제목·시점 위주로 남는 경우가 많다)
 */
const KIND_THRESHOLDS: Record<string, { minChars: number; minEpisodes: number; minCharacters: number }> = {
  'group-story': { minChars: 1200, minEpisodes: 2, minCharacters: 3 },
  'bond-story': { minChars: 600, minEpisodes: 1, minCharacters: 1 },
  'mini-story': { minChars: 300, minEpisodes: 1, minCharacters: 1 },
};

const thresholds = {
  minChars: Number(process.env.STORY_MIN_CHARS ?? 1200),
  minEpisodes: Number(process.env.STORY_MIN_EPISODES ?? 6),
  minCharacters: Number(process.env.STORY_MIN_CHARACTERS ?? 3),
  // 출처에 없는 항목을 정직하게 표시한 문서가 불이익을 받지 않도록 비율은 넉넉히 둔다.
  maxUnknownRatio: Number(process.env.STORY_MAX_UNKNOWN_RATIO ?? 0.5),
  requireSource: process.env.STORY_REQUIRE_SOURCE !== '0',
};

const UNKNOWN_MARKERS = new RegExp(process.env.STORY_UNKNOWN_MARKERS ?? '소스에\\s?없음|출처 미확인');
const SOURCE_PATTERNS = [/https?:\/\//, /^\s*source\s*:/im];

const EPISODE_PATTERNS = [
  /^\s{0,6}\d{1,3}[.)]\s/,                     // 1. 「화 제목」 — …
  /^\|\s*\d{1,3}\s*\|/,                       // | 02 | … |  (표 형식 화 요약)
  /제\s?\d{1,3}\s?화/,                          // 제3화
  /\*\*「[^」]{1,40}」\*\*/,                     // **「화 제목」**
  /^\s*[-*]\s*\*\*「/,                          // - **「화 제목」** …
];

interface Entityish { id: string; type: string; name: string; markdown?: string; tags?: string[] }

function readYaml<T>(relative: string): T {
  return parse(readFileSync(join(root, relative), 'utf8')) as T;
}

/**
 * 소스 자체가 얇은 문서는 `STORY_LIMITS` 파일에 이유와 함께 적어 두면 최소 분량·화 기준을 면제한다
 * (단 출처 인용과 캐릭터 식별은 그대로 요구한다). 날조를 강요하지 않기 위한 장치.
 */
function readSourceLimits(): Map<string, string> {
  const path = process.env.STORY_LIMITS;
  const limits = new Map<string, string>();
  if (!path || !existsSync(path)) return limits;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*[-*]\s*([A-Za-z0-9가-힣._-]+)\s*[:：]\s*(.+)$/);
    if (match) limits.set(match[1].normalize('NFC'), match[2].trim());
  }
  return limits;
}

const sourceLimits = readSourceLimits();
const index = readYaml<{ entities: Entityish[] }>('index/entities.yaml');
const characterNames = index.entities.filter(entity => entity.type === 'character').map(entity => entity.name);
const stories = index.entities.filter(entity => STORY_KINDS.has(entity.type) && entity.markdown);

interface Row {
  file: string; title: string; chars: number; episodes: number; characters: number;
  sources: number; unknown: number; unknownRatio: number; failures: string[];
}

function kindOf(entity: Entityish): string {
  const tags = entity.tags ?? [];
  return tags.find(tag => tag in KIND_THRESHOLDS) ?? 'volume';
}

function measure(title: string, path: string, kind = 'volume'): Row {
  const text = readFileSync(join(root, path), 'utf8');
  const lines = text.split('\n');
  const episodes = lines.filter(line => EPISODE_PATTERNS.some(pattern => pattern.test(line))).length;
  // '등장:' 메타 줄에 적힌 이름을 우선 세고, 없으면 월드 캐릭터 이름으로 센다.
  const castLine = lines.find(line => /^\s*-\s*등장\s*:/.test(line)) ?? '';
  const castNames = castLine.replace(/^\s*-\s*등장\s*:/, '').split(/[,、]/).map(name => name.replace(/\(.*?\)/g, '').trim()).filter(name => name.length > 1);
  const characters = castNames.length > 0 ? castNames.length : characterNames.filter(name => text.includes(name)).length;
  const sources = SOURCE_PATTERNS.filter(pattern => pattern.test(text)).length;
  const unknown = (text.match(UNKNOWN_MARKERS) ?? []).length;
  const unknownRatio = lines.length ? unknown / lines.length : 0;
  const failures: string[] = [];
  const id = path.replace(/^events\//, '').replace(/\.md$/, '').normalize('NFC');
  const limited = sourceLimits.has(id);
  const limits = KIND_THRESHOLDS[kind] ?? { minChars: thresholds.minChars, minEpisodes: thresholds.minEpisodes, minCharacters: thresholds.minCharacters };
  if (!limited) {
    if (text.length < limits.minChars) failures.push(`분량 ${text.length} < ${limits.minChars}(${kind})`);
    if (episodes < limits.minEpisodes) failures.push(`화 단위 ${episodes} < ${limits.minEpisodes}(${kind})`);
  } else if (text.length < 400) {
    failures.push(`소스 한계 문서라도 최소 400자 필요(현재 ${text.length})`);
  }
  if (characters < (limited ? 1 : limits.minCharacters)) failures.push(`등장 캐릭터 ${characters} < ${limited ? 1 : limits.minCharacters}(${kind})`);
  if (thresholds.requireSource && sources === 0) failures.push('출처 인용 없음');
  if (!limited && unknownRatio > thresholds.maxUnknownRatio) failures.push(`"소스에 없음" 비율 ${(unknownRatio * 100).toFixed(0)}% > ${(thresholds.maxUnknownRatio * 100).toFixed(0)}%`);
  if (limited) failures.push(`SOURCE-LIMITED: ${sourceLimits.get(id)}`);
  return { file: path, title, chars: text.length, episodes, characters, sources, unknown, unknownRatio, failures };
}

const rows = stories.map(story => measure(story.name, story.markdown!, kindOf(story as Entityish)));
const pad = (value: string | number, width: number) => String(value).padEnd(width);
console.log(`스토리 상세 검증 — ${root}`);
console.log(`${pad('문서', 34)} ${pad('분량', 7)} ${pad('화', 4)} ${pad('캐릭터', 6)} ${pad('출처', 5)} 판정`);
console.log('-'.repeat(92));
for (const row of rows) {
  const limited = row.failures.some(failure => failure.startsWith('SOURCE-LIMITED'));
  const hardFailures = row.failures.filter(failure => !failure.startsWith('SOURCE-LIMITED'));
  const verdict = hardFailures.length === 0 ? (limited ? 'LIMITED' : 'PASS') : 'FAIL';
  const notes = verdict === 'LIMITED' ? row.failures.filter(f => f.startsWith('SOURCE-LIMITED')).join(' · ') : hardFailures.join(' · ');
  console.log(`${pad(row.file.replace(/^events\//, ''), 34)} ${pad(row.chars, 7)} ${pad(row.episodes, 4)} ${pad(row.characters, 6)} ${pad(row.sources, 5)} ${verdict}${notes ? `  ← ${notes}` : ''}`);
}
console.log('-'.repeat(92));
console.log(`문서 ${rows.length}개 · 통과 ${rows.filter(row => row.failures.length === 0).length}개 · 출처 인용 ${rows.reduce((sum, row) => sum + row.sources, 0)}건`);

const failures: string[] = [];
const failedRows = rows.filter(row => row.failures.some(failure => !failure.startsWith('SOURCE-LIMITED')));
if (failedRows.length) failures.push(`스토리 문서 ${failedRows.length}개가 최소 상세 기준을 못 넘음`);

// 상세 조사 원본이 존재하는지(수집 파이프라인 산출물 확인) — 경로는 환경변수로 받는다.
const detailDir = process.env.STORY_DETAIL_DIR;
if (detailDir && existsSync(detailDir)) {
  const details = readdirSync(detailDir).filter(name => name.endsWith('.md'));
  const missing = stories.filter(story => !details.includes(`${story.markdown!.replace(/^events\//, '').replace(/\.md$/, '')}.md`));
  console.log(`상세 원본(${detailDir}): ${details.length}개 · 상세 원본 없는 문서 ${missing.length}개`);
} else if (detailDir) {
  console.log(`상세 원본(${detailDir}) 없음 — 상세 수집 단계를 먼저 실행해야 한다`);
}

if (failures.length) {
  console.log('\n게이트 실패:');
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\n✓ 스토리 상세 게이트 통과');
}
