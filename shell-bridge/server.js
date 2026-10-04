'use strict';
/**
 * shell-bridge — WebSocket bridge to a persistent bash process.
 *
 * One bash per connection, pipes (no PTY — line-oriented shell, good for raw
 * commands; interactive TUIs like vim/top won't work by design).
 *
 * Protocol (JSON frames):
 *   client -> { type: 'input', data: 'ls -la\n' }
 *   server -> { type: 'output', stream: 'stdout'|'stderr', data: '...' }
 *   server -> { type: 'exit', code: 0 }
 *
 * Auth: ?token=<token> (generated on first run, stored in ./.token mode 600).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.SHELL_BRIDGE_PORT || '8766', 10);
const HOME_DIR = process.env.SHELL_BRIDGE_HOME || '/home/codespace';
const TOKEN_FILE = path.join(__dirname, '.token');

function loadOrCreateToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t.length >= 16) return t;
  } catch { /* first run */ }
  const t = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
}
const TOKEN = loadOrCreateToken();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, conns: wss.clients.size }) + '\n');
    return;
  }
  if (req.url === '/status') {
    // Tailnet summary for the app's "In Review" count. codespace has
    // passwordless sudo; tailscaled's socket is root-only.
    execFile('sudo', ['-n', 'tailscale', 'status', '--json'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'tailscale query failed' }) + '\n');
        return;
      }
      try {
        const st = JSON.parse(stdout);
        const peers = Object.values(st.Peer || {});
        const online = peers.filter((p) => p.Online).length;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          self: st.Self && st.Self.HostName,
          peers: peers.length,
          online,
          offline: peers.length - online,
        }) + '\n');
      } catch {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'bad tailscale data' }) + '\n');
      }
    });
    return;
  }
  res.writeHead(404).end('shell-bridge: WebSocket endpoint\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('token') !== TOKEN) {
    ws.close(4401, 'invalid token');
    return;
  }

  const shell = spawn('/bin/bash', ['--norc', '--noprofile', '-i'], {
    cwd: HOME_DIR,
    env: {
      ...process.env,
      HOME: HOME_DIR,
      TERM: 'dumb', // no PTY: keep output line-oriented, no escape sequences
      PS1: '$ ',
      PATH: `${HOME_DIR}/nvm/current/bin:/usr/local/bin:/usr/bin:/bin`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  shell.stdout.on('data', (d) => send({ type: 'output', stream: 'stdout', data: d.toString() }));
  shell.stderr.on('data', (d) => send({ type: 'output', stream: 'stderr', data: d.toString() }));
  shell.on('exit', (code) => {
    send({ type: 'exit', code });
    ws.close(1000, 'shell exited');
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      shell.stdin.write(msg.data);
    }
  });
  ws.on('close', () => shell.kill('SIGTERM'));
  ws.on('error', () => shell.kill('SIGTERM'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`shell-bridge listening on 0.0.0.0:${PORT} (ws, token auth)`);
});
