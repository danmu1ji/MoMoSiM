/**
 * 자리표시자 누수 검사(placeholder leak gate).
 *
 * 배경(실제 버그): 소속 동아리 이름을 캐릭터 엔티티에서 잘못 찾아 값이 "소스에 없음"이 되었고,
 * 렌더러가 그 값을 문장에 그대로 넣어 이런 문서가 만들어졌다.
 *
 *     - 너는 기록 보존소 소스에 없음의 아리아다.
 *
 * 표의 값 셀(`| 동아리 | 소스에 없음 |`)이나 줄 끝 표기는 정직한 기록이므로 허용하되,
 * **문장 중간에 섞여 들어간 자리표시자**는 실패로 처리한다.
 *
 * 사용:  pnpm check:placeholder [worlds/<id>]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.argv[2] ?? 'worlds/examples/echo-world';
const TOKENS = ['소스에 없음', '출처에 없음'];

/** 문장 중간 누수로 보는 패턴: 자리표시자 뒤에 조사/서술어가 붙어 문장이 이어지는 경우 */
const LEAK_PATTERNS = [/소스에\s?없음\s*(의|은|는|이|가|을|를|다|이다|입니다)/, /출처에\s?없음\s*(의|은|는|이|가|을|를|다|이다|입니다)/];

interface Violation { file: string; line: number; text: string }

function markdownFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) markdownFiles(path, out);
    else if (extname(name) === '.md') out.push(path);
  }
  return out;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isLineEndValue(line: string): boolean {
  // "…: 소스에 없음" 처럼 줄 끝 값으로 쓰인 경우(데이터 표기)는 허용
  const trimmed = line.trim().replace(/[.)\]]+$/, '');
  return TOKENS.some(token => trimmed.endsWith(token));
}

const characterDir = join(root, 'characters');
const violations: Violation[] = [];
const files = markdownFiles(root);
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (isTableRow(line) || isLineEndValue(line)) return;
    for (const token of TOKENS) {
      if (!line.includes(token)) continue;
      if (!LEAK_PATTERNS.some(pattern => pattern.test(line))) continue;
      violations.push({ file: file.replace(`${root}/`, ''), line: index + 1, text: line.trim().slice(0, 160) });
    }
  });
}

// 프롬프트 파일은 모델에 그대로 들어가므로 자리표시자를 **전혀** 허용하지 않는다.
const promptViolations: Violation[] = [];
if (existsSync(characterDir)) {
  for (const name of readdirSync(characterDir)) {
    const promptPath = join(characterDir, name, 'prompt.md');
    if (!existsSync(promptPath)) continue;
    readFileSync(promptPath, 'utf8').split('\n').forEach((line, index) => {
      for (const token of TOKENS) {
        if (line.includes(token)) promptViolations.push({ file: `characters/${name}/prompt.md`, line: index + 1, text: line.trim().slice(0, 160) });
      }
    });
  }
}

// 캐릭터 프롬프트 첫 역할 줄은 특히 중요하다(모델에 그대로 들어간다).
let roleLines = 0;
if (existsSync(characterDir)) {
  for (const name of readdirSync(characterDir)) {
    const promptPath = join(characterDir, name, 'prompt.md');
    if (!existsSync(promptPath)) continue;
    const roleLine = readFileSync(promptPath, 'utf8').split('\n').find(line => line.startsWith('- 너는 ')) ?? '';
    roleLines += 1;
    for (const token of TOKENS) {
      if (roleLine.includes(token)) violations.push({ file: `characters/${name}/prompt.md`, line: 3, text: roleLine });
    }
  }
}

violations.push(...promptViolations);
if (violations.length === 0) {
  console.log(`✓ 자리표시자 누수 없음 — 문서 ${files.length}개 · 캐릭터 역할 줄 ${roleLines}개 검사`);
  process.exit(0);
}
console.log(`✗ 자리표시자 누수 ${violations.length}건 (문장에 "소스에 없음"이 섞임)`);
for (const violation of violations.slice(0, 40)) {
  console.log(`  ${violation.file}:${violation.line}  ${violation.text}`);
}
process.exit(1);
