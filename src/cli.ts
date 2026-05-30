#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig, paths } from './config.js';
import { startDaemon } from './daemon.js';
import { CertAuthority } from './ca.js';
import { Allowlist } from './allowlist.js';
import { log } from './log.js';

interface DaemonInfo {
  proxyPort?: number;
  uiPort?: number;
}

function daemonInfo(): DaemonInfo {
  try {
    return JSON.parse(fs.readFileSync(paths(loadConfig().homeDir).daemon, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Environment that routes a child process through the running airlock proxy.
 * When a session id is given it is embedded as the proxy username, which
 * clients send back as Proxy-Authorization so the proxy can attribute requests.
 */
function proxyEnv(session?: string): Record<string, string> {
  const config = loadConfig();
  const p = paths(config.homeDir);
  const port = daemonInfo().proxyPort ?? config.proxyPort;
  const auth = session ? `${encodeURIComponent(session)}:airlock@` : '';
  const proxyUrl = `http://${auth}127.0.0.1:${port}`;
  const bundle = fs.existsSync(p.caBundle) ? p.caBundle : p.caCert;
  return {
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    NODE_EXTRA_CA_CERTS: p.caCert,
    SSL_CERT_FILE: bundle,
    REQUESTS_CA_BUNDLE: bundle,
    CURL_CA_BUNDLE: bundle,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
}

/** Best-effort registration of a session with the running daemon. */
async function registerSession(meta: { id: string; label?: string; cwd?: string; command?: string }): Promise<void> {
  const port = daemonInfo().uiPort;
  if (!port) return;
  try {
    await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(meta),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* daemon not reachable — the proxy still tags by id from the request */
  }
}

const program = new Command();
program
  .name('airlock')
  .description('Human-in-the-loop approval proxy for outbound requests in a Claude Code session')
  .version('0.1.0')
  .enablePositionalOptions();

program
  .command('start')
  .description('Start the airlock proxy and approval UI')
  .option('--proxy-port <n>', 'proxy port (default 9000)', (v) => Number(v))
  .option('--ui-port <n>', 'approval UI port (default 9001)', (v) => Number(v))
  .option('--gate-reads', 'also require approval for GET/HEAD/OPTIONS', false)
  .action((opts: { proxyPort?: number; uiPort?: number; gateReads?: boolean }) => {
    const config = loadConfig({
      proxyPort: opts.proxyPort,
      uiPort: opts.uiPort,
      gateSafeMethods: !!opts.gateReads,
    });
    const ca = new CertAuthority(config.homeDir);
    writeBundle(config.homeDir, ca.caCertificatePem);
    fs.writeFileSync(
      paths(config.homeDir).daemon,
      JSON.stringify({ proxyPort: config.proxyPort, uiPort: config.uiPort, pid: process.pid, startedAt: Date.now() }, null, 2),
    );

    startDaemon(config);

    log.ok(`gating ${config.gateSafeMethods ? 'all requests' : 'POST/PUT/DELETE/PATCH'} to non-allowlisted hosts`);
    log.info('route a session through airlock with:  eval "$(airlock env)" && claude');

    const cleanup = () => {
      try {
        fs.rmSync(paths(config.homeDir).daemon);
      } catch {
        /* already gone */
      }
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });

program
  .command('env')
  .description('Print shell exports that route a session through airlock (use: eval "$(airlock env)")')
  .option('--label <name>', 'name this session in the dashboard history')
  .action(async (opts: { label?: string }) => {
    const id = randomUUID().slice(0, 8);
    const label = opts.label ?? `shell:${path.basename(process.cwd())}`;
    await registerSession({ id, label, cwd: process.cwd() });
    const lines = Object.entries(proxyEnv(id)).map(([k, v]) => `export ${k}=${v}`);
    process.stdout.write(lines.join('\n') + '\n');
  });

program
  .command('run')
  .description('Run a command (e.g. "airlock run claude") with its traffic routed through airlock')
  .argument('<command...>', 'command and arguments to launch')
  .option('--label <name>', 'name this session in the dashboard history')
  .allowUnknownOption()
  .passThroughOptions()
  .action(async (command: string[], opts: { label?: string }) => {
    const [cmd, ...args] = command;
    const id = randomUUID().slice(0, 8);
    const label = opts.label ?? cmd;
    await registerSession({ id, label, cwd: process.cwd(), command: command.join(' ') });
    log.ok(`session "${label}" (${id}) routed through airlock`);
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...proxyEnv(id) },
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
    child.on('error', (err) => {
      log.error(`failed to launch ${cmd}: ${err.message}`);
      process.exit(127);
    });
  });

program
  .command('ca')
  .description('Print the path to the airlock root CA certificate')
  .action(() => {
    const config = loadConfig();
    const ca = new CertAuthority(config.homeDir);
    writeBundle(config.homeDir, ca.caCertificatePem);
    process.stdout.write(paths(config.homeDir).caCert + '\n');
  });

program
  .command('allow [host]')
  .description('Add a host to the persistent allowlist, or list the allowlist when no host is given')
  .action((host?: string) => {
    const config = loadConfig();
    const allowlist = new Allowlist(config.homeDir);
    if (host) {
      allowlist.add(host);
      log.ok(`allowlisted ${host}`);
      log.info('restart airlock (or use the UI) for a running daemon to pick this up');
    } else {
      process.stdout.write(allowlist.list().join('\n') + '\n');
    }
  });

program
  .command('status')
  .description('Show whether airlock is running and any pending approvals')
  .action(async () => {
    const config = loadConfig();
    const p = paths(config.homeDir);
    let daemon: { proxyPort?: number; uiPort?: number } = {};
    try {
      daemon = JSON.parse(fs.readFileSync(p.daemon, 'utf8'));
    } catch {
      log.warn('airlock is not running');
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.uiPort}/api/state`);
      const state = (await res.json()) as { pending: unknown[]; allowlist: string[] };
      log.ok(`running — proxy:${daemon.proxyPort} ui:${daemon.uiPort}`);
      log.info(`pending approvals: ${state.pending.length}`);
      log.info(`allowlist: ${state.allowlist.join(', ')}`);
    } catch {
      log.warn('daemon record present but UI not reachable — it may have crashed');
    }
  });

/** Build a CA bundle of (system roots + airlock CA) for tools like curl/python. */
function writeBundle(home: string, caPem: string): void {
  const p = paths(home);
  let system = '';
  for (const cand of ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/cert.pem']) {
    try {
      if (fs.existsSync(cand)) {
        system = fs.readFileSync(cand, 'utf8');
        break;
      }
    } catch {
      /* try next candidate */
    }
  }
  fs.writeFileSync(p.caBundle, `${system}\n${caPem}`);
}

program.parseAsync(process.argv);
