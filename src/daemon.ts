import { Config } from './config.js';
import { CertAuthority } from './ca.js';
import { Allowlist } from './allowlist.js';
import { Sessions } from './sessions.js';
import { Store } from './store.js';
import { Gate } from './gate.js';
import { startProxy } from './proxy.js';
import { startUI } from './ui.js';

export interface Daemon {
  ca: CertAuthority;
  allowlist: Allowlist;
  sessions: Sessions;
  store: Store;
  gate: Gate;
}

/** Wire the CA, allowlist, sessions, gate, proxy and UI together and listen. */
export function startDaemon(config: Config): Daemon {
  const ca = new CertAuthority(config.homeDir);
  const allowlist = new Allowlist(config.homeDir);
  const sessions = new Sessions(config.homeDir);
  const store = new Store(config.homeDir, sessions);
  const gate = new Gate(allowlist, config);

  startProxy({ config, ca, gate, store, allowlist });
  startUI({ config, store, allowlist, sessions, caCertPem: ca.caCertificatePem });

  return { ca, allowlist, sessions, store, gate };
}
