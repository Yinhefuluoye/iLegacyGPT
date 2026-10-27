#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate direction D (light theme) from direction C (graphite theme).

Same layout / JS; only the theme tokens change, plus the bottom hero note is
already removed from C.  Run from anywhere:

    python tools/make_light_variant.py
"""

import os
import re

PROTO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "web", "prototypes")
SRC = os.path.join(PROTO, "c", "index.html")
DST = os.path.join(PROTO, "d", "index.html")

LIGHT_TOKENS = """/* ==THEME-TOKENS-START== */
/* =========================================================
   Direction D · 白底浅色（C 的浅色版；静态分层，不用实时模糊）
   ========================================================= */
:root {
  --bg: #f6f6f2;
  --bg-image:
    radial-gradient(circle at 50% -10%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 55%),
    linear-gradient(180deg, #fbfbf8 0%, #f3f3ee 58%, #ededE7 100%);
  --fg: #1b1d1a;
  --fg-dim: rgba(27, 29, 26, 0.62);
  --fg-faint: rgba(27, 29, 26, 0.38);
  --topbar-border: rgba(0, 0, 0, 0.07);
  --icon-hover-bg: rgba(0, 0, 0, 0.05);
  --surface: #ffffff;
  --surface-border: rgba(0, 0, 0, 0.08);
  --surface-shadow: 0 1px 0 rgba(255, 255, 255, 0.85) inset, 0 14px 34px rgba(23, 24, 20, 0.10);
  --composer-focus-border: rgba(160, 120, 60, 0.55);
  --input-fg: #1b1d1a;
  --placeholder: #9a9f98;
  --surface-icon: #5b605a;
  --surface-hover: rgba(0, 0, 0, 0.05);
  --surface-dim: #7b807a;
  --chip-bg: #f0f0ea;
  --chip-border: rgba(0, 0, 0, 0.06);
  --chip-fg: #33362f;
  --chip-hover: #e8e8e1;
  --accent: #b98a4b;
  --accent-fg: #ffffff;
  --think-on-bg: rgba(185, 138, 75, 0.14);
  --think-on-border: rgba(185, 138, 75, 0.45);
  --think-on-fg: #8a5f28;
  --send-bg: #22241f;
  --send-fg: #f7f7f3;
  --send-border: rgba(34, 36, 31, 0.9);
  --send-off-bg: rgba(0, 0, 0, 0.06);
  --send-off-fg: rgba(0, 0, 0, 0.28);
  --user-bubble-bg: #e9e9e1;
  --user-bubble-fg: #1e201c;
  --bubble-radius: 18px;
  --bubble-tail-radius: 8px;
  --ai-fg: rgba(24, 26, 22, 0.9);
  --ai-strong: #111310;
  --code-bg: rgba(0, 0, 0, 0.05);
  --code-fg: #7a5a2e;
  --divider: rgba(0, 0, 0, 0.08);
  --overlay: rgba(24, 24, 20, 0.32);
  --sheet-bg: #ffffff;
  --sheet-border: rgba(0, 0, 0, 0.08);
  --sheet-shadow: 0 34px 90px rgba(23, 24, 20, 0.18);
  --field-bg: #f4f4ef;
  --field-border: rgba(0, 0, 0, 0.09);
  --field-fg: #1b1d1a;
  --label: rgba(27, 29, 26, 0.55);
  --selected-bg: rgba(185, 138, 75, 0.10);
  --selected-border: rgba(185, 138, 75, 0.5);
  --danger: #b0403c;
  --toast-bg: #26282b;
  --toast-fg: #f5f5f1;
  --greeting-size: 38px;
  --greeting-weight: 500;
  --greeting-tracking: 0;
  --greeting-shadow: 0 10px 44px rgba(0, 0, 0, 0.06);
  --msg-size: 16px;
  --radius-sheet: 20px;
}
@media (min-width: 900px) {
  :root { --greeting-size: 45px; }
}
/* ==THEME-TOKENS-END== */"""


def main():
    with open(SRC, "r", encoding="utf-8") as fh:
        html = fh.read()

    # replace theme token block (from marker start to marker end, inclusive)
    html = re.sub(
        r"/\* ==THEME-TOKENS-START== \*/.*?/\* ==THEME-TOKENS-END== \*/",
        LIGHT_TOKENS,
        html,
        count=1,
        flags=re.S,
    )

    # per-file metadata
    html = html.replace('data-direction="c"', 'data-direction="d"')
    html = html.replace("<title>方向 C · 石墨轻层次</title>", "<title>方向 D · 白底浅色</title>")
    html = html.replace('content="#202327"', 'content="#f6f6f2"')
    html = html.replace("方向 C「石墨灰 + 轻层次」", "方向 D「白底浅色」")

    # colors that were hardcoded for the dark theme
    html = html.replace("background: rgba(0, 0, 0, 0.15);", "background: rgba(0, 0, 0, 0.06);")
    html = html.replace("border-color: rgba(255, 130, 145, 0.32);", "border-color: rgba(176, 64, 60, 0.35);")
    html = html.replace("background: rgba(255, 130, 145, 0.06);", "background: rgba(176, 64, 60, 0.06);")
    html = html.replace("box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);",
                        "box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);")

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    print("wrote", DST, len(html), "chars")


if __name__ == "__main__":
    main()