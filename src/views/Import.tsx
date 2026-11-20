import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { parseAny } from '../core/parsers/detect';
import { empty } from '../store';
import { SAMPLE } from '../sample';
import { Icon, Modal, useToast } from '../ui';
import type { Tab, Upd } from '../shared';
import type { Project } from '../store';

export function Import({ p, upd, go }: { p: Project; upd: Upd; go: (t: Tab) => void }) {
  const toast = useToast(), inp = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false), [skips, setSkips] = useState<string[]>([]), [confirm, setConfirm] = useState(false);
  const add = (name: string, text: string, db: string) => {
    const batch = `${name}#${Date.now()}`, { records, report } = parseAny(text, batch, db || name);
    upd(q => ({ ...q, recs: [...q.recs, ...records], imports: [...q.imports, { name, parsed: report.parsed, skipped: report.skipped.length }] }));
    if (report.skipped.length) setSkips(s => [...s, ...report.skipped.map(x => `${name} · record #${x.index}: ${x.reason}`)]);
    if (report.parsed) toast(`${name}: ${report.parsed} records imported`);
    else toast(`${name}: nothing could be parsed`, 'err');
  };
  const ingest = async (files: FileList | File[] | null) => { for (const f of Array.from(files || [])) add(f.name, await f.text(), ''); };
  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => { await ingest(e.target.files); e.target.value = ''; };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); ingest(e.dataTransfer.files); };
  return (
    <div className="stack">
      <section className="card enter">
        <h2>Import references</h2>
        <p className="muted">RIS, BibTeX, CSV or TSV. Format and columns are detected automatically. Files are parsed in your browser and never uploaded.</p>
        <div className={`drop${drag ? ' over' : ''}`} role="button" tabIndex={0}
          onClick={() => inp.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.current?.click(); } }}
          onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
          <div className="drop-ic"><Icon n="upload" size={26} /></div>
          <strong>{drag ? 'Drop to import' : 'Drop files here or tap to browse'}</strong>
          <span className="muted">.ris · .bib · .csv · .tsv · .txt</span>
          <input ref={inp} type="file" multiple hidden accept=".ris,.bib,.csv,.tsv,.txt" onChange={onFiles} />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={() => add('sample.ris', SAMPLE, 'Sample')}><Icon n="sparkles" size={16} />Load sample data</button>
          {p.recs.length > 0 && <button className="danger" onClick={() => setConfirm(true)}><Icon n="trash" size={16} />Clear project</button>}
          <span className="grow" />
          {p.recs.length > 0 && <button className="pri" onClick={() => go('dups')}>Next: deduplicate<Icon n="right" size={16} /></button>}
        </div>
      </section>
      {p.imports.length > 0 && (
        <section className="card enter" style={{ animationDelay: '60ms' }}>
          <h3>Imported files</h3>
          <ul className="files">
            {p.imports.map((f, i) => (
              <li key={i} style={{ animationDelay: `${i * 40}ms` }}><Icon n="file" size={16} /><span className="fname">{f.name}</span>
                <span className="chip ok">{f.parsed} records</span>{f.skipped > 0 && <span className="chip warn">{f.skipped} skipped</span>}</li>
            ))}
          </ul>
          {skips.length > 0 && <details className="more"><summary>Skipped records ({skips.length})</summary><ul>{skips.slice(0, 50).map((s, i) => <li key={i}>{s}</li>)}</ul></details>}
        </section>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete the whole project?">
        <p className="muted">All imported records, decisions and AI suggestions stored in this browser will be removed. This cannot be undone.</p>
        <div className="row end"><button onClick={() => setConfirm(false)}>Cancel</button>
          <button className="danger solid" onClick={() => { upd(q => ({ ...empty, me: q.me })); setSkips([]); setConfirm(false); toast('Project cleared', 'info'); }}>Delete everything</button></div>
      </Modal>
    </div>
  );
}
