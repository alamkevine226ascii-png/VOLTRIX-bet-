#!/usr/bin/env python3
"""Télécharge les images d'arènes/octogone MMA, valide,
redimensionne (900x600 crop paysage) et compresse en JPG."""
import json
import os
import urllib.request

from PIL import Image

SRC = "/tmp/arena-search"
DST = "/home/z/my-project/public/arenas"
TARGET_W = 900
TARGET_H = 600

os.makedirs(DST, exist_ok=True)

NAMES = {
    "octagon": "octagon.jpg",      # octogone UFC générique (héros par défaut)
    "tmob": "tmoArena.jpg",        # T-Mobile Arena (Las Vegas)
    "msg": "msg.jpg",              # Madison Square Garden (New York)
    "apex": "apex.jpg",            # UFC Apex (Las Vegas)
}

report = []
for key, fname in NAMES.items():
    out_path = os.path.join(DST, fname)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 20_000:
        report.append((key, "ALREADY"))
        continue
    urls = json.load(open(os.path.join(SRC, f"{key}.json")))
    ok = None
    for url in urls[:6]:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                blob = r.read()
            if len(blob) < 15_000:
                continue
            tmp = os.path.join(SRC, f"{key}.bin")
            with open(tmp, "wb") as bf:
                bf.write(blob)
            img = Image.open(tmp)
            img.load()
            w, h = img.size
            if w < 500 or h < 300:
                continue
            img = img.convert("RGB")
            ok = img
            break
        except Exception:
            continue
    if ok is None:
        report.append((key, "DL-FAILED"))
        continue
    # crop centre 3:2 puis resize
    w, h = ok.size
    ratio = TARGET_W / TARGET_H
    if w / h > ratio:
        nw = int(h * ratio)
        x0 = (w - nw) // 2
        ok = ok.crop((x0, 0, x0 + nw, h))
    else:
        nh = int(w / ratio)
        y0 = max(0, int((h - nh) * 0.35))  # garde le haut (toits / écrans)
        ok = ok.crop((0, y0, w, y0 + nh))
    ok = ok.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    ok.save(out_path, "JPEG", quality=72, optimize=True)
    report.append((key, f"OK {os.path.getsize(out_path) // 1024} KB"))

print(report)
