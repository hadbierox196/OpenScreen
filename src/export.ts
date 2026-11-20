import type { Project } from './store';
import { active } from './shared';
import { finalOf, numbering } from './team';

/** One row per record, one decision column per reviewer, plus the agreed decision. */
export function screenedRows(p: Project, locked: boolean): string[][] {
  const nums = numbering(p), others = locked ? [] : Object.values(p.others);
  const H = ['Title', 'Authors', 'Year', 'Journal', 'DOI', 'Source', 'All sources', 'Decision', 'Reason', 'Notes', 'Record #', `${p.me.name || 'My'} decision`, ...others.map(o => `${o.name} decision`)];
  return [H, ...active(p).map(r => [r.title, r.authors.join('; '), r.year ?? '', r.journal, r.doi, r.sourceDb, (r.sources || []).join(' | '), finalOf(p, r.id, locked) ?? '', p.decisions[r.id]?.reason ?? '', p.decisions[r.id]?.note ?? '', String(nums.get(r.id) ?? ''), p.decisions[r.id]?.v ?? '', ...others.map(o => o.decisions[r.id]?.v ?? '')].map(String))];
}

/** Tidy "long" format: one row per record x reviewer. Best for analysis (pivot tables, R, pandas). */
export function decisionsLong(p: Project, locked: boolean): string[][] {
  const nums = numbering(p), rows: string[][] = [['Record #', 'Record ID', 'Title', 'Year', 'DOI', 'Reviewer', 'Decision', 'Reason', 'Note', 'Decided at']];
  const people = [{ name: p.me.name || 'You', dec: p.decisions }, ...(locked ? [] : Object.values(p.others).map(o => ({ name: o.name, dec: o.decisions })))];
  for (const r of active(p)) for (const x of people) {
    const d = x.dec[r.id]; if (!d) continue;
    rows.push([String(nums.get(r.id) ?? ''), r.id, r.title, r.year ? String(r.year) : '', r.doi, x.name, d.v, d.reason, d.note, new Date(d.t).toISOString()]);
  }
  return [rows[0], ...rows.slice(1).sort((a, b) => (Number(a[0]) - Number(b[0])) || a[5].localeCompare(b[5]))];
}
