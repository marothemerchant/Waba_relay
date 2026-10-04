# AGENTS.md

## Repo state

The repo is a near-empty shell: the `waba-relay` project (clean-room ClawTerminal-compatible relay) was deleted on 2026-10-04. Full implementation lives in git history (commit `03d28da` and earlier) — restore from there if asked; do not rebuild it from scratch. The `/etc/init.d/waba-relay` service and its `ssh-init.sh` boot hook were removed at the same time; port 8765 is closed.

## auto-link (Expo app)

- Expo SDK 57 app in `auto-link/` (gitignored from this repo; no own repo yet). Expo/EAS CLI is signed in as `marotheart` (session in `~/.expo/`).
- Metro dev server: `/etc/init.d/metro-auto-link` (user `codespace`, boot-wired in `ssh-init.sh` after opencode-serve), advertises the tailnet IP via `REACT_NATIVE_PACKAGER_HOSTNAME=100.91.244.126`. Expo Go connects to `exp://100.91.244.126:8081` — manual URL entry required; LAN auto-discovery doesn't cross Tailscale.
- EAS project `@marotheart/auto-link` (id `c58420cc-dc64-4638-80aa-8cef57c25835`). Publish: `cd auto-link && CI=1 npx --yes eas-cli@latest update --branch main --message "..." --platform all --non-interactive`. `runtimeVersion` in app.json is pinned to the literal `exposdk:57.0.0` for Expo Go compatibility — bump it when the SDK upgrades.
- `npx expo install <pkg>` fails in this environment; use plain `npm install <pkg>` instead (worked for expo-updates).
- EAS quirks seen here: `branch:create` may report "GraphQL request failed" after actually succeeding (verify with `branch:list` before retrying).

## opencode-serve (Tailscode API)

- `opencode serve` on `0.0.0.0:4096` for the Tailscode iOS app, installed by the guitaripod/Tailscode script (files: `~/.local/bin/opencode-serve-*`, `~/.config/opencode-serve.env` with the basic-auth password, marker-guarded — don't hand-edit those scripts; re-run the installer to change them). Its systemd `--user` units are inert here; the machine runs it via `/etc/init.d/opencode-serve` (user `codespace`, boot-wired in `ssh-init.sh` after waba-relay, logs `~/.local/state/opencode-serve/stdout.log`).
- Auth is HTTP basic, user `opencode`, password in the env file. Only `/api/*` enforces it — paths like `/config` or `/session` return the public SPA HTML shell (200) even without credentials; that's not an auth failure.
- The 15-min model-catalog refresher (`opencode-catalog-refresh`) is intentionally not scheduled: it stands down on opencode v2 (installed: v2.0.22), and no cron/systemd exists here.

## Environment (this dev container)

- No systemd (PID 1 is `docker-init`); `/usr/local/bin/systemctl` is a shim that tells you to use `service`. Manage daemons with `sudo service <name> start|stop|status` (SysV scripts in `/etc/init.d/`).
- Boot-time services are started by name from `/usr/local/share/ssh-init.sh` (runs sshd) and `/usr/local/share/docker-init.sh` (runs containerd/dockerd). `rc*.d` runlevel symlinks are never executed.
- Tailscale is installed and joined to the user's tailnet as node `codespaces-7dd7c1` (exit node + Tailscale SSH enabled, stateful filtering on). Custom `/etc/init.d/tailscaled` manages it and re-applies `net.ipv4.ip_forward=1` / `net.ipv6.conf.all.forwarding=1` on start; it auto-starts at container boot via a line appended to `ssh-init.sh`. State lives in `/var/lib/tailscale` — reconnects without an auth key.
- Host is hardened; boot order in `ssh-init.sh` is hardening → sshd → tailscaled. `/etc/init.d/hardening` applies `/etc/sysctl.d/99-hardening.conf` and sets iptables INPUT policy DROP with a `HARDENING` allow chain (lo, established, tailscale0, udp/41641, tcp/22, docker0, icmp). FORWARD/nat belong to dockerd/tailscaled; OUTPUT is open on purpose.
- sshd is keys-only (no password, no root login) via `/etc/ssh/sshd_config.d/99-hardening.conf`; root password is locked. Do not flush iptables or re-enable password auth to "fix" connectivity — adjust the `HARDENING` chain instead.
- iptables runs mixed legacy/nft (image's own setup; docker-init.sh picks the alternative). The "iptables-legacy tables present" warning is normal here.
