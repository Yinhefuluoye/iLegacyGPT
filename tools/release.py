#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Create the GitHub release for an already built IPA (no CI involved).

Usage (Windows PowerShell):
  $env:GH_TOKEN = (gh auth token).Trim()
  python tools/release.py --version 1.0.0

It verifies the IPA (app name, version, icon set), writes a sha256 file next to
it, then creates the git tag + GitHub release and uploads both files.
"""

import argparse
import hashlib
import os
import plistlib
import subprocess
import sys
import zipfile

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_EXE = "ChatAI"


def run(cmd, dry=False):
    line = " ".join(cmd)
    print("+ " + line, flush=True)
    if dry:
        return ""
    out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=PROJECT)
    text = out.stdout.decode("utf-8", "replace").strip()
    if out.returncode != 0:
        raise SystemExit("command failed (%d): %s\n%s" % (out.returncode, line, text))
    if text:
        print(text)
    return text


def verify_ipa(path, version, display_name):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        root = "Payload/%s.app/" % APP_EXE
        plist_name = root + "Info.plist"
        if plist_name not in names:
            raise SystemExit("Info.plist missing from IPA")
        pl = plistlib.loads(z.read(plist_name))
        got_name = pl.get("CFBundleDisplayName", "")
        got_ver = pl.get("CFBundleShortVersionString", "")
        icons = [n for n in names if n.startswith(root + "Icon-")]
        if got_name != display_name:
            raise SystemExit("display name mismatch: %r != %r" % (got_name, display_name))
        if version and got_ver != version:
            raise SystemExit("version mismatch: %r != %r" % (got_ver, version))
        if len(icons) < 8:
            raise SystemExit("icon set looks incomplete: %d files" % len(icons))
        print("verified: %s %s, %d icons, %d files" % (got_name, got_ver, len(icons), len(names)))
        return got_ver


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True, help="e.g. 1.0.0")
    ap.add_argument("--name", default="iLegacyGPT", help="product name / IPA stem")
    ap.add_argument("--display-name", default="iLegacyGPT")
    ap.add_argument("--repo", default="Yinhefuluoye/iLegacyGPT")
    ap.add_argument("--target", default="main", help="branch the tag points at")
    ap.add_argument("--ipa", default=None)
    ap.add_argument("--notes", default=None)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--draft", action="store_true")
    ap.add_argument("--gh", default=os.environ.get("GH_BIN", "gh"))
    args = ap.parse_args()

    ipa = args.ipa or os.path.join(PROJECT, "dist", "%s-%s.ipa" % (args.name, args.version))
    ipa = os.path.abspath(ipa)
    if not os.path.isfile(ipa):
        raise SystemExit("IPA not found: " + ipa)

    tag = args.tag or ("v" + args.version)
    notes = args.notes or os.path.join(PROJECT, "docs", "release-notes", "%s.md" % tag)
    if not os.path.isfile(notes):
        raise SystemExit("release notes not found: " + notes)

    verify_ipa(ipa, args.version, args.display_name)

    with open(ipa, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    sum_path = os.path.splitext(ipa)[0] + ".sha256"
    with open(sum_path, "w", encoding="utf-8") as f:
        f.write("%s  %s\n" % (digest, os.path.basename(ipa)))
    print("sha256: " + digest)

    cmd = [args.gh, "release", "create", tag, ipa, sum_path,
           "--repo", args.repo,
           "--title", "%s %s" % (args.name, tag),
           "--notes-file", notes,
           "--target", args.target]
    if args.draft:
        cmd.append("--draft")
    if os.environ.get("GH_TOKEN"):
        cmd_env = dict(os.environ)
    else:
        print("warning: GH_TOKEN is not set; falling back to the gh CLI login", flush=True)
        cmd_env = dict(os.environ)
    out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=PROJECT, env=cmd_env)
    if out.returncode != 0:
        raise SystemExit("gh release create failed:\n" + out.stdout.decode("utf-8", "replace"))
    print(out.stdout.decode("utf-8", "replace").strip())


if __name__ == "__main__":
    sys.exit(main())