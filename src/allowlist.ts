import fs from 'node:fs';
import { paths } from './config.js';

interface AllowData {
  hosts: string[];
}

/**
 * Hosts that are trusted out of the box so a Claude Code session can always
 * reach the model API and basic telemetry without prompting. The host of
 * ANTHROPIC_BASE_URL (if set) is added too.
 */
function defaultHosts(): string[] {
  const hosts = new Set<string>([
    'api.anthropic.com',
    'console.anthropic.com',
    'claude.ai',
    'statsig.anthropic.com',
  ]);
  if (process.env.ANTHROPIC_BASE_URL) {
    try {
      hosts.add(new URL(process.env.ANTHROPIC_BASE_URL).hostname);
    } catch {
      /* ignore malformed base url */
    }
  }
  return [...hosts];
}

/** Persistent set of hosts whose requests are auto-approved across sessions. */
export class Allowlist {
  private hosts = new Set<string>();

  constructor(private home: string) {
    const file = paths(home).allowlist;
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')) as AllowData;
        (data.hosts ?? []).forEach((h) => this.hosts.add(h));
      } catch {
        /* corrupt file — start from what defaults provide below */
      }
    } else {
      defaultHosts().forEach((h) => this.hosts.add(h));
      this.save();
    }
  }

  has(host: string): boolean {
    return this.hosts.has(host);
  }

  add(host: string): void {
    this.hosts.add(host);
    this.save();
  }

  remove(host: string): void {
    this.hosts.delete(host);
    this.save();
  }

  list(): string[] {
    return [...this.hosts].sort();
  }

  private save(): void {
    fs.writeFileSync(
      paths(this.home).allowlist,
      JSON.stringify({ hosts: this.list() }, null, 2),
    );
  }
}
