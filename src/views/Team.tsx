import { useEffect, useRef, useState } from 'react';
import { empty, type Project, type Slice, type Verdict } from '../store';
import { adoptConfig, adoptProject, blindState, coverage, freezePlan, genSlices, isConflict, kappaLabel, mergeReviewer, pairStats, parseTeamFile, reviewerList, toProjectFile, toReviewerFile, votesFor, type SplitMode } from '../team';
import type { useFolderSync } from '../sync';
import { loadSheet } from '../sheet';
import { Badge, VERDICT, active, type Upd } from '../shared';
import { Empty, Icon, Modal, Num, useToast } from '../ui';

type Sync = ReturnType<typeof useFolderSync>;
const saveJson = (name: string, data: unknown) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 5 ? 'just now' : s < 90 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };
export const STATUS_LABEL: Record<Sync['status'], string> = { off: 'Not connected', 'needs-permission': 'Needs permission', syncing: 'Syncing…', ok: 'Synced', mismatch: 'Different project', error: 'Sync problem' };

function SheetConnect({ sync }: { sync: Sync }) {
  const saved = loadSheet(), [url, setUrl] = useState(saved?.url ?? ''), [token, setToken] = useState(saved?.token ?? '');
  const on = sync.mode === 'sheet';
  return (
    <>
      {on && <div className={`syncline s-${sync.status}`}><Icon n="cloud" size={16} /><b>{STATUS_LABEL[sync.status]}</b>{sync.status === 'ok' && sync.last > 0 && <span className="muted">· {ago(sync.last)}</span>}</div>}
      {sync.mode !== 'folder' && sync.err && <p className="muted small">{sync.err}</p>}
      {!on ? <>
        <input placeholder="Web app URL (…/exec)" value={url} onChange={e => setUrl(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <input placeholder="Token" value={token} onChange={e => setToken(e.target.value)} autoCapitalize="off" autoCorrect="off" style={{ marginTop: 8 }} />
        <div className="row" style={{ marginTop: 8 }}><button className="pri" onClick={() => sync.connectSheet(url, token)}><Icon n="cloud" size={16} />Connect</button></div>
        <p className="muted small">The lead sets this up once (see <code>apps-script/README</code> in the repo) and shares the URL and token. Every decision then lands as a tidy row in their Google Sheet.</p>
      </> : <div className="row">
        <button onClick={() => sync.syncNow()}><Icon n="refresh" size={16} />Sync now</button>
        <button className="ghost" onClick={sync.publish}>Publish project</button>
        <button className="ghost" onClick={sync.disconnect}>Disconnect</button></div>}
    </>
  );
}

export function Team({ p, upd, sync }: { p: Project; upd: Upd; sync: Sync }) {
  const toast = useToast(), file = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState(''), [mode, setMode] = useState<SplitMode>('batches'), [size, setSize] = useState(300);
  const [pending, setPending] = useState<ReturnType<typeof toProjectFile> | null>(null), [switchOpen, setSwitchOpen] = useState(false);
  const [tick, setTick] = useState(0), [A, setA] = useState(''), [B, setB] = useState(''), [shown, setShown] = useState(20);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 5000); return () => clearInterval(t); }, []);

  const total = active(p).length, slices = p.plan?.slices ?? [], cov = coverage(slices, p.plan?.order.length ?? total);
  const setSlices = (s: Slice[]) => upd(q => ({ ...q, plan: { ...(q.plan ?? freezePlan(q, [])), slices: s, t: Date.now() }, cfgRev: Date.now() }));
  const patch = (i: number, x: Partial<Slice>) => setSlices(slices.map((s, k) => (k === i ? { ...s, ...x } : s)));
  const generate = () => {
    const list = names.split(/[,\n]+/).map(x => x.trim()).filter(Boolean);
    if (!list.length) { toast('Enter at least one reviewer name', 'info'); return; }
    upd(q => ({ ...q, plan: freezePlan(q, genSlices(active(q).length, list, mode, size)), cfgRev: Date.now() }));
    toast('Work plan created and numbering frozen');
  };
  const reviewers = reviewerList(p), bs = blindState(p);
  const a = A || p.me.id, b = B || (reviewers.find(r => !r.me)?.id ?? '');
  const st = b ? pairStats(p, a, b) : null;
  const conflicts = active(p).filter(r => isConflict(p, r.id)), resolvedN = Object.keys(p.resolved).length;
  const nameOf = (id: string) => reviewers.find(r => r.id === id)?.name ?? id;

  const onFiles = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      const t = parseTeamFile(await f.text());
      if (!t) { toast(`${f.name}: not an OpenScreen team file`, 'err'); continue; }
      if (t.kind === 'project') { if (p.recs.length && p.pid !== t.pid) setPending(t); else { upd(q => adoptProject(q, t, empty)); toast('Project loaded'); } }
      else if (t.pid !== p.pid) toast(`${f.name} belongs to a different project. Load the lead's project file first.`, 'err');
      else if (t.kind === 'reviewer') { upd(q => mergeReviewer(q, t)); toast(`Decisions from ${t.reviewer.name || 'reviewer'} imported`); }
      else { upd(q => adoptConfig(q, t)); toast('Shared settings imported'); }
    }
    if (file.current) file.current.value = '';
  };
  const resolve = (id: string, v: Verdict) => upd(q => ({ ...q, resolved: { ...q.resolved, [id]: { v, by: q.me.id, t: Date.now() } } }));
  void tick;

  return (
    <div className="stack">
      <section className="card enter">
        <h2>Your reviewer profile</h2>
        <p className="muted">Your name labels your decisions and links you to the ranges in the work plan. Use the same spelling the lead uses there.</p>
        <input placeholder="Your name, e.g. Ann" value={p.me.name} onChange={e => upd(q => ({ ...q, me: { ...q.me, name: e.target.value } }))} />
      </section>

      <section className="card enter" style={{ animationDelay: '50ms' }}>
        <h2>Work plan</h2>
        <p className="muted">Split the {total} records between reviewers, e.g. Ann screens 1–300, Bob 301–600. Numbers are frozen when the plan is created so everyone sees the same #.</p>
        <div className="plan-gen">
          <input placeholder="Reviewers, comma-separated: Ann, Bob, Cara" value={names} onChange={e => setNames(e.target.value)} />
          <div className="row nowrap">
            <select value={mode} onChange={e => setMode(e.target.value as SplitMode)}>
              <option value="batches">Batches, handed out in turn</option><option value="even">One equal block each</option><option value="double">Double screening (each record twice)</option>
            </select>
            {mode === 'batches' && <input type="number" min={1} style={{ width: 96 }} value={size} onChange={e => setSize(+e.target.value)} aria-label="Batch size" title="Batch size" />}
            <button className="pri" onClick={generate} disabled={!total}><Icon n="users" size={16} />Generate</button>
          </div>
        </div>
        {slices.length > 0 && (
          <>
            <div className="slices">
              {slices.map((s, i) => (
                <div className="slice" key={i} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                  <input value={s.name} onChange={e => patch(i, { name: e.target.value })} aria-label="Reviewer" />
                  <input type="number" min={1} value={s.from} onChange={e => patch(i, { from: +e.target.value })} aria-label="From" />
                  <span className="muted">to</span>
                  <input type="number" min={1} value={s.to} onChange={e => patch(i, { to: +e.target.value })} aria-label="To" />
                  <button className="ghost icon" onClick={() => setSlices(slices.filter((_, k) => k !== i))} aria-label="Remove range"><Icon n="trash" size={16} /></button>
                </div>
              ))}
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              <span className="chip ok">{cov.one + cov.multi} assigned</span>{cov.multi > 0 && <span className="chip">{cov.multi} double-covered</span>}{cov.none > 0 && <span className="chip warn">{cov.none} unassigned</span>}
            </div>
          </>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => setSlices([...slices, { name: p.me.name || '', from: 1, to: Math.min(300, total) }])} disabled={!total}><Icon n="plus" size={16} />Add range</button>
          {p.plan && <button className="ghost" onClick={() => { upd(q => ({ ...q, plan: q.plan && freezePlan(q, q.plan.slices), cfgRev: Date.now() })); toast('Numbering refrozen to current records', 'info'); }}>Refreeze numbering</button>}
          {p.plan && <button className="ghost danger" onClick={() => upd(q => ({ ...q, plan: null, scope: q.scope.mode === 'plan' ? { ...q.scope, mode: 'all' } : q.scope, cfgRev: Date.now() }))}>Remove plan</button>}
        </div>
      </section>

      <section className="card enter" style={{ animationDelay: '90ms' }}>
        <div className="row"><h2 className="grow">Blinding</h2>
          <label className="check"><input type="checkbox" checked={p.blind} onChange={e => upd(q => ({ ...q, blind: e.target.checked, cfgRev: Date.now() }))} />Blind screening</label></div>
        <p className="muted">While on, other reviewers' decisions, agreement and conflicts stay hidden until you have decided every record assigned to you.</p>
      </section>

      <section className="card enter" style={{ animationDelay: '130ms' }}>
        <h2>Share &amp; sync</h2>
        <div className="share-grid">
          <div><h3>Live: Google Sheet (any device, incl. Android)</h3>
            <SheetConnect sync={sync} />
          </div>
          <div><h3>Live: shared folder (desktop Chrome / Edge)</h3>
            {!sync.supported ? <div className="note"><Icon n="info" size={16} /><span>Folder sync needs desktop Chrome, Edge or Opera. On a phone use the Google Sheet option.</span></div> : (
              <>
                <div className={`syncline s-${sync.status}`}><Icon n="cloud" size={16} /><b>{STATUS_LABEL[sync.status]}</b>{sync.folder && <span className="muted">· {sync.folder}</span>}{sync.status === 'ok' && sync.last > 0 && <span className="muted">· {ago(sync.last)}</span>}</div>
                {sync.err && <p className="muted small">{sync.err}</p>}
                <div className="row">
                  {sync.status === 'off' ? <button className="pri" onClick={sync.connect}><Icon n="folder" size={16} />Choose shared folder</button> : <>
                    {sync.status === 'needs-permission' && <button className="pri" onClick={sync.reconnect}>Reconnect</button>}
                    {sync.status === 'mismatch' && <button className="pri" onClick={() => setSwitchOpen(true)}>Use the shared project</button>}
                    <button onClick={() => sync.syncNow()} disabled={sync.status === 'needs-permission'}><Icon n="refresh" size={16} />Sync now</button>
                    {p.recs.length > 0 && sync.status === 'ok' && <button className="ghost" onClick={sync.publish}>Publish project</button>}
                    <button className="ghost" onClick={sync.disconnect}>Disconnect</button></>}
                </div>
                {sync.status === 'off' && <p className="muted small">Pick a folder that every reviewer can reach (Dropbox, Google Drive, OneDrive, Syncthing, a network drive). Each person writes only their own file there, so nothing is overwritten.</p>}
              </>
            )}
          </div>
          <div><h3>Files (no folder needed)</h3>
            <div className="row">
              <button onClick={() => { saveJson('openscreen-project.json', toProjectFile(p)); toast('Project exported'); }} disabled={!p.recs.length}><Icon n="download" size={16} />Export project</button>
              <button onClick={() => { saveJson(`decisions-${(p.me.name || 'me').replace(/\W+/g, '_')}.json`, toReviewerFile(p)); toast('Decisions exported'); }} disabled={!p.me.name.trim()}><Icon n="download" size={16} />Export my decisions</button>
              <button onClick={() => file.current?.click()}><Icon n="upload" size={16} />Import file</button>
              <input ref={file} type="file" hidden multiple accept=".json,application/json" onChange={e => onFiles(e.target.files)} />
            </div>
            <p className="muted small">The lead exports the project once and sends it to everyone. Later, reviewers swap decision files. The Import button accepts either kind.</p>
          </div>
        </div>
      </section>

      <section className="card enter" style={{ animationDelay: '170ms' }}>
        <h2>Agreement &amp; conflicts</h2>
        {reviewers.length < 2 ? <Empty icon="users" title="No other reviewers yet">Once another reviewer's decisions arrive by folder or file, agreement and conflicts show up here.</Empty>
          : bs.locked ? (
            <div className="locked"><div className="empty-ic"><Icon n="lock" size={26} /></div>
              <h3>Blinded</h3><p className="muted">Decide your remaining <b><Num v={bs.remaining} /></b> assigned record{bs.remaining === 1 ? '' : 's'} to unlock agreement and conflicts.</p>
              <button className="ghost" onClick={() => upd(q => ({ ...q, blind: false, cfgRev: Date.now() }))}>Unblind now</button></div>
          ) : (
            <>
              <div className="row nowrap pair-sel"><select value={a} onChange={e => setA(e.target.value)}>{reviewers.map(r => <option key={r.id} value={r.id}>{r.name}{r.me ? ' (you)' : ''} · {r.count}</option>)}</select><span className="muted">vs</span>
                <select value={b} onChange={e => setB(e.target.value)}>{reviewers.map(r => <option key={r.id} value={r.id}>{r.name}{r.me ? ' (you)' : ''} · {r.count}</option>)}</select></div>
              {st && a !== b && (
                <div className="stats3">
                  <div className="stat"><strong><Num v={st.n} /></strong><span>Compared</span></div>
                  <div className="stat"><strong>{st.n ? Math.round(st.po * 100) : 0}%</strong><span>Agreement</span></div>
                  <div className="stat"><strong>{isNaN(st.kappa) ? '—' : st.kappa.toFixed(2)}</strong><span>Cohen's κ · {kappaLabel(st.kappa)}</span></div>
                </div>
              )}
              <h3 style={{ marginTop: 16 }}>{conflicts.length} unresolved conflict{conflicts.length === 1 ? '' : 's'}{resolvedN > 0 && <span className="muted"> · {resolvedN} resolved</span>}</h3>
              {conflicts.length === 0 && <p className="muted">No open disagreements.</p>}
              {conflicts.slice(0, shown).map(r => (
                <div className="conflict" key={r.id}>
                  <div className="muted small">{votesFor(p, r.id).length} reviewers</div>
                  <b>{r.title}</b>
                  <div className="votes">{votesFor(p, r.id).map(v => <div key={v.rid} className="vote"><span>{v.name}</span><Badge v={v.v} />{v.reason && <span className="muted small">{v.reason}</span>}</div>)}</div>
                  <div className="decide small-btns">{(Object.keys(VERDICT) as Verdict[]).map(v => <button key={v} className={`d-${v}`} onClick={() => resolve(r.id, v)}><Icon n={VERDICT[v].icon} size={16} />{VERDICT[v].label}</button>)}</div>
                </div>
              ))}
              {conflicts.length > shown && <button className="ghost" onClick={() => setShown(s => s + 20)}>Show more</button>}
            </>
          )}
      </section>

      <Modal open={!!pending} onClose={() => setPending(null)} title="Replace your project?">
        <p className="muted">This file is a different project from the one in your browser. Loading it replaces your records. Your own decisions are kept only for records that also exist in the new project.</p>
        <div className="row end"><button onClick={() => setPending(null)}>Cancel</button><button className="danger solid" onClick={() => { if (pending) upd(q => adoptProject(q, pending, empty)); setPending(null); toast('Project loaded'); }}>Replace</button></div>
      </Modal>
      <Modal open={switchOpen} onClose={() => setSwitchOpen(false)} title="Use the folder's project?">
        <p className="muted">The shared folder holds a different project from the one in your browser. Switching replaces your local records. Export your project first if you want a backup.</p>
        <div className="row end"><button onClick={() => setSwitchOpen(false)}>Cancel</button><button className="danger solid" onClick={() => { setSwitchOpen(false); sync.adoptFromFolder(); }}>Switch</button></div>
      </Modal>
    </div>
  );
}
