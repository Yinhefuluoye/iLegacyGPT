#!/usr/bin/env bash
# One-time bootstrap for the imported Ubuntu distro (run as ROOT, inside WSL).
#
#   wsl -d Ubuntu -u root -- bash /mnt/d/.../projects/ipad-chat-client/tools/wsl_bootstrap.sh
#
# Creates the user, sets CN apt mirrors, installs build dependencies.

set -euo pipefail

USER_NAME="${WSL_USER:-yinhe}"

if [ "$(id -u)" != "0" ]; then
  echo "run as root: wsl -d Ubuntu -u root -- bash $0" >&2
  exit 1
fi

echo "==> apt mirrors (aliyun)"
cat >/etc/apt/sources.list <<'EOF'
deb http://mirrors.aliyun.com/ubuntu/ jammy main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ jammy-updates main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ jammy-backports main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ jammy-security main restricted universe multiverse
EOF

export DEBIAN_FRONTEND=noninteractive
echo "==> apt update + deps"
apt-get update -y
apt-get install -y --no-install-recommends \
  bash curl sudo git unzip python3 make perl ca-certificates xz-utils \
  libc6-dev libstdc++6 rsync

echo "==> user: $USER_NAME"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$USER_NAME"
fi
usermod -aG sudo "$USER_NAME"
echo "$USER_NAME ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$USER_NAME"
chmod 440 "/etc/sudoers.d/$USER_NAME"

echo "==> /etc/wsl.conf default user"
cat >/etc/wsl.conf <<EOF
[user]
default=$USER_NAME
EOF

echo "==> ok (user=$USER_NAME)"