#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Patch theos/sdks tbd stubs so armv7 *executables* (not just tweaks) can link.

The theos/sdks iPhoneOS SDK tbd files were generated from simulator binaries and
omit a few device-only Objective-C runtime symbols used by armv7 struct-returning
message sends. Tweaks link with -undefined dynamic_lookup and never notice, but
an .app executable needs every symbol declared.

Adding the declarations here is safe: the real symbols exist in the device's
/usr/lib/libobjc.A.dylib at runtime.

Usage:
  python3 tools/patch_sdk.py --sdk "$THEOS/sdks/iPhoneOS10.3.sdk"
"""

import argparse
import os
import sys

SYMBOLS = [
    "_objc_msgSend_stret",
    "_objc_msgSendSuper_stret",
    "_objc_msgSendSuper2_stret",
    "_objc_msgSend_fpret",
    "_objc_msgSend_fp2ret",
]

EXTRA_BLOCK = (
    "  - archs:                [ armv7, armv7s ]\n"
    "    symbols:              [ _objc_msgSend_stret, _objc_msgSendSuper_stret,\n"
    "                            _objc_msgSendSuper2_stret, _objc_msgSend_fpret,\n"
    "                            _objc_msgSend_fp2ret ]\n"
)


def patch_file(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    if "_objc_msgSend_stret" in text:
        return False
    if "exports:\n" not in text:
        # e.g. tbd redirect files such as libobjc.tbd; nothing to patch here
        return False
    patched = text.replace("exports:\n", "exports:\n" + EXTRA_BLOCK, 1)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(patched)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sdk", required=True, help="path to iPhoneOS10.3.sdk")
    args = ap.parse_args()
    sdk = os.path.abspath(args.sdk)
    targets = [
        os.path.join(sdk, "usr", "lib", "libobjc.A.tbd"),
        os.path.join(sdk, "usr", "lib", "libobjc.tbd"),
    ]
    changed = 0
    for path in targets:
        if not os.path.isfile(path):
            print("skip missing:", path)
            continue
        try:
            if patch_file(path):
                print("patched:", path)
                changed += 1
            else:
                print("already ok:", path)
        except Exception as exc:  # noqa: BLE001
            print("WARN failed to patch %s: %s" % (path, exc))
    if changed == 0:
        print("no changes needed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
