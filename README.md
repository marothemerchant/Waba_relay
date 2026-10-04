# Waba_relay

Clean-room WebSocket relay compatible with the **ClawTerminal** iOS app's
*Settings → Relay Server* feature. Keeps SSH / Claude CLI sessions alive while
the app is backgrounded, and hosts shared-room broadcast (6-char room codes,
host → guests, read-only).

> The official relay server ships only inside the private ClawTerminal app
> repo (`relay-server/`). This is an independent, permissive implementation
> built from the public docs + in-app quick-setup text. The exact wire
> protocol is proprietary, so unknown frames are logged for iteration — see
> *Protocol notes* below.

## Quick start

```sh
./install.sh        # npm install, (re)start, smoke test, print token + URLs
```

Or manually:

```sh
npm install
npm start           # foreground, ws://0.0.0.0:8765
npm test            # smoke test (requires a running server)
npm run token       # print the auth token
```

## ClawTerminal setup

Settings → Relay Server:

- **Server:** `ws://<tailscale-ip-or-magicdns>:8765` (same-LAN IP works too)
- **Auth Token:** from `curl http://localhost:8765/token` on the host
  (localhost-only by design) or the end of `./install.sh` output

Tap **Test Connection**. If it fails, read `logs/relay.log` on the server —
every connection and every frame is logged with a classification, so the
exact message the app sent is visible and the handler can be extended.

## Layout

| Path | Purpose |
|---|---|
| `src/server.js` | the whole server (~250 lines, dep: `ws` only) |
| `scripts/smoke-test.js` | 10-assertion smoke test (`npm test`) |
| `install.sh` | one-shot install/start/token-print |
| `.relay-state/token` | generated once, persisted, mode 600 (gitignored) |
| `logs/relay.log` | full frame log (gitignored) |

## Protocol notes (best-guess v0.1, permissive by design)

- **Auth** accepted three ways: `?token=` query param, `Authorization: Bearer`,
  or first message `{"type":"auth","token":"…"}`. Success → `auth.success`.
- **Ping** `{"type":"ping"}` → `{"type":"pong"}`; server also sends WS-level
  pings every 30 s and terminates dead connections.
- **Rooms:** host/create/share → `room.created` with a 6-char code; join by
  code → `room.joined`; any message/output/data frame from the host is
  broadcast to guests; host stop/disconnect → `room.closed` for all guests.
- Message `type` matching is **fuzzy** (see `classify()` in `src/server.js`)
  to maximize compatibility with the real app; extend there as the true
  protocol reveals itself in `logs/relay.log`.
- `/health` (any interface) returns `{ok, rooms, conns}`; `/token` answers on
  localhost only.

## Production notes (this codespace)

- Managed by `/etc/init.d/waba-relay` (runs as the unprivileged `codespace`
  user), auto-started at container boot from `/usr/local/share/ssh-init.sh`
  after tailscaled. `sudo service waba-relay start|stop|restart|status`.
- Reachable over Tailscale only: the host firewall (INPUT DROP + HARDENING
  chain) allows `tailscale0`, so `ws://100.91.244.126:8765` or the MagicDNS
  name works from any tailnet device; eth0/LAN access to 8765 is dropped.
