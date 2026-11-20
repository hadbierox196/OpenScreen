import { describe, expect, it } from 'vitest';
import { empty } from '../src/store';
import { applyCfg, bucket, buildJoined, chunkRecs, decisionChunks, isDirty, makeInvite, mergeChunk, mergeResolutions, parseInvite, pendingChunks, pendingResolutions, sig, toCfg } from '../src/teamsync';
import { freezePlan } from '../src/team';
const rec = (i: number, extra: object = {}) => ({ id: `file.ris#99-${i}`, title: 'T' + i, abstract: 'abs ' + 'x'.repeat(200), authors: ['A'], journal: '', volume: '', issue: '', pages: '', doi: '', pmid: '', keywords: [], sourceDb: '', batch: '', raw: 'RAW'.repeat(100), ...extra });
const dec = (v: 'include' | 'exclude' | 'maybe', t = 1) => ({ v, reason: '', note: '', t });
const proj = (n = 40): any => ({ ...empty, pid: 'T', me: { id: 'a', name: 'Ann' }, recs: Array.from({ length: n }, (_, i) => rec(i)) });

describe('cloud team helpers', () => {
  it('chunks records under the size limit, strips raw text, keeps order', () => {
    const recs = Array.from({ length: 50 }, (_, i) => rec(i));
    const chunks = chunkRecs(recs as any, 3000);
    expect(chunks.length).toBeGreaterThan(3);
    const back = chunks.flatMap(c => JSON.parse(c));
    expect(back.map((r: any) => r.id)).toEqual(recs.map(r => r.id));
    expect(back.every((r: any) => r.raw === '')).toBe(true);
    expect(chunks.every(c => new TextEncoder().encode(c).length <= 3000 + 700)).toBe(true);
    expect(chunkRecs([], 100)).toEqual(['[]']);
    expect(JSON.parse(chunkRecs([rec(1, { mergedInto: 'x' })] as any)[0])[0].abstract).toBe('');
  });
  it('uploads only changed decision buckets, and empties a bucket after undo', () => {
    let p = proj(); p = { ...p, decisions: { [p.recs[0].id]: dec('include'), [p.recs[1].id]: dec('exclude') } };
    const first = pendingChunks(p, {}); expect(first.length).toBeGreaterThan(0);
    const sent = Object.fromEntries(first.map(c => [c.k, sig(c.json)]));
    expect(pendingChunks(p, sent)).toEqual([]);
    const p2 = { ...p, decisions: { ...p.decisions, [p.recs[2].id]: dec('maybe') } };
    expect(pendingChunks(p2, sent).map(c => c.k)).toEqual([bucket(p.recs[2].id)].filter(k => true));
    const p3 = { ...p, decisions: {} };
    expect(pendingChunks(p3, sent).every(c => c.json === '{}')).toBe(true);
    expect(pendingChunks(p3, sent).length).toBe(first.length);
  });
  it('merges another reviewer per bucket, including deletions, without touching mine', () => {
    const p = proj(), ids = p.recs.map((r: any) => r.id), k0 = bucket(ids[0]);
    const inB = ids.filter((i: string) => bucket(i) === k0);
    let q = mergeChunk(p, 'b', 'Bob', k0, JSON.stringify({ [inB[0]]: dec('include') }), 10);
    expect(q.others.b.decisions[inB[0]].v).toBe('include'); expect(q.others.b.name).toBe('Bob');
    q = mergeChunk(q, 'b', 'Bob', k0, '{}', 20);
    expect(q.others.b.decisions[inB[0]]).toBeUndefined();            // deletion propagates
    expect(q.others.b.t).toBe(20);
    expect(mergeChunk(p, 'b', 'Bob', 0, 'not json', 1)).toBe(p);
    // own data only restores what is missing
    const mine = { ...p, decisions: { [inB[0]]: dec('exclude', 9) } };
    const r = mergeChunk(mine, 'a', 'Ann', k0, JSON.stringify({ [inB[0]]: dec('include'), ...(inB[1] ? { [inB[1]]: dec('maybe') } : {}) }), 1);
    expect(r.decisions[inB[0]].v).toBe('exclude');
    if (inB[1]) expect(r.decisions[inB[1]].v).toBe('maybe');
  });
  it('syncs resolutions newest-wins and tracks dirtiness', () => {
    const p = proj(), id = p.recs[0].id;
    const a = mergeResolutions(p, JSON.stringify({ [id]: { v: 'include', by: 'b', t: 5 }, ghost: { v: 'exclude', by: 'b', t: 5 } }));
    expect(a.resolved[id].v).toBe('include'); expect(a.resolved.ghost).toBeUndefined();
    expect(mergeResolutions(a, JSON.stringify({ [id]: { v: 'exclude', by: 'b', t: 3 } }))).toBe(a);
    const link = { tid: 't', name: 'n', lead: false, key: '', last: 0, finished: false, sent: {}, seen: 0, projRev: 1, nRecs: 40, cfgSent: 0, members: {} };
    const t = { ...p, team: link };
    expect(isDirty(t)).toBe(false);
    expect(isDirty({ ...t, decisions: { [id]: dec('include') } })).toBe(true);
    expect(isDirty({ ...t, resolved: { [id]: { v: 'include', by: 'a', t: 1 } } })).toBe(true);
    expect(pendingResolutions({ ...t, resolved: { [id]: { v: 'include', by: 'b', t: 1 } } }, {})).toBeNull(); // others' resolutions are not mine to send
    expect(isDirty({ ...t, team: { ...link, lead: true }, cfgRev: 5 })).toBe(true);
    expect(isDirty({ ...t, team: { ...link, finished: true }, decisions: { [id]: dec('include') } })).toBe(false);
    expect(isDirty(p)).toBe(false);
  });
  it('round-trips shared settings with the plan as positions', () => {
    let p = proj(10); p = { ...p, inc: 'random*', question: 'Q?' };
    p.plan = freezePlan(p, [{ name: 'Ann', from: 1, to: 5 }]);
    const cfg = toCfg(p); expect(cfg.plan!.idx).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const joiner = applyCfg({ ...proj(10), me: { id: 'b', name: 'Bob' } }, JSON.parse(JSON.stringify(cfg)), 7);
    expect(joiner.plan!.order).toEqual(p.plan.order); expect(joiner.cfgRev).toBe(7); expect(joiner.inc).toBe('random*');
    const j = buildJoined({ tid: 'T', name: 'Team', uid: 'u', myName: 'Bob', recs: p.recs, cfg, cfgRev: 3, projRev: 9 });
    expect(j.pid).toBe('T'); expect(j.me).toEqual({ id: 'u', name: 'Bob' }); expect(j.team!.lead).toBe(false); expect(j.plan!.slices[0].name).toBe('Ann'); expect(Object.keys(j.decisions)).toHaveLength(0);
  });
  it('makes and parses invite links', () => {
    const link = makeInvite('https://app.example/os/#old', 'AbCdEfGhIjKlMnOp1234', 'k3yk3yk3yk3yk3yk3yk3yk3y');
    expect(link.startsWith('https://app.example/os/#team=')).toBe(true);
    expect(parseInvite(new URL(link).hash)).toEqual({ tid: 'AbCdEfGhIjKlMnOp1234', key: 'k3yk3yk3yk3yk3yk3yk3yk3y' });
    expect(parseInvite('#nothing')).toBeNull(); expect(parseInvite('#team=short.x')).toBeNull();
  });
});
