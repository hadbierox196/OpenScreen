import { useState } from 'react';
import type { Project } from '../store';
import type { useTeam } from '../sync';
import { Modal, Spinner } from '../ui';

/** Opens from an invite link: enter your name, join, start screening. */
export function JoinModal({ p, invite, sync, onClose, onDone }: { p: Project; invite: { tid: string; key: string }; sync: ReturnType<typeof useTeam>; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(p.me.name), same = p.team?.tid === invite.tid;
  const replaces = !same && (p.recs.length > 0 || !!p.team);
  if (same) return <Modal open onClose={onClose} title="You’re already in this team"><p className="muted">This invite is for the team you already joined (“{p.team!.name}”).</p><div className="row end"><button className="pri" onClick={onDone}>Start screening</button></div></Modal>;
  if (!sync.configured) return <Modal open onClose={onClose} title="Team sync isn’t set up"><p className="muted">This copy of the app has no Firebase settings, so it can’t open team invites. Ask the lead for the correct app link.</p><div className="row end"><button onClick={onClose}>Close</button></div></Modal>;
  const go = async () => { if (await sync.join(invite.tid, invite.key, name)) onDone(); };
  return (
    <Modal open onClose={sync.busy ? () => undefined : onClose} title="Join the screening team">
      <p className="muted">You’ve been invited to a screening project. Enter your name so your decisions are labelled. Everything you do stays on your device until you press Sync.</p>
      {replaces && <div className="note"><span>This replaces the project currently stored in this browser ({p.recs.length} records). Export anything you want to keep first.</span></div>}
      <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} autoFocus style={{ marginTop: 10 }} />
      {sync.err && <p className="err small">{sync.err}</p>}
      <div className="row end" style={{ marginTop: 12 }}>
        {sync.busy && <span className="muted small grow">{sync.step || 'Joining…'}</span>}
        <button onClick={onClose} disabled={sync.busy}>Cancel</button>
        <button className="pri" onClick={go} disabled={sync.busy || !name.trim()}>{sync.busy ? <Spinner /> : null}Join &amp; start</button>
      </div>
    </Modal>
  );
}
