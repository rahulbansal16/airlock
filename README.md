<div align="center">

# 🔒 Airlock

### See and approve every request your Claude Code agent makes, in real time.

Airlock is a local approval proxy and live dashboard for [Claude Code](https://claude.com/claude-code). It pauses risky writes such as POST, PUT, DELETE and PATCH, then waits for your click before they ever leave your machine. Read traffic and hosts you trust flow straight through, so your agent stays fast while you stay in control.

[![License: MIT](https://img.shields.io/badge/license-MIT-3da639.svg)](LICENSE)
[![Built for Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-d97757.svg)](https://claude.com/claude-code)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-388bfd.svg)](#contributing)
[![Star on GitHub](https://img.shields.io/github/stars/rahulbansal16/airlock?style=social)](https://github.com/rahulbansal16/airlock)

[Quick start](#quick-start) &nbsp;•&nbsp; [Why Airlock](#why-airlock) &nbsp;•&nbsp; [How it works](#how-it-works) &nbsp;•&nbsp; [Commands](#commands) &nbsp;•&nbsp; [FAQ](#faq)

</div>

<br/>

## Why Airlock

AI coding agents are powerful because they can act on their own. They can call APIs, push data, delete records and reach any endpoint they like. Most of the time that is exactly what you want. Sometimes it is the one request you wish you had seen first.

Airlock gives your agent a glass door. Every outbound call is visible. The dangerous ones stop and ask. You approve with one click, or you block it, and the agent keeps working with no broken sessions and no guesswork.

> Think of it as a code review step for network traffic, running live while your agent works.

## What you get

- ✅ **Live approval dashboard** for outbound traffic, served on your own machine at `http://127.0.0.1:9001`
- ✅ **Writes pause, reads pass.** POST, PUT, DELETE and PATCH to any host you have not trusted yet are held for approval. GET, HEAD and OPTIONS flow through.
- ✅ **One click to always trust a host.** Approve once and Airlock remembers it in a persistent allowlist across every future session.
- ✅ **Full request detail.** Method, URL, headers and body, even over HTTPS, thanks to local TLS interception with a certificate that never leaves your laptop.
- ✅ **Works with everything your agent spawns.** Claude Code itself, MCP servers, WebFetch, plus `curl`, `wget` and Python scripts run inside Bash.
- ✅ **History by session.** Every request is attributed to the session that made it, so you can see exactly which Claude Code run called which API. History is saved to disk and survives restarts.
- ✅ **Zero config to start.** The Anthropic API is trusted out of the box so your agent can always think.

## Demo

```text
┌──────────────────────────────────────────── AIRLOCK ─ live ──┐
│  Pending approval (1)                                         │
│                                                              │
│  [ POST ]  https://api.stripe.com/v1/charges   refactor-auth │
│  ▸ headers & body (218 bytes)                                │
│                                                              │
│     [ Approve ]  [ Approve & always allow api.stripe.com ]   │
│     [ Deny ]                                                 │
│                                                              │
│  Sessions:   refactor-auth  12      nightly-deploy  3        │
│  Allowlist:  api.anthropic.com   api.github.com              │
│                                                              │
│  Activity                              filter: all sessions  │
│   12:04:51  refactor-auth   approved   POST  api.github.com  │
│   12:04:48  nightly-deploy  auto       GET   registry.npmjs  │
└──────────────────────────────────────────────────────────────┘
```

## Quick start

Airlock needs Node 20 or newer. Install it once and use it from any project. This command clones, builds and links the `airlock` command for you.

```bash
npm install -g github:rahulbansal16/airlock
```

Prefer a local checkout? Clone it and link instead.

```bash
git clone https://github.com/rahulbansal16/airlock
cd airlock
npm install        # builds automatically through the prepare step
npm link           # puts the airlock command on your PATH
```

A published package on the npm registry is on the way. Once it lands you will also be able to run `npm install -g airlock-proxy`.

Start the proxy and the dashboard in their own terminal and leave it running.

```bash
airlock start
```

Open the dashboard at **http://127.0.0.1:9001**, then launch Claude Code through Airlock.

```bash
airlock run claude
```

That is it. From now on, every write your agent attempts shows up in the dashboard and waits for your approval. Prefer to wire your current shell instead?

```bash
eval "$(airlock env)"
claude
```

## How it works

Claude Code and the tools it spawns honor the standard `HTTP_PROXY` and `HTTPS_PROXY` settings. Airlock points them at a tiny proxy running on your own machine. To read the method and URL of encrypted HTTPS calls, it terminates TLS locally using a root certificate it generates once and keeps in `~/.airlock`. The private key stays on your laptop.

```text
   Claude Code  ──►  HTTPS_PROXY  ──►  Airlock proxy  ──►  the internet
                                            │
                                            ▼
                                    approval dashboard
                                            │
                                   you click Approve or Deny
```

Every request is checked against one simple rule.

```text
  host is on your allowlist            ──►  allow
  method is POST, PUT, DELETE, PATCH   ──►  hold for your approval
  method is GET, HEAD, OPTIONS         ──►  allow
```

Want to review reads too? Start with `airlock start --gate-reads` and Airlock will pause every method.

## Commands

- **`airlock start`** starts the proxy and the approval dashboard. Flags: `--proxy-port`, `--ui-port`, `--gate-reads`.
- **`airlock run <command>`** launches any command with its traffic routed through Airlock, for example `airlock run claude`. Add `--label <name>` to name the session in the dashboard.
- **`airlock env`** prints the shell exports to route your current shell. Use it as `eval "$(airlock env)"`. Add `--label <name>` to name the session.
- **`airlock status`** shows whether Airlock is running and how many requests are waiting.
- **`airlock allow [host]`** lists your allowlist, or adds a host to it.
- **`airlock ca`** prints the path to the root certificate.

## History by session

Each time you launch a run, Airlock mints a session id and embeds it in the proxy credentials, which clients send back on every request. The proxy reads that id, threads it through the encrypted tunnel, and tags every request with it. The dashboard then shows a Sessions panel with a request count per session, a session label on each row, and a filter so you can view one session at a time.

```bash
airlock run --label refactor-auth claude
airlock run --label nightly-deploy claude
```

Give two runs different labels and the dashboard tells you exactly which one called which API. History is written to `~/.airlock/history.jsonl` and reloaded on restart, so you keep a durable record of what your agents did on the network.

## Trusting the certificate

To show you the contents of HTTPS calls, Airlock signs traffic with a root certificate stored at `~/.airlock/ca.crt`. The `airlock run` and `airlock env` commands point Node, curl and Python at it automatically, using a bundle of your system roots plus the Airlock root so the rest of your TLS keeps working. To trust it everywhere, import `~/.airlock/ca.crt` into your operating system or browser, or download it from `http://127.0.0.1:9001/airlock-ca.crt`.

## Where state lives

Everything sits under `~/.airlock`, which you can move with the `AIRLOCK_HOME` variable.

- **`ca.crt` and `ca.key`** are your root certificate and its private key.
- **`ca-bundle.crt`** is your system roots plus the Airlock root, for curl and Python.
- **`allowlist.json`** is your saved list of trusted hosts, seeded with the Anthropic API.
- **`daemon.json`** records the ports the running proxy and dashboard use.

## FAQ

**Does this slow my agent down?**
No. Reads and trusted hosts pass straight through. Only writes to a host you have not approved yet wait for you, and approving one is a single click.

**Does it capture my Anthropic API key or other secrets?**
The dashboard redacts sensitive headers such as `authorization`, `cookie` and `x-api-key` before it shows a request. Nothing is sent anywhere. Everything runs on your machine.

**Will it break the Claude Code session?**
The Anthropic API is trusted out of the box, so the agent can always reach the model. A denied request returns a clean `403` to the caller, which the agent simply sees as a failed call.

**What does it not cover?**
Only traffic that honors proxy settings is intercepted. Most tools do, including Node fetch, curl and Python requests. A binary that ignores proxy settings will not be seen.

**Is this a security boundary?**
Airlock is a developer tool for visibility and oversight, not a hardened sandbox. Pair it with real isolation if you need a strict boundary.

## Roadmap

- A native Claude Code hook layer for tool level approval alongside the proxy
- Rules by URL path and by request body content
- Desktop notifications when a request is waiting
- Shareable team allowlists

## Contributing

Issues and pull requests are very welcome. To build from source:

```bash
git clone https://github.com/rahulbansal16/airlock
cd airlock
npm install
npm run build
npm link
```

If Airlock saves you from one request you did not want to send, please star the repo so more people find it.

## License

MIT. See [LICENSE](LICENSE).
