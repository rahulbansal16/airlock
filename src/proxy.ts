import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';
import { CertAuthority } from './ca.js';
import { Gate } from './gate.js';
import { Store } from './store.js';
import { Allowlist } from './allowlist.js';
import { Config } from './config.js';
import { log } from './log.js';

const HOP_BY_HOP = new Set([
  'proxy-connection',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
]);

const SENSITIVE = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'set-cookie']);

export interface ProxyDeps {
  config: Config;
  ca: CertAuthority;
  gate: Gate;
  store: Store;
  allowlist: Allowlist;
}

export function startProxy({ config, ca, gate, store, allowlist }: ProxyDeps): http.Server {
  // Maps the local port of an intercepted CONNECT tunnel to the session that
  // opened it, so decrypted HTTPS requests can be attributed to a session.
  const tunnelSession = new Map<number, string>();

  // Internal HTTPS endpoint that terminates TLS for intercepted CONNECT
  // tunnels, minting a cert per SNI host on the fly.
  const tlsTerminator = https.createServer({
    SNICallback: (servername, cb) => {
      try {
        const { key, cert } = ca.certFor(servername);
        cb(null, tls.createSecureContext({ key, cert }));
      } catch (err) {
        cb(err as Error);
      }
    },
  });
  tlsTerminator.on('request', (req, res) => handle(req, res, 'https'));
  tlsTerminator.on('tlsClientError', () => {
    /* client aborted handshake — ignore */
  });
  tlsTerminator.listen(0, '127.0.0.1');

  const proxy = http.createServer((req, res) => handle(req, res, 'http'));

  // HTTPS: accept CONNECT, then funnel the raw socket into the TLS terminator
  // so we can read the decrypted request.
  proxy.on('connect', (req, clientSocket, head) => {
    const session = sessionFromAuth(req.headers['proxy-authorization']);
    const addr = tlsTerminator.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const upstream = net.connect(port, '127.0.0.1', () => {
      // localPort is the remotePort the TLS terminator will see for this tunnel.
      if (upstream.localPort) tunnelSession.set(upstream.localPort, session);
      if (head && head.length) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.on('close', () => {
      if (upstream.localPort) tunnelSession.delete(upstream.localPort);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  proxy.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  proxy.listen(config.proxyPort, '127.0.0.1', () =>
    log.ok(`proxy listening on http://127.0.0.1:${config.proxyPort}`),
  );

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, scheme: 'http' | 'https') {
    const rawUrl = scheme === 'https' ? `https://${req.headers.host ?? ''}${req.url ?? ''}` : req.url ?? '';
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('airlock: bad request url\n');
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const host = target.hostname;
    const session =
      scheme === 'https'
        ? tunnelSession.get(req.socket.remotePort ?? -1) ?? 'default'
        : sessionFromAuth(req.headers['proxy-authorization']);
    const verdict = gate.decide({ host, method });

    if (verdict.action === 'hold') {
      const { body, truncated } = await readBody(req, config.maxBufferBytes);
      const preview = body.subarray(0, config.bodyPreviewBytes).toString('utf8');
      const decision = await store.hold({
        method,
        url: rawUrl,
        host,
        session,
        headers: sanitizeHeaders(req.headers),
        bodyPreview: preview,
        bodyTruncated: truncated || body.length > config.bodyPreviewBytes,
        bodyBytes: body.length,
      });

      if (decision.decision === 'deny') {
        log.warn(`deny  ${method} ${rawUrl}`);
        res.writeHead(403, { 'content-type': 'text/plain' });
        return res.end('airlock: request blocked by user\n');
      }
      if (decision.remember) allowlist.add(host);
      log.ok(`allow [${session}] ${method} ${rawUrl}${decision.remember ? ' (allowlisted)' : ''}`);
      return forward(target, req, res, scheme, body);
    }

    store.logAuto(method, rawUrl, host, session, verdict.reason);
    forward(target, req, res, scheme, null);
  }

  function forward(
    target: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    scheme: 'http' | 'https',
    body: Buffer | null,
  ): void {
    const mod = scheme === 'https' ? https : http;
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = v;
    }
    if (body) headers['content-length'] = String(body.length);

    const upstream = mod.request(
      {
        protocol: `${scheme}:`,
        hostname: target.hostname,
        port: target.port || (scheme === 'https' ? 443 : 80),
        method: req.method,
        path: target.pathname + target.search,
        headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      log.error('upstream error', target.host, err.message);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`airlock: upstream error: ${err.message}\n`);
    });

    if (body) upstream.end(body);
    else req.pipe(upstream);
  }

  return proxy;
}

function readBody(req: http.IncomingMessage, cap: number): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= cap) chunks.push(c);
      else truncated = true;
    });
    req.on('end', () => resolve({ body: Buffer.concat(chunks), truncated }));
    req.on('error', () => resolve({ body: Buffer.concat(chunks), truncated }));
  });
}

/** Extract the session id that `airlock run`/`env` embeds as the proxy username. */
function sessionFromAuth(header?: string): string {
  if (!header) return 'default';
  const m = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!m) return 'default';
  try {
    const user = Buffer.from(m[1], 'base64').toString('utf8').split(':')[0];
    return user || 'default';
  } catch {
    return 'default';
  }
}

function sanitizeHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (SENSITIVE.has(k.toLowerCase())) {
      out[k] = '«redacted»';
      continue;
    }
    out[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  }
  return out;
}
