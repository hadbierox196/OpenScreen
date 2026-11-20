import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { empty, load, save, type Project } from './store';
import { loadSettings, type AiSettings } from './ai';
import { Icon, Num, Ring, ToastProvider, useToast, type IconName } from './ui';
import { useFolderSync } from './sync';
import { uid } from './team';
import { parseInvite } from './sheet';
import { Team, STATUS_LABEL } from './views/Team';
import { active, pendingPairs, type Tab, type Upd } from './shared';
import { Import } from './views/Import';
import { Dups } from './views/Dups';
import { Screen } from './views/Screen';
import { Table } from './views/Table';
import { AiSettingsModal } from './views/AiSettings';

const TABS: [Tab, string, IconName][] = [['import', 'Import', 'upload'], ['dups', 'Duplicates', 'layers'], ['screen', 'Screen', 'eye'], ['team', 'Team', 'users'], ['table', 'Export', 'table']];

export default function App() { return <ToastProvider><Shell /></ToastProvider>; }

function Shell() {
  const toast = useToast();
  const [p, setP] = useState<Project>(empty), [ready, setReady] = useState(false), [tab, setTab] = useState<Tab>('import');
  const [ai, setAi] = useState<AiSettings>(loadSettings), [aiOpen, setAiOpen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => { load().then(x => { setP(x); setReady(true); if (x.recs.length) setTab('screen'); }); }, []);
  useEffect(() => { if (!ready) return; const t = setTimeout(() => save(p), 400); return () => clearTimeout(t); }, [p, ready]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('openscreen.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ } }, [dark]);
  const upd = useCallback<Upd>(f => setP(f), []);
  useEffect(() => { if (ready && (!p.me.id || !p.pid)) upd(q => ({ ...q, me: q.me.id ? q.me : { ...q.me, id: uid() }, pid: q.pid || uid() })); }, [ready, p.me.id, p.pid, upd]);
  const sync = useFolderSync(p, upd, ready, toast);
  const joined = useRef(false);
  useEffect(() => { // one-tap invite: open the link, get connected
    if (!ready || !p.me.id || !p.pid || joined.current) return;
    const inv = parseInvite(location.hash); if (!inv) return;
    joined.current = true; history.replaceState(null, '', location.pathname + location.search); // keep the token out of the address bar and history
    setTab('team'); toast('Joining the team project…', 'info'); sync.connectSheet(inv.url, inv.token);
  }, [ready, p.me.id, p.pid]); // eslint-disable-line
  const act = active(p), screened = act.filter(r => p.decisions[r.id]).length, pct = act.length ? screened / act.length : 0;
  const review = useMemo(() => pendingPairs(p).length, [p.recs, p.pairs, p.kept]); // eslint-disable-line
  const stats: [string, number][] = [['Imported', p.recs.length], ['Unique', act.length], ['Included', act.filter(r => p.decisions[r.id]?.v === 'include').length]];
  const aiCtx = { s: ai, open: () => setAiOpen(true) };
  const i = TABS.findIndex(t => t[0] === tab);
  return (
    <>
      <main>
        <header className="top">
          <div className="brand"><div className="logo"><Icon n="check" size={20} /></div>
            <div><h1>OpenScreen</h1><div className="muted small"><Icon n="lock" size={11} /> Stored locally in your browser</div></div></div>
          <div className="row nowrap">
            {sync.status !== 'off' && <button className={`ghost pill sync s-${sync.status}`} onClick={() => setTab('team')} title={STATUS_LABEL[sync.status]}><Icon n="cloud" size={16} /><span className="hide-sm">{STATUS_LABEL[sync.status]}</span></button>}
            <button className={`ai pill${ai.key ? ' live' : ''}`} onClick={() => setAiOpen(true)}><Icon n="sparkles" size={16} /><span className="hide-sm">{ai.key ? 'AI ready' : 'Set up AI'}</span></button>
            <button className="ghost icon" onClick={() => setDark(d => !d)} aria-label="Toggle theme"><Icon n={dark ? 'sun' : 'moon'} /></button>
          </div>
        </header>
        <section className="stats">
          {stats.map(([l, v]) => <div key={l} className="stat"><strong><Num v={v} /></strong><span>{l}</span></div>)}
          <div className="stat ringstat"><Ring pct={pct} /><div><strong><Num v={Math.round(pct * 100)} />%</strong><span>Screened</span></div></div>
        </section>
        <nav className="tabs" style={{ ['--i' as string]: i, ['--n' as string]: TABS.length }}>
          <i />{TABS.map(([k, l, ic]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon n={ic} size={16} /><span>{l}</span>{k === 'dups' && review > 0 && <em>{review}</em>}</button>
          ))}
        </nav>
        <div key={tab} className="view">
          {!ready ? <div className="card"><div className="skel" /><div className="skel" style={{ width: '60%' }} /></div>
            : tab === 'import' ? <Import p={p} upd={upd} go={setTab} />
            : tab === 'dups' ? <Dups p={p} upd={upd} ai={aiCtx} />
            : tab === 'screen' ? <Screen p={p} upd={upd} ai={aiCtx} />
            : tab === 'team' ? <Team p={p} upd={upd} sync={sync} />
            : <Table p={p} />}
        </div>
      </main>
      <AiSettingsModal open={aiOpen} onClose={() => setAiOpen(false)} s={ai} setS={setAi} />
    </>
  );
}
