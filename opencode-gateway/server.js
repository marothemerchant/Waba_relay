#!/usr/bin/env node
'use strict';
/**
 * opencode-gateway — passwordless front door for `opencode serve`.
 *
 * opencode serve (v2) has no unauthenticated mode: it requires a password,
 * generating a random one per start when none is configured. This gateway
 * owns the public port (4096, tailnet-only via the HARDENING chain) and
 * forwards to the real server on 127.0.0.1:4097, injecting the basic-auth
 * header so browsers and apps never see a password prompt.
 *
 * The upstream password is read from ~/.config/opencode-serve.env at start
 * (single source of truth; also consumed by the opencode-serve runner).
 * Exposure model is unchanged: without the tailnet, nothing reaches 4096.
 */
const http = require('http');
const fs = require('fs');

const LISTEN_PORT = 4096;
const UPSTREAM_PORT = 4097;
const ENV_FILE = process.env.HOME + '/.config/opencode-serve.env';

function readPassword() {
  const text = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*OPENCODE_SERVER_PASSWORD=(.+)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

const password = readPassword();
if (!password) {
  console.error('opencode-gateway: OPENCODE_SERVER_PASSWORD not found in ' + ENV_FILE);
  process.exit(1); // fail closed — never proxy to an unknown-auth upstream
}
const AUTH = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${UPSTREAM_PORT}`, authorization: AUTH };
  const up = http.request(
    {
      host: '127.0.0.1',
      port: UPSTREAM_PORT,
      path: req.url,
      method: req.method,
      headers,
      agent: false, // fresh socket per request keeps SSE streams honest
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  up.on('error', (err) => {
    console.error('upstream error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('opencode-gateway: upstream unavailable\n');
  });
  req.pipe(up);
});

// SSE (/api/event) is long-lived; disable the idle timeouts.
server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;

// The SPA uses SSE, not WebSockets — refuse upgrades rather than hang.
server.on('upgrade', (req, socket) => socket.destroy());

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`opencode-gateway listening on 0.0.0.0:${LISTEN_PORT} -> 127.0.0.1:${UPSTREAM_PORT} (auth injected)`);
});
