#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Push the current git HEAD to GitHub through `gh api` (Git Data API).

Use this when github.com:443 (git endpoint) is unreachable but `gh` works.
Requires: authenticated `gh` on PATH (set GH_BIN if needed).

Usage (repo root):
    python tools/gh_push.py
"""

import json
import base64
import os
import subprocess
import sys

REPO = "Yinhefuluoye/ipad-chat-client"
BRANCH = "main"
GH = os.environ.get("GH_BIN", r"D:\Developer\tools\gh\bin\gh.exe")
TMP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".ghcache", "api")


def git(*args, binary=False):
    out = subprocess.run(["git", *args], check=True, capture_output=True)
    return out.stdout if binary else out.stdout.decode("utf-8", "replace").strip()


def gh_api(method, path, payload=None):
    os.makedirs(TMP, exist_ok=True)
    cmd = [GH, "api", "--method", method, path]
    if payload is not None:
        tmp = os.path.join(TMP, "payload.json")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        cmd += ["--input", tmp]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        raise SystemExit("gh api failed: %s\n%s\n%s" % (path, res.stdout, res.stderr))
    body = (res.stdout or "").strip()
    return json.loads(body) if body else {}


def main():
    head = git("rev-parse", "HEAD")
    message = git("log", "-1", "--pretty=%B")

    ref = gh_api("GET", "repos/%s/git/ref/heads/%s" % (REPO, BRANCH))
    base = ref["object"]["sha"]
    if base == head:
        print("already up to date:", head)
        return

    parent = gh_api("GET", "repos/%s/git/commits/%s" % (REPO, base))
    base_tree = parent["tree"]["sha"]

    # git diff needs a commit both sides exist locally; the API-made remote
    # commits are not in the local object database, so track the last pushed
    # local commit ourselves.
    last_file = os.path.join(os.path.dirname(TMP), "last_pushed")
    diff_base = ""
    if os.path.exists(last_file):
        with open(last_file, "r", encoding="utf-8") as fh:
            diff_base = fh.read().strip()
    if not diff_base or subprocess.run(["git", "cat-file", "-e", diff_base],
                                       capture_output=True).returncode != 0:
        r = subprocess.run(["git", "rev-parse", "--verify", "HEAD~1"], capture_output=True)
        diff_base = r.stdout.decode("utf-8").strip() if r.returncode == 0 else head

    diff = git("diff", "--name-status", diff_base, head)
    entries = []
    for line in diff.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status, path = parts[0], parts[-1]
        if status.startswith("D"):
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
            continue
        blob = git("show", "%s:%s" % (head, path), binary=True)
        res = gh_api("POST", "repos/%s/git/blobs" % REPO,
                     {"content": base64.b64encode(blob).decode("ascii"), "encoding": "base64"})
        mode = "100755" if git("ls-tree", head, "--", path).startswith("100755") else "100644"
        entries.append({"path": path, "mode": mode, "type": "blob", "sha": res["sha"]})

    if not entries:
        print("no file changes between", base, "and", head)
        return

    tree = gh_api("POST", "repos/%s/git/trees" % REPO, {"base_tree": base_tree, "tree": entries})
    commit = gh_api("POST", "repos/%s/git/commits" % REPO,
                    {"message": message, "tree": tree["sha"], "parents": [base]})
    gh_api("PATCH", "repos/%s/git/refs/heads/%s" % (REPO, BRANCH),
           {"sha": commit["sha"], "force": False})

    with open(last_file, "w", encoding="utf-8") as fh:
        fh.write(head)

    print("pushed :", head)
    print("files  :", len(entries))
    print("commit :", commit["sha"])


if __name__ == "__main__":
    main()