# -*- coding: utf-8 -*-
"""Graphiques du rapport VOLTRIX — donut pondérations moteur foot + barres poids dimensions MMA."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm

fm.fontManager.addfont('/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf')
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')

import matplotlib.pyplot as plt

plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Noto Sans SC']
plt.rcParams['axes.unicode_minus'] = False

# Palette cascade (générée par palette.cascade — ne pas modifier à la main)
ACCENT = '#3895c3'
ACCENT_2 = '#c3465b'
HEADER_FILL = '#384a52'
ICON = '#406b81'
BORDER = '#bbc9cf'
TEXT_PRIMARY = '#222526'
TEXT_MUTED = '#767d80'

OUT = '/home/z/my-project/download/'

# ------------------------------------------------------------------
# Graphique 1 — donut : pondérations de l'ensemble moteur football
# ------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7.2, 4.2), constrained_layout=True)
labels = ['Poisson (buts attendus)', 'Elo (force relative)', 'Forme (5 derniers)']
vals = [45, 30, 25]
cols = [ACCENT, HEADER_FILL, ICON]
wedges, _ = ax.pie(vals, colors=cols, startangle=90, counterclock=False,
                   wedgeprops=dict(width=0.34, edgecolor='white', linewidth=2))
for w, l, v in zip(wedges, labels, vals):
    ang = (w.theta2 + w.theta1) / 2.0
    import math
    x = 0.83 * math.cos(math.radians(ang))
    y = 0.83 * math.sin(math.radians(ang))
    ax.text(x, y, f'{v} %', ha='center', va='center', fontsize=13,
            fontweight='bold', color='white')
ax.legend(wedges, labels, loc='center left', bbox_to_anchor=(1.02, 0.5),
          frameon=False, fontsize=10.5)
ax.text(0, 0.06, '1X2', ha='center', va='center', fontsize=15, fontweight='bold',
        color=TEXT_PRIMARY)
ax.text(0, -0.16, 'ensemble final', ha='center', va='center', fontsize=9, color=TEXT_MUTED)
ax.set(aspect='equal')
fig.savefig(OUT + 'chart-ensemble-foot.png', dpi=200)
plt.close(fig)

# ------------------------------------------------------------------
# Graphique 2 — barres horizontales : poids des dimensions MMA
# ------------------------------------------------------------------
dims = [
    ('Forme r\u00e9cente', 1.5), ('Volume de frappes', 1.2), ('Pr\u00e9cision des frappes', 1.2),
    ('Frappes absorb\u00e9es', 1.2), ('D\u00e9fense frappes', 1.0), ('Lutte (takedowns)', 1.0),
    ('D\u00e9fense takedown', 1.0), ('Pouvoir de finition', 1.0), ('Soumissions', 0.8),
    ('Exp\u00e9rience', 0.8), ('Envergure physique', 0.6),
]
dims = dims[::-1]
names = [d[0] for d in dims]
weights = [d[1] for d in dims]
colors_bar = [ACCENT if w >= 1.2 else (HEADER_FILL if w >= 1.0 else BORDER) for w in weights]

fig, ax = plt.subplots(figsize=(7.2, 4.6), constrained_layout=True)
bars = ax.barh(names, weights, color=colors_bar, height=0.62, edgecolor='none')
for b, w in zip(bars, weights):
    ax.text(b.get_width() + 0.03, b.get_y() + b.get_height() / 2, f'{w:.1f}',
            va='center', ha='left', fontsize=9.5, color=TEXT_PRIMARY, fontweight='bold')
ax.set_xlim(0, 1.75)
ax.set_xlabel('Poids dans le pronostic (mod\u00e8le voltrix-mma-v1)', fontsize=10, color=TEXT_PRIMARY)
ax.tick_params(axis='y', labelsize=9.5, colors=TEXT_PRIMARY, length=0)
ax.tick_params(axis='x', labelsize=9, colors=TEXT_MUTED)
for s in ('top', 'right', 'left'):
    ax.spines[s].set_visible(False)
ax.spines['bottom'].set_color(BORDER)
ax.grid(axis='x', linestyle='--', alpha=0.2, color=HEADER_FILL)
ax.set_axisbelow(True)
fig.savefig(OUT + 'chart-dimensions-mma.png', dpi=200)
plt.close(fig)

print('Graphiques OK : chart-ensemble-foot.png, chart-dimensions-mma.png')
