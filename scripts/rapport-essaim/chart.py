#!/usr/bin/env python3
"""Graphique : jugements de l'essaim par catégorie (barres horizontales)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.family"] = "DejaVu Sans"
plt.rcParams["axes.unicode_minus"] = False

cats = [
    "Zones tactiles < 44 px",
    "Polices < 9 px",
    "Contenu sous barres flottantes",
    "Gabarit mobile sur grands écrans",
    "Premier contenu après défilement",
]
vals = [120896, 85809, 24570, 1107, 373]

fig, ax = plt.subplots(figsize=(8.6, 4.2), constrained_layout=True)
bars = ax.barh(cats[::-1], vals[::-1], color="#5B8DB8", height=0.62)
ax.set_xlabel("Nombre de jugements d'agents (sur 232 765)")
ax.set_title("Essaim VOLTRIX — jugements par famille de constat (3 000 agents)", fontsize=12, fontweight="bold")
ax.set_xlim(0, 140000)
for b, v in zip(bars, vals[::-1]):
    ax.text(b.get_width() + 2000, b.get_y() + b.get_height() / 2, f"{v:,}".replace(",", " "),
            va="center", fontsize=9.5, color="#1A2B40")
ax.spines[["top", "right"]].set_visible(False)
ax.grid(axis="x", alpha=0.25, linestyle=":")
fig.savefig("/tmp/swarm/graphique-jugements.png", dpi=160)
print("graphique OK")
