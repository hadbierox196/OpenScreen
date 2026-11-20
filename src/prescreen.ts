import type { Rec } from './core/types';
import { AiError, PACE_MS, screenOne, sleep, type AiSettings } from './ai';
import type { AiSuggestion, Project } from './store';

export interface BatchStats {
  total: number; done: number; include: number; exclude: number; maybe: number; failed: number;
  startedAt: number; endedAt?: number;
  /** Set while waiting for the free-model rate limit to reset. */
  waitUntil?: number;
  /** Why the run ended early (bad key, no credits, daily limit, repeated failures). */
  stopped?: string; cancelled?: boolean;
}
export const newStats = (total: number, now = Date.now()): BatchStats => ({ total, done: 0, include: 0, exclude: 0, maybe: 0, failed: 0, startedAt: now });

/**
 * AI pre-screens records one by one at a pace that stays under OpenRouter's free limit (20/min).
 * A per-minute 429 is waited out and the same record is retried, so the run keeps going by itself.
 * It only ends early for things waiting cannot fix: bad key, no credits, the daily cap, or repeated failures.
 */
export async function prescreen(o: {
  todo: Rec[]; s: AiSettings; q: Pick<Project, 'question' | 'criteria'>; signal: AbortSignal;
  onResult: (r: Rec, s: AiSuggestion) => void; onProgress: (st: BatchStats) => void;
}): Promise<BatchStats> {
  const st = newStats(o.todo.length), emit = () => o.onProgress({ ...st });
  let streak = 0, lastErr = '';
  emit();
  for (const rec of o.todo) {
    if (o.signal.aborted) break;
    let tries = 0, ok = false, limitWaits = 0, lastStart = 0;
    while (!o.signal.aborted) {
      lastStart = Date.now();
      try {
        const s = await screenOne(o.s, rec, o.q, o.signal);
        o.onResult(rec, s); st[s.v]++; ok = true; break;
      } catch (e) {
        if (o.signal.aborted) break;
        const err = e instanceof AiError ? e : new AiError(e instanceof Error ? e.message : 'Network error');
        if (err.status === 401 || err.status === 402 || (err.status === 429 && err.daily)) { st.stopped = err.message; break; }
        if (err.status === 429) {
          if (++limitWaits > 10) { st.stopped = 'Still rate limited after several waits. Try again in a few minutes.'; break; }
          const ms = err.retryAfter ?? 60_000;
          st.waitUntil = Date.now() + ms; emit();
          await sleep(ms, o.signal); st.waitUntil = undefined; continue;      // same record again, not counted as a failure
        }
        lastErr = err.message;
        if (++tries >= 2) break;                                              // give up on this record only
        await sleep(1500, o.signal);
      }
    }
    if (o.signal.aborted || st.stopped) break;
    if (ok) streak = 0; else { st.failed++; streak++; }
    if (streak >= 4) { st.stopped = `Stopped after 4 failures in a row. ${lastErr}`.trim(); break; }
    st.done++; emit();
    const gap = PACE_MS - (Date.now() - lastStart);
    if (gap > 0) await sleep(gap, o.signal);
  }
  st.cancelled = o.signal.aborted; st.endedAt = Date.now(); st.waitUntil = undefined; emit();
  return st;
}
