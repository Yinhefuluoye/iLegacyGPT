#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build ChatAI.app for armv7 iOS 8+ and package it as an unsigned IPA.

The iPad is jailbroken with AppSync Unified, so no code signing is required.
The app is cross-compiled on Windows/Linux with clang + ld64.lld from LLVM
against the iPhoneOS10.3.sdk (theos/sdks).

Usage:
  python3 tools/build.py --sdk /path/to/iPhoneOS10.3.sdk --out dist
  python3 tools/build.py --sdk ... --clang C:/llvm/bin/clang.exe --ld C:/llvm/bin/ld64.lld.exe
"""

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import zipfile

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IOS_DIR = os.path.join(PROJECT, "ios")
SRC_DIR = os.path.join(IOS_DIR, "ChatAI")
RES_DIR = os.path.join(IOS_DIR, "Resources")
BUILD_DIR = os.path.join(PROJECT, "build")

APP_NAME = "ChatAI"
BUNDLE_ID = "com.yinhe.chatai"
MIN_IOS = "8.0"
SDK_VERSION = "10.3"
ARCH = "armv7"
FRAMEWORKS = ["UIKit", "Foundation", "WebKit", "CoreGraphics", "QuartzCore"]


def log(msg):
    print(msg, flush=True)


def run(cmd, cwd=None):
    log("$ " + " ".join(cmd))
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.stdout.decode("utf-8", "replace")
    if out.strip():
        log(out.rstrip())
    if p.returncode != 0:
        raise SystemExit("command failed (%d): %s" % (p.returncode, " ".join(cmd)))


def find_exe(name, explicit=None):
    if explicit:
        if not os.path.isfile(explicit):
            raise SystemExit("not found: " + explicit)
        return os.path.abspath(explicit)
    path = shutil.which(name)
    if path:
        return path
    # common LLVM Windows install locations inside the project toolchain
    for cand in (
        os.path.join(PROJECT, ".toolchain", "llvm", "bin", name),
        os.path.join(PROJECT, ".toolchain", "llvm", "bin", name + ".exe"),
        os.path.join(PROJECT, ".toolchain", "llvm", "bin", name.replace(".exe", "") + ".exe"),
    ):
        if os.path.isfile(cand):
            return cand
    return None


def resolve_ld(explicit):
    ld = find_exe("ld64.lld", explicit) or find_exe("ld64.lld.exe", explicit)
    if ld:
        return ld
    lld = find_exe("lld") or find_exe("lld.exe")
    if not lld:
        raise SystemExit("ld64.lld not found (pass --ld)")
    # lld dispatches on argv[0]; provide a shim named ld64.lld
    shim_dir = os.path.join(BUILD_DIR, "toolshim")
    os.makedirs(shim_dir, exist_ok=True)
    ext = ".exe" if os.name == "nt" else ""
    shim = os.path.join(shim_dir, "ld64.lld" + ext)
    if not os.path.exists(shim):
        try:
            os.symlink(lld, shim)
        except OSError:
            shutil.copy2(lld, shim)
    return shim


def macho_info(path):
    with open(path, "rb") as f:
        data = f.read(4096)
    magic = struct.unpack("<I", data[:4])[0]
    if magic == 0xFEEDFACE:
        cputype, cpusub, filetype, ncmds = struct.unpack("<iiII", data[4:20])
        return {"magic": "0x%08x" % magic, "bits": 32, "cputype": cputype,
                "cpusubtype": cpusub, "filetype": filetype, "ncmds": ncmds,
                "minios": None}
    if magic == 0xFEEDFACF:
        cputype, cpusub, filetype, ncmds = struct.unpack("<iiII", data[4:20])
        return {"magic": "0x%08x" % magic, "bits": 64, "cputype": cputype,
                "cpusubtype": cpusub, "filetype": filetype, "ncmds": ncmds,
                "minios": None}
    return {"magic": "0x%08x" % magic, "bits": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sdk", required=True, help="path to iPhoneOS10.3.sdk")
    ap.add_argument("--clang", default=None)
    ap.add_argument("--ld", default=None)
    ap.add_argument("--out", default=os.path.join(PROJECT, "dist"))
    ap.add_argument("--version", default=None, help="CFBundleShortVersionString override")
    ap.add_argument("--compile-only", action="store_true",
                    help="only compile .m files (local syntax/API check; armv7 linking needs theos)")
    args = ap.parse_args()

    sdk = os.path.abspath(args.sdk)
    if not os.path.isdir(sdk):
        raise SystemExit("SDK dir not found: " + sdk)
    clang = find_exe("clang", args.clang) or find_exe("clang.exe", args.clang)
    if not clang:
        raise SystemExit("clang not found (pass --clang)")
    ld = resolve_ld(args.ld)

    log("clang : " + clang)
    log("ld    : " + ld)
    log("sdk   : " + sdk)

    if os.path.isdir(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    obj_dir = os.path.join(BUILD_DIR, "obj")
    os.makedirs(obj_dir)

    sources = sorted(f for f in os.listdir(SRC_DIR) if f.endswith(".m"))
    if not sources:
        raise SystemExit("no .m sources in " + SRC_DIR)
    objs = []
    common = [
        clang,
        "-target", "%s-apple-ios%s" % (ARCH, MIN_IOS),
        "-isysroot", sdk,
        "-fobjc-arc",
        "-fblocks",
        "-O2",
        "-Wall",
        "-Wno-unused-parameter",
        "-Wno-deprecated-declarations",
        "-I", SRC_DIR,
    ]
    for name in sources:
        src = os.path.join(SRC_DIR, name)
        obj = os.path.join(obj_dir, name[:-2] + ".o")
        run(common + ["-c", src, "-o", obj])
        objs.append(obj)

    if args.compile_only:
        log("")
        log("compile-only OK: %d source files compiled" % len(objs))
        return

    exe = os.path.join(BUILD_DIR, APP_NAME)
    link = [
        ld,
        "-arch", ARCH,
        "-platform_version", "ios", MIN_IOS, SDK_VERSION,
        "-syslibroot", sdk,
        "-o", exe,
        "-e", "_main",
        "-pie",
        "-dead_strip",
    ] + objs
    for fw in FRAMEWORKS:
        link += ["-framework", fw]
    link += ["-lSystem", "-lobjc"]
    run(link)

    info = macho_info(exe)
    log("macho: " + json.dumps(info))
    if info.get("cputype") != 12:
        raise SystemExit("unexpected cputype (want 12/armv7): %r" % info)
    if info.get("filetype") != 2:
        raise SystemExit("unexpected filetype (want 2/executable): %r" % info)

    # ---- assemble .app ----
    app = os.path.join(BUILD_DIR, APP_NAME + ".app")
    os.makedirs(app)
    shutil.copy2(exe, os.path.join(app, APP_NAME))
    os.chmod(os.path.join(app, APP_NAME), 0o755)
    shutil.copy2(os.path.join(RES_DIR, "Info.plist"), os.path.join(app, "Info.plist"))

    # version override
    version = args.version
    if version:
        with open(os.path.join(app, "Info.plist"), "rb") as f:
            pl = plistlib.load(f)
        pl["CFBundleShortVersionString"] = version
        with open(os.path.join(app, "Info.plist"), "wb") as f:
            plistlib.dump(pl, f)

    for item in sorted(os.listdir(RES_DIR)):
        if item in ("Info.plist",):
            continue
        src = os.path.join(RES_DIR, item)
        dst = os.path.join(app, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    # ---- package IPA ----
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(app, "Info.plist"), "rb") as f:
        pl = plistlib.load(f)
    ipa_name = "%s-%s.ipa" % (APP_NAME, pl.get("CFBundleShortVersionString", "0.0.0"))
    ipa_path = os.path.join(os.path.abspath(args.out), ipa_name)
    if os.path.exists(ipa_path):
        os.remove(ipa_path)
    with zipfile.ZipFile(ipa_path, "w", zipfile.ZIP_DEFLATED) as zf:
        root = os.path.dirname(app)
        for dirpath, _dirnames, filenames in os.walk(app):
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, root)
                zi = zipfile.ZipInfo(rel.replace(os.sep, "/"), (2026, 1, 1, 0, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                mode = 0o755 if fn == APP_NAME else 0o644
                zi.external_attr = (0o100000 | mode) << 16
                with open(full, "rb") as f:
                    zf.writestr(zi, f.read())

    with open(ipa_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    size = os.path.getsize(ipa_path)
    log("")
    log("IPA   : " + ipa_path)
    log("size  : %d bytes" % size)
    log("sha256: " + digest)
    log("app   : " + app)


if __name__ == "__main__":
    main()
