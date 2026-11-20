import { useEffect, useMemo, useRef, useState } from 'react';
import { AiError, mergeTerms, screenOne, sleep, suggestKeywords } from '../ai';
import type { Decision, Project, Scope, Verdict } from '../store';
import { myRanges, numbering, scopedRecs } from '../team';
import { etaMinutes, fmtEta, makeDecision, missingReasons, queue, type Filter, type Order } from '../screening';
import { Collapse, Empty, Icon, Spinner, useToast } from '../ui';
import { active, Badge, Hl, hitCount, reducedMotion, VERDICT, type AiCtx, type Upd } from '../shared';

const REASONS = ['Wrong population', 'Wrong intervention', 'Wrong outcome', 'Wrong study design', 'Not in English', 'Full text unavailable'];

export function Screen({ p, upd, ai }: { p: Project; upd: Upd; ai: AiCtx }) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('un'), [order, setOrder] = useState<Order>('orig'), [i, setI] = useState(0), [reason, setReason] = useState(''), [note, setNote] = useState('');
  const [exit, setExit] = useState<Verdict | null>(null), [panel, setPanel] = useState<'kw' | 'crit' | null>(null);
  const [busy, setBusy] = useState(false), [kwBusy, setKwBusy] = useState(false), [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [hist, setHist] = useState<{ id: string; prev?: Decision }[]>([]), [focus, setFocus] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null), t0 = useRef<{ x: number; y: number } | null>(null), session = useRef({ at: Date.now(), n: 0 });
  const [dx, setDx] = useState(0), [jump, setJump] = useState('');
  useEffect(() => () => stop.current?.abort(), []);

  const nums = useMemo(() => numbering(p), [p.recs, p.plan]); // eslint-disable-line
  const act = scopedRecs(p, nums), mine = myRanges(p), list = queue(act, p, nums, filter, order);
  const setScope = (x: Partial<Scope>) => { upd(q => ({ ...q, scope: { ...q.scope, ...x } })); setI(0); };
  const nextBatch = () => {
    const size = Math.max(1, p.scope.to - p.scope.from + 1), from = p.scope.to + 1;
    if (from > nums.size) { toast('You have reached the last record', 'info'); return; }
    setScope({ from, to: Math.min(nums.size, from + size - 1) });
  };
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && p.scope.mode === 'all' && mine.length) { auto.current = true; setScope({ mode: 'plan' }); } }, [p.plan, p.me.name]); // eslint-disable-line
  const idx = Math.max(0, Math.min(i, list.length - 1)), r = list[idx];
  const done = act.filter(x => p.decisions[x.id]).length, pct = act.length ? done / act.length : 0;
  useEffect(() => { const d = r && p.decisions[r.id]; setReason(d ? d.reason : ''); setNote(d ? d.note : ''); }, [r?.id]); // eslint-disable-line
  useEffect(() => { if (!focus) return; const k = list.findIndex(x => x.id === focus); if (k >= 0) { setI(k); setFocus(null); } }); // eslint-disable-line

  const go = (d: number) => setI(Math.max(0, Math.min(list.length - 1, idx + d)));
  const decide = (v: Verdict, aiWhy?: string) => {
    if (!r || exit) return;
    const rec = r, prev = p.decisions[rec.id], d = makeDecision(v, reason, note, aiWhy);
    if (navigator.vibrate) navigator.vibrate(12);
    setExit(v);
    setTimeout(() => {
      upd(q => ({ ...q, decisions: { ...q.decisions, [rec.id]: d } }));
      setHist(h => [...h.slice(-49), { id: rec.id, prev }]);
      if (!prev) session.current.n++;
      // stays in the queue (so step forward) when the filter still shows it; otherwise the next record slides into place
      if (filter === 'all' || (filter === 'maybe' && v === 'maybe')) go(1);
      setExit(null);
    }, reducedMotion() ? 0 : 220);
  };
  const undo = () => {
    const h = hist[hist.length - 1]; if (!h) return;
    setHist(x => x.slice(0, -1)); setFocus(h.id); if (!h.prev) session.current.n = Math.max(0, session.current.n - 1);
    if (filter !== 'all') setFilter('all');
    upd(q => { const d = { ...q.decisions }; if (h.prev) d[h.id] = h.prev; else delete d[h.id]; return { ...q, decisions: d }; });
    toast('Decision undone', 'info');
  };
  const needSetup = () => !p.question.trim() && !p.criteria.trim();
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'AI request failed', 'err');

  const suggest = async () => {
    if (!r) return;
    if (!ai.s.key) return ai.open();
    if (needSetup()) { setPanel('crit'); toast('Add your review question or criteria first', 'info'); return; }
    setBusy(true);
    try { const s = await screenOne(ai.s, r, p); upd(q => ({ ...q, ai: { ...q.ai, [r.id]: s } })); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const runBatch = async () => {
    if (!ai.s.key) return ai.open();
    if (needSetup()) { setPanel('crit'); toast('Add your review question or criteria first', 'info'); return; }
    const todo = act.filter(x => !p.decisions[x.id] && !p.ai[x.id]);
    if (!todo.length) { toast('Nothing left to pre-screen', 'info'); return; }
    const ac = new AbortController(); stop.current = ac; setBatch({ done: 0, total: todo.length });
    let ok = 0, fails = 0;
    for (let n = 0; n < todo.length && !ac.signal.aborted; n++) {
      try { const s = await screenOne(ai.s, todo[n], p, ac.signal); upd(q => ({ ...q, ai: { ...q.ai, [todo[n].id]: s } })); ok++; fails = 0; }
      catch (e) {
        if (ac.signal.aborted) break;
        fails++; const st = e instanceof AiError ? e.status : 0;
        if (st === 401 || st === 402 || fails >= 3) { fail(e); break; }
        if (st === 429) await sleep(12000, ac.signal);
      }
      setBatch({ done: n + 1, total: todo.length });
      await sleep(2500, ac.signal);                                  // stay under free-tier rate limits
    }
    stop.current = null; setBatch(null); toast(`AI pre-screened ${ok} record${ok === 1 ? '' : 's'}`, ok ? 'ok' : 'info');
  };
  const genKeywords = async () => {
    if (!ai.s.key) return ai.open();
    if (!p.question.trim()) { setPanel('crit'); toast('Write your review question first', 'info'); return; }
    setKwBusy(true);
    try { const k = await suggestKeywords(ai.s, p.question, p.criteria); upd(q => ({ ...q, inc: mergeTerms(q.inc, k.include), exc: mergeTerms(q.exc, k.exclude) })); toast('Keywords added'); } catch (e) { fail(e); } finally { setKwBusy(false); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'i') decide('include'); else if (k === 'e') decide('exclude'); else if (k === 'm') decide('maybe');
      else if (k === 'z') undo(); else if (k === 'a') suggest();
      else if (k === 'arrowright' || k === 'j') go(1); else if (k === 'arrowleft' || k === 'k') go(-1);
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  const hc = r ? hitCount(r, p) : { inc: 0, exc: 0 }, cur = r && p.decisions[r.id], sug = r && p.ai[r.id];
  const pending = act.filter(x => !p.decisions[x.id] && !p.ai[x.id]).length;
  return (
    <div className="stack">
      <section className="card toolbar enter">
        <div className="progress"><div style={{ width: `${pct * 100}%` }} /></div>
        <div className="row">
          <span className="muted grow">{list.length ? `${idx + 1} of ${list.length}` : 'All done'} · {done}/{act.length} decided in range{(() => { const m = etaMinutes(session.current.n, session.current.at, act.length - done); return m ? ` · ${fmtEta(m)}` : ''; })()}</span>
          <div className="seg" role="group" aria-label="Filter">
            {([['un', 'Undecided'], ['maybe', `Maybe ${act.filter(x => p.decisions[x.id]?.v === 'maybe').length}`], ['all', 'All']] as [Filter, string][]).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setI(0); }}>{l}</button>)}
          </div>
        </div>
        <div className="row scope">
          <select value={p.scope.mode} onChange={e => setScope({ mode: e.target.value as Scope['mode'] })} aria-label="Which records to screen">
            <option value="all">All records</option>
            <option value="plan" disabled={!mine.length}>My assignment{mine.length ? ` (${mine.map(m => `${m.from}–${m.to}`).join(', ')})` : ''}</option>
            <option value="range">Custom range</option>
          </select>
          {p.scope.mode === 'range' && <>
            <input type="number" min={1} value={p.scope.from} onChange={e => setScope({ from: Math.max(1, +e.target.value || 1) })} aria-label="From record number" />
            <span className="muted">to</span>
            <input type="number" min={1} value={p.scope.to} onChange={e => setScope({ to: Math.max(1, +e.target.value || 1) })} aria-label="To record number" />
            <button onClick={nextBatch}>Next batch<Icon n="right" size={16} /></button></>}
          {p.scope.mode === 'plan' && !mine.length && <span className="muted small">No range for “{p.me.name || 'you'}” yet. Set your name in Team.</span>}
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Order">
            <button className={order === 'orig' ? 'on' : ''} onClick={() => { setOrder('orig'); setI(0); }}>In order</button>
            <button className={order === 'rel' ? 'on' : ''} onClick={() => { setOrder('rel'); setI(0); }} title="Records with the most include-keyword hits first">Most relevant</button>
          </div>
          <input className="jump" inputMode="numeric" placeholder="Go to #" value={jump} onChange={e => setJump(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key !== 'Enter') return; const id = [...nums].find(([, n]) => n === +jump)?.[0], k = list.findIndex(x => x.id === id); if (k >= 0) setI(k); else if (id) { setFilter('all'); setFocus(id); } else toast('No record with that number in range', 'info'); setJump(''); }} aria-label="Go to record number" />
        </div>
        <div className="row">
          <button className={`ghost${panel === 'kw' ? ' on' : ''}`} onClick={() => setPanel(x => (x === 'kw' ? null : 'kw'))}><Icon n="tag" size={16} />Keywords</button>
          <button className={`ghost${panel === 'crit' ? ' on' : ''}`} onClick={() => setPanel(x => (x === 'crit' ? null : 'crit'))}><Icon n="book" size={16} />Review criteria</button>
          <span className="grow" />
          {batch ? <button className="danger" onClick={() => stop.current?.abort()}><Icon n="stop" size={16} />Stop ({batch.done}/{batch.total})</button>
            : <button className="ai" onClick={runBatch} disabled={!act.length}><Icon n="sparkles" size={16} />AI pre-screen{pending > 0 ? ` ${pending}` : ''}</button>}
        </div>
        {batch && <div className="progress ai"><div style={{ width: `${(batch.done / batch.total) * 100}%` }} /></div>}
        <Collapse open={panel === 'kw'}>
          <p className="muted">One per line or comma-separated. Phrases and wildcards work: <code>random*</code>. Green = include, red = exclude.</p>
          <div className="two">
            <textarea className="kw-inc" rows={4} placeholder="Include keywords" value={p.inc} onChange={e => upd(q => ({ ...q, inc: e.target.value }))} />
            <textarea className="kw-exc" rows={4} placeholder="Exclude keywords" value={p.exc} onChange={e => upd(q => ({ ...q, exc: e.target.value }))} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="check"><input type="checkbox" checked={p.cs} onChange={e => upd(q => ({ ...q, cs: e.target.checked }))} />Case-sensitive</label>
            <span className="grow" />
            <button className="ai" onClick={genKeywords} disabled={kwBusy}>{kwBusy ? <Spinner /> : <Icon n="sparkles" size={16} />}Suggest from question</button>
          </div>
        </Collapse>
        <Collapse open={panel === 'crit'}>
          <p className="muted">Used by the AI assistant. Suggestions are only hints; you make every decision.</p>
          <textarea rows={2} placeholder="Review question, e.g. Does exercise improve sleep in older adults?" value={p.question} onChange={e => upd(q => ({ ...q, question: e.target.value }))} />
          <textarea rows={4} style={{ marginTop: 8 }} placeholder={'Inclusion / exclusion criteria, e.g.\nInclude: randomized trials, age 60+\nExclude: animal studies, protocols'} value={p.criteria} onChange={e => upd(q => ({ ...q, criteria: e.target.value }))} />
        </Collapse>
      </section>

      {!r ? (
        <Empty icon={p.recs.length ? 'check' : 'upload'} title={p.recs.length ? (filter === 'maybe' ? 'No “Maybe” records' : 'Nothing left to screen') : 'Import records first'}>{p.recs.length ? (act.length ? (() => { const m = missingReasons(p, act.map(x => x.id)); return `Every record in this range has a decision.${m ? ` ${m} exclusion${m === 1 ? ' has' : 's have'} no reason yet: switch to All to add them.` : ''}`; })() : 'No records in this range. Check your assignment or range.') : 'Your records will appear here for screening.'}</Empty>
      ) : (
        <section key={r.id} className={`card rec enter${exit ? ` exit-${exit}` : ''}${Math.abs(dx) > 60 ? (dx > 0 ? ' sw-inc' : ' sw-exc') : ''}`}
          style={dx && !exit ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: 'none' } : undefined}
          onTouchStart={e => { t0.current = /INPUT|TEXTAREA|SELECT|BUTTON|A/.test((e.target as HTMLElement).tagName) ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
          onTouchMove={e => { const s = t0.current; if (!s) return; const x = e.touches[0].clientX - s.x, y = e.touches[0].clientY - s.y; if (Math.abs(y) > Math.abs(x)) { t0.current = null; setDx(0); } else if (Math.abs(x) > 14) setDx(x); }}
          onTouchEnd={() => { const x = dx; t0.current = null; setDx(0); if (Math.abs(x) > 110) decide(x > 0 ? 'include' : 'exclude'); }}>
          <div className="chips">
            {nums.get(r.id) && <span className="chip num">#{nums.get(r.id)}</span>}{r.year && <span className="chip">{r.year}</span>}{r.journal && <span className="chip">{r.journal}</span>}
            {r.sources && r.sources.length > 1 && <span className="chip">{r.sources.length} sources merged</span>}
            {cur && <Badge v={cur.v} />}
          </div>
          <h2 className="rec-title"><Hl text={r.title} p={p} /></h2>
          <div className="muted">{r.authors.slice(0, 6).join('; ')}{r.authors.length > 6 ? ' et al.' : ''}{r.doi && <> · <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">DOI <Icon n="external" size={12} /></a></>}</div>
          <p className="abstract"><Hl text={r.abstract || '(no abstract)'} p={p} /></p>
          {(hc.inc > 0 || hc.exc > 0) && <div className="chips"><mark className="inc">{hc.inc} include hits</mark><mark className="exc">{hc.exc} exclude hits</mark></div>}

          {busy ? <div className="aibox busy enter"><Spinner /><span className="skel" /></div> : sug ? (
            <div className={`aibox enter s-${sug.v}`}>
              <div className="row"><Icon n="sparkles" size={16} /><b>AI suggests</b><Badge v={sug.v} ai />
                <span className="conf" title="Model confidence"><i style={{ width: `${sug.conf * 100}%` }} /></span><span className="muted">{Math.round(sug.conf * 100)}%</span><span className="grow" />
                <button className="ghost icon" onClick={suggest} aria-label="Ask again" title="Ask again"><Icon n="refresh" size={16} /></button></div>
              <p>{sug.why}</p>
              <div className="row"><button onClick={() => decide(sug.v, sug.why)}>Accept suggestion</button><span className="muted small">{sug.model}</span></div>
            </div>
          ) : <button className="ai wide" onClick={suggest}><Icon n="sparkles" size={16} />Ask AI for a suggestion <kbd>A</kbd></button>}

          <div className="reasons">{REASONS.map(x => <button key={x} className={`chip btn${reason === x ? ' on' : ''}`} onClick={() => setReason(reason === x ? '' : x)}>{x}</button>)}</div>
          <input placeholder="Exclusion reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
          <textarea rows={2} placeholder="Notes" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 8 }} />
          <div className="decide">
            {(Object.keys(VERDICT) as Verdict[]).map(v => (
              <button key={v} className={`d-${v}`} onClick={() => decide(v)}><Icon n={VERDICT[v].icon} size={20} />{VERDICT[v].label}<kbd>{VERDICT[v].key}</kbd></button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={() => go(-1)} disabled={idx === 0}><Icon n="left" size={16} />Prev</button>
            <button className="ghost" onClick={undo} disabled={!hist.length}><Icon n="undo" size={16} />Undo <kbd>Z</kbd></button>
            <span className="grow" />
            <button className="ghost" onClick={() => go(1)} disabled={idx >= list.length - 1}>Next<Icon n="right" size={16} /></button>
          </div>
        </section>
      )}
      {r && <div className="muted small center swipehint">Swipe right to include, left to exclude · tap Maybe to revisit later</div>}
      {r && <div className="muted small center hints">Keys: <kbd>I</kbd> include · <kbd>E</kbd> exclude · <kbd>M</kbd> maybe · <kbd>←</kbd><kbd>→</kbd> navigate</div>}
    </div>
  );
}
