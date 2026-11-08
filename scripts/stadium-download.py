#!/usr/bin/env python3
"""Télécharge les images de stades depuis les JSON de recherche,
valide, redimensionne (largeur max 900px, crop paysage) et compresse."""
import json
import os
import sys
import urllib.request

from PIL import Image

SRC = "/tmp/stadium-search"
DST = "/home/z/my-project/public/stadiums"
TARGET_W = 900
TARGET_H = 600  # crop paysage 3:2

os.makedirs(DST, exist_ok=True)

keys = sorted(f[:-5] for f in os.listdir(SRC) if f.endswith(".json"))
report = []

for key in keys:
    with open(os.path.join(SRC, f"{key}.json")) as fh:
        data = json.load(fh)
    if not data.get("success") or not data.get("results"):
        report.append((key, "NO-RESULTS"))
        continue

    out_path = os.path.join(DST, f"{key}.jpg")
    if os.path.exists(out_path) and os.path.getsize(out_path) > 20_000:
        report.append((key, "ALREADY"))
        continue

    downloaded = None
    for res in data["results"][:3]:
        url = res.get("original_url")
        if not url:
            continue
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
            # convertit en RGB (évite les PNG palette / CMJN)
            img = img.convert("RGB")
            downloaded = img
            break
        except Exception:
            continue

    if downloaded is None:
        report.append((key, "DL-FAILED"))
        continue

    img = downloaded
    w, h = img.size
    # crop centré paysage 3:2
    target_ratio = TARGET_W / TARGET_H
    if w / h > target_ratio:
        new_w = int(h * target_ratio)
        x0 = (w - new_w) // 2
        img = img.crop((x0, 0, x0 + new_w, h))
    else:
        new_h = int(w / target_ratio)
        y0 = max(0, int((h - new_h) * 0.35))  # léger biais vers le haut (ciel/toit du stade)
        img = img.crop((0, y0, w, y0 + new_h))
    img = img.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    img.save(out_path, "JPEG", quality=68, optimize=True, progressive=True)
    report.append((key, f"OK {os.path.getsize(out_path)//1024} Ko {img.size}"))

for k, s in report:
    print(f"{k}: {s}")
ok = sum(1 for _, s in report if s.startswith(("OK", "ALREADY")))
print(f"\n{ok}/{len(report)} stades prêts dans {DST}")
