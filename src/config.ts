import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface Config {
  /** Directory holding the CA, allowlist and runtime state (default ~/.airlock). */
  homeDir: string;
  /** Port the forward proxy listens on. */
  proxyPort: number;
  /** Port the approval web UI listens on. */
  uiPort: number;
  /** How many bytes of a held request body to surface in the UI. */
  bodyPreviewBytes: number;
  /** Hard cap on a buffered request body when a request is held. */
  maxBufferBytes: number;
  /** When true, GET/HEAD/OPTIONS also require approval (off by default). */
  gateSafeMethods: boolean;
}

/** Idempotent / read-only methods that flow through without approval by default. */
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
/** Side-effecting methods that are held for approval. */
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function airlockHome(): string {
  const dir = process.env.AIRLOCK_HOME || path.join(os.homedir(), '.airlock');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const homeDir = overrides.homeDir ?? airlockHome();
  return {
    homeDir,
    proxyPort: overrides.proxyPort ?? Number(process.env.AIRLOCK_PROXY_PORT ?? 9000),
    uiPort: overrides.uiPort ?? Number(process.env.AIRLOCK_UI_PORT ?? 9001),
    bodyPreviewBytes: overrides.bodyPreviewBytes ?? 64 * 1024,
    maxBufferBytes: overrides.maxBufferBytes ?? 25 * 1024 * 1024,
    gateSafeMethods: overrides.gateSafeMethods ?? false,
  };
}

export const paths = (home: string) => ({
  caCert: path.join(home, 'ca.crt'),
  caKey: path.join(home, 'ca.key'),
  caBundle: path.join(home, 'ca-bundle.crt'),
  allowlist: path.join(home, 'allowlist.json'),
  daemon: path.join(home, 'daemon.json'),
  sessions: path.join(home, 'sessions.json'),
  history: path.join(home, 'history.jsonl'),
});
