import { useEffect, useState } from 'react';
import type { Project, Slice, Verdict } from '../store';
import { blindState, coverage, freezePlan, genSlices, isConflict, kappaLabel, pairStats, reviewerList, votesFor, type SplitMode } from '../team';
import { isDirty, makeInvite, parseInvite } from '../teamsync';
import type { useTeam } from '../sync';
import { screenedRows } from '../export';
import { Badge, VERDICT, active, download, type Upd } from '../shared';
import { Empty, Icon, Modal, Num, Spinner, useToast } from '../ui';

type Sync = ReturnType<typeof useTeam>;
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 5 ? 'just now' : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

/** Everything about the cloud team: create, invite, sync, finish. */
function TeamPanel({ p, sync }: { p: Project; sync: Sync }) {
  const toast = useToast(), t = p.team;
  const [teamName, setTeamName] = useState(''), [me, setMe] = useState(p.me.name), [paste, setPaste] = useState(''), [fin, setFin] = useState(false);
  const link = t?.lead && t.key ? makeInvite(location.origin + location.pathname, t.tid, t.key) : '';
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title: `Join “${t!.name}” on OpenScreen`, text: 'Tap to join our screening project:', url: link }); return; } } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { window.prompt('Copy the invite link:', link); }
  };
  if (!sync.configured) return (
    <section className="card enter"><h2>Teams</h2>
      <div className="note"><Icon n="info" size={16} /><span>Team sync is not set up in this copy of the app. Add your Firebase settings (see <code>firebase/README.md</code>) and rebuild. Solo screening works without it.</span></div></section>
  );
  if (!t) return (
    <section className="card enter">
      <h2>Work as a team</h2>
      <p className="muted">Create a team and share one invite link. Everyone screens on their own device (phones included); your work stays local until you press <b>Sync</b>.</p>
      <input placeholder="Team or project name" value={teamName} onChange={e => setTeamName(e.target.value)} />
      <input placeholder="Your name" value={me} onChange={e => setMe(e.target.value)} style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="pri" disabled={sync.busy || !p.recs.length || !teamName.trim() || !me.trim()} onClick={() => sync.create(teamName, me)}>{sync.busy ? <Spinner /> : <Icon n="users" size={16} />}Create team &amp; upload</button>
        {sync.busy && sync.step && <span className="muted small">{sync.step}</span>}
      </div>
      {!p.recs.length && <p className="muted small">Import (and deduplicate) your records first. They are uploaded once when you create the team.</p>}
      {sync.err && <p className="err small">{sync.err}</p>}
      <h3 style={{ marginTop: 18 }}>Joining someone else’s team?</h3>
      <p className="muted small">Open the invite link they sent you. If it didn’t open here, paste it:</p>
      <div className="row nowrap"><input placeholder="Invite link" value={paste} onChange={e => setPaste(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <button disabled={!parseInvite(paste)} onClick={() => { const i = parseInvite(paste)!; location.hash = `team=${i.tid}.${i.key}`; location.reload(); }}>Open</button></div>
    </section>
  );
  const dirty = isDirty(p), names = Object.entries(t.members), counts = (id: string) => (id === p.me.id ? Object.keys(p.decisions).length : Object.keys(p.others[id]?.decisions ?? {}).length);
  return (
    <>
      <section className="card enter">
        <div className="row"><h2 className="grow">{t.name}</h2><span className={`chip ${t.lead ? 'ok' : ''}`}>{t.lead ? 'Lead' : 'Reviewer'}</span></div>
        {t.finished ? <div className="note"><Icon n="check" size={16} /><span>This project was finished and removed from the server. Your copy stays on this device. Use the Export tab to save your results.</span></div> : <>
          <div className={`syncline s-${sync.status === 'busy' ? 'syncing' : sync.status}`}><Icon n="cloud" size={16} /><b>{sync.busy ? sync.step || 'Syncing…' : dirty ? 'Changes not synced yet' : 'Everything synced'}</b>{!sync.busy && t.last > 0 && <span className="muted">· last sync {ago(t.last)}</span>}</div>
          {sync.err && <p className="err small">{sync.err}</p>}
          <div className="row"><button className={dirty ? 'pri' : ''} onClick={() => sync.sync()} disabled={sync.busy}><Icon n="refresh" size={16} />Sync now</button>
            {!t.lead && <button className="ghost danger" onClick={sync.leave}>Leave team</button>}</div>
          <p className="muted small">Syncing uploads your decisions and downloads your teammates’. Nothing is sent until you press it.</p></>}
      </section>
      {t.lead && !t.finished && (
        <section className="card enter">
          <h2>Invite link</h2>
          <p className="muted">One link for everyone. They open it, enter their name and start. Anyone with the link can join, so share it only with your team.</p>
          <div className="invite">{link}</div>
          <div className="row"><button className="pri" onClick={share}><Icon n="users" size={16} />Share link</button>
            {p.recs.length > t.nRecs && <button onClick={sync.republish} disabled={sync.busy}>Send {p.recs.length - t.nRecs} new records to team</button>}</div>
        </section>
      )}
      {!t.finished && names.length > 0 && (
        <section className="card enter"><h2>Reviewers</h2>
          <div className="reviewers">{names.map(([id, n]) => <div key={id} className="vote"><span>{id === p.me.id ? `${p.me.name} (you)` : n}</span><span className="muted small">{counts(id)} decided</span></div>)}</div>
        </section>
      )}
      {t.lead && !t.finished && (
        <section className="card enter"><h2>Finish project</h2>
          <p className="muted">When screening is done, finishing downloads the combined results to this device and then deletes the project from the server. Ask everyone to press Sync first.</p>
          <button className="danger" onClick={() => setFin(true)} disabled={sync.busy}>Finish &amp; remove from server…</button></section>
      )}
      <Modal open={fin} onClose={() => setFin(false)} title="Finish and remove from the server?">
        <p className="muted">This syncs one last time, downloads <b>screened.csv</b> with every reviewer’s decisions, then permanently deletes the team’s data from the server. Reviewers keep their own copies. This cannot be undone.</p>
        <div className="reviewers">{names.map(([id, n]) => <div key={id} className="vote"><span>{id === p.me.id ? `${p.me.name} (you)` : n}</span><span className="muted small">{counts(id)} decided</span></div>)}</div>
        <div className="row end" style={{ marginTop: 12 }}><button onClick={() => setFin(false)}>Cancel</button>
          <button className="danger solid" onClick={async () => { setFin(false); await sync.finish(w => download('screened.csv', screenedRows(w, false))); }}>Finish &amp; delete</button></div>
      </Modal>
    </>
  );
}

export function Team({ p, upd, sync }: { p: Project; upd: Upd; sync: Sync }) {
  const canEdit = !p.team || p.team.lead;
  const toast = useToast();
  const [names, setNames] = useState(''), [mode, setMode] = useState<SplitMode>('batches'), [size, setSize] = useState(300);
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

  const resolve = (id: string, v: Verdict) => upd(q => ({ ...q, resolved: { ...q.resolved, [id]: { v, by: q.me.id, t: Date.now() } } }));
  void tick;

  return (
    <div className="stack">
      <TeamPanel p={p} sync={sync} />
      {!p.team && (
        <section className="card enter">
          <h2>Your reviewer profile</h2>
          <p className="muted">Your name labels your decisions and links you to the ranges in the work plan.</p>
          <input placeholder="Your name, e.g. Ann" value={p.me.name} onChange={e => upd(q => ({ ...q, me: { ...q.me, name: e.target.value } }))} />
        </section>
      )}
      {!canEdit && <div className="note"><Icon n="lock" size={16} /><span>The work plan and blinding are set by the team lead and arrive when you sync.</span></div>}
      <fieldset className="plain" disabled={!canEdit}>
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
      </fieldset>

      <section className="card enter" style={{ animationDelay: '170ms' }}>
        <h2>Agreement &amp; conflicts</h2>
        {reviewers.length < 2 ? <Empty icon="users" title="No other reviewers yet">Once your teammates press Sync, their decisions arrive and agreement and conflicts show up here.</Empty>
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
    </div>
  );
}
