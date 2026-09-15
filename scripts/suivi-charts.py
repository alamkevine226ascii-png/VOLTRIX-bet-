#!/usr/bin/env python3
# Graphiques du dossier de suivi VOLTRIX bet — palette IG-1 (or #C9A84C sur encre #1A1A1A)
# Données réelles du backtest V3 poolé (download/backtest-v3-replay-results.json, 7 folds 2026)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["font.family"] = "DejaVu Sans"

TEXT = "#333333"
GRID = "#E0E0E0"

C_MARCHE = "#1A1A1A"
C_POISSON = "#ABABAB"
C_ELO = "#CFCFCF"
C_MIX = "#8A7548"
C_VFULL = "#C9A84C"
C_VCAL = "#C9A84C"
C_VBRUT = "#E0CE9A"

OUT = "/home/z/my-project/scripts"


def fr(x):
    """Format français : virgule décimale, 4 décimales."""
    return f"{x:.4f}".replace(".", ",")


def style_ax(ax):
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color("#999999")
    ax.tick_params(colors=TEXT, labelsize=10)


# ── Figure 1 : Brier 1X2 par modèle (backtest V3 poolé, n = 1 540) ──
models = ["Marché (clôture)", "Poisson simple", "VOLTRIX complet", "MIX (Poisson+Elo+forme)", "Elo simple"]
vals = [0.6236, 0.6363, 0.6496, 0.6497, 0.6545]
cols = [C_MARCHE, C_POISSON, C_VFULL, C_MIX, C_ELO]

fig, ax = plt.subplots(figsize=(9.2, 4.0), constrained_layout=True)
y = range(len(models))
bars = ax.barh(y, vals, color=cols, height=0.62, edgecolor="white")
ax.set_yticks(list(y))
ax.set_yticklabels(models, fontsize=10.5, color=TEXT)
ax.invert_yaxis()  # meilleur en haut
for bar, v in zip(bars, vals):
    ax.text(v + 0.0015, bar.get_y() + bar.get_height() / 2, fr(v),
            va="center", ha="left", fontsize=10, color=TEXT)
ax.set_xlim(0.60, 0.675)
ax.set_xlabel("Score de Brier multiclasse (plus bas = meilleur)", fontsize=10.5, color=TEXT)
ax.grid(axis="x", alpha=0.35, color=GRID)
ax.set_axisbelow(True)
style_ax(ax)
fig.savefig(f"{OUT}/suivi-chart-brier-1x2.png", dpi=200, facecolor="white")
plt.close(fig)

# ── Figure 2 : marchés secondaires (O/U 2,5 et BTTS), backtest V3 poolé ──
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.6, 4.4), constrained_layout=True)

ou_labels = ["Marché", "VOLTRIX\ncalibré", "VOLTRIX\nbrut", "Poisson\nsimple"]
ou_vals = [0.2489, 0.2502, 0.2580, 0.2616]
ou_cols = [C_MARCHE, C_VCAL, C_VBRUT, C_POISSON]
bars1 = ax1.bar(ou_labels, ou_vals, color=ou_cols, width=0.6, edgecolor="white")
for bar, v in zip(bars1, ou_vals):
    ax1.text(bar.get_x() + bar.get_width() / 2, v + 0.0018, fr(v),
             ha="center", va="bottom", fontsize=9.5, color=TEXT)
ax1.set_ylim(0.24, 0.272)
ax1.set_title("O/U 2,5 buts (n = 1 540)", fontsize=11.5, color=TEXT, pad=10)
ax1.set_ylabel("Score de Brier (plus bas = meilleur)", fontsize=10, color=TEXT)
ax1.grid(axis="y", alpha=0.35, color=GRID)
ax1.set_axisbelow(True)
style_ax(ax1)

btts_labels = ["Poisson\nsimple", "VOLTRIX\ncalibré", "MIX\n(P+E+F)", "VOLTRIX\ncomplet"]
btts_vals = [0.2548, 0.2648, 0.2714, 0.2723]
btts_cols = [C_POISSON, C_VCAL, C_MIX, C_VFULL]
bars2 = ax2.bar(btts_labels, btts_vals, color=btts_cols, width=0.6, edgecolor="white")
for bar, v in zip(bars2, btts_vals):
    ax2.text(bar.get_x() + bar.get_width() / 2, v + 0.0018, fr(v),
             ha="center", va="bottom", fontsize=9.5, color=TEXT)
ax2.set_ylim(0.24, 0.282)
ax2.set_title("BTTS — les deux équipes marquent (n = 1 836)", fontsize=11.5, color=TEXT, pad=10)
ax2.grid(axis="y", alpha=0.35, color=GRID)
ax2.set_axisbelow(True)
style_ax(ax2)

fig.savefig(f"{OUT}/suivi-chart-marches-secondaires.png", dpi=200, facecolor="white")
plt.close(fig)

print("Charts OK")
