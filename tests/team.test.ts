import { describe, expect, it } from 'vitest';
import { empty } from '../src/store';
import { blindState, coverage, finalOf, freezePlan, genSlices, isConflict, kappa, numbering, pairStats, scopedRecs } from '../src/team';
const rec = (i: number) => ({ id: 'r' + i, title: 'T' + i, abstract: '', authors: [], journal: '', volume: '', issue: '', pages: '', doi: '', pmid: '', keywords: [], sourceDb: '', batch: '', raw: '' });
const dec = (v: 'include' | 'exclude' | 'maybe') => ({ v, reason: '', note: '', t: 1 });
describe('team workflow', () => {
  it('splits work and measures agreement', () => {
    expect(genSlices(601, ['A', 'B'], 'batches', 300).map(s => `${s.name}:${s.from}-${s.to}`)).toEqual(['A:1-300', 'B:301-600', 'A:601-601']);
    expect(genSlices(10, ['A', 'B'], 'even', 0).map(s => `${s.name}:${s.from}-${s.to}`)).toEqual(['A:1-5', 'B:6-10']);
    expect(coverage(genSlices(10, ['A', 'B'], 'double', 0), 10)).toEqual({ none: 0, one: 0, multi: 10 });
    expect(kappa([['include', 'include'], ['exclude', 'exclude']]).kappa).toBe(1);
  });
  it('scopes, blinds and resolves', () => {
    let a: any = { ...empty, pid: 'P', me: { id: 'a', name: 'Ann' }, recs: [1, 2, 3, 4].map(rec), decisions: { r1: dec('include'), r2: dec('exclude') } };
    a.plan = freezePlan(a, [{ name: 'ann', from: 1, to: 2 }, { name: 'Bob', from: 3, to: 4 }]);
    expect(scopedRecs({ ...a, scope: { mode: 'plan', from: 1, to: 1 } }).map((r: any) => r.id)).toEqual(['r1', 'r2']);
    expect(scopedRecs({ ...a, scope: { mode: 'range', from: 2, to: 3 } }).map((r: any) => r.id)).toEqual(['r2', 'r3']);
    expect(numbering(a).get('r3')).toBe(3);
    expect(blindState(a).locked).toBe(false);
    expect(blindState({ ...a, decisions: {} }).locked).toBe(true);
    const back = { ...a, others: { b: { name: 'Bob', t: 1, decisions: { r1: dec('exclude') } } } };
    expect(isConflict(back, 'r1')).toBe(true); expect(finalOf(back, 'r1')).toBeUndefined();
    expect(finalOf({ ...back, resolved: { r1: { v: 'include', by: 'a', t: 5 } } }, 'r1')).toBe('include');
    expect(pairStats(back, 'a', 'b').conflicts).toEqual(['r1']);
  });
});
