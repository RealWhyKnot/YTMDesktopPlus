#!/bin/sh
# Provisions the Arch WSL distro used to test the Linux flatpak build. Idempotent.
set -eu

RUNTIME_VERSION=25.08
MARKER=/var/lib/ytmdplus-provisioned

if [ "$(id -u)" -ne 0 ]; then
  echo "provision.sh must run as root" >&2
  exit 1
fi

echo "==> Refreshing pacman keyring"
if [ ! -f /etc/pacman.d/gnupg/trustdb.gpg ]; then
  pacman-key --init
  pacman-key --populate archlinux
fi

# Node is pinned to the major CI builds with. @electron/packager exits silently partway
# through extracting the Electron zip on 26, leaving no out directory and exit status 0.
echo "==> Pinning Node to the major CI builds with"
if ! pacman -Qq nodejs-lts-jod >/dev/null 2>&1; then
  pacman -Rdd --noconfirm nodejs >/dev/null 2>&1 || true
  pacman -Sy --noconfirm nodejs-lts-jod
fi

echo "==> Installing packages"
pacman -Syu --noconfirm --needed \
  flatpak dbus xdg-desktop-portal xdg-desktop-portal-gtk \
  mesa libglvnd noto-fonts \
  git npm rsync flatpak-builder elfutils

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
  flathub "org.freedesktop.Platform//${RUNTIME_VERSION}"

# WSL starts every distro as root; the flatpak install above is per-user.
if ! grep -q '^default=deck' /etc/wsl.conf 2>/dev/null; then
  echo "==> Setting deck as the default WSL user"
  printf '\n[user]\ndefault=deck\n' >>/etc/wsl.conf
fi

date -u +%Y-%m-%dT%H:%M:%SZ >"$MARKER"
echo "==> Provisioned"
