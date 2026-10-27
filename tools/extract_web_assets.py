#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract CSS + static markup from the approved prototype (direction D)
into the production web sources under web/.

Run: python tools/extract_web_assets.py
"""

import os
import re

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTO = os.path.join(PROJECT, "web", "prototypes", "d", "index.html")
OUT_CSS = os.path.join(PROJECT, "web", "src", "styles.css")
OUT_HTML = os.path.join(PROJECT, "web", "index.html")

META = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#f6f6f2">
<title>AI 对话</title>
<link rel="stylesheet" href="app.css">
</head>
"""


def main():
    with open(PROTO, "r", encoding="utf-8") as fh:
        html = fh.read()

    style = re.search(r"<style>(.*?)</style>", html, re.S)
    if not style:
        raise SystemExit("no <style> block in prototype")
    css = style.group(1).strip() + "\n"

    body = re.search(r"<body>(.*)</body>", html, re.S)
    if not body:
        raise SystemExit("no <body> in prototype")
    markup = body.group(1)
    markup = re.sub(r"<script>.*?</script>", "", markup, flags=re.S)
    markup = markup.strip()
    markup += '\n<script src="app.js"></script>\n'

    os.makedirs(os.path.dirname(OUT_CSS), exist_ok=True)
    with open(OUT_CSS, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(css)
    with open(OUT_HTML, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(META + "<body>\n" + markup + "</body>\n</html>\n")

    print("css  ->", OUT_CSS, len(css), "chars")
    print("html ->", OUT_HTML, len(markup), "chars")

    ids = sorted(set(re.findall(r'id="([^"]+)"', markup)))
    print("ids  :", ", ".join(ids))


if __name__ == "__main__":
    main()