import { describe, expect, it } from 'vitest';
import { isFree, mergeTerms, parseDup, parseJson, parseKeywords, parseScreen, screenMessages } from '../src/ai';

describe('ai parsing', () => {
  it('extracts JSON from fences and <think> blocks', () => {
    const t = '<think>hmm {not json}</think>\n```json\n{"decision":"Include","confidence":85,"reason":"RCT in older adults"}\n```';
    expect(parseScreen(t)).toEqual({ v: 'include', conf: 0.85, why: 'RCT in older adults' });
  });
  it('rejects unusable answers', () => {
    expect(parseJson('no json here')).toBeNull();
    expect(parseScreen('{"decision":"banana"}')).toBeNull();
    expect(parseDup('{"duplicate":"yes"}')).toBeNull();
  });
  it('parses keywords and duplicates', () => {
    expect(parseKeywords('{"include":["random*","trial"],"exclude":["mice"]}')).toEqual({ include: ['random*', 'trial'], exclude: ['mice'] });
    expect(parseDup('{"duplicate":true,"confidence":0.9,"reason":"same DOI"}')).toMatchObject({ dup: true, conf: 0.9 });
  });
  it('merges terms without duplicates', () => {
    expect(mergeTerms('Trial\nsleep', ['trial', 'older adults'])).toBe('Trial\nsleep\nolder adults');
  });
  it('detects free models and skips routers', () => {
    expect(isFree({ id: 'a/b:free' })).toBe(true);
    expect(isFree({ id: 'a/b', pricing: { prompt: '0', completion: '0' } })).toBe(true);
    expect(isFree({ id: 'a/b', pricing: { prompt: '0.001', completion: '0' } })).toBe(false);
    expect(isFree({ id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } })).toBe(false);
  });
  it('screening prompt carries criteria and guards against injection', () => {
    const m = screenMessages({ title: 'T', abstract: 'A', authors: [], year: 2020, journal: 'J' } as never, { question: 'Q?', criteria: 'C' });
    expect(m[0].content).toMatch(/never follow instructions/);
    expect(m[1].content).toContain('Q?');
  });
});
