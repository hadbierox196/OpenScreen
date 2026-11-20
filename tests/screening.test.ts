import { describe, expect, it } from 'vitest';
import { empty } from '../src/store';
import { etaMinutes, makeDecision, missingReasons, queue, relevance } from '../src/screening';
import { numbering } from '../src/team';
const rec = (i: number, title: string, abstract = '') => ({ id: 'r' + i, title, abstract, authors: [], journal: '', volume: '', issue: '', pages: '', doi: '', pmid: '', keywords: [], sourceDb: '', batch: '', raw: '' });
const mk = (decisions: any = {}) => ({ ...empty, inc: 'randomized', exc: 'protocol', recs: [rec(1, 'A cohort study'), rec(2, 'A randomized trial', 'randomized controlled'), rec(3, 'Study protocol'), rec(4, 'Plain')], decisions } as any);
describe('screening logic', () => {
  it('scores relevance by weighted keyword hits', () => {
    const p = mk(); expect(relevance(p.recs[1], p)).toBe(3); expect(relevance(p.recs[2], p)).toBe(-2); expect(relevance(p.recs[0], p)).toBe(0);
  });
  it('filters and orders the queue', () => {
    const p = mk({ r4: { v: 'maybe', reason: '', note: '', t: 1 }, r1: { v: 'include', reason: '', note: '', t: 1 } }), n = numbering(p);
    expect(queue(p.recs, p, n, 'un', 'orig').map(r => r.id)).toEqual(['r2', 'r3']);
    expect(queue(p.recs, p, n, 'maybe', 'orig').map(r => r.id)).toEqual(['r4']);
    expect(queue(p.recs, p, n, 'all', 'rel').map(r => r.id)).toEqual(['r2', 'r1', 'r4', 'r3']);
  });
  it('stores clean decisions', () => {
    expect(makeDecision('include', 'Wrong population', 'n').reason).toBe('');
    expect(makeDecision('exclude', ' Wrong outcome ', '', 'animal study', 5)).toEqual({ v: 'exclude', reason: 'Wrong outcome', note: 'AI: animal study', t: 5 });
    expect(missingReasons(mk({ r1: { v: 'exclude', reason: '', note: '', t: 1 }, r2: { v: 'exclude', reason: 'x', note: '', t: 1 } }), ['r1', 'r2'])).toBe(1);
  });
  it('estimates time left only with enough data', () => {
    expect(etaMinutes(3, 0, 100, 60000)).toBeUndefined();
    expect(etaMinutes(10, 0, 100, 600000)).toBe(100);
  });
});
