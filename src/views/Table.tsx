import { useMemo, useState } from 'react';
import { byId, rootOf } from '../merge';
import type { Project } from '../store';
import type { Rec } from '../core/types';
import { Icon, Num } from '../ui';
import { active, Badge, download, hitCount } from '../shared';
import { decisionsLong, screenedRows } from '../export';
import { blindState, finalOf, isConflict, numbering } from '../team';

export function Table({ p }: { p: Project }) {
  const [q, setQ] = useState(''), [f, setF] = useState('all'), [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: 'title', d: 1 }), [page, setPage] = useState(0);
  const m = useMemo(() => byId(p.recs), [p.recs]), locked = blindState(p).locked, nums = useMemo(() => numbering(p), [p.recs, p.plan]);
  const fin = (id: string) => finalOf(p, id, locked);
  const rows = useMemo(() => {
    const val = (r: Rec, k: string): string | number => k === 'year' ? r.year ?? 0 : k === 'num' ? nums.get(r.id) ?? 0 : k === 'decision' ? fin(r.id) ?? '' : k === 'hits' ? hitCount(r, p).inc : k === 'journal' ? r.journal : r.title;
    return active(p).filter(r => (f === 'all' || (fin(r.id) ?? 'undecided') === f) && (!q || `${r.title} ${r.authors.join(' ')} ${r.doi}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => (val(a, sort.k) > val(b, sort.k) ? 1 : -1) * sort.d);
  }, [p, q, f, sort]);
  const act = active(p), n = (v: string) => act.filter(r => fin(r.id) === v).length;
  const merged = p.recs.filter(r => r.mergedInto), undecided = act.length - n('include') - n('exclude') - n('maybe');
  const th = (k: string, l: string) => <th className="sortable" onClick={() => setSort(s => ({ k, d: s.k === k ? (-s.d as 1 | -1) : 1 }))}>{l}{sort.k === k && <Icon n="down" size={12} className={sort.d > 0 ? 'flip' : ''} />}</th>;
  const steps: [string, number, string][] = [['Identified', p.recs.length, ''], ['Duplicates removed', merged.length, 'muted'], ['Screened', act.length, ''], ['Included', n('include'), 'ok'], ['Excluded', n('exclude'), 'bad'], ['Maybe', n('maybe'), 'warn'], ['Undecided', undecided, 'muted']];
  const exports: [string, () => void][] = [
    ['Deduplicated', () => download('deduplicated.csv', screenedRows(p, locked).map(r => r.slice(0, 7)))],
    ['Screened', () => download('screened.csv', screenedRows(p, locked))],
    ['All decisions (long)', () => download('decisions-long.csv', decisionsLong(p, locked))],
    ['Duplicates report', () => download('duplicates-report.csv', [['Removed title', 'DOI', 'Merged into'], ...merged.map(r => [r.title, r.doi, rootOf(m, r.id)?.title ?? ''])])],
    ['PRISMA', () => download('prisma.csv', [['Stage', 'Count'], ...steps.map(([l, c]) => [l, String(c)])])],
  ];
  return (
    <div className="stack">
      <section className="card enter">
        <h2>PRISMA counts</h2>{locked && <p className="muted small">Blinded: counts show only your own decisions until you finish your assigned records.</p>}
        <div className="flow">{steps.map(([l, c, t], i) => (
          <div key={l} className={`step ${t}`} style={{ animationDelay: `${i * 55}ms` }}><strong><Num v={c} /></strong><span>{l}</span></div>
        ))}</div>
        <div className="row" style={{ marginTop: 14 }}>{exports.map(([l, fn]) => <button key={l} onClick={fn}><Icon n="download" size={16} />{l} CSV</button>)}</div>
      </section>
      <div className="row filters enter">
        <div className="search"><Icon n="search" size={16} /><input placeholder="Search title, author, DOI" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} /></div>
        <select value={f} onChange={e => { setF(e.target.value); setPage(0); }}>{['all', 'undecided', 'include', 'exclude', 'maybe'].map(x => <option key={x}>{x}</option>)}</select>
        <span className="muted">{rows.length} records</span>
      </div>
      <div className="card scroll enter"><table><thead><tr>{th('num', '#')}{th('title', 'Title')}<th>Authors</th>{th('year', 'Year')}{th('journal', 'Journal')}<th>DOI</th>{th('decision', 'Decision')}<th>AI</th>{th('hits', 'Hits')}</tr></thead>
        <tbody>{rows.slice(page * 100, page * 100 + 100).map(r => { const h = hitCount(r, p), s = p.ai[r.id]; return (
          <tr key={r.id}><td className="muted">{nums.get(r.id)}</td><td className="t-title">{r.title}</td><td>{r.authors.slice(0, 2).join('; ')}{r.authors.length > 2 ? ' …' : ''}</td><td>{r.year}</td><td>{r.journal}</td>
            <td>{r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">{r.doi}</a>}</td>
            <td><Badge v={fin(r.id)} />{!locked && isConflict(p, r.id) && <span className="chip warn" style={{ marginLeft: 6 }}>conflict</span>}</td><td>{s ? <Badge v={s.v} ai /> : <span className="muted">—</span>}</td>
            <td><mark className="inc">{h.inc}</mark> <mark className="exc">{h.exc}</mark></td></tr>); })}</tbody></table>
        {rows.length === 0 && <p className="muted center">No records match.</p>}
      </div>
      <div className="row"><button disabled={!page} onClick={() => setPage(page - 1)}><Icon n="left" size={16} />Prev</button>
        <span className="muted">Page {page + 1} of {Math.max(1, Math.ceil(rows.length / 100))}</span>
        <button disabled={(page + 1) * 100 >= rows.length} onClick={() => setPage(page + 1)}>Next<Icon n="right" size={16} /></button></div>
    </div>
  );
}
