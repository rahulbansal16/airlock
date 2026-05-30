import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { paths } from './config.js';
import { Sessions } from './sessions.js';

export interface PendingInfo {
  method: string;
  url: string;
  host: string;
  session: string;
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
  session: string;
  at: number;
  outcome: string;
}

/**
 * Holds the queue of requests awaiting a human decision and a rolling log of
 * recent outcomes, each attributed to the session that made the request.
 * History is appended to history.jsonl so it survives restarts, and the most
 * recent entries are reloaded on startup. Emits `update` on every change so the
 * UI can stream live state over SSE.
 */
export class Store extends EventEmitter {
  private pending = new Map<string, PendingEntry>();
  private history: HistoryEntry[] = [];
  private maxHistory = 500;

  constructor(
    private home: string,
    private sessions: Sessions,
  ) {
    super();
    this.loadHistory();
  }

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
    this.record({
      id,
      method: entry.method,
      url: entry.url,
      host: entry.host,
      session: entry.session,
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
  logAuto(method: string, url: string, host: string, session: string, reason: string): void {
    this.record({ id: randomUUID(), method, url, host, session, at: Date.now(), outcome: `auto (${reason})` });
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

  private record(h: HistoryEntry): void {
    this.sessions.touch(h.session);
    this.history.unshift(h);
    if (this.history.length > this.maxHistory) this.history.pop();
    try {
      fs.appendFileSync(paths(this.home).history, JSON.stringify(h) + '\n');
    } catch {
      /* best effort: dashboard still has the in-memory copy */
    }
  }

  private loadHistory(): void {
    try {
      const lines = fs.readFileSync(paths(this.home).history, 'utf8').trim().split('\n');
      this.history = lines
        .slice(-this.maxHistory)
        .map((l) => JSON.parse(l) as HistoryEntry)
        .reverse();
    } catch {
      /* no history yet */
    }
  }
}
