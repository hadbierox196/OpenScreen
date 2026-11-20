import type { Project } from './store';
import { numbering } from './team';

/** One tidy row per decision (matches the Decisions sheet header in apps-script/Code.gs). */
export function decisionRows(p: Project): string[][] {
  const nums = numbering(p), byId = new Map(p.recs.map(r => [r.id, r]));
  const out: string[][] = [];
  for (const [id, d] of Object.entries(p.decisions)) {
    const r = byId.get(id), n = nums.get(id); if (!r || n === undefined) continue;
    out.push([String(n), id, r.title, r.year ? String(r.year) : '', r.doi, p.me.name, p.me.id, d.v, d.reason || '', d.note || '', new Date(d.t).toISOString()]);
  }
  return out.sort((a, b) => Number(a[0]) - Number(b[0]));
}

export interface Entry { lm: number; text(): Promise<string> }
/** Where team files live: a picked folder (desktop) or a Google Sheet backend (any device). */
export interface Transport { list(): Promise<Record<string, Entry>>; write(name: string, text: string, rows?: string[][]): Promise<void> }

async function call(url: string, token: string, body: object): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // a string body is sent as text/plain: no CORS preflight, which Apps Script cannot answer
  const r = await fetch(url, { method: 'POST', body: JSON.stringify({ token, ...body }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Sheet backend error');
  return j;
}
export const sheetTransport = (url: string, token: string): Transport => ({
  async list() {
    const j = await call(url, token, { action: 'list' }), out: Record<string, Entry> = {};
    for (const f of j.files as { name: string; modified: number }[]) out[f.name] = { lm: f.modified, text: async () => (await call(url, token, { action: 'get', name: f.name })).content };
    return out;
  },
  async write(name, text, rows) { await call(url, token, { action: 'put', name, content: text, rows }); },
});
export const SHEET_KEY = 'openscreen.sheet';
export const loadSheet = (): { url: string; token: string } | null => { try { const j = JSON.parse(localStorage.getItem(SHEET_KEY) || ''); return j?.url && j?.token ? j : null; } catch { return null; } };
export const saveSheet = (v: { url: string; token: string } | null) => { try { if (v) localStorage.setItem(SHEET_KEY, JSON.stringify(v)); else localStorage.removeItem(SHEET_KEY); } catch { /* ignore */ } };
