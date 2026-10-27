#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Turn one square master PNG into the iOS 10 icon set and wire Info.plist.

Usage:
  python tools/make_app_icons.py --master path/to/icon-1024.png

Outputs loose PNGs into ios/Resources/ (they land at the app bundle root) and
updates ios/Resources/Info.plist with CFBundleIcons / CFBundleIconFiles.
The master must be opaque (iOS icons may not carry alpha).
"""

import argparse
import os
import plistlib
import sys

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow is required (pip install pillow)")

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(PROJECT, "ios", "Resources")
DEFAULT_PLIST = os.path.join(DEFAULT_OUT, "Info.plist")

# name -> edge length in pixels (iPad app: 20/29/40/76 + their @2x, 83.5, store)
SIZES = [
    ("Icon-20.png", 20),
    ("Icon-20@2x.png", 40),
    ("Icon-29.png", 29),
    ("Icon-29@2x.png", 58),
    ("Icon-40.png", 40),
    ("Icon-40@2x.png", 80),
    ("Icon-76.png", 76),
    ("Icon-76@2x.png", 152),
    ("Icon-83.5@2x.png", 167),
    ("Icon-1024.png", 1024),
]

ICON_FILES = ["Icon-20", "Icon-29", "Icon-40", "Icon-76", "Icon-83.5"]


def square_master(im):
    im = im.convert("RGBA")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    im = im.crop((left, top, left + side, top + side))

    # iOS rejects icons with transparency: flatten onto white
    flat = Image.new("RGB", im.size, (255, 255, 255))
    flat.paste(im, mask=im.split()[3])
    return flat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", required=True, help="square source image (>=1024px)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="directory for the PNGs")
    ap.add_argument("--plist", default=DEFAULT_PLIST, help="Info.plist to update")
    args = ap.parse_args()

    master_path = os.path.abspath(args.master)
    if not os.path.isfile(master_path):
        raise SystemExit("master not found: " + master_path)

    im = Image.open(master_path)
    if min(im.size) < 1024:
        print("warning: master is %dx%d, 1024 square is recommended" % im.size)
    flat = square_master(im)

    os.makedirs(args.out, exist_ok=True)
    for name, size in SIZES:
        resized = flat.resize((size, size), Image.LANCZOS)
        target = os.path.join(args.out, name)
        resized.save(target, "PNG", optimize=True)
        print("wrote %-20s %4dx%-4d %6d B" % (name, size, size, os.path.getsize(target)))

    with open(args.plist, "rb") as f:
        pl = plistlib.load(f)
    pl["CFBundleIcons"] = {
        "CFBundlePrimaryIcon": {
            "CFBundleIconFiles": list(ICON_FILES),
        }
    }
    pl["CFBundleIconFiles"] = list(ICON_FILES)
    with open(args.plist, "wb") as f:
        plistlib.dump(pl, f, fmt=plistlib.FMT_XML, sort_keys=False)
    print("updated", args.plist, "->", ", ".join(ICON_FILES))


if __name__ == "__main__":
    sys.exit(main())