import { segments } from './highlight';
import { byId, rootOf } from './merge';
import type { Project, Verdict } from './store';
import type { Rec } from './core/types';
import type { AiSettings } from './ai';
import { Icon, type IconName } from './ui';

export type Upd = (f: (q: Project) => Project) => void;
export type Tab = 'import' | 'dups' | 'screen' | 'team' | 'table';
export interface AiCtx { s: AiSettings; open: () => void }
export const active = (p: Project) => p.recs.filter(r => !r.mergedInto);

export function download(name: string, rows: string[][]) {
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const b = new Blob(['\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const Hl = ({ text, p }: { text: string; p: Project }) => (
  <>{segments(text, p.inc, p.exc, p.cs).map((s, i) => (s.k ? <mark key={i} className={s.k}>{s.t}</mark> : s.t))}</>
);
export const hitCount = (r: Rec, p: Project) => {
  const s = segments(`${r.title}\n${r.abstract}`, p.inc, p.exc, p.cs);
  return { inc: s.filter(x => x.k === 'inc').length, exc: s.filter(x => x.k === 'exc').length };
};
export function pendingPairs(p: Project) {
  const m = byId(p.recs), seen = new Set<string>(), out: { a: Rec; b: Rec; k: string; score: number }[] = [];
  for (const x of p.pairs) {
    const a = rootOf(m, x.a), b = rootOf(m, x.b); if (!a || !b || a.id === b.id) continue;
    const k = [a.id, b.id].sort().join('|'); if (seen.has(k) || p.kept.includes(k)) continue;
    seen.add(k); out.push({ a, b, k, score: x.score });
  }
  return out.sort((x, y) => y.score - x.score);
}
export const VERDICT: Record<Verdict, { label: string; key: string; icon: IconName }> = {
  include: { label: 'Include', key: 'I', icon: 'check' },
  maybe: { label: 'Maybe', key: 'M', icon: 'help' },
  exclude: { label: 'Exclude', key: 'E', icon: 'x' },
};
export const Badge = ({ v, ai }: { v?: Verdict; ai?: boolean }) =>
  v ? <span className={`badge b-${v}`}>{ai && <Icon n="sparkles" size={12} />}{VERDICT[v].label}</span> : <span className="badge b-none">Undecided</span>;
export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
