#!/usr/bin/env bash
# Diagnostic: which linker does Theos use and what version is it?
set -u

THEOS="${THEOS:-$HOME/theos}"
TC="$THEOS/toolchain/linux"

echo "== toolchain layout =="
ls "$TC"

echo "== ld candidates =="
for p in "$TC/iphone/bin/ld" "$TC/host/bin/ld" "$TC/iphone/bin/ld64"; do
    if [ -e "$p" ]; then
        echo "-- $p"
        file -b "$p" 2>/dev/null | head -1
        "$p" -v 2>&1 | head -3
    fi
done

echo "== resolution with toolchain PATH =="
PATH="$TC/iphone/bin:$PATH" bash -c 'which -a ld 2>/dev/null; ld -v 2>&1 | head -3'

echo "== clang link test (armv7) =="
SDK="$THEOS/sdks/iPhoneOS10.3.sdk"
printf 'int main(void){return 0;}\n' >/tmp/t.c
"$TC/iphone/bin/clang" -target armv7-apple-ios8.0 -isysroot "$SDK" -c /tmp/t.c -o /tmp/t.o 2>&1 | head -3
"$TC/iphone/bin/clang" -target armv7-apple-ios8.0 -isysroot "$SDK" /tmp/t.o -o /tmp/t 2>&1 | head -6
ls -l /tmp/t 2>/dev/null && file -b /tmp/t