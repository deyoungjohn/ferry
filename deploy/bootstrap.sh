#!/usr/bin/env bash
set -euo pipefail

# Idempotent host bootstrap for an Ubuntu 24.04 Lightsail instance.
# Run as root from the repository: sudo ADMIN_IP=203.0.113.10 bash deploy/bootstrap.sh
# It reads no secret file and starts no solver process.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
FERRY_USER="${FERRY_USER:-ferry}"
ADMIN_IP="${ADMIN_IP:-}"
FNM_DIR="/opt/fnm"

export DEBIAN_FRONTEND=noninteractive

log() {
	printf '%s\n' "$*"
}

warn() {
	printf 'warning: %s\n' "$*" >&2
}

if [ "$(id -u)" -ne 0 ]; then
	log "Run this script as root (sudo ADMIN_IP=203.0.113.10 bash deploy/bootstrap.sh)."
	exit 1
fi

if [ ! -r "$REPO_ROOT/.nvmrc" ] || [ ! -r "$REPO_ROOT/package.json" ]; then
	log "Run this script from the Ferry repository; .nvmrc and package.json are required."
	exit 1
fi

NODE_VERSION="$(tr -d '[:space:]' <"$REPO_ROOT/.nvmrc")"
NODE_VERSION="${NODE_VERSION#v}"
PNPM_VERSION="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json" | head -n 1)"
PNPM_VERSION="${PNPM_VERSION:-9.15.9}"
NODE_ROOT="$FNM_DIR/node-versions/v$NODE_VERSION/installation"
NODE_BIN="$NODE_ROOT/bin/node"
NPM_BIN="$NODE_ROOT/bin/npm"
PNPM_BIN="$NODE_ROOT/bin/pnpm"

log "Ferry bootstrap: Node $NODE_VERSION, pnpm $PNPM_VERSION, user $FERRY_USER"

log "Installing base packages"
apt-get update
apt-get install -y \
	apt-transport-https \
	build-essential \
	ca-certificates \
	curl \
	debian-archive-keyring \
	debian-keyring \
	fail2ban \
	git \
	gnupg \
	python3 \
	rsync \
	sqlite3 \
	ufw \
	unattended-upgrades \
	unzip \
	xz-utils

log "Creating the $FERRY_USER service user"
if ! id "$FERRY_USER" >/dev/null 2>&1; then
	useradd --create-home --shell /bin/bash --comment "Ferry service" "$FERRY_USER"
fi

SOURCE_USER="${SUDO_USER:-root}"
SOURCE_HOME="$(getent passwd "$SOURCE_USER" | cut -d: -f6 || true)"
KEY_SOURCE=""
for candidate in "$SOURCE_HOME/.ssh/authorized_keys" /root/.ssh/authorized_keys; do
	if [ -n "$candidate" ] && [ -f "$candidate" ]; then
		KEY_SOURCE="$candidate"
		break
	fi
done
if [ -z "$KEY_SOURCE" ]; then
	log "No SSH authorized_keys found for $SOURCE_USER or root."
	log "Add your public key before running this script so key-only SSH cannot lock you out."
	exit 1
fi
install -d -m 0700 -o "$FERRY_USER" -g "$FERRY_USER" "/home/$FERRY_USER/.ssh"
install -m 0600 -o "$FERRY_USER" -g "$FERRY_USER" "$KEY_SOURCE" "/home/$FERRY_USER/.ssh/authorized_keys"

log "Hardening SSH to key-only authentication"
install -d -m 0755 /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/99-ferry-hardening.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
SSH
if ! sshd -t; then
	log "sshd configuration validation failed; not reloading SSH."
	exit 1
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd

log "Configuring the firewall"
ufw default deny incoming
ufw default allow outgoing
if [ -n "$ADMIN_IP" ]; then
	ufw allow from "$ADMIN_IP" to any port 22 proto tcp
else
	warn "ADMIN_IP is unset; SSH port 22 is open to all addresses."
	ufw allow 22/tcp
fi
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Configuring fail2ban and unattended upgrades"
cat >/etc/fail2ban/jail.d/ferry.local <<'FAIL2BAN'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true
FAIL2BAN
systemctl enable --now fail2ban
systemctl restart fail2ban

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'UPGRADES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
UPGRADES
systemctl enable --now unattended-upgrades

log "Installing Node $NODE_VERSION with fnm in $FNM_DIR"
if [ ! -x "$FNM_DIR/fnm" ]; then
	curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$FNM_DIR" --skip-shell
fi
if [ ! -x "$FNM_DIR/fnm" ]; then
	log "fnm installation did not produce $FNM_DIR/fnm."
	exit 1
fi
if [ ! -x "$NODE_BIN" ] || [ "$("$NODE_BIN" --version)" != "v$NODE_VERSION" ]; then
	"$FNM_DIR/fnm" install "$NODE_VERSION" --fnm-dir "$FNM_DIR" --log-level error
fi
if [ ! -x "$NODE_BIN" ] || [ "$("$NODE_BIN" --version)" != "v$NODE_VERSION" ]; then
	log "Expected Node v$NODE_VERSION at $NODE_BIN; refusing to continue."
	exit 1
fi
chmod -R a+rX "$FNM_DIR"
for binary in node npm npx; do
	if [ -x "$NODE_ROOT/bin/$binary" ]; then
		ln -sf "$NODE_ROOT/bin/$binary" "/usr/local/bin/$binary"
	fi
done

log "Installing pnpm $PNPM_VERSION"
if [ ! -x "$PNPM_BIN" ] || [ "$("$PNPM_BIN" --version 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
	"$NPM_BIN" install --global "pnpm@$PNPM_VERSION"
fi
if [ ! -x "$PNPM_BIN" ]; then
	log "pnpm installation did not produce $PNPM_BIN."
	exit 1
fi
ln -sf "$PNPM_BIN" /usr/local/bin/pnpm
if [ "$(pnpm --version)" != "$PNPM_VERSION" ]; then
	log "Expected pnpm $PNPM_VERSION on PATH; found $(pnpm --version)."
	exit 1
fi

log "Installing Caddy from the official apt repository"
if ! command -v caddy >/dev/null 2>&1; then
	curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
		| gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
		-o /etc/apt/sources.list.d/caddy-stable.list
	apt-get update
	apt-get install -y caddy
fi

log "Creating service directories and permissions"
install -d -m 0750 -o root -g "$FERRY_USER" /etc/ferry
if [ ! -e /etc/ferry/solver.env ]; then
	install -m 0600 -o "$FERRY_USER" -g "$FERRY_USER" /dev/null /etc/ferry/solver.env
fi
chown "$FERRY_USER:$FERRY_USER" /etc/ferry/solver.env
chmod 0600 /etc/ferry/solver.env
install -d -m 0750 -o "$FERRY_USER" -g "$FERRY_USER" /var/lib/ferry
install -d -m 0750 -o "$FERRY_USER" -g "$FERRY_USER" /var/log/ferry
install -d -m 0755 -o root -g root /var/www/ferry /var/www/ferry/swap /var/www/ferry/landing
install -d -m 0750 -o caddy -g caddy /var/log/caddy

log "Installing helper scripts and systemd units"
install -m 0750 -o root -g "$FERRY_USER" "$REPO_ROOT/deploy/backup.sh" /usr/local/sbin/ferry-backup
install -m 0750 -o root -g "$FERRY_USER" "$REPO_ROOT/deploy/healthcheck.sh" /usr/local/sbin/ferry-healthcheck
install -m 0644 "$REPO_ROOT/deploy/systemd/ferry-solver.service" /etc/systemd/system/ferry-solver.service
install -m 0644 "$REPO_ROOT/deploy/systemd/ferry-backup.service" /etc/systemd/system/ferry-backup.service
install -m 0644 "$REPO_ROOT/deploy/systemd/ferry-backup.timer" /etc/systemd/system/ferry-backup.timer
install -m 0644 "$REPO_ROOT/deploy/systemd/ferry-health.service" /etc/systemd/system/ferry-health.service
install -m 0644 "$REPO_ROOT/deploy/systemd/ferry-health.timer" /etc/systemd/system/ferry-health.timer

log "Installing the Caddy configuration"
if [ ! -f /etc/caddy/Caddyfile ] || ! grep -q '/var/www/ferry/landing' /etc/caddy/Caddyfile; then
	if [ -f /etc/caddy/Caddyfile ]; then
		cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-ferry.$(date -u +%Y%m%dT%H%M%SZ)"
	fi
	install -m 0644 "$REPO_ROOT/deploy/Caddyfile" /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile
chown -R caddy:caddy /var/log/caddy

systemctl daemon-reload
systemctl enable ferry-solver.service ferry-backup.timer ferry-health.timer caddy.service >/dev/null

log "Bootstrap complete."
log "Next: edit /etc/caddy/Caddyfile for the real domain, fill /etc/ferry/solver.env,"
log "build the web and solver, then start caddy, ferry-solver, ferry-backup.timer and ferry-health.timer."
