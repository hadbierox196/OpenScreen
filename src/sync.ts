import { useCallback, useRef, useState } from 'react';
import * as cloud from './cloud';
import type { Project, TeamLink } from './store';
import type { Upd } from './shared';
import { applyCfg, buildJoined, mergeChunk, mergeResolutions, pendingChunks, pendingResolutions, sig } from './teamsync';

export type Notify = (text: string, kind?: 'ok' | 'err' | 'info') => void;
export type SyncStatus = 'idle' | 'busy' | 'ok' | 'error';

const nice = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? '', m = e instanceof Error ? e.message : '';
  if (code.includes('permission-denied')) return 'No access. The invite may be wrong, or the project was finished or removed.';
  if (code.includes('unavailable') || /network|offline|failed to fetch/i.test(m)) return 'No connection. Your work is safe on this device; press Sync again when you are online.';
  if (code.includes('resource-exhausted')) return 'The free Firebase quota is used up for today. Try again tomorrow.';
  if (code.includes('operation-not-allowed')) return 'Anonymous sign-in is switched off in the Firebase console (Authentication, Sign-in method).';
  return m || 'Something went wrong.';
};

/** Local-first team sync. Nothing leaves this device until create / join / sync / finish is pressed. */
export function useTeam(p: Project, upd: Upd, notify: Notify) {
  const [status, setStatus] = useState<SyncStatus>('idle'), [err, setErr] = useState(''), [step, setStep] = useState('');
  const pr = useRef(p), busy = useRef(false); pr.current = p;
  const prog = (what: string) => (d: number, t: number) => setStep(`${what} ${d}/${t}…`);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true; setStatus('busy'); setErr('');
    try { const r = await fn(); setStatus('ok'); return r; }
    catch (e) { setStatus('error'); setErr(nice(e)); return undefined; }
    finally { busy.current = false; setStep(''); }
  }, []);

  const patchTeam = (f: (t: TeamLink) => TeamLink) => (q: Project): Project => (q.team ? { ...q, team: f(q.team) } : q);

  /** Lead: create the team and upload the project in one go. */
  const create = (teamName: string, myName: string) => run(async () => {
    const local = pr.current; if (!local.recs.length) throw new Error('Import records first.');
    setStep('Signing in…'); const uid = await cloud.signIn();
    const base: Project = { ...local, me: { id: uid, name: myName.trim() }, cfgRev: local.cfgRev || Date.now() };
    const r = await cloud.createTeam(base, teamName.trim(), prog('Uploading'));
    upd(q => ({ ...q, pid: r.tid, me: base.me, cfgRev: base.cfgRev, team: { tid: r.tid, key: r.key, name: teamName.trim(), lead: true, last: Date.now(), finished: false, sent: {}, seen: 0, projRev: r.projRev, nRecs: r.nRecs, cfgSent: base.cfgRev, members: {} } }));
    notify('Team created. Share the invite link.');
  });

  /** Reviewer: join with the invite link; the project is downloaded once. */
  const join = (tid: string, key: string, myName: string) => run(async () => {
    const r = await cloud.joinTeam(tid, key, myName.trim(), prog('Downloading'));
    upd(() => buildJoined({ tid, name: r.name, uid: r.uid, myName: myName.trim(), recs: r.recs, cfg: r.cfg, cfgRev: r.cfgRev, projRev: r.projRev }));
    notify(`Joined “${r.name}”`);
    return true;
  });

  /** Push my changes, pull everyone else's. Returns the merged project. */
  const syncCore = async (): Promise<Project> => {
    let work = pr.current; const t0 = work.team; if (!t0 || t0.finished) return work;
    const apply = (f: (q: Project) => Project) => { work = f(work); upd(f); };
    setStep('Signing in…'); const uid = await cloud.signIn();
    if (uid !== work.me.id) throw new Error('This browser’s sign-in changed. Open the invite link again to rejoin.');
    const since = t0.seen;
    setStep('Syncing…');
    const pulled = await cloud.pull(t0.tid, since);
    if (pulled.status === 'finished') { apply(patchTeam(t => ({ ...t, finished: true, last: Date.now() }))); notify('The lead finished this project. Your copy stays on this device: export your results.', 'info'); return work; }

    // shared project + settings
    if (!t0.lead && pulled.projRev > t0.projRev) {
      setStep('Updating records…'); const recs = await cloud.fetchRecs(t0.tid, prog('Downloading'));
      apply(q => ({ ...q, recs, team: q.team && { ...q.team, projRev: pulled.projRev, nRecs: recs.length } }));
    }
    if (!t0.lead && pulled.cfg && pulled.cfgRev > work.cfgRev) apply(q => applyCfg(q, pulled.cfg!, pulled.cfgRev));
    let cfgSent = t0.cfgSent;
    if (t0.lead && work.cfgRev > pulled.cfgRev) { await cloud.pushConfig(work); cfgSent = work.cfgRev; }
    else if (t0.lead) cfgSent = Math.max(cfgSent, work.cfgRev);

    // my changes
    const sent = { ...t0.sent }, chunks = pendingChunks(work, sent), res = pendingResolutions(work, sent);
    if (chunks.length || res !== null) {
      await cloud.pushDecisions(t0.tid, uid, work.me.name, chunks, res);
      for (const c of chunks) sent[c.k] = sig(c.json);
      if (res !== null) sent.res = sig(res);
    }

    // everyone else's
    let seen = t0.seen, fresh = 0;
    for (const d of pulled.docs) {
      seen = Math.max(seen, d.t);
      if (d.rid === uid && since > 0) continue;       // our own uploads coming back
      if (d.kind === 'res') apply(q => mergeResolutions(q, d.d));
      else { apply(q => mergeChunk(q, d.rid, d.name, d.k, d.d, d.t)); if (d.rid !== uid) fresh++; }
    }
    apply(patchTeam(t => ({ ...t, sent, seen, cfgSent, last: Date.now(), members: pulled.members })));
    if (fresh) notify('Synced: new decisions from your team');
    return work;
  };
  const sync = (quiet = false) => run(async () => { const w = await syncCore(); if (!quiet && !w.team?.finished) notify('Synced'); return true; });

  /** Lead: send the current records again so reviewers pick up newly imported ones. */
  const republish = () => run(async () => {
    const r = await cloud.republish(pr.current, prog('Uploading'));
    upd(patchTeam(t => ({ ...t, projRev: r.projRev, nRecs: r.nRecs, cfgSent: pr.current.cfgRev })));
    notify('Project updated for the team');
  });

  /** Lead: final sync, hand the results over, delete everything from the server. */
  const finish = (onExport: (p: Project) => void) => run(async () => {
    const t = pr.current.team; if (!t?.lead) throw new Error('Only the lead can finish the project.');
    const merged = await syncCore();
    onExport(merged);                                  // results are saved on this device before anything is deleted
    setStep('Removing from the server…'); await cloud.finishTeam(t.tid);
    upd(patchTeam(x => ({ ...x, finished: true, key: '', last: Date.now() })));
    notify('Project finished and removed from the server');
  });
  const leave = () => upd(q => ({ ...q, team: null }));

  return { configured: cloud.configured, status, err, step, busy: status === 'busy', create, join, sync, republish, finish, leave };
}
