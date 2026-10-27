#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Restore symlinks that a Windows git checkout stored as text stubs.

`git clone` on Windows without symlink support writes each symlink as a small
file whose content is the link target. The SDK trees in theos/sdks contain many
such links (e.g. usr/include/pthread.h -> pthread/pthread.h); compiling against
those stubs fails with "expected identifier or '('".

This walks a directory tree, finds such stub files (small, single-line, path-like
and pointing at an existing file) and replaces them with real symlinks.

Usage: python3 tools/fix_sdk_symlinks.py <sdk-root>
"""

import os
import sys


def stub_target(path):
    if os.path.islink(path) or not os.path.isfile(path):
        return None
    try:
        size = os.path.getsize(path)
    except OSError:
        return None
    if size == 0 or size > 250:
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except (OSError, UnicodeDecodeError):
        return None
    text = text.strip()
    if not text or "\n" in text or "\x00" in text:
        return None
    if any(ch.isspace() for ch in text):
        return None
    if text.startswith("#") or "*" in text or "//" in text:
        return None
    if not (text.endswith(".h") or text.endswith(".tbd") or text.endswith(".modulemap")
            or text.endswith(".inc") or text.endswith(".a") or text.endswith(".dylib")):
        return None
    resolved = os.path.normpath(os.path.join(os.path.dirname(path), text))
    if not os.path.exists(resolved):
        return None
    return text


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python3 tools/fix_sdk_symlinks.py <sdk-root>")
    root = os.path.abspath(sys.argv[1])
    converted = 0
    seen = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            path = os.path.join(dirpath, name)
            seen += 1
            target = stub_target(path)
            if target is None:
                continue
            os.remove(path)
            os.symlink(target, path)
            converted += 1
    print("scanned %d files, restored %d symlinks under %s" % (seen, converted, root))


if __name__ == "__main__":
    main()