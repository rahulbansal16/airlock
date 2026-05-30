import { Config } from './config.js';
import { CertAuthority } from './ca.js';
import { Allowlist } from './allowlist.js';
import { Store } from './store.js';
import { Gate } from './gate.js';
import { startProxy } from './proxy.js';
import { startUI } from './ui.js';

export interface Daemon {
  ca: CertAuthority;
  allowlist: Allowlist;
  store: Store;
  gate: Gate;
}

/** Wire the CA, allowlist, gate, proxy and UI together and start listening. */
export function startDaemon(config: Config): Daemon {
  const ca = new CertAuthority(config.homeDir);
  const allowlist = new Allowlist(config.homeDir);
  const store = new Store();
  const gate = new Gate(allowlist, config);

  startProxy({ config, ca, gate, store, allowlist });
  startUI({ config, store, allowlist, caCertPem: ca.caCertificatePem });

  return { ca, allowlist, store, gate };
}
