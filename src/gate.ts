import { Allowlist } from './allowlist.js';
import { Config, SAFE_METHODS } from './config.js';

export interface Verdict {
  action: 'allow' | 'hold';
  reason: string;
}

/** Decides whether an outbound request flows through or waits for approval. */
export class Gate {
  constructor(
    private allow: Allowlist,
    private config: Config,
  ) {}

  decide(req: { host: string; method: string }): Verdict {
    const method = req.method.toUpperCase();
    if (this.allow.has(req.host)) {
      return { action: 'allow', reason: 'allowlisted' };
    }
    if (!this.config.gateSafeMethods && SAFE_METHODS.has(method)) {
      return { action: 'allow', reason: 'safe-method' };
    }
    return { action: 'hold', reason: 'mutating-request' };
  }
}
