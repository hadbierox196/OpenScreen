import { useMemo, useState, type ChangeEvent } from 'react';
import { dedupe } from '../core/dedup';
import { mergeGroup, undoMerge } from '../merge';
import { judgePair } from '../ai';
import { Collapse, Empty, Icon, Spinner, useToast } from '../ui';
import { active, pendingPairs, type AiCtx, type Upd } from '../shared';
import type { Project } from '../store';
import type { Rec } from '../core/types';

function Diff({ a, b }: { a: Rec; b: Rec }) {
  const rows: [string, string, string][] = [
    ['Title', a.title, b.title], ['Authors', a.authors.join('; '), b.authors.join('; ')], ['Year', String(a.year ?? ''), String(b.year ?? '')],
    ['Journal', a.journal, b.journal], ['Vol/pp', `${a.volume} ${a.pages}`.trim(), `${b.volume} ${b.pages}`.trim()],
    ['DOI', a.doi, b.doi], ['Source', a.sourceDb, b.sourceDb], ['Abstract', a.abstract.slice(0, 250), b.abstract.slice(0, 250)],
  ];
  return <div className="diff">{rows.map(([l, x, y]) => [<b key={l}>{l}</b>, <div key={l + 'a'} className={x !== y ? 'd' : ''}>{x || '—'}</div>, <div key={l + 'b'} className={x !== y ? 'd' : ''}>{y || '—'}</div>])}</div>;
}

export function Dups({ p, upd, ai }: { p: Project; upd: Upd; ai: AiCtx }) {
  const toast = useToast();
  const queue = useMemo(() => pendingPairs(p), [p.recs, p.pairs, p.kept]); // eslint-disable-line
  const [running, setRunning] = useState(false), [tune, setTune] = useState(false);
  const [leaving, setLeaving] = useState<Record<string, 'merge' | 'keep'>>({});
  const [verdicts, setVerdicts] = useState<Record<string, { dup: boolean; conf: number; why: string } | 'busy'>>({});
  const mergedCount = p.recs.length - active(p).length;

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const d = dedupe(active(p), p.th), groups = d.clusters.filter(c => c.length > 1);
      upd(q => {
        let recs = q.recs; const log = [...q.log];
        for (const c of groups) { const r = mergeGroup(recs, c); recs = r.recs; log.push(r.entry); }
        return { ...q, recs, log, pairs: d.pairs.filter(x => x.tier === 'possible') };
      });
      setRunning(false);
      const removed = groups.reduce((n, c) => n + c.length - 1, 0), poss = d.pairs.filter(x => x.tier === 'possible').length;
      toast(removed ? `Merged ${removed} duplicates · ${poss} to review` : `No automatic merges · ${poss} to review`, removed || poss ? 'ok' : 'info');
    }, 60);
  };
  const th = (k: 'auto' | 'possible') => (e: ChangeEvent<HTMLInputElement>) => upd(q => ({ ...q, th: { ...q.th, [k]: +e.target.value } }));
  const leave = (k: string, kind: 'merge' | 'keep', fn: () => void) => {
    setLeaving(l => ({ ...l, [k]: kind }));
    setTimeout(() => { fn(); setLeaving(l => { const n = { ...l }; delete n[k]; return n; }); }, 260);
  };
  const judge = async (k: string, a: Rec, b: Rec) => {
    if (!ai.s.key) { ai.open(); return; }
    setVerdicts(v => ({ ...v, [k]: 'busy' }));
    try { const r = await judgePair(ai.s, a, b); setVerdicts(v => ({ ...v, [k]: r })); }
    catch (e) { setVerdicts(v => { const n = { ...v }; delete n[k]; return n; }); toast(e instanceof Error ? e.message : 'AI request failed', 'err'); }
  };
  const undo = () => { upd(q => { const e = q.log[q.log.length - 1]; return e ? { ...q, recs: undoMerge(q.recs, e), log: q.log.slice(0, -1) } : q; }); toast('Last merge undone', 'info'); };

  return (
    <div className="stack">
      <section className="card enter">
        <div className="row"><h2 className="grow">Deduplication</h2>
          <button className="ghost" onClick={() => setTune(t => !t)} aria-expanded={tune}><Icon n="sliders" size={16} />Thresholds<Icon n="down" size={14} className={tune ? 'flip' : ''} /></button></div>
        <Collapse open={tune}>
          <div className="sliders">
            <label>Auto-merge at or above <b>{p.th.auto.toFixed(2)}</b><input type="range" min="0.6" max="1" step="0.01" value={p.th.auto} onChange={th('auto')} /></label>
            <label>Send to review at or above <b>{p.th.possible.toFixed(2)}</b><input type="range" min="0.5" max={p.th.auto} step="0.01" value={Math.min(p.th.possible, p.th.auto)} onChange={th('possible')} /></label>
          </div>
        </Collapse>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="pri" onClick={run} disabled={running || !p.recs.length}>{running ? <Spinner /> : <Icon n="merge" size={16} />}{running ? 'Working…' : 'Run deduplication'}</button>
          <button disabled={!p.log.length} onClick={undo}><Icon n="undo" size={16} />Undo last merge{p.log.length > 0 && <span className="count">{p.log.length}</span>}</button>
        </div>
        <div className="chips" style={{ marginTop: 12 }}><span className="chip ok">{mergedCount} merged</span><span className="chip warn">{queue.length} to review</span></div>
      </section>

      {queue.length === 0 && <Empty icon="check" title={p.recs.length ? 'Nothing to review' : 'No records yet'}>{p.recs.length ? 'Run deduplication to find possible duplicates, or continue to screening.' : 'Import references first.'}</Empty>}

      {queue.map(({ a, b, k, score }, i) => {
        const v = verdicts[k];
        return (
          <section className={`card pair enter${leaving[k] ? ` leave-${leaving[k]}` : ''}`} key={k} style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
            <div className="row"><span className="grow"><b>Possible duplicate</b></span>
              <span className={`score ${score >= 0.9 ? 'hi' : ''}`}>{Math.round(score * 100)}% match</span></div>
            <Diff a={a} b={b} />
            {v && (
              <div className={`aibox enter ${v === 'busy' ? 'busy' : v.dup ? 'dup' : 'nodup'}`}>
                {v === 'busy' ? <><Spinner /><span className="skel" /></> :
                  <><Icon n="sparkles" size={16} /><div><b>AI: {v.dup ? 'likely the same publication' : 'likely different publications'}</b> <span className="muted">({Math.round(v.conf * 100)}% confident)</span><div className="muted">{v.why}</div></div></>}
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="pri" onClick={() => leave(k, 'merge', () => { upd(q => { const r = mergeGroup(q.recs, [a.id, b.id]); return { ...q, recs: r.recs, log: [...q.log, r.entry] }; }); toast('Records merged'); })}><Icon n="merge" size={16} />Merge</button>
              <button onClick={() => leave(k, 'keep', () => upd(q => ({ ...q, kept: [...q.kept, k] })))}>Keep separate</button>
              <span className="grow" />
              <button className="ai" disabled={v === 'busy'} onClick={() => judge(k, a, b)}><Icon n="sparkles" size={16} />Ask AI</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
