#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--inside" ]; then
  package=$2
  case "$package" in
    *.deb)
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$package" xvfb xauth dbus procps
      ;;
    *.rpm)
      dnf install -y -q "$package" xorg-x11-server-Xvfb xorg-x11-xauth dbus-daemon procps-ng shadow-utils util-linux
      ;;
    *)
      echo "Not a deb or rpm: $package" >&2
      exit 1
      ;;
  esac
  command -v ytmdesktop-plus
  test -x /usr/lib/ytmdesktop-plus/ytmdesktop-plus
  grep -qs "x-scheme-handler/ytmdplus" /usr/share/applications/*.desktop
  useradd -m smoke
  exec runuser -u smoke -- bash "$0" --launch
fi

if [ "${1:-}" = "--launch" ]; then
  cd "$HOME"
  dbus-run-session -- xvfb-run -a ytmdesktop-plus --no-sandbox > "$HOME/app.log" 2>&1 &
  sleep 45
  ok=""
  if pgrep -x ytmdesktop-plus > /dev/null && [ -n "$(ls -A "$HOME/.config/YTMDesktopPlus" 2>/dev/null)" ]; then ok=1; fi
  echo "--- app output tail"
  tail -n 40 "$HOME/app.log" || true
  pkill -x ytmdesktop-plus || true
  [ -n "$ok" ]
  exit 0
fi

package=$(realpath "$1")
image=$2
name=$(basename "$package")
docker run --rm \
  -v "$package:/smoke/$name:ro" \
  -v "$(realpath "$0"):/smoke/linux-package.sh:ro" \
  "$image" bash /smoke/linux-package.sh --inside "/smoke/$name"
