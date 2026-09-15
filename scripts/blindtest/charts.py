#!/usr/bin/env python3
# ============================================================
# VOLTRIX blind test JJA 2026 — graphiques du rapport PDF (Phase 5)
# Source unique : scripts/blindtest/data/metrics.json (données réelles).
# Règles charts.md : spines top/right supprimés, grille pointillée 20%,
# légende hors zone de tracé (bbox_to_anchor), pas de titre interne
# (les figures ont une légende/caption dans le PDF).
# ============================================================
import json
import os
from matplotlib import font_manager

font_manager.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
font_manager.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
import matplotlib.pyplot as plt

plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, 'data')

# ── Palette cascade (copiée de palette.cascade — seed 21) ──
ACCENT = '#96771c'
ACCENT_2 = '#5537b0'
HEADER_FILL = '#675e45'
ICON = '#a08f5e'
BORDER = '#c2beb0'
TEXT = '#22211f'
MUTED = '#87857d'
SUCCESS = '#47845b'
ERROR = '#8f4a44'

with open(os.path.join(DATA, 'metrics.json'), encoding='utf-8') as f:
    M = json.load(f)['metrics']

def fr(x, nd=3):
    """Format français : virgule décimale."""
    return f'{x:.{nd}f}'.replace('.', ',')

def style_ax(ax):
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color(BORDER)
    ax.spines['bottom'].set_color(BORDER)
    ax.tick_params(colors=MUTED, labelsize=9)
    for lbl in ax.get_xticklabels() + ax.get_yticklabels():
        lbl.set_color(TEXT)
    ax.grid(True, linestyle='--', linewidth=0.5, alpha=0.2, color=HEADER_FILL)

# ============================================================
# FIGURE 1 — Diagrammes de fiabilité (calibration), poolé toutes horizons
# ============================================================
fig, axes = plt.subplots(1, 3, figsize=(10.6, 3.7), constrained_layout=True)
panels = [
    ('1X2 (probabilité du pick)', '1X2', 'voltrixFull', True),
    ('O/U 2.5 (VOLTRIX brut)', 'OU25', 'voltrixFullRaw', False),
    ('BTTS (VOLTRIX brut)', 'BTTS', 'voltrixFullRaw', False),
]
for ax, (title, market, variant, _) in zip(axes, panels):
    cell = M['pooledAllHorizons'][market].get(variant)
    style_ax(ax)
    if not cell or not cell.get('calibration'):
        ax.text(0.5, 0.5, 'données insuffisantes', ha='center', va='right', color=MUTED)
        continue
    probs = [b['avgProb'] for b in cell['calibration']]
    rates = [b['actualRate'] for b in cell['calibration']]
    counts = [b['count'] for b in cell['calibration']]
    labels = [b['label'] for b in cell['calibration']]
    ax.plot([0, 1], [0, 1], linestyle='--', linewidth=1, color=BORDER, zorder=1, label='Calibration parfaite')
    sizes = [max(28, min(420, c * 2.2)) for c in counts]
    ax.scatter(probs, rates, s=sizes, color=ACCENT, alpha=0.85, edgecolors='white', linewidths=1.2, zorder=3, label='Seuils (taille ∝ n)')
    ax.plot(probs, rates, color=ICON, linewidth=1.4, alpha=0.7, zorder=2)
    offsets = [(9, -14), (9, 8), (-12, 10), (9, -14), (-12, -16)]
    for idx, (p, r, c, l) in enumerate(zip(probs, rates, counts, labels)):
        dx, dy = offsets[idx % len(offsets)]
        ha = 'left' if dx > 0 else 'right'
        ax.annotate(f'{l} (n={c})', (p, r), textcoords='offset points', xytext=(dx, dy),
                    fontsize=7.2, color=MUTED, ha=ha)
    ax.set_xlim(0.25, 1.0)
    ax.set_ylim(0, 1.02)
    ax.set_xlabel('Probabilité annoncée', fontsize=9.5, color=TEXT)
    if ax is axes[0]:
        ax.set_ylabel('Fréquence observée', fontsize=9.5, color=TEXT)
    ax.set_title(title, fontsize=10.5, color=TEXT, loc='left', pad=8)
axes[0].legend(loc='upper left', bbox_to_anchor=(0.0, 1.02), frameon=False, fontsize=8)
fig.savefig(os.path.join(DATA, 'chart-calibration.png'), dpi=200, facecolor='white')
plt.close(fig)
print('chart-calibration.png OK')

# ============================================================
# FIGURE 2 — Brier par variante et par marché (horizon officiel T−3h)
# ============================================================
off = M['officialHorizonT3h']
groups = [
    ('1X2', [('voltrixFull', 'VOLTRIX'), ('marketAtT', 'Marché open'), ('marketClose', 'Marché clôture'), ('poisson', 'Poisson simple'), ('elo', 'Elo simple'), ('mix', 'MIX')]),
    ('OU25', [('voltrixFullRaw', 'VOLTRIX brut'), ('voltrixFullCal', 'VOLTRIX calibré'), ('marketAtT', 'Marché open'), ('marketClose', 'Marché clôture'), ('poisson', 'Poisson simple'), ('mix', 'MIX')]),
    ('BTTS', [('voltrixFullRaw', 'VOLTRIX brut'), ('voltrixFullCal', 'VOLTRIX calibré'), ('poisson', 'Poisson simple'), ('mix', 'MIX')]),
]
MARKET_DISPLAY = {'1X2': '1X2', 'OU25': 'O/U 2.5', 'BTTS': 'BTTS'}
rows = []
for market, variants in groups:
    for key, label in variants:
        cell = off[market].get(key)
        if cell and cell.get('n'):
            rows.append((market, label, cell['brier'], cell['n'], key.startswith('voltrix')))
rows.sort(key=lambda r: (r[0], r[2]))
fig, ax = plt.subplots(figsize=(10.6, 5.4), constrained_layout=True)
style_ax(ax)
y = range(len(rows))
colors_bar = [ACCENT if r[4] else (HEADER_FILL if 'Marché' in r[1] else ICON) for r in rows]
bars = ax.barh(list(y), [r[2] for r in rows], color=colors_bar, height=0.62, edgecolor='none')
ax.set_yticks(list(y))
ax.set_yticklabels([f'{MARKET_DISPLAY.get(r[0], r[0])} · {r[1]}  (n={r[3]})' for r in rows], fontsize=8.8)
ax.invert_yaxis()
for i, r in enumerate(rows):
    ax.text(r[2] + 0.004, i, fr(r[2], 4), va='center', fontsize=8.4, color=TEXT)
ax.set_xlabel('Score de Brier (plus bas = meilleur) · horizon officiel T−3h', fontsize=9.5, color=TEXT)
ax.set_xlim(0, max(r[2] for r in rows) * 1.14)
from matplotlib.patches import Patch
ax.legend(handles=[
    Patch(color=ACCENT, label='VOLTRIX'),
    Patch(color=HEADER_FILL, label='Marché (référence)'),
    Patch(color=ICON, label='Baselines simples'),
], loc='lower right', bbox_to_anchor=(1.0, 0.02), frameon=False, fontsize=8.5)
fig.savefig(os.path.join(DATA, 'chart-brier-marches.png'), dpi=200, facecolor='white')
plt.close(fig)
print('chart-brier-marches.png OK')

# ============================================================
# FIGURE 3 — Stabilité par horizon (T−12h → T−1h)
# ============================================================
horizons = ['h12h', 'h6h', 'h3h', 'h1h']
hlabels = ['T−12h', 'T−6h', 'T−3h', 'T−1h']
fig, axes = plt.subplots(1, 3, figsize=(10.6, 3.5), constrained_layout=True)
series = [
    ('1X2', '1X2', ['voltrixFull', 'marketClose', 'poisson'], ['VOLTRIX', 'Marché clôture', 'Poisson'], [ACCENT, HEADER_FILL, ICON]),
    ('OU25', 'O/U 2.5', ['voltrixFullRaw', 'marketClose', 'poisson'], ['VOLTRIX brut', 'Marché clôture', 'Poisson'], [ACCENT, HEADER_FILL, ICON]),
    ('BTTS', 'BTTS', ['voltrixFullRaw', 'poisson'], ['VOLTRIX brut', 'Poisson'], [ACCENT, ICON]),
]
for ax, (market, title_m, keys, labels_, cols) in zip(axes, series):
    style_ax(ax)
    for k, lab, c in zip(keys, labels_, cols):
        vals = []
        for h in horizons:
            cell = M['byHorizon'][h][market].get(k)
            vals.append(cell['brier'] if cell else None)
        xs = [i for i, v in enumerate(vals) if v is not None]
        ys = [v for v in vals if v is not None]
        ax.plot(xs, ys, marker='o', markersize=4, linewidth=2, color=c, label=lab)
        for i, v in zip(xs, ys):
            ax.annotate(fr(v, 3), (i, v), textcoords='offset points', xytext=(0, 7), fontsize=6.8, ha='center', color=MUTED)
    ax.set_xticks(range(4))
    ax.set_xticklabels(hlabels, fontsize=8.4)
    ax.set_title(title_m, fontsize=10.5, color=TEXT, loc='left', pad=8)
    ax.set_ylim(0, None)
    if ax is axes[0]:
        ax.set_ylabel('Brier', fontsize=9.5, color=TEXT)
axes[0].legend(loc='upper center', bbox_to_anchor=(0.5, -0.16), ncol=3, frameon=False, fontsize=8.2)
fig.savefig(os.path.join(DATA, 'chart-horizons.png'), dpi=200, facecolor='white')
plt.close(fig)
print('chart-horizons.png OK')

# ============================================================
# FIGURE 4 — Analyse par niveau de confiance (horizon officiel T−3h)
# ============================================================
conf = M['byConfidence']
levels = ['niveau1', 'niveau2', 'niveau3', 'niveau4', 'niveau5']
ns = [conf[l]['predictions'] for l in levels]
accs = [conf[l]['1X2']['voltrixFull']['accuracy'] if conf[l]['1X2'].get('voltrixFull') else None for l in levels]
briers = [conf[l]['1X2']['voltrixFull']['brier'] if conf[l]['1X2'].get('voltrixFull') else None for l in levels]
briers_ou = [conf[l]['OU25']['voltrixFullRaw']['brier'] if conf[l]['OU25'].get('voltrixFullRaw') else None for l in levels]
briers_btts = [conf[l]['BTTS']['voltrixFullRaw']['brier'] if conf[l]['BTTS'].get('voltrixFullRaw') else None for l in levels]

fig, axes = plt.subplots(1, 2, figsize=(10.6, 3.8), constrained_layout=True)
ax = axes[0]
style_ax(ax)
xs = range(1, 6)
acc_plot = [(i + 1, a) for i, a in enumerate(accs) if a is not None]
bars = ax.bar([i + 1 for i, a in enumerate(accs) if a is not None], [a * 100 for _, a in acc_plot],
              color=ACCENT, width=0.58, edgecolor='none')
for i, (lvl, a) in enumerate(acc_plot):
    ax.text(lvl, a * 100 + 1.2, f'{a*100:.1f}'.replace('.', ',') + '%', ha='center', fontsize=8.6, color=TEXT)
    if ns[lvl - 1]:
        ax.text(lvl, 3.5, f'n={ns[lvl-1]}', ha='center', fontsize=8, color='white', fontweight='bold')
ax.set_xticks(list(xs))
ax.set_xticklabels([f'Niveau {i}' for i in xs], fontsize=8.8)
ax.set_ylim(0, 65)
ax.set_ylabel('Précision 1X2 (%)', fontsize=9.5, color=TEXT)
ax.set_title('Précision 1X2 par niveau de confiance', fontsize=10.5, color=TEXT, loc='left', pad=8)

ax = axes[1]
style_ax(ax)
for vals, lab, c in [(briers, 'Brier 1X2', ACCENT), (briers_ou, 'Brier O/U brut', ICON), (briers_btts, 'Brier BTTS brut', HEADER_FILL)]:
    xs_ = [i + 1 for i, v in enumerate(vals) if v is not None]
    ys_ = [v for v in vals if v is not None]
    ax.plot(xs_, ys_, marker='o', markersize=4.5, linewidth=2, color=c, label=lab)
ax.set_xticks(list(xs))
ax.set_xticklabels([f'Niveau {i}' for i in xs], fontsize=8.8)
ax.set_ylabel('Brier (plus bas = meilleur)', fontsize=9.5, color=TEXT)
ax.set_title('Qualité probabiliste par niveau de confiance', fontsize=10.5, color=TEXT, loc='left', pad=8)
ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.14), ncol=3, frameon=False, fontsize=8.2)
fig.savefig(os.path.join(DATA, 'chart-confiance.png'), dpi=200, facecolor='white')
plt.close(fig)
print('chart-confiance.png OK')
print('Tous les graphiques générés.')
