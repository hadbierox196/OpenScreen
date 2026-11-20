import type { Pair, Rec } from './core/types';
export type Verdict = 'include' | 'exclude' | 'maybe';
export interface Decision { v: Verdict; reason: string; note: string; t: number }
export interface AiSuggestion { v: Verdict; conf: number; why: string; model: string; t: number }
export interface Reviewer { id: string; name: string }
export interface Resolution { v: Verdict; by: string; t: number }
/** A reviewer's assigned range of record numbers (1-based, inclusive) in the frozen numbering. */
export interface Slice { name: string; from: number; to: number }
export interface Plan { order: string[]; slices: Slice[]; t: number }
export interface Scope { mode: 'all' | 'plan' | 'range'; from: number; to: number }
export interface OtherReviewer { name: string; t: number; decisions: Record<string, Decision> }
/** Link to a cloud team. Everything stays on this device until the person presses Sync. */
export interface TeamLink {
  tid: string; name: string; lead: boolean;
  /** Invite secret (kept only by the lead, who shares it). */
  key: string;
  last: number; finished: boolean;
  /** Signatures of the decision chunks already uploaded, to send only what changed. */
  sent: Record<string, string>;
  /** Newest server time seen in other reviewers' data (incremental pulls). */
  seen: number;
  projRev: number; nRecs: number; cfgSent: number;
  members: Record<string, string>;
}
export interface MergeEntry { master: string; before: Rec; merged: string[]; t: number }
export interface Project {
  recs: Rec[]; pairs: Pair[]; kept: string[]; decisions: Record<string, Decision>;
  inc: string; exc: string; cs: boolean; log: MergeEntry[]; th: { auto: number; possible: number };
  imports: { name: string; parsed: number; skipped: number }[];
  /** Review question + criteria (given to the AI assistant) and its per-record suggestions. Suggestions never count as decisions. */
  question: string; criteria: string; ai: Record<string, AiSuggestion>;
  /** Team: pid identifies the shared project; me is this browser's reviewer identity (never overwritten by imports). */
  pid: string; me: Reviewer; plan: Plan | null; blind: boolean; cfgRev: number; scope: Scope;
  others: Record<string, OtherReviewer>; resolved: Record<string, Resolution>;
  team: TeamLink | null;
}
export const empty: Project = { recs: [], pairs: [], kept: [], decisions: {}, inc: '', exc: '', cs: false, log: [], th: { auto: 0.95, possible: 0.8 }, imports: [], question: '', criteria: '', ai: {},
  pid: '', me: { id: '', name: '' }, plan: null, blind: true, cfgRev: 0, scope: { mode: 'all', from: 1, to: 300 }, others: {}, resolved: {}, team: null };
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('openscreen', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
export async function load(): Promise<Project> {
  try {
    const db = await open();
    return await new Promise(res => {
      const q = db.transaction('kv').objectStore('kv').get('p');
      q.onsuccess = () => res({ ...empty, ...(q.result || {}) }); q.onerror = () => res(empty);
    });
  } catch { return empty; }
}
export async function save(p: Project) {
  try { (await open()).transaction('kv', 'readwrite').objectStore('kv').put(p, 'p'); } catch { /* ignore */ }
}
