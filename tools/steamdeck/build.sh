#!/bin/sh
# Builds the flatpak inside the distro from a copy of the working tree at $1.
set -eu

RUNTIME_VERSION=25.08
SOURCE=$1
BUILD_DIR=$HOME/build

# WSL appends the Windows PATH, so a bare node resolves to a Windows shim whose CRLF line
# endings fail as a Linux interpreter.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

flatpak install --user --noninteractive flathub \
  "org.freedesktop.Sdk//${RUNTIME_VERSION}" "org.electronjs.Electron2.BaseApp//${RUNTIME_VERSION}"

# Built here rather than over /mnt, which is slow, and whose node_modules is built for Windows.
mkdir -p "$BUILD_DIR"
rsync -a --delete --exclude node_modules --exclude out --exclude .vite \
  --exclude tools/test-harness/runs \
  "$SOURCE/" "$BUILD_DIR/"

cd "$BUILD_DIR"
yarn=$(ls .yarn/releases/yarn-*.cjs | head -1)
node "$yarn" install --immutable
node "$yarn" make --arch x64 --targets @electron-forge/maker-flatpak

mkdir -p "$SOURCE/out/make/flatpak"
cp -r "$BUILD_DIR"/out/make/flatpak/. "$SOURCE/out/make/flatpak/"
