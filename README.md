# airlock

A human-in-the-loop approval proxy for outbound requests made during a **Claude Code** session.

`airlock` runs a local forward proxy plus a small web UI. When a Claude Code
session (or any tool it spawns — `curl`, `wget`, MCP servers, `WebFetch`) makes
an outbound request, airlock decides what to do:

- **GET / HEAD / OPTIONS** (read-only) and any **allowlisted host** flow through automatically.
- Any **`POST` / `PUT` / `DELETE` / `PATCH` to a host that isn't on your allowlist is held** and shown in the UI with its method, URL, headers and body. The request proceeds only when you click **Approve** — or you can **Deny** it (the client gets a `403`).

Because the proxy performs TLS interception with a locally-trusted CA, it can
see the method and URL even for HTTPS requests.

```
   Claude Code ──HTTP(S)_PROXY──▶  airlock proxy ──▶  ?  ──▶  the internet
                                        │
                                        ▼
                                  approval UI  ◀── you click Approve / Deny
```

## Install

```bash
npm install -g airlock-proxy      # or: npm link from a clone
```

From a clone:

```bash
npm install
npm run build
npm link        # exposes the `airlock` command globally
```

## Use

**1. Start the proxy + UI** (leave it running in its own terminal):

```bash
airlock start
# proxy on http://127.0.0.1:9000, approval UI on http://127.0.0.1:9001
```

Open the UI at **http://127.0.0.1:9001**.

**2. Run a Claude Code session through it.** Either inject the env and run inline:

```bash
airlock run claude
```

…or export the variables into your current shell:

```bash
eval "$(airlock env)"
claude
```

Now every mutating request the session attempts pauses in the UI until you
approve it. Click **"Approve & always allow `<host>`"** to add the host to your
persistent allowlist so it never prompts again.

## Commands

| Command | Description |
| --- | --- |
| `airlock start` | Start the proxy and approval UI. `--proxy-port`, `--ui-port`, `--gate-reads` (also gate GET/HEAD/OPTIONS). |
| `airlock run <cmd…>` | Launch a command with traffic routed through airlock (e.g. `airlock run claude`). |
| `airlock env` | Print shell `export` lines (`eval "$(airlock env)"`). |
| `airlock status` | Show whether airlock is running and any pending approvals. |
| `airlock allow [host]` | List the allowlist, or add a host to it. |
| `airlock ca` | Print the path to the root CA certificate. |

## How requests are gated

```
allowlisted host?  ──▶ allow
mutating method (POST/PUT/DELETE/PATCH)?  ──▶ hold for approval
otherwise (GET/HEAD/OPTIONS)  ──▶ allow
```

Pass `--gate-reads` to `airlock start` to require approval for read methods too.

## The CA certificate

To read HTTPS methods/URLs, airlock terminates TLS using a root CA generated
once at `~/.airlock/ca.crt`. The `airlock env` / `airlock run` commands point
Node, curl, Python and friends at it via `NODE_EXTRA_CA_CERTS`,
`SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE` (a bundle of your
system roots **plus** the airlock CA, so other TLS still works). The CA private
key never leaves your machine. To trust it system-wide, import `~/.airlock/ca.crt`
into your OS/browser trust store, or download it from
`http://127.0.0.1:9001/airlock-ca.crt`.

## State on disk

Everything lives under `~/.airlock/` (override with `AIRLOCK_HOME`):

- `ca.crt` / `ca.key` — the root CA.
- `ca-bundle.crt` — system roots + airlock CA, for curl/python.
- `allowlist.json` — your persistent allowlist (seeded with the Anthropic API so the session can always reach the model).
- `daemon.json` — the running proxy/UI ports.

## Limitations

- Only traffic that honours `HTTP_PROXY`/`HTTPS_PROXY` is intercepted. Most
  tools (Node `fetch`/undici, curl, requests) do; statically-linked or
  proxy-ignoring binaries may not.
- Held request bodies are buffered up to 25 MB; larger bodies are forwarded
  truncated for display purposes.
- This is a local developer tool, not a hardened security boundary.

## License

MIT
