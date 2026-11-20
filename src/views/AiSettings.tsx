import { useEffect, useState } from 'react';
import { AUTO_MODEL, cachedModels, chat, fetchFreeModels, saveSettings, type AiSettings, type FreeModel } from '../ai';
import { Icon, Modal, Spinner, useToast } from '../ui';

export function AiSettingsModal({ open, onClose, s, setS }: { open: boolean; onClose: () => void; s: AiSettings; setS: (s: AiSettings) => void }) {
  const toast = useToast();
  const [models, setModels] = useState<FreeModel[]>(cachedModels()), [loading, setLoading] = useState(false), [testing, setTesting] = useState(false), [show, setShow] = useState(false);
  const set = (patch: Partial<AiSettings>) => { const n = { ...s, ...patch }; setS(n); saveSettings(n); };
  const refresh = async () => {
    setLoading(true);
    try { const l = await fetchFreeModels(); setModels(l); toast(`${l.length} free models found`); } catch (e) { toast(e instanceof Error ? e.message : 'Could not load models', 'err'); } finally { setLoading(false); }
  };
  useEffect(() => { if (open) refresh(); }, [open]); // eslint-disable-line
  const test = async () => {
    setTesting(true);
    try { const r = await chat(s, [{ role: 'user', content: 'Reply with the single word: ready' }], { max: 20 }); toast(`Connected · ${r.model}`); } catch (e) { toast(e instanceof Error ? e.message : 'Connection failed', 'err'); } finally { setTesting(false); }
  };
  const known = s.model === AUTO_MODEL || models.some(m => m.id === s.model);
  return (
    <Modal open={open} onClose={onClose} title="AI assistant · OpenRouter">
      <p className="muted">Get suggestions for screening, duplicates and keywords from free models on OpenRouter. The AI only suggests; every decision stays yours.</p>
      <label className="field">API key <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Get a free key <Icon n="external" size={12} /></a>
        <div className="row nowrap"><input type={show ? 'text' : 'password'} placeholder="sk-or-v1-…" autoComplete="off" spellCheck={false} value={s.key} onChange={e => set({ key: e.target.value })} />
          <button className="ghost" onClick={() => setShow(x => !x)}>{show ? 'Hide' : 'Show'}</button></div></label>
      <label className="field">Model
        <div className="row nowrap"><select value={known ? s.model : '__custom'} onChange={e => e.target.value !== '__custom' && set({ model: e.target.value })}>
          <option value={AUTO_MODEL}>Auto: any available free model</option>
          {models.map(m => <option key={m.id} value={m.id}>{m.name}{m.ctx ? ` · ${Math.round(m.ctx / 1000)}k` : ''}</option>)}
          {!known && <option value="__custom">Custom: {s.model}</option>}
        </select>
          <button className="ghost icon" onClick={refresh} disabled={loading} aria-label="Refresh free models" title="Refresh free models">{loading ? <Spinner /> : <Icon n="refresh" size={16} />}</button></div></label>
      <label className="field">Or any model ID<input placeholder="vendor/model-name:free" value={s.model} onChange={e => set({ model: e.target.value.trim() })} spellCheck={false} /></label>
      <label className="check"><input type="checkbox" checked={s.fallback} onChange={e => set({ fallback: e.target.checked })} />If a model is busy or fails, try other free models automatically</label>
      <div className="note"><Icon n="lock" size={16} /><span>Your key is stored only in this browser. When you use AI, the title and abstract of the record (or the pair) are sent to OpenRouter and the model provider. Free models may log prompts, so avoid confidential material. OpenRouter limits free models to 20 requests a minute and 50 a day (1,000 a day once you have bought $10 of credits), shared across all free models. Pre-screening waits out the per-minute limit by itself; the daily limit can only be lifted by OpenRouter. If you get “no endpoint” errors, enable free endpoints at openrouter.ai/settings/privacy.</span></div>
      <div className="row end"><button onClick={test} disabled={!s.key || testing}>{testing ? <Spinner /> : <Icon n="check" size={16} />}Test connection</button><button className="pri" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
