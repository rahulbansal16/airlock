import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Allowlist } from './allowlist.js';
import { Config } from './config.js';
import { log } from './log.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface UiDeps {
  config: Config;
  store: Store;
  allowlist: Allowlist;
  caCertPem: string;
}

export function startUI({ config, store, allowlist, caCertPem }: UiDeps): http.Server {
  const indexHtml = fs.readFileSync(path.join(here, 'public', 'index.html'), 'utf8');

  const liveState = () => ({
    ...store.snapshot(),
    allowlist: allowlist.list(),
    config: { proxyPort: config.proxyPort, uiPort: config.uiPort, gateSafeMethods: config.gateSafeMethods },
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, 'text/html; charset=utf-8', indexHtml);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, liveState());
      }
      if (req.method === 'GET' && url.pathname === '/airlock-ca.crt') {
        res.writeHead(200, {
          'content-type': 'application/x-x509-ca-cert',
          'content-disposition': 'attachment; filename="airlock-ca.crt"',
        });
        return res.end(caCertPem);
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        return stream(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/api/decision') {
        const b = await readJson(req);
        const ok = store.resolve(String(b.id), {
          decision: b.decision === 'allow' ? 'allow' : 'deny',
          remember: !!b.remember,
        });
        return json(res, ok ? 200 : 404, { ok });
      }
      if (req.method === 'POST' && url.pathname === '/api/allowlist') {
        const b = await readJson(req);
        if (b.action === 'add' && b.host) allowlist.add(String(b.host));
        if (b.action === 'remove' && b.host) allowlist.remove(String(b.host));
        store.emit('update');
        return json(res, 200, { ok: true, allowlist: allowlist.list() });
      }
      send(res, 404, 'text/plain', 'not found');
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  function stream(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const push = () => res.write(`data: ${JSON.stringify(liveState())}\n\n`);
    push();
    const onUpdate = () => push();
    store.on('update', onUpdate);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      store.off('update', onUpdate);
      clearInterval(ping);
    });
  }

  server.listen(config.uiPort, '127.0.0.1', () =>
    log.ok(`approval UI on http://127.0.0.1:${config.uiPort}`),
  );
  return server;
}

function send(res: http.ServerResponse, code: number, type: string, data: string): void {
  res.writeHead(code, { 'content-type': type });
  res.end(data);
}

function json(res: http.ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}
