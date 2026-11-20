import type { Rec } from './core/types';
import { empty, type Decision, type Plan, type Project, type Resolution, type Slice, type TeamLink } from './store';

/* Pure helpers for cloud teams: chunking, merging, config, invite links. No network here, so everything is unit-tested. */

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;
/** A Firestore document is limited to 1 MiB; stay well under it. */
export const CHUNK_BYTES = 600_000;
/** Decisions are spread over a fixed number of buckets by record id, so chunks stay stable when records are merged or added. */
export const BUCKETS = 16;

export const sig = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return `${s.length}:${h}`; };
export const bucket = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % BUCKETS; };

/* ---------- project upload ---------- */
/** Records without the heavy parts (raw text); merged duplicates are reduced to a stub because nobody screens them. */
export const slim = (r: Rec): Rec => ({ ...r, raw: '', ...(r.mergedInto ? { abstract: '', authors: [], keywords: [] } : {}) });
export function chunkRecs(recs: Rec[], max = CHUNK_BYTES): string[] {
  const out: string[] = []; let cur: Rec[] = [], size = 2;
  for (const r of recs.map(slim)) {
    const n = bytes(JSON.stringify(r)) + 1;
    if (cur.length && size + n > max) { out.push(JSON.stringify(cur)); cur = []; size = 2; }
    cur.push(r); size += n;
  }
  if (cur.length || !out.length) out.push(JSON.stringify(cur));
  return out;
}

/* ---------- shared settings ---------- */
export interface Cfg { plan: { idx: number[]; slices: Slice[]; t: number } | null; blind: boolean; question: string; criteria: string; inc: string; exc: string; cs: boolean }
/** The plan's frozen order is sent as positions in the record list (compact), not as ids. */
export function toCfg(p: Project): Cfg {
  const ix = new Map(p.recs.map((r, i) => [r.id, i]));
  return { plan: p.plan ? { idx: p.plan.order.map(id => ix.get(id) ?? -1).filter(i => i >= 0), slices: p.plan.slices, t: p.plan.t } : null, blind: p.blind, question: p.question, criteria: p.criteria, inc: p.inc, exc: p.exc, cs: p.cs };
}
export function applyCfg(p: Project, c: Cfg, rev: number): Project {
  const plan: Plan | null = c.plan ? { order: c.plan.idx.map(i => p.recs[i]?.id).filter((x): x is string => !!x), slices: c.plan.slices, t: c.plan.t } : null;
  return { ...p, cfgRev: rev, plan, blind: c.blind, question: c.question, criteria: c.criteria, inc: c.inc, exc: c.exc, cs: c.cs };
}

/* ---------- decisions ---------- */
export function decisionChunks(p: Project): Map<number, string> {
  const by = new Map<number, Record<string, Decision>>();
  for (const [id, d] of Object.entries(p.decisions)) { const k = bucket(id); if (!by.has(k)) by.set(k, {}); by.get(k)![id] = d; }
  return new Map([...by].map(([k, v]) => [k, JSON.stringify(v)]));
}
export const myResolutions = (p: Project): Record<string, Resolution> => Object.fromEntries(Object.entries(p.resolved).filter(([, r]) => r.by === p.me.id));
/** Chunks whose content differs from what was last uploaded (an emptied chunk is uploaded as {}). */
export function pendingChunks(p: Project, sent: Record<string, string>): { k: number; json: string }[] {
  const cur = decisionChunks(p), out: { k: number; json: string }[] = [];
  for (const [k, json] of cur) if (sent[k] !== sig(json)) out.push({ k, json });
  for (const k of Object.keys(sent)) if (k !== 'res' && !cur.has(+k) && sent[k] !== sig('{}')) out.push({ k: +k, json: '{}' });
  return out;
}
export function pendingResolutions(p: Project, sent: Record<string, string>): string | null {
  const r = myResolutions(p), json = JSON.stringify(r);
  return (Object.keys(r).length || sent.res) && sent.res !== sig(json) ? json : null;
}
export const isDirty = (p: Project) => !!p.team && !p.team.finished && (pendingChunks(p, p.team.sent).length > 0 || pendingResolutions(p, p.team.sent) !== null || (p.team.lead && p.cfgRev > p.team.cfgSent));

/** Apply one downloaded decision chunk. Another reviewer's chunk replaces what we hold for that bucket; our own is only used to restore missing decisions (new device). */
export function mergeChunk(p: Project, rid: string, name: string, bucketNo: number, json: string, t: number): Project {
  let d: Record<string, Decision>; try { d = JSON.parse(json); } catch { return p; }
  const ids = p.recs.filter(r => bucket(r.id) === bucketNo).map(r => r.id);
  if (rid === p.me.id) {
    const dec = { ...p.decisions }; let changed = false;
    for (const id of ids) if (!dec[id] && d[id]) { dec[id] = d[id]; changed = true; }
    return changed ? { ...p, decisions: dec } : p;
  }
  const prev = p.others[rid], base = { ...(prev?.decisions || {}) };
  for (const id of ids) { if (d[id]) base[id] = d[id]; else delete base[id]; }
  return { ...p, others: { ...p.others, [rid]: { name: name || prev?.name || 'Reviewer', t: Math.max(t, prev?.t ?? 0), decisions: base } } };
}
export function mergeResolutions(p: Project, json: string): Project {
  let r: Record<string, Resolution>; try { r = JSON.parse(json); } catch { return p; }
  const known = new Set(p.recs.map(x => x.id)); let resolved = p.resolved;
  for (const [id, x] of Object.entries(r)) if (known.has(id) && (!resolved[id] || x.t > resolved[id].t) && resolved[id]?.v !== x.v) { if (resolved === p.resolved) resolved = { ...resolved }; resolved[id] = x; }
  return resolved === p.resolved ? p : { ...p, resolved };
}

/* ---------- joining ---------- */
export function buildJoined(a: { tid: string; name: string; uid: string; myName: string; recs: Rec[]; cfg: Cfg | null; cfgRev: number; projRev: number }): Project {
  const link: TeamLink = { tid: a.tid, name: a.name, lead: false, key: '', last: Date.now(), finished: false, sent: {}, seen: 0, projRev: a.projRev, nRecs: a.recs.length, cfgSent: 0, members: {} };
  const base: Project = { ...empty, recs: a.recs, pid: a.tid, me: { id: a.uid, name: a.myName }, team: link };
  return a.cfg ? applyCfg(base, a.cfg, a.cfgRev) : { ...base, cfgRev: a.cfgRev };
}

/* ---------- invite link: https://app/#team=<id>.<key> (the hash is never sent to a server) ---------- */
const ALPHA = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomKey(n = 24): string { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map(x => ALPHA[x % ALPHA.length]).join(''); }
export const makeInvite = (base: string, tid: string, key: string) => `${base.split('#')[0]}#team=${tid}.${key}`;
export function parseInvite(text: string): { tid: string; key: string } | null {
  const m = /team=([A-Za-z0-9]{10,40})\.([A-Za-z0-9]{16,64})/.exec(text);
  return m ? { tid: m[1], key: m[2] } : null;
}
