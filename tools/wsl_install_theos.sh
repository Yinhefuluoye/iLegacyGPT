#!/usr/bin/env bash
# Install Theos inside the imported Ubuntu distro (run as the normal user).
set -euo pipefail

export THEOS="${THEOS:-$HOME/theos}"

if [ -d "$THEOS/makefiles" ]; then
  echo "Theos already installed at $THEOS"
else
  echo "==> installing Theos to $THEOS"
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)"
fi

echo "==> ensuring iPhoneOS10.3 SDK"
if [ ! -d "$THEOS/sdks/iPhoneOS10.3.sdk" ]; then
  "$THEOS/bin/install-sdk" 10.3 || true
fi

echo "==> Theos ready:"
ls "$THEOS/sdks" | head -n 20