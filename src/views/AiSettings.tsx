import { useEffect, useState } from 'react';
import { addModelId, AUTO_MODEL, cachedModels, chat, fetchFreeModels, maskKey, modelsUpdatedAt, saveSettings, upsertKey, type AiSettings, type FreeModel } from '../ai';
import { Icon, Modal, Spinner, useToast } from '../ui';

const ago = (t: number) => { if (!t) return 'not refreshed yet'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'updated just now' : m < 60 ? `updated ${m} min ago` : m < 1440 ? `updated ${Math.round(m / 60)} h ago` : `updated ${Math.round(m / 1440)} d ago`; };

export function AiSettingsModal({ open, onClose, s, setS }: { open: boolean; onClose: () => void; s: AiSettings; setS: (s: AiSettings) => void }) {
  const toast = useToast();
  const [models, setModels] = useState<FreeModel[]>(cachedModels()), [loading, setLoading] = useState(false), [testing, setTesting] = useState(false), [show, setShow] = useState(false);
  const [label, setLabel] = useState(''), [newModel, setNewModel] = useState(''), [at, setAt] = useState(modelsUpdatedAt()), [live, setLive] = useState(false);
  const set = (patch: Partial<AiSettings>) => { const n = { ...s, ...patch }; setS(n); saveSettings(n); };
  const refresh = async (quiet = false) => {
    setLoading(true);
    try { const l = await fetchFreeModels(); setModels(l); setAt(modelsUpdatedAt()); setLive(l.length > 0); if (!quiet) toast(`${l.length} free models found`); } catch (e) { toast(e instanceof Error ? e.message : 'Could not load models', 'err'); } finally { setLoading(false); }
  };
  useEffect(() => { if (open) refresh(true); }, [open]); // eslint-disable-line
  const test = async () => {
    setTesting(true);
    try { const r = await chat(s, [{ role: 'user', content: 'Reply with the single word: ready' }], { max: 20 }); toast(`Connected · ${r.model}`); } catch (e) { toast(e instanceof Error ? e.message : 'Connection failed', 'err'); } finally { setTesting(false); }
  };
  const saveKey = () => {
    const had = s.saved.some(x => x.key === s.key.trim() || x.label === (label.trim() || ''));
    set({ saved: upsertKey(s.saved, label, s.key) }); setLabel(''); toast(had ? 'Saved key updated' : 'Key saved');
  };
  const addModel = () => {
    const next = addModelId(s.custom, newModel);
    if (next === s.custom) { toast('Use the form vendor/model-name, e.g. meta-llama/llama-3.3-70b-instruct:free', 'info'); return; }
    set({ custom: next, model: newModel.trim() }); setNewModel(''); toast('Model added and selected');
  };
  const gone = live && s.model !== AUTO_MODEL && !models.some(m => m.id === s.model);   // not in the live free list any more
  const known = s.model === AUTO_MODEL || s.custom.includes(s.model) || models.some(m => m.id === s.model);
  return (
    <Modal open={open} onClose={onClose} title="AI assistant · OpenRouter">
      <p className="muted">Get suggestions for screening, duplicates and keywords from free models on OpenRouter. The AI only suggests; every decision stays yours.</p>
      <label className="field">API key <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Get a free key <Icon n="external" size={12} /></a>
        <div className="row nowrap"><input type={show ? 'text' : 'password'} placeholder="sk-or-v1-…" autoComplete="off" spellCheck={false} value={s.key} onChange={e => set({ key: e.target.value })} />
          <button className="ghost" onClick={() => setShow(x => !x)}>{show ? 'Hide' : 'Show'}</button></div></label>
      <div className="field">Saved keys
        {s.saved.map(k => (
          <div className="row nowrap keyrow" key={k.key}>
            <span className="grow">{k.label} <code>{maskKey(k.key)}</code></span>
            {k.key === s.key.trim() ? <span className="badge b-include">In use</span> : <button onClick={() => set({ key: k.key })}>Use</button>}
            <button className="ghost icon" onClick={() => set({ saved: s.saved.filter(x => x.key !== k.key) })} aria-label={`Remove ${k.label}`} title="Remove from saved keys"><Icon n="trash" size={16} /></button>
          </div>
        ))}
        {!s.saved.length && <span className="muted small">Save a key to switch between keys later, or to replace an old one.</span>}
        <div className="row nowrap" style={{ marginTop: 6 }}>
          <input placeholder="Label, e.g. Main account" value={label} onChange={e => setLabel(e.target.value)} />
          <button onClick={saveKey} disabled={!s.key.trim()}>Save key</button>
        </div>
        <span className="muted small">Using a saved label again replaces that key, which is how you update an expired one.</span>
      </div>
      <div className="field">Model <span className="muted small">· {ago(at)}</span>
        <div className="row nowrap"><select value={known ? s.model : '__custom'} onChange={e => e.target.value !== '__custom' && set({ model: e.target.value })}>
          <option value={AUTO_MODEL}>Auto: any available free model</option>
          {s.custom.length > 0 && <optgroup label="Your models">{s.custom.map(id => <option key={id} value={id}>{id}</option>)}</optgroup>}
          <optgroup label="Free models on OpenRouter">{models.map(m => <option key={m.id} value={m.id}>{m.name}{m.ctx ? ` · ${Math.round(m.ctx / 1000)}k` : ''}</option>)}</optgroup>
          {!known && <option value="__custom">Custom: {s.model}</option>}
        </select>
          <button className="icon" onClick={() => refresh()} disabled={loading} aria-label="Update free models" title="Update the free model list">{loading ? <Spinner /> : <Icon n="refresh" size={16} />}</button></div>
        <div className="row nowrap" style={{ marginTop: 6 }}>
          <input placeholder="Add a model ID: vendor/model-name:free" value={newModel} onChange={e => setNewModel(e.target.value.trim())} onKeyDown={e => e.key === 'Enter' && addModel()} spellCheck={false} />
          <button onClick={addModel} disabled={!newModel}>Add</button>
        </div>
        {s.custom.length > 0 && <div className="reasons">{s.custom.map(id => <button key={id} className="chip btn" onClick={() => set({ custom: s.custom.filter(x => x !== id), ...(s.model === id ? { model: AUTO_MODEL } : {}) })} title="Remove this model">{id} ✕</button>)}</div>}
      </div>
      {gone && <div className="note"><Icon n="alert" size={16} /><span>“{s.model}” is not in OpenRouter’s current free list, so it may be retired or no longer free. <button className="ghost" onClick={() => set({ model: AUTO_MODEL })}>Switch to Auto</button></span></div>}
      <label className="check"><input type="checkbox" checked={s.fallback} onChange={e => set({ fallback: e.target.checked })} />If a model is busy or fails, try other free models automatically</label>
      <div className="note"><Icon n="lock" size={16} /><span>Your keys are stored only in this browser. When you use AI, the title and abstract of the record (or the pair) are sent to OpenRouter and the model provider. Free models may log prompts, so avoid confidential material. OpenRouter limits free models to 20 requests a minute and 50 a day (1,000 a day once you have bought $10 of credits), shared across all free models. Pre-screening waits out the per-minute limit by itself; the daily limit can only be lifted by OpenRouter. If you get “no endpoint” errors, enable free endpoints at openrouter.ai/settings/privacy.</span></div>
      <div className="row end"><button onClick={test} disabled={!s.key || testing}>{testing ? <Spinner /> : <Icon n="check" size={16} />}Test connection</button><button className="pri" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
