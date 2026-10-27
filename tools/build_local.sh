#!/usr/bin/env bash
# Build ChatAI.app + IPA inside WSL/Ubuntu (Theos must be installed).
#
#   bash tools/build_local.sh
#   VERSION=0.2.0 bash tools/build_local.sh
#
# Theos is looked up from $THEOS, defaulting to ~/theos.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export THEOS="${THEOS:-$HOME/theos}"
SDK="$THEOS/sdks/iPhoneOS10.3.sdk"

if [ ! -d "$THEOS/makefiles" ]; then
  echo "error: Theos not found at $THEOS" >&2
  echo "hint : bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)\"" >&2
  exit 1
fi
if [ ! -d "$SDK" ]; then
  echo "error: iPhoneOS10.3.sdk not found at $SDK" >&2
  echo "hint : $THEOS/bin/install-sdk 10.3" >&2
  exit 1
fi

python3 tools/patch_sdk.py --sdk "$SDK"

echo "==> building (armv7 / iOS 10.3)…"
( cd ios && make FINALPACKAGE=1 ) 2>&1 | tail -n 160 || {
  echo "error: build failed" >&2
  exit 1
}

APP="$(find ios/.theos/obj -type d -name 'ChatAI.app' | head -n 1)"
if [ -z "$APP" ]; then
  echo "error: ChatAI.app not found under ios/.theos/obj" >&2
  exit 1
fi

VERSION="${VERSION:-0.1.local}"
python3 tools/package_ipa.py \
  --app "$APP" \
  --out dist \
  --version "$VERSION" \
  --bundle-version "$(date +%s)"

echo
ls -lh dist/*.ipa