#!/usr/bin/env bash
# Install Theos inside the imported Ubuntu (run as the normal user).
#
# Done manually instead of running upstream install-theos, because this network
# cannot reliably reach raw.githubusercontent.com; github.com and the release
# downloads do work. SDKs are copied from the Windows-side sparse clone.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export THEOS="${THEOS:-$HOME/theos}"
ARCH="$(uname -m)"
SDK_SRC="$ROOT/.toolchain/theos-sdks/iPhoneOS10.3.sdk"

echo "==> Theos dir: $THEOS (arch $ARCH)"

if [ ! -d "$THEOS/makefiles" ]; then
  echo "==> cloning theos"
  git clone --recursive https://github.com/theos/theos "$THEOS"
fi

if [ ! -x "$THEOS/toolchain/linux/iphone/bin/clang" ]; then
  echo "==> downloading Linux iOS toolchain"
  mkdir -p "$THEOS/toolchain"
  URL="https://github.com/L1ghtmann/llvm-project/releases/latest/download/iOSToolchain-$ARCH.tar.xz"
  echo "    $URL"
  curl -L --fail --retry 5 --retry-delay 3 "$URL" -o /tmp/iOSToolchain.tar.xz
  tar -xJf /tmp/iOSToolchain.tar.xz -C "$THEOS/toolchain/"
  rm -f /tmp/iOSToolchain.tar.xz
fi

echo "==> installing SDK"
mkdir -p "$THEOS/sdks"
if [ ! -d "$THEOS/sdks/iPhoneOS10.3.sdk" ]; then
  if [ -d "$SDK_SRC" ]; then
    cp -r "$SDK_SRC" "$THEOS/sdks/"
  else
    "$THEOS/bin/install-sdk" 10.3
  fi
fi

echo "==> verifying"
"$THEOS/toolchain/linux/iphone/bin/clang" --version | head -n 2
ls "$THEOS/sdks"