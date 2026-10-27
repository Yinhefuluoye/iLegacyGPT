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

# A Windows git checkout stores the SDK's YAML stubs with CRLF line endings,
# which ld64 reports as "unsupported tapi file type '!tapi-tbd-v2". Normalise.
find "$SDK" -name '*.tbd' -type f -exec sed -i 's/\r$//' {} + 2>/dev/null || true

python3 tools/patch_sdk.py --sdk "$SDK"

echo "==> building (armv7 / iOS 10.3)…"
( cd ios && make FINALPACKAGE=1 ) 2>&1 | tail -n 160 || {
  echo "error: build failed" >&2
  exit 1
}

# Theos keeps the link output under .theos/obj and the staged bundle with its
# resources under .theos/_ — pick whichever directory actually has Info.plist.
APP="$(find ios/.theos -type d -name 'ChatAI.app' 2>/dev/null | while read -r d; do
  if [ -f "$d/Info.plist" ]; then echo "$d"; break; fi
done)"
if [ -z "$APP" ]; then
  APP="$(find ios/.theos -type d -name 'ChatAI.app' 2>/dev/null | head -n 1)"
fi
if [ -z "$APP" ]; then
  echo "error: ChatAI.app not found under ios/.theos" >&2
  exit 1
fi
echo "==> bundle: $APP"

VERSION="${VERSION:-0.1.local}"
python3 tools/package_ipa.py \
  --app "$APP" \
  --out dist \
  --version "$VERSION" \
  --bundle-version "$(date +%s)"

echo
ls -lh dist/*.ipa