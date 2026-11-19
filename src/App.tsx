import { useState, type ChangeEvent } from 'react';
import { parseRis } from './core/parsers/ris';
import { dedupe } from './core/dedup';
import type { ParseReport, Pair, Rec } from './core/types';

export default function App() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [report, setReport] = useState<ParseReport | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [unique, setUnique] = useState(0);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const { records, report } = parseRis(await f.text(), f.name);
    const d = dedupe(records);
    setRecs(records); setReport(report); setPairs(d.pairs); setUnique(d.clusters.length);
  }
  const title = (id: string) => recs.find(r => r.id === id)?.title ?? id;

  return (
    <main style={{ font: '16px system-ui', maxWidth: 820, margin: '0 auto', padding: 16, colorScheme: 'light dark' }}>
      <h1>OpenScreen</h1>
      <p>Import a .ris file. Everything runs in your browser; nothing is uploaded.</p>
      <input type="file" accept=".ris,.txt" onChange={onFile} />
      {report && (
        <>
          <h2>Import report</h2>
          <p>{report.parsed} parsed, {report.skipped.length} skipped
            {report.skipped.map(s => ` (#${s.index}: ${s.reason})`)}</p>
          <h2>Deduplication</h2>
          <p>{recs.length} records, {unique} unique after auto-merge, {pairs.filter(p => p.tier === 'possible').length} possible duplicates to review.</p>
          <ul style={{ paddingLeft: 18 }}>
            {pairs.map((p, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                <b>{p.tier === 'auto' ? 'Auto-merge' : 'Possible'}</b> ({p.score.toFixed(2)}, {p.reason})<br />
                {title(p.a)}<br />{title(p.b)}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
