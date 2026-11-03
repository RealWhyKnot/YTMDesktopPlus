#!/bin/sh
set -eu

RUNTIME_VERSION=25.08
SOURCE=$1
BUILD_DIR=${HOME}/build

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

flatpak install --user --noninteractive flathub \
  "org.freedesktop.Sdk//${RUNTIME_VERSION}" "org.electronjs.Electron2.BaseApp//${RUNTIME_VERSION}"

mkdir -p "${BUILD_DIR}"
rsync -a --delete --exclude node_modules --exclude out --exclude .vite \
  --exclude tools/test-harness/runs \
  "${SOURCE}/" "${BUILD_DIR}/"

cd "${BUILD_DIR}"
set -- .yarn/releases/yarn-*.cjs
yarn=$1
node "${yarn}" install --immutable
node "${yarn}" make --arch x64 --targets flatpak

mkdir -p "${SOURCE}/out/make/flatpak"
cp -r "${BUILD_DIR}"/out/make/flatpak/. "${SOURCE}/out/make/flatpak/"
