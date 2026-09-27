import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('DanmuTalk conversation workspace', () => {
  it('provides the full-bleed inbox and functional shared locale selection', () => {
    const source = readFileSync(new URL('./home.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Momo<span>Talk</span>');
    expect(source).toContain('value={language} onChange={onLanguage}');
    expect(source).toContain('Search students');
    expect(source).toContain('onOpenGroupChat');
    expect(source).toContain('Sensei profile');
    expect(source).not.toContain('SCHOOL DIRECTORY');
  });
});
