#!/usr/bin/env bash
# WSL1 workaround: the Swift toolchain shipped with the Theos Linux toolchain
# hangs in its driver (`swift-driver --version` spins forever), and Theos probes
# `swiftc --version` at make time. We never build Swift here, so hide the Swift
# binaries so the probe fails fast instead of hanging.
set -euo pipefail

THEOS="${THEOS:-$HOME/theos}"
TC="$THEOS/toolchain/linux/iphone"
HOST="$THEOS/toolchain/linux/host"

echo "== where is the probe =="
grep -rn "swiftc --version" "$THEOS/makefiles" "$THEOS/bin" 2>/dev/null | head -5 || true
grep -rn "cut -d" "$THEOS/makefiles" 2>/dev/null | head -5 || true

echo "== hiding swift binaries =="
for f in "$TC/bin/swiftc" "$TC/bin/swiftc-original" "$TC/bin/swift-frontend" \
         "$HOST/bin/swift-driver" "$HOST/bin/swift-frontend" "$HOST/bin/swiftc"; do
  if [ -f "$f" ]; then
    chmod -x "$f" && echo "  -x $f"
  fi
done

echo "== verify probe is fast =="
( time timeout 5 bash -c 'swiftc --version 2>/dev/null | head -1' ) 2>&1 | head -4 || true
echo "done"