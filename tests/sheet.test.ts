import { describe, expect, it } from 'vitest';
import { empty } from '../src/store';
import { decisionRows } from '../src/sheet';
const rec = (i: number) => ({ id: 'r' + i, title: 'T' + i, abstract: '', authors: [], year: 2020, journal: '', volume: '', issue: '', pages: '', doi: '10/x' + i, pmid: '', keywords: [], sourceDb: '', batch: '', raw: '' });
describe('sheet rows', () => {
  it('flattens my decisions into tidy numbered rows', () => {
    const p = { ...empty, pid: 'P', me: { id: 'a', name: 'Ann' }, recs: [1, 2, 3].map(rec), decisions: { r3: { v: 'exclude', reason: 'wrong population', note: '', t: 0 }, r1: { v: 'include', reason: '', note: 'n', t: 0 } } } as never;
    const rows = decisionRows(p);
    expect(rows.map(r => r.slice(0, 2))).toEqual([['1', 'r1'], ['3', 'r3']]);
    expect(rows[1]).toEqual(['3', 'r3', 'T3', '2020', '10/x3', 'Ann', 'a', 'exclude', 'wrong population', '', '1970-01-01T00:00:00.000Z']);
  });
});
