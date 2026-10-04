# AGENTS.md

## Project

`waba-relay`: a clean-room, permissive WebSocket relay (Node 20+, single dep `ws`) compatible with the ClawTerminal iOS app's "Relay Server" (ws://:8765, token auth, `/token` endpoint, 6-char room broadcast). The real protocol is proprietary — `classify()` in `src/server.js` fuzzy-matches message types, and unknown frames are logged to `logs/relay.log`. When the app misbehaves, read that log first and extend the handlers; do not tighten the auth/message handling without evidence from the log.

## Commands

- `npm start` — run foreground; `npm test` — 10-assertion smoke test (needs a running server); `npm run token` — print the auth token
- `./install.sh` — install + restart via service + smoke test + print token/URLs
- `sudo service waba-relay start|stop|restart|status` — production control (runs as `codespace`, pid file `/run/waba-relay.pid`)
- State: token in `.relay-state/token` (gitignored, mode 600). Logs: `logs/relay.log`. Both survive restarts; neither survives a codespace rebuild (token regenerates on first boot — that's fine, just re-enter it in the app).

## Gotchas

- Never `pkill -f` with a pattern matching `server.js` from a shell whose own cmdline contains it — it SIGTERMs the invoking shell. Use `sudo service waba-relay stop` instead.
- `/token` intentionally answers on localhost only; the WS endpoint is on `0.0.0.0:8765`. Reachability from the iPhone is via Tailscale (`tailscale0` is allowed by the HARDENING chain; eth0:8765 is dropped).

## Environment (this dev container)

- No systemd (PID 1 is `docker-init`); `/usr/local/bin/systemctl` is a shim that tells you to use `service`. Manage daemons with `sudo service <name> start|stop|status` (SysV scripts in `/etc/init.d/`).
- Boot-time services are started by name from `/usr/local/share/ssh-init.sh` (runs sshd) and `/usr/local/share/docker-init.sh` (runs containerd/dockerd). `rc*.d` runlevel symlinks are never executed.
- Tailscale is installed and joined to the user's tailnet as node `codespaces-7dd7c1` (exit node + Tailscale SSH enabled, stateful filtering on). Custom `/etc/init.d/tailscaled` manages it and re-applies `net.ipv4.ip_forward=1` / `net.ipv6.conf.all.forwarding=1` on start; it auto-starts at container boot via a line appended to `ssh-init.sh`. State lives in `/var/lib/tailscale` — reconnects without an auth key.
- Host is hardened; boot order in `ssh-init.sh` is hardening → sshd → tailscaled. `/etc/init.d/hardening` applies `/etc/sysctl.d/99-hardening.conf` and sets iptables INPUT policy DROP with a `HARDENING` allow chain (lo, established, tailscale0, udp/41641, tcp/22, docker0, icmp). FORWARD/nat belong to dockerd/tailscaled; OUTPUT is open on purpose.
- sshd is keys-only (no password, no root login) via `/etc/ssh/sshd_config.d/99-hardening.conf`; root password is locked. Do not flush iptables or re-enable password auth to "fix" connectivity — adjust the `HARDENING` chain instead.
- iptables runs mixed legacy/nft (image's own setup; docker-init.sh picks the alternative). The "iptables-legacy tables present" warning is normal here.
