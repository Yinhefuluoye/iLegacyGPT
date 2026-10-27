#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Package a built ChatAI.app into an unsigned IPA (used by CI and locally).

Usage:
  python3 tools/package_ipa.py --app ios/.theos/obj/iphone/8.0/ChatAI.app \
      --out dist --version 0.1.5
"""

import argparse
import hashlib
import os
import plistlib
import shutil
import sys
import zipfile

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_NAME = "ChatAI"


def log(msg):
    print(msg, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", required=True, help="path to built ChatAI.app")
    ap.add_argument("--out", default=os.path.join(PROJECT, "dist"))
    ap.add_argument("--version", default=None, help="CFBundleShortVersionString override")
    ap.add_argument("--bundle-version", default=None, help="CFBundleVersion override")
    ap.add_argument("--name", default=APP_NAME, help="file name stem for the IPA")
    args = ap.parse_args()

    app = os.path.abspath(args.app)
    if not os.path.isdir(app):
        raise SystemExit("app bundle not found: " + app)
    exe = os.path.join(app, APP_NAME)
    if not os.path.isfile(exe):
        # fall back to CFBundleExecutable
        plist_path = os.path.join(app, "Info.plist")
        if not os.path.isfile(plist_path):
            raise SystemExit("no Info.plist in app bundle")
        with open(plist_path, "rb") as f:
            pl = plistlib.load(f)
        exe = os.path.join(app, pl.get("CFBundleExecutable", APP_NAME))
    if not os.path.isfile(exe):
        raise SystemExit("app executable not found: " + exe)

    plist_path = os.path.join(app, "Info.plist")
    with open(plist_path, "rb") as f:
        pl = plistlib.load(f)
    if args.version:
        pl["CFBundleShortVersionString"] = args.version
    if args.bundle_version:
        pl["CFBundleVersion"] = args.bundle_version
    with open(plist_path, "wb") as f:
        plistlib.dump(pl, f)

    os.makedirs(args.out, exist_ok=True)
    ipa_name = "%s-%s.ipa" % (args.name, pl.get("CFBundleShortVersionString", "0.0.0"))
    ipa_path = os.path.abspath(os.path.join(args.out, ipa_name))
    if os.path.exists(ipa_path):
        os.remove(ipa_path)

    root = os.path.dirname(app)
    with zipfile.ZipFile(ipa_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirnames, filenames in os.walk(app):
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = "Payload/" + os.path.relpath(full, root).replace(os.sep, "/")
                zi = zipfile.ZipInfo(rel, (2026, 1, 1, 0, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                mode = 0o755 if os.path.abspath(full) == os.path.abspath(exe) else 0o644
                zi.external_attr = (0o100000 | mode) << 16
                with open(full, "rb") as f:
                    zf.writestr(zi, f.read())

    with open(ipa_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    log("IPA   : " + ipa_path)
    log("size  : %d bytes" % os.path.getsize(ipa_path))
    log("sha256: " + digest)


if __name__ == "__main__":
    main()
