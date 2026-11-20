import type { Rec } from './core/types';
import type { Decision, Project, Verdict } from './store';
import { segments } from './highlight';

export type Filter = 'un' | 'maybe' | 'all';
export type Order = 'orig' | 'rel';

/** Keyword relevance: include hits count +1 (title hits +2), exclude hits -1 (title -2). Used only to order the queue, never to decide. */
export function relevance(r: Rec, p: Pick<Project, 'inc' | 'exc' | 'cs'>): number {
  const score = (text: string, w: number) => segments(text, p.inc, p.exc, p.cs).reduce((s, x) => s + (x.k === 'inc' ? w : x.k === 'exc' ? -w : 0), 0);
  return score(r.title, 2) + score(r.abstract, 1);
}

/** Which records to show: by filter, optionally most relevant first (ties keep the frozen record number order). */
export function queue(recs: Rec[], p: Project, nums: Map<string, number>, filter: Filter, order: Order): Rec[] {
  const keep = recs.filter(r => { const d = p.decisions[r.id]; return filter === 'all' || (filter === 'un' ? !d : d?.v === 'maybe'); });
  const n = (r: Rec) => nums.get(r.id) ?? Infinity;
  if (order === 'orig') return keep.sort((a, b) => n(a) - n(b));
  const s = new Map(keep.map(r => [r.id, relevance(r, p)]));
  return keep.sort((a, b) => (s.get(b.id)! - s.get(a.id)!) || n(a) - n(b));
}

/** What gets stored: a reason only means something for an exclusion, and the AI's rationale goes in the note, never in the reason column. */
export function makeDecision(v: Verdict, reason: string, note: string, aiWhy?: string, t = Date.now()): Decision {
  const n = [note.trim(), aiWhy ? `AI: ${aiWhy.trim()}` : ''].filter(Boolean).join(' | ');
  return { v, reason: v === 'exclude' ? reason.trim() : '', note: n, t };
}

/** Minutes left at this session's pace; undefined until there is enough data to say. */
export function etaMinutes(decidedThisSession: number, startedAt: number, remaining: number, now = Date.now()): number | undefined {
  const mins = (now - startedAt) / 60000;
  if (decidedThisSession < 5 || mins <= 0 || remaining <= 0) return undefined;
  return Math.max(1, Math.round(remaining / (decidedThisSession / mins)));
}
export const fmtEta = (m: number) => (m < 60 ? `~${m} min left` : `~${Math.floor(m / 60)} h ${m % 60} min left`);

/** Exclusions that have no reason yet (for a quick audit before export). */
export const missingReasons = (p: Project, ids: string[]) => ids.filter(id => p.decisions[id]?.v === 'exclude' && !p.decisions[id].reason).length;
