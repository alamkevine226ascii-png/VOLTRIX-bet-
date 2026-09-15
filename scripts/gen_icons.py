#!/usr/bin/env python3
"""Génère les icônes PWA de VOLTRIX bet — éclair jaune néon sur fond noir."""
from PIL import Image, ImageDraw
import os

OUT = "/home/z/my-project/public/icons"
os.makedirs(OUT, exist_ok=True)

BLACK = (10, 10, 12, 255)
YELLOW = (232, 255, 0, 255)  # jaune électrique

def draw_lightning(size):
    img = Image.new("RGBA", (size, size), BLACK)
    d = ImageDraw.Draw(img)
    s = size
    # Éclair stylisé (coordonnées relatives 0..1)
    pts = [
        (0.60, 0.08),
        (0.28, 0.52),
        (0.47, 0.52),
        (0.38, 0.92),
        (0.72, 0.42),
        (0.52, 0.42),
        (0.66, 0.08),
    ]
    scale = [(x * s, y * s) for x, y in pts]
    d.polygon(scale, fill=YELLOW)
    return img

def make_maskable(size):
    """Icône maskable : éclair centré dans la zone safe (80%)."""
    img = Image.new("RGBA", (size, size), BLACK)
    bolt = draw_lightning(int(size * 0.62))
    # léger padding pour zone safe Android
    pos = ((size - bolt.width) // 2, (size - bolt.height) // 2 - int(size * 0.02))
    img.paste(bolt, pos, bolt)
    return img

# Icônes standard (full bleed)
for size in [192, 512, 180]:  # 180 = apple-touch-icon
    draw_lightning(size).save(f"{OUT}/icon-{size}.png")

# Maskable (avec marges de sécurité)
for size in [192, 512]:
    make_maskable(size).save(f"{OUT}/icon-maskable-{size}.png")

# Favicon 64
draw_lightning(64).save("/home/z/my-project/public/favicon-voltrix.png")
print("Icônes générées :", os.listdir(OUT))
