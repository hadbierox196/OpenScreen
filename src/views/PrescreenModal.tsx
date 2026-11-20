import { useEffect, useState } from 'react';
import type { BatchStats } from '../prescreen';
import { batchEtaSeconds, fmtDuration } from '../screening';
import { Icon, Modal, Spinner } from '../ui';

/** Live popup for AI pre-screening: progress, time left, and how many the AI suggests to include / exclude. */
export function PrescreenModal({ st, open, onStop, onClose }: { st: BatchStats | null; open: boolean; onStop: () => void; onClose: () => void }) {
  const [now, setNow] = useState(Date.now());
  const running = !!st && !st.endedAt;
  useEffect(() => { if (!open || !running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [open, running]);
  if (!st) return null;
  const pct = st.total ? st.done / st.total : 0;
  const wait = st.waitUntil ? Math.max(0, Math.ceil((st.waitUntil - now) / 1000)) : 0;
  const eta = running ? batchEtaSeconds(st.done, st.total, now - st.startedAt) : 0;
  const title = running ? 'AI pre-screening' : st.stopped || st.cancelled ? 'Pre-screening stopped' : 'Pre-screening finished';
  const total = st.include + st.exclude + st.maybe;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className={`progress${running ? ' ai' : ''}`}><div style={{ width: `${pct * 100}%` }} /></div>
      <div className="row" style={{ marginTop: 8 }}>
        <b>{st.done} of {st.total}</b><span className="muted">screened</span><span className="grow" />
        {running ? <span className="muted">{wait ? 'Paused for the rate limit' : st.done < 3 ? `About ${fmtDuration(eta)} left` : `~${fmtDuration(eta)} left`}</span>
          : <span className="muted">Took {fmtDuration(Math.max(1, ((st.endedAt ?? now) - st.startedAt) / 1000))}</span>}
      </div>
      <div className="tally" aria-live="polite">
        <div className="t-include"><b>{st.include}</b><span>Included</span></div>
        <div className="t-exclude"><b>{st.exclude}</b><span>Excluded</span></div>
        <div className="t-maybe"><b>{st.maybe}</b><span>Maybe</span></div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>These are AI suggestions only. Nothing is decided until you accept it on the record.</p>
      {wait > 0 && <div className="note"><Spinner /><span>Free models allow about 20 requests a minute. Continuing automatically in {wait}s.</span></div>}
      {st.failed > 0 && <div className="note"><Icon n="info" size={16} /><span>{st.failed} record{st.failed === 1 ? '' : 's'} could not be read and {st.failed === 1 ? 'was' : 'were'} skipped. They stay undone, so you can run pre-screen again.</span></div>}
      {st.stopped && <div className="note"><Icon n="alert" size={16} /><span>{st.stopped}</span></div>}
      <div className="row end">
        {running ? <>
          <button className="ghost" onClick={onClose}>Hide</button>
          <button className="danger" onClick={onStop}><Icon n="stop" size={16} />Stop</button>
        </> : <button className="pri" onClick={onClose}>{total ? 'Review suggestions' : 'Close'}</button>}
      </div>
    </Modal>
  );
}
