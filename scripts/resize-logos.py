#!/usr/bin/env python3
"""Redimensionne les crests ESPN en 96px palette optimisée.

- raw_dir : PNG 500px téléchargés par fetch-team-logos-v2.mjs
- out_dir : public/logos/ (noms de fichiers identiques)

Les fichiers déjà présents dans out_dir mais absents de raw_dir
(l'ancien lot 500px) sont aussi recompressés sur place.
"""
import sys
from pathlib import Path

from PIL import Image

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/logos-raw")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/home/z/my-project/public/logos")
SIZE = 96

def shrink(src: Path, dest: Path) -> tuple[bool, int, int]:
    avant = src.stat().st_size
    try:
        img = Image.open(src)
        img.load()
        if img.mode not in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
        img.thumbnail((SIZE, SIZE), Image.LANCZOS)
        # palette adaptative : gain de taille majeur sur des crests à aplats
        if img.mode == "RGBA":
            img = img.quantize(colors=128, method=Image.FASTOCTREE)
        img.save(dest, "PNG", optimize=True)
        apres = dest.stat().st_size
        return True, avant, apres
    except Exception as e:  # noqa: BLE001
        print(f"  !! {src.name}: {e}")
        return False, avant, avant

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total_avant = total_apres = n = 0
    for f in sorted(RAW.glob("*.png")):
        ok, avant, apres = shrink(f, OUT / f.name)
        if ok:
            n += 1
            total_avant += avant
            total_apres += apres
    # recompression de l'ancien lot (500px) encore présent
    for f in sorted(OUT.glob("*.png")):
        if (RAW / f.name).exists():
            continue  # déjà traité ci-dessus
        if f.stat().st_size > 25_000:  # ~> 25 Ko = encore en 500px
            ok, avant, apres = shrink(f, f)
            if ok:
                total_avant += avant
                total_apres += apres
    print(
        f"{n} crests redimensionnés ; "
        f"{total_avant // 1024} Ko -> {total_apres // 1024} Ko"
    )

if __name__ == "__main__":
    main()
