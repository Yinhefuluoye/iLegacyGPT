#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Turn one square master image into the iOS 10 icon set and wire Info.plist.

Usage:
  python tools/make_app_icons.py --master tools/Logo.jfif --flat
  python tools/make_app_icons.py --master art.png --fill 0.86

--fill  enlarges the artwork so it occupies that fraction of the canvas (iOS
        masks the corners, so a logo with a huge margin looks tiny on the home
        screen). 0 keeps the master untouched.
--flat  rebuilds a flat 3-colour logo (background / ink / accent) from binary
        masks instead of scaling the JPEG, which removes compression noise and
        keeps edges clean at every icon size. Colours are sampled from the
        master itself.
"""

import argparse
import os
import plistlib
import sys

try:
    from PIL import Image, ImageFilter
except ImportError:
    raise SystemExit("Pillow is required (pip install pillow)")

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(PROJECT, "ios", "Resources")
DEFAULT_PLIST = os.path.join(DEFAULT_OUT, "Info.plist")

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
]

ICON_FILES = ["Icon-20", "Icon-29", "Icon-40", "Icon-76", "Icon-83.5"]


def corner_color(im):
    w, h = im.size
    px = im.load()
    pts = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2),
           (w // 2, 1), (w // 2, h - 2), (1, h // 2), (w - 2, h // 2)]
    vals = [px[x, y] for x, y in pts]
    return tuple(sorted(v[i] for v in vals)[len(vals) // 2] for i in range(3))


def dominant(im, pred):
    im = im.convert("RGB")
    w, h = im.size
    small = im.resize((min(w, 400), min(h, 400)))
    px = small.load()
    vals = []
    for y in range(small.size[1]):
        for x in range(small.size[0]):
            c = px[x, y]
            if pred(c):
                vals.append(c)
    if not vals:
        return None
    return tuple(sorted(v[i] for v in vals)[len(vals) // 2] for i in range(3))


def content_bbox(im, bg, threshold=16, row_ratio=0.002):
    w, h = im.size
    small = im.resize((min(w, 512), min(h, 512)))
    sw, sh = small.size
    px = small.load()
    cols = [0] * sw
    rows = [0] * sh
    for y in range(sh):
        for x in range(sw):
            r, g, b = px[x, y]
            if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) > threshold:
                cols[x] += 1
                rows[y] += 1
    min_col = max(1, int(sw * row_ratio))
    min_row = max(1, int(sh * row_ratio))
    xs = [x for x in range(sw) if cols[x] >= min_col]
    ys = [y for y in range(sh) if rows[y] >= min_row]
    if not xs or not ys:
        return None
    sx, sy = w / sw, h / sh
    return (int(min(xs) * sx), int(min(ys) * sy),
            int((max(xs) + 1) * sx), int((max(ys) + 1) * sy))


def crop_fill(im, bg, fill, canvas=2048):
    box = content_bbox(im, bg)
    if not box:
        return im
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    half = side // 2
    sx0, sy0 = max(0, cx - half), max(0, cy - half)
    sx1, sy1 = min(im.size[0], sx0 + side), min(im.size[1], sy0 + side)
    art = im.crop((sx0, sy0, sx1, sy1)).resize((int(canvas * fill), int(canvas * fill)), Image.LANCZOS)
    out = Image.new("RGB", (canvas, canvas), bg)
    off = (canvas - art.size[0]) // 2
    out.paste(art, (off, off))
    print("artwork box: %s -> fill %.0f%%" % (str(box), fill * 100))
    return out


def flat_layers(im):
    """Return (ink_mask, accent_mask, ink_colour, accent_colour)."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    ink = Image.new("L", (w, h), 0)
    accent = Image.new("L", (w, h), 0)
    ipx, apx = ink.load(), accent.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if (r - b) > 35 and r > 120 and lum < 210:
                apx[x, y] = 255
            elif lum < 128:
                ipx[x, y] = 255
    ink = ink.filter(ImageFilter.MedianFilter(9))
    accent = accent.filter(ImageFilter.MedianFilter(9))
    ink_col = dominant(rgb, lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 90) or (27, 29, 26)
    accent_col = dominant(rgb, lambda c: (c[0] - c[2]) > 45 and c[0] > 150) or (185, 138, 75)
    return ink, accent, ink_col, accent_col


def render_flat(layers, bg, size):
    ink, accent, ink_col, accent_col = layers
    if size < 64:
        resample = Image.BOX
    else:
        resample = Image.BOX
    ai = ink.resize((size, size), resample)
    aa = accent.resize((size, size), resample)
    out = Image.new("RGB", (size, size), bg)
    px, ip, ap = out.load(), ai.load(), aa.load()
    for y in range(size):
        for x in range(size):
            a = ap[x, y] / 255.0
            i = ip[x, y] / 255.0
            r = bg[0] * (1 - a) + accent_col[0] * a
            g = bg[1] * (1 - a) + accent_col[1] * a
            b = bg[2] * (1 - a) + accent_col[2] * a
            rr = r * (1 - i) + ink_col[0] * i
            gg = g * (1 - i) + ink_col[1] * i
            bb = b * (1 - i) + ink_col[2] * i
            px[x, y] = (int(rr + 0.5), int(gg + 0.5), int(bb + 0.5))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", required=True, help="source image")
    ap.add_argument("--out", default=DEFAULT_OUT, help="directory for the PNGs")
    ap.add_argument("--plist", default=DEFAULT_PLIST, help="Info.plist to update")
    ap.add_argument("--fill", type=float, default=0.0,
                    help="fraction of the canvas the artwork should occupy (0 = keep)")
    ap.add_argument("--marketing", default=None,
                    help="write the 1024 marketing icon to this path instead of the bundle")
    ap.add_argument("--exact", action="store_true",
                    help="keep the master as drawn: pad to square, never crop")
    ap.add_argument("--flat", action="store_true",
                    help="rebuild as flat colour layers (removes JPEG noise)")
    ap.add_argument("--bg", default="auto", help="background colour 'auto' or #rrggbb")
    args = ap.parse_args()

    master_path = os.path.abspath(args.master)
    if not os.path.isfile(master_path):
        raise SystemExit("master not found: " + master_path)

    bg = None
    if args.bg and args.bg.lower() != "auto":
        hexv = args.bg.lstrip("#")
        bg = tuple(int(hexv[i:i + 2], 16) for i in (0, 2, 4))

    im = Image.open(master_path)
    if min(im.size) < 1024:
        print("warning: master is %dx%d, 1024 square is recommended" % im.size)
    im = im.convert("RGB")
    bg = bg or corner_color(im)
    if args.exact:
        w, h = im.size
        if w != h:
            side = max(w, h)
            canvas = Image.new("RGB", (side, side), bg)
            canvas.paste(im, ((side - w) // 2, (side - h) // 2))
            im = canvas
    elif args.fill and args.fill > 0:
        im = crop_fill(im, bg, args.fill)
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))

    os.makedirs(args.out, exist_ok=True)
    layers = flat_layers(im) if args.flat else None

    for name, size in SIZES:
        icon = render_flat(layers, bg, size) if layers else im.resize((size, size), Image.LANCZOS)
        target = os.path.join(args.out, name)
        icon.save(target, "PNG", optimize=True)
        print("wrote %-20s %4dx%-4d %6d B" % (name, size, size, os.path.getsize(target)))

    if args.marketing:
        marketing = render_flat(layers, bg, 1024) if layers else im.resize((1024, 1024), Image.LANCZOS)
        os.makedirs(os.path.dirname(os.path.abspath(args.marketing)), exist_ok=True)
        marketing.save(args.marketing, "PNG", optimize=True)
        print("wrote %-20s 1024x1024 (outside the app bundle)" % os.path.basename(args.marketing))

    with open(args.plist, "rb") as f:
        pl = plistlib.load(f)
    pl["CFBundleIcons"] = {"CFBundlePrimaryIcon": {"CFBundleIconFiles": list(ICON_FILES)}}
    pl["CFBundleIconFiles"] = list(ICON_FILES)
    with open(args.plist, "wb") as f:
        plistlib.dump(pl, f, fmt=plistlib.FMT_XML, sort_keys=False)
    print("updated", args.plist, "->", ", ".join(ICON_FILES))


if __name__ == "__main__":
    sys.exit(main())