#!/usr/bin/env python3
"""Vérifie que les captures d'écran ne sont ni blanches ni vides :
rapport de pixels non-fond et diversité de couleurs par capture."""
from PIL import Image
import sys

files = [
    "/tmp/vt-1-home.png",
    "/tmp/vt-2-previsions.png",
    "/tmp/vt-3-precision.png",
    "/tmp/vt-4-portefeuille.png",
    "/tmp/vt-5-reglages.png",
    "/tmp/vt-6-home2.png",
]

ok = True
for f in files:
    img = Image.open(f).convert("RGB")
    w, h = img.size
    px = list(img.getdata())
    total = len(px)
    # couleurs dominantes (fond ink #141414 / canvas #8cb305)
    counts = {}
    for p in px[::7]:
        counts[p] = counts.get(p, 0) + 1
    top = sorted(counts.items(), key=lambda x: -x[1])[:3]
    n_colors = len(counts)
    # pixels "significatifs" = ni ink pur ni canvas pur
    bg_like = sum(c for (r, g, b), c in counts.items()
                  if (abs(r - 20) < 8 and abs(g - 20) < 8 and abs(b - 20) < 8)
                  or (abs(r - 140) < 10 and abs(g - 179) < 10 and abs(b - 5) < 10))
    sampled = sum(counts.values())
    sig_ratio = 1 - bg_like / sampled
    status = "OK " if n_colors > 200 and sig_ratio > 0.06 else "SUSPECT"
    if status != "OK ":
        ok = False
    print(f"{status} {f}: {w}x{h}, {n_colors} couleurs échantillonnées, {sig_ratio:.1%} pixels significatifs, top={top[0][0]}")

sys.exit(0 if ok else 1)
