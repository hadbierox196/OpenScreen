import { useCallback, useEffect, useRef, useState } from 'react';
import { empty, loadHandle, saveHandle, type Project } from './store';
import { adoptConfig, adoptProject, mergeReviewer, parseTeamFile, toConfigFile, toProjectFile, toReviewerFile, type ConfigFile, type ProjectFile, type ReviewerFile } from './team';
import type { Upd } from './shared';
import { decisionRows, loadSheet, saveSheet, sheetTransport, type Entry, type Transport } from './sheet';

/* Minimal File System Access API typings (Chromium: Chrome, Edge, Opera, Brave). */
interface FileH { kind: 'file'; name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }
interface DirH {
  kind: 'directory'; name: string; values(): AsyncIterable<FileH | DirH>;
  getFileHandle(n: string, o?: { create?: boolean }): Promise<FileH>;
  queryPermission(o: { mode: 'readwrite' }): Promise<string>; requestPermission(o: { mode: 'readwrite' }): Promise<string>;
}
export type SyncStatus = 'off' | 'needs-permission' | 'syncing' | 'ok' | 'mismatch' | 'error';
export type Notify = (text: string, kind?: 'ok' | 'err' | 'info') => void;

const folderTransport = (d: DirH): Transport => ({
  async list() { const out: Record<string, Entry> = {}; for await (const e of d.values()) if (e.kind === 'file') { const h = e as FileH; out[e.name] = { lm: (await h.getFile()).lastModified, text: async () => (await h.getFile()).text() }; } return out; },
  async write(name, text) { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); },
});
const read = async (e: Entry) => parseTeamFile(await e.text());
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Sync failed');

/**
 * Shared-folder sync. Layout inside the folder (put it in Dropbox / Drive / OneDrive / Syncthing / a network share):
 *   project.json        records + settings, written once when the lead publishes
 *   config.json         plan, blinding, criteria, keywords (newest cfgRev wins)
 *   reviewer-<id>.json  one file per reviewer, written only by that reviewer, so nobody overwrites anybody
 */
export function useFolderSync(p: Project, upd: Upd, ready: boolean, notify: Notify) {
  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const [status, setStatus] = useState<SyncStatus>('off'), [err, setErr] = useState(''), [last, setLast] = useState(0), [folder, setFolder] = useState('');
  const [mode, setMode] = useState<'none' | 'folder' | 'sheet'>('none');
  const dir = useRef<DirH | null>(null), tr = useRef<Transport | null>(null), pr = useRef(p), busy = useRef(false), written = useRef(''), seen = useRef<Record<string, number>>({});
  pr.current = p;
  const reset = () => { seen.current = {}; written.current = ''; };

  const syncOnce = useCallback(async () => {
    const t = tr.current; if (!t || busy.current) return;
    busy.current = true;
    try {
      if (dir.current && (await dir.current.queryPermission({ mode: 'readwrite' })) !== 'granted') { setStatus('needs-permission'); return; }
      let local = pr.current; if (!local.pid || !local.me.id) return;
      const files = await t.list();

      // 1) project + shared settings
      if (files['config.json']) {
        const cfg = (await read(files['config.json'])) as ConfigFile | null;
        if (cfg && cfg.kind === 'config' && cfg.pid !== local.pid) {
          if (local.recs.length === 0 && files['project.json']) {
            const pf = (await read(files['project.json'])) as ProjectFile | null;
            if (pf && pf.kind === 'project') { upd(q => adoptProject(q, pf, empty)); notify('Joined the shared project'); reset(); setTimeout(syncOnce, 400); setStatus('syncing'); return; }
          }
          setStatus('mismatch'); return;
        }
        if (cfg && cfg.kind === 'config') {
          if (cfg.cfgRev > local.cfgRev) { upd(q => adoptConfig(q, cfg)); local = { ...local, cfgRev: cfg.cfgRev }; }
          else if (local.cfgRev > cfg.cfgRev) await t.write('config.json', JSON.stringify(toConfigFile(local)));
        }
      } else if (local.recs.length > 0) {
        await t.write('project.json', JSON.stringify(toProjectFile(local)));
        await t.write('config.json', JSON.stringify(toConfigFile(local)));
        notify('Project published');
      } else { setStatus('ok'); setLast(Date.now()); setErr('Waiting for the lead reviewer to publish a project here.'); return; }

      // 2) other reviewers (only re-read files that changed since last time)
      for (const [name, e] of Object.entries(files)) {
        if (!/^reviewer-.+\.json$/.test(name) || seen.current[name] === e.lm) continue;
        const f = (await read(e)) as ReviewerFile | null;
        seen.current[name] = e.lm;
        if (f && f.kind === 'reviewer') upd(q => mergeReviewer(q, f));
      }

      // 3) my own decisions (the sheet backend also gets them as tidy rows for the CSV)
      if (local.me.name.trim()) {
        const own = toReviewerFile(local), sig = JSON.stringify([own.reviewer, own.decisions, own.resolved]);
        if (sig !== written.current) { await t.write(`reviewer-${local.me.id}.json`, JSON.stringify(own), decisionRows(local)); written.current = sig; }
        setErr('');
      } else setErr('Enter your name in the Team tab so your decisions can be shared.');
      setStatus('ok'); setLast(Date.now());
    } catch (e) { setStatus('error'); setErr(msg(e)); } finally { busy.current = false; }
  }, [upd, notify]);

  const connect = async () => {
    try {
      const h = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirH> }).showDirectoryPicker({ mode: 'readwrite', id: 'openscreen' });
      dir.current = h; tr.current = folderTransport(h); setMode('folder'); setFolder(h.name); await saveHandle(h); saveSheet(null); reset(); setStatus('syncing'); setErr('');
      await syncOnce();
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) { setStatus('error'); setErr(msg(e)); } }
  };
  /** Any device (incl. Android): connect to the lead's Google Sheet backend with its /exec URL and token. */
  const connectSheet = async (url: string, token: string) => {
    url = url.trim(); token = token.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url) || !token) { setStatus('error'); setErr('Paste the Web app URL (https://script.google.com/…/exec) and the token.'); return; }
    dir.current = null; tr.current = sheetTransport(url, token); setMode('sheet'); setFolder('Google Sheet'); saveSheet({ url, token }); await saveHandle(null); reset(); setStatus('syncing'); setErr('');
    await syncOnce();
  };
  const reconnect = async () => { const d = dir.current; if (d && (await d.requestPermission({ mode: 'readwrite' })) === 'granted') { setStatus('syncing'); await syncOnce(); } };
  const disconnect = async () => { dir.current = null; tr.current = null; setMode('none'); await saveHandle(null); saveSheet(null); setStatus('off'); setFolder(''); setErr(''); };
  /** Mismatch: throw away the local project and take the shared one. */
  const adoptFromFolder = async () => {
    const t = tr.current; if (!t) return;
    try {
      const e = (await t.list())['project.json']; if (!e) throw new Error('No project.json has been published yet.');
      const pf = (await read(e)) as ProjectFile | null;
      if (!pf || pf.kind !== 'project') throw new Error('project.json is not valid.');
      upd(q => adoptProject(q, pf, empty)); reset(); setStatus('syncing'); setTimeout(syncOnce, 400);
    } catch (e) { setStatus('error'); setErr(msg(e)); }
  };
  /** Force-write the current records and settings (lead reviewer). */
  const publish = async () => {
    const t = tr.current, local = pr.current; if (!t) return;
    try { await t.write('project.json', JSON.stringify(toProjectFile(local))); await t.write('config.json', JSON.stringify(toConfigFile(local))); notify('Project published'); await syncOnce(); }
    catch (e) { setStatus('error'); setErr(msg(e)); }
  };

  // restore the remembered connection after a reload (a folder needs one click to re-grant permission; the sheet just resumes)
  useEffect(() => {
    if (!ready) return;
    const sh = loadSheet();
    if (sh) { tr.current = sheetTransport(sh.url, sh.token); setMode('sheet'); setFolder('Google Sheet'); setStatus('syncing'); syncOnce(); return; }
    if (!supported) return;
    loadHandle<DirH>().then(async h => {
      if (!h) return;
      dir.current = h; tr.current = folderTransport(h); setMode('folder'); setFolder(h.name);
      try { if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') { setStatus('syncing'); syncOnce(); } else setStatus('needs-permission'); } catch { setStatus('needs-permission'); }
    });
  }, [ready]); // eslint-disable-line
  // poll while visible, and after local changes (debounced)
  const idle = status === 'off' || status === 'needs-permission';
  useEffect(() => {
    if (idle) return;
    const iv = setInterval(() => { if (document.visibilityState === 'visible') syncOnce(); }, mode === 'sheet' ? 30000 : 15000);
    const v = () => { if (document.visibilityState === 'visible') syncOnce(); };
    document.addEventListener('visibilitychange', v); window.addEventListener('focus', v);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', v); window.removeEventListener('focus', v); };
  }, [idle, mode, syncOnce]);
  useEffect(() => {
    if (!tr.current || idle) return;
    const t = setTimeout(syncOnce, 2000); return () => clearTimeout(t);
  }, [p.decisions, p.resolved, p.me.name, p.cfgRev, p.recs.length]); // eslint-disable-line

  return { supported, mode, status, err, last, folder, connect, connectSheet, reconnect, disconnect, syncNow: syncOnce, adoptFromFolder, publish };
}
