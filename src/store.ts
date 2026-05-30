import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export interface PendingInfo {
  method: string;
  url: string;
  host: string;
  headers: Record<string, string>;
  bodyPreview: string;
  bodyTruncated: boolean;
  bodyBytes: number;
}

export interface Decision {
  decision: 'allow' | 'deny';
  remember?: boolean;
}

interface PendingEntry extends PendingInfo {
  id: string;
  createdAt: number;
  resolve: (d: Decision) => void;
}

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  host: string;
  at: number;
  outcome: string;
}

/**
 * Holds the queue of requests awaiting a human decision and a rolling log of
 * recent outcomes. Emits `update` whenever either changes so the UI can stream
 * live state over SSE.
 */
export class Store extends EventEmitter {
  private pending = new Map<string, PendingEntry>();
  private history: HistoryEntry[] = [];
  private maxHistory = 200;

  /** Park a request until a decision arrives from the UI. */
  hold(info: PendingInfo): Promise<Decision> {
    const id = randomUUID();
    return new Promise<Decision>((resolve) => {
      this.pending.set(id, { ...info, id, createdAt: Date.now(), resolve });
      this.emit('update');
    });
  }

  /** Resolve a held request with the user's decision. */
  resolve(id: string, decision: Decision): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    this.addHistory({
      id,
      method: entry.method,
      url: entry.url,
      host: entry.host,
      at: Date.now(),
      outcome:
        decision.decision === 'allow'
          ? decision.remember
            ? 'approved + allowlisted'
            : 'approved'
          : 'denied',
    });
    entry.resolve(decision);
    this.emit('update');
    return true;
  }

  /** Record an auto-allowed request (safe method or allowlisted host). */
  logAuto(method: string, url: string, host: string, reason: string): void {
    this.addHistory({ id: randomUUID(), method, url, host, at: Date.now(), outcome: `auto (${reason})` });
    this.emit('update');
  }

  snapshot() {
    return {
      pending: [...this.pending.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ resolve, ...rest }) => rest),
      history: this.history,
    };
  }

  private addHistory(h: HistoryEntry): void {
    this.history.unshift(h);
    if (this.history.length > this.maxHistory) this.history.pop();
  }
}
