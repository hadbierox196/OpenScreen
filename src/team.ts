import type { Rec } from './core/types';
import type { Decision, OtherReviewer, Plan, Project, Resolution, Slice, Verdict } from './store';

export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const active = (p: Project): Rec[] => p.recs.filter(r => !r.mergedInto);
export const sameName = (a: string, b: string) => !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/* ---------- numbering & scope ---------- */
/** Stable record numbers: the plan's frozen order when a plan exists, otherwise current order. */
export function numbering(p: Project): Map<string, number> {
  const ids = p.plan ? p.plan.order : active(p).map(r => r.id);
  return new Map(ids.map((id, i) => [id, i + 1]));
}
export const myRanges = (p: Project): Slice[] => (p.plan ? p.plan.slices.filter(s => sameName(s.name, p.me.name)) : []);
export function scopedRecs(p: Project, nums = numbering(p)): Rec[] {
  const act = active(p), { mode, from, to } = p.scope;
  if (mode === 'range') return act.filter(r => { const n = nums.get(r.id); return n !== undefined && n >= from && n <= to; });
  if (mode === 'plan') { const rs = myRanges(p); return act.filter(r => { const n = nums.get(r.id); return n !== undefined && rs.some(s => n >= s.from && n <= s.to); }); }
  return act;
}

/* ---------- plan generation ---------- */
export type SplitMode = 'batches' | 'even' | 'double';
/** batches: consecutive batches of `size` handed out round-robin. even: one equal block each. double: every record gets two reviewers. */
export function genSlices(total: number, names: string[], mode: SplitMode, size: number): Slice[] {
  const ns = names.map(n => n.trim()).filter(Boolean);
  if (!total || !ns.length) return [];
  const out: Slice[] = [];
  if (mode === 'batches') {
    const b = Math.max(1, Math.floor(size) || 300);
    for (let from = 1, j = 0; from <= total; from += b, j++) out.push({ name: ns[j % ns.length], from, to: Math.min(total, from + b - 1) });
    return out;
  }
  const k = ns.length, chunk = Math.ceil(total / k);
  const block = (i: number): [number, number] => [i * chunk + 1, Math.min(total, (i + 1) * chunk)];
  for (let i = 0; i < k; i++) {
    const [a, b] = block(i); if (a <= b) out.push({ name: ns[i], from: a, to: b });
    if (mode === 'double' && k > 1) { const [c, d] = block((i + 1) % k); if (c <= d) out.push({ name: ns[i], from: c, to: d }); }
  }
  return out;
}
export function coverage(slices: Slice[], total: number) {
  const diff = new Array(total + 2).fill(0);
  for (const s of slices) { const a = Math.max(1, s.from), b = Math.min(total, s.to); if (a <= b) { diff[a]++; diff[b + 1]--; } }
  let cur = 0, none = 0, one = 0, multi = 0;
  for (let i = 1; i <= total; i++) { cur += diff[i]; if (cur === 0) none++; else if (cur === 1) one++; else multi++; }
  return { none, one, multi };
}
export const freezePlan = (p: Project, slices: Slice[]): Plan => ({ order: active(p).map(r => r.id), slices, t: Date.now() });

/* ---------- votes, consensus, agreement ---------- */
export interface Vote { rid: string; name: string; v: Verdict; reason: string }
export function votesFor(p: Project, id: string): Vote[] {
  const out: Vote[] = [];
  const mine = p.decisions[id]; if (mine) out.push({ rid: p.me.id, name: p.me.name || 'You', v: mine.v, reason: mine.reason });
  for (const [rid, o] of Object.entries(p.others)) { const d = o.decisions[id]; if (d) out.push({ rid, name: o.name, v: d.v, reason: d.reason }); }
  return out;
}
/** Resolved decision, else the unanimous vote, else undefined (conflict or unscreened). `mineOnly` is used while blinded. */
export function finalOf(p: Project, id: string, mineOnly = false): Verdict | undefined {
  if (mineOnly) return p.decisions[id]?.v;
  if (p.resolved[id]) return p.resolved[id].v;
  const v = votesFor(p, id);
  return v.length && v.every(x => x.v === v[0].v) ? v[0].v : undefined;
}
export const isConflict = (p: Project, id: string) => { if (p.resolved[id]) return false; const v = votesFor(p, id); return v.length > 1 && v.some(x => x.v !== v[0].v); };

/** Blinding: other reviewers' work is hidden until you have decided everything assigned to you (or everything, with no plan). */
export function blindState(p: Project) {
  const rs = myRanges(p), nums = numbering(p);
  const mine = rs.length ? active(p).filter(r => { const n = nums.get(r.id); return n !== undefined && rs.some(s => n >= s.from && n <= s.to); }) : active(p);
  const remaining = mine.filter(r => !p.decisions[r.id]).length;
  return { locked: p.blind && remaining > 0, remaining, total: mine.length };
}

const CATS: Verdict[] = ['include', 'maybe', 'exclude'];
export function kappa(pairs: [Verdict, Verdict][]) {
  const n = pairs.length; if (!n) return { n: 0, agree: 0, po: 0, kappa: NaN };
  const a: Record<string, number> = {}, b: Record<string, number> = {}; let agree = 0;
  for (const [x, y] of pairs) { a[x] = (a[x] || 0) + 1; b[y] = (b[y] || 0) + 1; if (x === y) agree++; }
  const po = agree / n, pe = CATS.reduce((s, c) => s + ((a[c] || 0) / n) * ((b[c] || 0) / n), 0);
  return { n, agree, po, kappa: pe >= 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe) };
}
export const kappaLabel = (k: number) => isNaN(k) ? '—' : k < 0 ? 'poor' : k <= 0.2 ? 'slight' : k <= 0.4 ? 'fair' : k <= 0.6 ? 'moderate' : k <= 0.8 ? 'substantial' : 'almost perfect';
export function reviewerList(p: Project) {
  return [{ id: p.me.id, name: p.me.name || 'You', count: Object.keys(p.decisions).length, me: true }, ...Object.entries(p.others).map(([id, o]) => ({ id, name: o.name, count: Object.keys(o.decisions).length, me: false }))];
}
export function pairStats(p: Project, a: string, b: string) {
  const dec = (id: string) => (id === p.me.id ? p.decisions : p.others[id]?.decisions || {});
  const A = dec(a), B = dec(b), both: [Verdict, Verdict][] = [], conflicts: string[] = [];
  for (const id of Object.keys(A)) if (B[id]) { both.push([A[id].v, B[id].v]); if (A[id].v !== B[id].v) conflicts.push(id); }
  return { ...kappa(both), conflicts };
}

/* ---------- files ---------- */
export interface ReviewerFile { app: 'openscreen'; kind: 'reviewer'; v: 1; pid: string; reviewer: { id: string; name: string }; t: number; decisions: Record<string, Decision>; resolved: Record<string, Resolution> }
export interface ConfigFile { app: 'openscreen'; kind: 'config'; v: 1; pid: string; cfgRev: number; plan: Plan | null; blind: boolean; question: string; criteria: string; inc: string; exc: string; cs: boolean }
export interface ProjectFile { app: 'openscreen'; kind: 'project'; v: 1; pid: string; exportedAt: number; project: Partial<Project>; from: ReviewerFile }

export const toReviewerFile = (p: Project): ReviewerFile => ({
  app: 'openscreen', kind: 'reviewer', v: 1, pid: p.pid, reviewer: { id: p.me.id, name: p.me.name }, t: Date.now(),
  decisions: p.decisions, resolved: Object.fromEntries(Object.entries(p.resolved).filter(([, r]) => r.by === p.me.id)),
});
export const toConfigFile = (p: Project): ConfigFile => ({ app: 'openscreen', kind: 'config', v: 1, pid: p.pid, cfgRev: p.cfgRev, plan: p.plan, blind: p.blind, question: p.question, criteria: p.criteria, inc: p.inc, exc: p.exc, cs: p.cs });
export function toProjectFile(p: Project): ProjectFile {
  const { recs, pairs, kept, log, th, inc, exc, cs, imports, question, criteria, plan, blind, cfgRev, others, resolved } = p;
  return { app: 'openscreen', kind: 'project', v: 1, pid: p.pid, exportedAt: Date.now(), project: { recs, pairs, kept, log, th, inc, exc, cs, imports, question, criteria, plan, blind, cfgRev, others, resolved }, from: toReviewerFile(p) };
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
export function parseTeamFile(text: string): ReviewerFile | ProjectFile | ConfigFile | null {
  try { const j = JSON.parse(text); return isObj(j) && j.app === 'openscreen' && (j.kind === 'reviewer' || j.kind === 'project' || j.kind === 'config') && typeof j.pid === 'string' ? (j as never) : null; } catch { return null; }
}

/** Merge one reviewer's file into the project. Returns the same object when nothing changed (avoids save/sync loops). */
export function mergeReviewer(p: Project, f: ReviewerFile): Project {
  if (f.pid !== p.pid || !f.reviewer?.id || f.reviewer.id === p.me.id || !isObj(f.decisions)) return p;
  const known = new Set(p.recs.map(r => r.id)), prev = p.others[f.reviewer.id];
  let changed = false, others = p.others, resolved = p.resolved;
  if (!prev || f.t > prev.t) {
    const decisions = Object.fromEntries(Object.entries(f.decisions).filter(([id]) => known.has(id)));
    if (!prev || prev.name !== f.reviewer.name || JSON.stringify(prev.decisions) !== JSON.stringify(decisions)) {
      others = { ...p.others, [f.reviewer.id]: { name: f.reviewer.name || 'Reviewer', t: f.t, decisions } as OtherReviewer }; changed = true;
    }
  }
  for (const [id, r] of Object.entries(f.resolved || {})) if (known.has(id) && (!resolved[id] || r.t > resolved[id].t) && resolved[id]?.v !== r.v) { if (resolved === p.resolved) resolved = { ...resolved }; resolved[id] = r; changed = true; }
  return changed ? { ...p, others, resolved } : p;
}
/** Adopt shared settings (plan, blinding, criteria, keywords) when the remote revision is newer. */
export function adoptConfig(p: Project, c: ConfigFile): Project {
  if (c.pid !== p.pid || c.cfgRev <= p.cfgRev) return p;
  return { ...p, cfgRev: c.cfgRev, plan: c.plan, blind: c.blind, question: c.question, criteria: c.criteria, inc: c.inc, exc: c.exc, cs: c.cs };
}
/** Replace the local project with a shared one, keeping this browser's identity, scope and own decisions for records that still exist. */
export function adoptProject(local: Project, f: ProjectFile, empty: Project): Project {
  const pr = f.project, recs = pr.recs || [], known = new Set(recs.map(r => r.id));
  const mine = Object.fromEntries(Object.entries(local.decisions).filter(([id]) => known.has(id)));
  const base: Project = { ...empty, ...pr, pid: f.pid, me: local.me, scope: local.scope, decisions: mine, ai: {}, others: { ...(pr.others || {}) }, resolved: { ...(pr.resolved || {}) } } as Project;
  delete base.others[local.me.id];
  return mergeReviewer(base, f.from);
}
