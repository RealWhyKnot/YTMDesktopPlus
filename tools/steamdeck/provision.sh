#!/bin/sh
# Provisions the Arch WSL distro used to test the Linux flatpak build. Idempotent.
set -eu

RUNTIME_VERSION=25.08
MARKER=/var/lib/ytmdplus-provisioned

if [ "$(id -u)" -ne 0 ]; then
  echo "provision.sh must run as root" >&2
  exit 1
fi

if command -v pacman >/dev/null 2>&1; then
  echo "==> Refreshing pacman keyring"
  if [ ! -f /etc/pacman.d/gnupg/trustdb.gpg ]; then
    pacman-key --init
    pacman-key --populate archlinux
  fi

  echo "==> Installing Node"
  if ! pacman -Qq nodejs >/dev/null 2>&1; then
    pacman -Rdd --noconfirm nodejs-lts-jod >/dev/null 2>&1 || true
    pacman -Sy --noconfirm nodejs
  fi

  echo "==> Installing packages"
  pacman -Syu --noconfirm --needed \
    flatpak dbus xdg-desktop-portal xdg-desktop-portal-gtk \
    mesa libglvnd noto-fonts \
    git npm rsync flatpak-builder elfutils
elif command -v apt-get >/dev/null 2>&1; then
  echo "==> Installing packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get -y install --no-install-recommends \
    flatpak dbus xdg-desktop-portal xdg-desktop-portal-gtk \
    libgl1-mesa-dri libglvnd0 fonts-noto-core \
    git nodejs npm rsync flatpak-builder elfutils
else
  echo "provision.sh supports pacman and apt-get distros only" >&2
  exit 1
fi

# The Deck's own user, so paths in logs and bug reports line up with a real device.
if ! id deck >/dev/null 2>&1; then
  echo "==> Creating user deck"
  useradd --create-home --shell /bin/bash deck
  passwd --delete deck
fi

echo "==> Adding flathub and the runtime the app is built against"
runuser -u deck -- flatpak remote-add --if-not-exists --user \
  flathub https://dl.flathub.org/repo/flathub.flatpakrepo
runuser -u deck -- flatpak install --user --noninteractive \
  flathub "org.freedesktop.Platform//${RUNTIME_VERSION}" \
  "org.freedesktop.Sdk//${RUNTIME_VERSION}" "org.electronjs.Electron2.BaseApp//${RUNTIME_VERSION}"

# WSL starts every distro as root; the flatpak install above is per-user.
if ! grep -q '^default=' /etc/wsl.conf 2>/dev/null; then
  echo "==> Setting deck as the default WSL user"
  printf '\n[user]\ndefault=deck\n' >>/etc/wsl.conf
fi

date -u +%Y-%m-%dT%H:%M:%SZ >"$MARKER"
echo "==> Provisioned"
