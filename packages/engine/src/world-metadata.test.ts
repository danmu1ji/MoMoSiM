import { describe, expect, it } from 'vitest';
import { parseWorldMetadata } from './world-metadata';

describe('world metadata parsing', () => {
  it('keeps YAML 1.2 scalar types and multilingual character content', () => {
    expect(parseWorldMetadata('date: 2026-10-02\nyes: yes\nboolean: true\nnullish: null\nnumber: 0x10\nname: 아리아\ntext: |\n  Hello\n  World\n')).toEqual({
      date: '2026-10-02', yes: 'yes', boolean: true, nullish: null, number: 16, name: '아리아', text: 'Hello\nWorld\n',
    });
  });
  it('rejects duplicate keys and unsafe executable tags', () => {
    expect(() => parseWorldMetadata('id: one\nid: two')).toThrow();
    const value = parseWorldMetadata('value: !!js/function "function () { return 1; }"') as { value: unknown };
    expect(typeof value.value).not.toBe('function');
  });
  it('retains anchors and the existing alias expansion protection', () => {
    expect(parseWorldMetadata('base: &base [one, two]\ncopy: *base')).toEqual({ base: ['one', 'two'], copy: ['one', 'two'] });
    const bomb = ['a: &a [one, two]', 'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]', 'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]', 'd: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]'].join('\n');
    expect(() => parseWorldMetadata(bomb)).toThrow(/alias/i);
  });
  it('does not mutate prototypes through metadata keys', () => {
    const parsed = parseWorldMetadata('__proto__: { polluted: true }') as Record<string, unknown>;
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
