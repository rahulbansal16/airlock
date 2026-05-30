import fs from 'node:fs';
import { paths } from './config.js';

export interface SessionMeta {
  id: string;
  label: string;
  cwd?: string;
  command?: string;
  startedAt: number;
  lastSeen: number;
  requests: number;
}

/**
 * Tracks the Claude Code sessions (or shells) that route through airlock so
 * history can be attributed to whoever made each request. Persisted to
 * sessions.json so the dashboard still shows past sessions after a restart.
 */
export class Sessions {
  private map = new Map<string, SessionMeta>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private home: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(paths(home).sessions, 'utf8')) as SessionMeta[];
      for (const s of raw) this.map.set(s.id, s);
    } catch {
      /* no sessions yet */
    }
  }

  /** Create or enrich a session entry (called when `airlock run`/`env` starts). */
  register(meta: { id: string; label?: string; cwd?: string; command?: string }): void {
    const now = Date.now();
    const existing = this.map.get(meta.id);
    this.map.set(meta.id, {
      id: meta.id,
      label: meta.label ?? existing?.label ?? meta.id,
      cwd: meta.cwd ?? existing?.cwd,
      command: meta.command ?? existing?.command,
      startedAt: existing?.startedAt ?? now,
      lastSeen: now,
      requests: existing?.requests ?? 0,
    });
    this.scheduleSave();
  }

  /** Record that a session just made a request; creates a stub if unseen. */
  touch(id: string): void {
    const now = Date.now();
    const existing = this.map.get(id);
    if (existing) {
      existing.lastSeen = now;
      existing.requests += 1;
    } else {
      this.map.set(id, { id, label: id, startedAt: now, lastSeen: now, requests: 1 });
    }
    this.scheduleSave();
  }

  list(): SessionMeta[] {
    return [...this.map.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.writeFileSync(paths(this.home).sessions, JSON.stringify(this.list(), null, 2));
      } catch {
        /* best effort */
      }
    }, 750);
  }
}
