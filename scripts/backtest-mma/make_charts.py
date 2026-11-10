#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Graphiques du rapport PDF backtest MMA
# Mêmes règles que le football : Template 07, pas de titre
# interne, spines haut/droite supprimés, grille pointillée.
# ============================================================
from __future__ import annotations

import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "charts_pdf")
os.makedirs(OUT, exist_ok=True)

C_BASE = "#2d7ab3"
C_DARK = "#1a4a7a"
C_LIGHT = "#7fb3d8"
C_MUTED = "#5a7a96"
C_TEXT = "#142840"
C_BORDER = "#c0d0e2"
C_BAD = "#b0392d"
C_GOOD = "#2e7d54"
C_GOLD = "#b8860b"

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white",
    "axes.edgecolor": C_BORDER, "axes.labelcolor": C_TEXT,
    "text.color": C_TEXT, "xtick.color": C_MUTED, "ytick.color": C_MUTED,
    "grid.color": C_BORDER, "font.size": 11, "savefig.facecolor": "white",
    "savefig.dpi": 160, "axes.grid": True, "grid.linestyle": "--",
    "grid.linewidth": 0.5, "grid.alpha": 0.35,
})
for side in ("top", "right"):
    plt.rcParams[f"axes.spines.{side}"] = False

def style_ax(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, linestyle="--", linewidth=0.5, alpha=0.35, color=C_BORDER)

with open(os.path.join(HERE, "replay_results.json")) as f:
    R = json.load(f)

# ---------- 1. Métriques par split : modèle vs marché ----------
fig, axes = plt.subplots(1, 3, figsize=(11.6, 3.9), constrained_layout=True)
panels = [("acc", "Précision vainqueur", "plus haut = mieux", True, 100),
          ("brier", "Score de Brier", "plus bas = mieux", False, 1),
          ("logloss", "Log-loss", "plus bas = mieux", False, 1)]
splits = ["TRAIN", "VAL", "TEST"]
split_labels = ["Train\n<2023", "Valid.\n23-24", "Test\n25-26"]
for ax, (key, title, sub, higher, scale) in zip(axes, panels):
    mod = [R["asBuilt"][s][key] * scale for s in splits]
    mkt = [R["market"][s][key] * scale for s in splits]
    x = np.arange(3)
    w = 0.36
    b1 = ax.bar(x - w / 2, mod, w, color=C_BASE, label="voltrix-mma-v1", edgecolor="none")
    b2 = ax.bar(x + w / 2, mkt, w, color=C_BAD, label="Marché (clôture)", edgecolor="none")
    for bars in (b1, b2):
        for b in bars:
            v = b.get_height()
            ax.annotate(f"{v:.3f}" if scale == 1 else f"{v:.1f}%",
                        (b.get_x() + b.get_width() / 2, v), ha="center",
                        va="bottom" if higher else "top",
                        fontsize=7.6, color=C_TEXT,
                        xytext=(0, 2 if higher else -2), textcoords="offset points")
    ax.set_xticks(x)
    ax.set_xticklabels(split_labels, fontsize=9)
    ax.set_title(f"{title} ({sub})", fontsize=10.5, loc="left")
    if key == "acc":
        ax.set_ylim(40, 80)
    style_ax(ax)
axes[0].legend(frameon=False, fontsize=8.5, loc="upper left", bbox_to_anchor=(0, 1.02))
fig.savefig(os.path.join(OUT, "fig1-metrics.png"))
plt.close(fig)

# ---------- 2. Calibration symétrisée ----------
cal = [b for b in R["calibrationSym"] if b["n"] > 0]
px = [b["avgPred"] for b in cal]
py = [100 * b["wins"] / b["n"] for b in cal]
ns = [b["n"] for b in cal]
fig, ax = plt.subplots(figsize=(7.0, 5.2), constrained_layout=True)
ax.plot([10, 90], [10, 90], color=C_BORDER, linewidth=1.2, linestyle="--",
        label="Calibration parfaite", zorder=1)
sc = ax.scatter(px, py, s=[max(28, n / 14) for n in ns], color=C_BASE,
                alpha=0.85, edgecolor=C_DARK, linewidth=0.8, zorder=3,
                label="Observé (taille ∝ effectif)")
for b, x0, y0 in zip(cal, px, py):
    ax.annotate(f"n={b['n']}", (x0, y0), xytext=(6, -3), textcoords="offset points",
                fontsize=7.2, color=C_MUTED)
ax.set_xlabel("Probabilité prédite pour le combattant choisi (%)")
ax.set_ylabel("Fréquence de victoire observée (%)")
ax.set_xlim(15, 85)
ax.set_ylim(15, 85)
ax.set_aspect("equal")
ax.legend(frameon=False, fontsize=9, loc="upper left")
style_ax(ax)
fig.savefig(os.path.join(OUT, "fig2-calibration.png"))
plt.close(fig)

# ---------- 3. Précision par année + couverture ----------
years = [y["year"] for y in R["byYear"]]
accs = [100 * y["acc"] for y in R["byYear"]]
ns = [y["n"] for y in R["byYear"]]
# couverture par année (reconstruite depuis rows)
pred_by_year = {}
for r in R["rows"]:
    pred_by_year[r["year"]] = pred_by_year.get(r["year"], 0) + 1
dec_by_year = {}
for r in R["rows"]:
    dec_by_year.setdefault(r["year"], 0)
# décisions totales par année : depuis rows on n'a que les prédits ; utiliser le champ
# coverage global + refus par année recalculés côté replay (export) — approximation :
# refus par année stockés dans rows manquants → recalcul simple via n prédits vs
# total combats par année exporté dans coverage_by_year si présent
cov_by_year = R.get("coverageByYear")
if cov_by_year is None:
    cov_by_year = {}
fig, ax = plt.subplots(figsize=(11.6, 4.4), constrained_layout=True)
ax.plot(years, accs, color=C_BASE, linewidth=2.0, marker="o", markersize=4.5,
        label="Précision voltrix-mma-v1", zorder=3)
# fenêtre glissante 5 ans
if len(accs) >= 5:
    roll = np.convolve(accs, np.ones(5) / 5, mode="valid")
    ax.plot(years[4:], roll, color=C_GOLD, linewidth=2.4, alpha=0.9,
            label="Moyenne mobile 5 ans", zorder=2)
ax.axhline(50, color=C_BORDER, linewidth=1, linestyle=":")
ax.text(years[0], 50.7, "hasard (50 %)", fontsize=8, color=C_MUTED)
ax.set_xlabel("Année")
ax.set_ylabel("Précision (%)")
ax.set_ylim(30, 85)
ax2 = ax.twinx()
ax2.bar(years, ns, color=C_LIGHT, alpha=0.35, width=0.6, label="Combats prédits (n)", zorder=1)
ax2.set_ylabel("Combats prédits", color=C_MUTED)
ax2.set_ylim(0, max(ns) * 3.2)
ax2.spines["top"].set_visible(False)
ax2.grid(False)
ax.legend(frameon=False, fontsize=9, loc="upper left")
ax2.legend(frameon=False, fontsize=8.5, loc="upper right")
style_ax(ax)
fig.savefig(os.path.join(OUT, "fig3-annees.png"))
plt.close(fig)

# ---------- 4. Accord / désaccord avec le marché ----------
dis = R["marketDisagreement"]
n_dis, n_tot = dis["n"], dis["total"]
n_agree = n_tot - n_dis
acc_dis = 100 * dis["modelAccOnDisagree"]
# accord : précision modèle quand il suit le marché
agree_rows = [r for r in R["rows"]
              if r["marketIp1"] is not None and abs(r["marketIp1"] - 0.5) > 1e-9
              and ((r["marketIp1"] > 0.5) == (r["pA"] > 50))]
acc_agree = 100 * sum(1 for r in agree_rows
                      if (r["pA"] > 50) == r["winnerIsF1"]) / len(agree_rows)
fig, axes = plt.subplots(1, 2, figsize=(11.6, 4.0), constrained_layout=True,
                         gridspec_kw={"width_ratios": [1.05, 1.35]})
ax = axes[0]
bars = ax.bar([0, 1], [acc_agree, acc_dis], color=[C_BASE, C_BAD], width=0.55, edgecolor="none")
for b, v, n in zip(bars, [acc_agree, acc_dis], [n_agree, n_dis]):
    ax.annotate(f"{v:.1f}%", (b.get_x() + b.get_width() / 2, v), ha="center", va="bottom",
                fontsize=10, fontweight="bold", color=C_TEXT)
    ax.annotate(f"n = {n}", (b.get_x() + b.get_width() / 2, 4), ha="center",
                fontsize=8.5, color="white")
ax.set_xticks([0, 1])
ax.set_xticklabels(["Quand le modèle\nsuit le marché", "Quand le modèle\ncontre le marché"],
                   fontsize=9.5)
ax.set_ylabel("Précision du modèle (%)")
ax.set_ylim(0, 88)
ax.axhline(50, color=C_BORDER, linewidth=1, linestyle=":")
style_ax(ax)
ax = axes[1]
# répartition des probabilités prédites
dist_bins = [(20, 30), (30, 40), (40, 50), (50, 60), (60, 70), (70, 80)]
counts = []
for lo, hi in dist_bins:
    counts.append(sum(1 for r in R["rows"] if lo <= r["pA"] < hi))
# symétrisation implicite : 40-50 et 50-60 quasi identiques
xs = [f"{lo}-{hi}" for lo, hi in dist_bins]
colors = [C_LIGHT if lo < 50 else C_BASE for lo, _ in dist_bins]
bars = ax.bar(range(6), counts, color=colors, width=0.62, edgecolor="none")
for b, v in zip(bars, counts):
    ax.annotate(str(v), (b.get_x() + b.get_width() / 2, v), ha="center", va="bottom",
                fontsize=8.5, color=C_TEXT)
ax.set_xticks(range(6))
ax.set_xticklabels(xs, fontsize=9)
ax.set_xlabel("Probabilité prédite (%)")
ax.set_ylabel("Combats")
style_ax(ax)
fig.savefig(os.path.join(OUT, "fig4-marche.png"))
plt.close(fig)

# ---------- 5. Grille de calibration : log-loss VAL ----------
grid = R["gridTop"]
fig, ax = plt.subplots(figsize=(7.6, 4.6), constrained_layout=True)
ks = sorted({g["kLogistic"] for g in grid})
formes = sorted({g["forme"] for g in grid})
for wf in formes:
    ys = []
    for k in ks:
        cand = [g for g in grid if g["kLogistic"] == k and g["forme"] == wf]
        if cand:
            # bornes [25,75] comme référence de la famille
            c = min(cand, key=lambda g: g["val"]["logloss"])
            ys.append(c["val"]["logloss"])
        else:
            ys.append(np.nan)
    ax.plot(ks, ys, marker="o", markersize=4.5, linewidth=1.8,
            label=f"poids forme = {wf}")
ax.axhline(R["asBuilt"]["VAL"]["logloss"], color=C_BAD, linewidth=1.4, linestyle="--",
           label="As-built (K=2,6, forme 1,5)")
ax.set_xlabel("Pente logistique K")
ax.set_ylabel("Log-loss validation (2023-24)")
ax.legend(frameon=False, fontsize=8.5)
style_ax(ax)
fig.savefig(os.path.join(OUT, "fig5-grille.png"))
plt.close(fig)

print("OK :", sorted(os.listdir(OUT)))
