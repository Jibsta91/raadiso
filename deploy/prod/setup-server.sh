#!/usr/bin/env bash
# Prepares an Ubuntu server for Raadi (ADR-0051). Idempotent; run it as the admin user, which needs sudo:
#   ./raadi deploy setup          (pipes this file over SSH to DEPLOY_ADMIN_HOST)
# After it, the stack runs as the non-root user ${DEPLOY_USER} in ${DEPLOY_DIR}; the admin user is left for
# setup only. It needs Docker Engine and the Compose plugin already installed (Docker's apt repository).
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-prod}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/${DEPLOY_USER}/raadi}"
ADMIN_USER="${SUDO_USER:-$(id -un)}"
[[ "$(id -u)" == 0 ]] || { echo "run as root (sudo bash -s)" >&2; exit 1; }
say() { printf '  ✔ %s\n' "$*"; }
version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" == "$2" ]]; }

# Docker: the same minimums as ./raadi doctor.
command -v docker >/dev/null || { echo "Docker is not installed (docs/deploy.md)" >&2; exit 1; }
engine="$(docker version --format '{{.Server.Version}}')"
compose="$(docker compose version --short | sed 's/^v//')"
version_ge "$engine" 24.0.0 || { echo "Docker Engine $engine is too old (24 or newer)" >&2; exit 1; }
version_ge "$compose" 2.24.0 || { echo "Docker Compose $compose is too old (2.24 or newer)" >&2; exit 1; }
say "Docker Engine $engine, Compose $compose"

# The deploy user: no password, SSH with the admin user's keys, in the docker group (it runs the stack).
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
passwd -l "$DEPLOY_USER" >/dev/null
usermod -aG docker "$DEPLOY_USER"
home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
admin_keys="$(getent passwd "$ADMIN_USER" | cut -d: -f6)/.ssh/authorized_keys"
if [[ -s "$admin_keys" && ! -s "$home/.ssh/authorized_keys" ]]; then
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$admin_keys" "$home/.ssh/authorized_keys"
fi
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_DIR"
# Supplied secrets in transit and local backups (restic, slice 2) live here, readable by the user only.
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_DIR/secrets"
say "user $DEPLOY_USER, $DEPLOY_DIR"

# Firewall: SSH and the gateway. Published Docker ports bypass ufw, so the stack publishes only 80/443.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
say "ufw: 22, 80, 443"

# Security updates install themselves; reboots stay manual (the stack restarts with Docker anyway).
apt-get install -y -qq unattended-upgrades >/dev/null
printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' \
  > /etc/apt/apt.conf.d/20auto-upgrades
say "unattended security upgrades"

# Bounded logs: the journal, and Docker's own (Loki keeps the searchable copy).
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\nMaxRetentionSec=1month\n' > /etc/systemd/journald.conf.d/raadi.conf
systemctl restart systemd-journald
if [[ ! -s /etc/docker/daemon.json ]]; then
  printf '{\n  "log-driver": "local",\n  "log-opts": { "max-size": "20m", "max-file": "5" }\n}\n' \
    > /etc/docker/daemon.json
  # Running containers keep their old log settings until they are recreated.
  systemctl restart docker
fi
say "journald 1 GB, Docker logs 20 MB × 5 per container"

# OpenSearch needs vm.max_map_count ≥ 262144; a small swap file absorbs short memory peaks.
if (( $(sysctl -n vm.max_map_count) < 262144 )); then
  echo 'vm.max_map_count=262144' > /etc/sysctl.d/90-raadi.conf
  sysctl -q --system
fi
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 4G /swapfile && chmod 0600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/91-raadi-swap.conf
  sysctl -q --system
fi
say "vm.max_map_count $(sysctl -n vm.max_map_count), swap $(swapon --show=SIZE --noheadings | head -1)"

echo "Server ready. Next: ./raadi deploy"
