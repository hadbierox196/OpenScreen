import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore/lite';
import type { Rec } from './core/types';
import type { Project } from './store';
import { chunkRecs, randomKey, toCfg, type Cfg } from './teamsync';

/* Thin Firebase layer. Firestore "lite" is used on purpose: plain requests, no live listeners, a smaller bundle.
 * Data lives only while a project is active; finishTeam() deletes it. */
const env = import.meta.env;
const config = { apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID };
export const configured = !!(config.apiKey && config.projectId && config.appId);
const app = () => getApps()[0] ?? initializeApp(config);
const db = () => getFirestore(app());
export type Progress = (done: number, total: number) => void;

export async function signIn(): Promise<string> {
  const a = getAuth(app()); await a.authStateReady();
  if (!a.currentUser) await signInAnonymously(a);
  return a.currentUser!.uid;
}

const team = (tid: string) => doc(db(), 'teams', tid);
async function putProject(tid: string, recs: Rec[], prevChunks: number, onProgress?: Progress) {
  const chunks = chunkRecs(recs);
  for (let i = 0; i < chunks.length; i++) { await setDoc(doc(db(), 'teams', tid, 'project', `c${i}`), { i, d: chunks[i] }); onProgress?.(i + 1, chunks.length); }
  for (let i = chunks.length; i < prevChunks; i++) await deleteDoc(doc(db(), 'teams', tid, 'project', `c${i}`));
  return chunks.length;
}

export async function createTeam(p: Project, name: string, onProgress?: Progress) {
  const uid = p.me.id, d = team(doc(collection(db(), 'teams')).id), tid = d.id, key = randomKey(24), projRev = Date.now();
  await setDoc(d, { name, lead: uid, key, status: 'active', created: Date.now(), cfgRev: p.cfgRev, cfg: JSON.stringify(toCfg(p)), projRev, nRecs: p.recs.length, nChunks: 0 });
  await setDoc(doc(db(), 'teams', tid, 'members', uid), { name: p.me.name, key, joined: Date.now() });
  const nChunks = await putProject(tid, p.recs, 0, onProgress);
  await updateDoc(d, { nChunks });
  return { tid, key, projRev, nRecs: p.recs.length };
}
/** Lead: send the current record list again (e.g. after importing more). */
export async function republish(p: Project, onProgress?: Progress) {
  const t = p.team!, snap = await getDoc(team(t.tid)), prev = (snap.data()?.nChunks as number) ?? 0, projRev = Date.now();
  const nChunks = await putProject(t.tid, p.recs, prev, onProgress);
  await updateDoc(team(t.tid), { nChunks, projRev, nRecs: p.recs.length, cfgRev: p.cfgRev, cfg: JSON.stringify(toCfg(p)) });
  return { projRev, nRecs: p.recs.length };
}
async function getRecs(tid: string, nChunks: number, onProgress?: Progress): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let i = 0; i < nChunks; i++) { const s = await getDoc(doc(db(), 'teams', tid, 'project', `c${i}`)); out.push(...JSON.parse(s.data()?.d ?? '[]')); onProgress?.(i + 1, nChunks); }
  return out;
}
export async function joinTeam(tid: string, key: string, myName: string, onProgress?: Progress) {
  const uid = await signIn();
  await setDoc(doc(db(), 'teams', tid, 'members', uid), { name: myName, key, joined: Date.now() }); // rules check the key
  const s = await getDoc(team(tid)), t = s.data();
  if (!t) throw new Error('This team does not exist any more.');
  if (t.status === 'finished') throw new Error('This project has been finished by the lead.');
  const recs = await getRecs(tid, t.nChunks, onProgress);
  return { uid, name: t.name as string, recs, cfg: (t.cfg ? JSON.parse(t.cfg) : null) as Cfg | null, cfgRev: t.cfgRev as number, projRev: t.projRev as number };
}
export async function fetchRecs(tid: string, onProgress?: Progress) { const t = (await getDoc(team(tid))).data(); return getRecs(tid, t?.nChunks ?? 0, onProgress); }

export interface Pulled { status: 'active' | 'finished'; cfg: Cfg | null; cfgRev: number; projRev: number; members: Record<string, string>; docs: { id: string; rid: string; kind: 'dec' | 'res'; k: number; d: string; t: number; name: string }[] }
/** since = 0 downloads everything; later calls only fetch documents changed since then (with a small overlap for clock safety). */
export async function pull(tid: string, since: number): Promise<Pulled> {
  const t = (await getDoc(team(tid))).data();
  if (!t) throw new Error('This team no longer exists.');
  if (t.status === 'finished') return { status: 'finished', cfg: null, cfgRev: 0, projRev: 0, members: {}, docs: [] };
  const col = collection(db(), 'teams', tid, 'dec');
  const snap = await getDocs(since > 0 ? query(col, where('t', '>=', Timestamp.fromMillis(since - 2000))) : col);
  const mem = await getDocs(collection(db(), 'teams', tid, 'members'));
  return {
    status: 'active', cfg: t.cfg ? JSON.parse(t.cfg) : null, cfgRev: t.cfgRev, projRev: t.projRev,
    members: Object.fromEntries(mem.docs.map(m => [m.id, (m.data().name as string) || 'Reviewer'])),
    docs: snap.docs.map(x => { const v = x.data(); return { id: x.id, rid: v.rid, kind: v.kind, k: v.k, d: v.d, t: v.t instanceof Timestamp ? v.t.toMillis() : 0, name: v.name }; }),
  };
}
export async function pushDecisions(tid: string, uid: string, name: string, chunks: { k: number; json: string }[], res: string | null) {
  for (const c of chunks) await setDoc(doc(db(), 'teams', tid, 'dec', `${uid}_${c.k}`), { rid: uid, name, kind: 'dec', k: c.k, d: c.json, t: serverTimestamp() });
  if (res !== null) await setDoc(doc(db(), 'teams', tid, 'dec', `${uid}_res`), { rid: uid, name, kind: 'res', k: -1, d: res, t: serverTimestamp() });
}
export const pushConfig = (p: Project) => updateDoc(team(p.team!.tid), { cfgRev: p.cfgRev, cfg: JSON.stringify(toCfg(p)) });

/** Lead only. Removes everything except a tiny "finished" marker so late reviewers get a clear message instead of an error. */
export async function finishTeam(tid: string) {
  for (const sub of ['dec', 'project', 'members']) {
    const snap = await getDocs(collection(db(), 'teams', tid, sub));
    for (let i = 0; i < snap.docs.length; i += 400) { const b = writeBatch(db()); snap.docs.slice(i, i + 400).forEach(x => b.delete(x.ref)); await b.commit(); }
  }
  await updateDoc(team(tid), { status: 'finished', finishedAt: Date.now(), key: deleteField(), cfg: deleteField(), nChunks: 0, nRecs: 0 });
}
