#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Graphiques du rapport PDF (mode clair, Template 07)
# Règles typesetting/charts.md : pas de titre interne (caption dans
# le PDF), spines haut/droite supprimées, grille pointillée 20 %,
# légende sans cadre, famille bleue unique + couleurs sémantiques.
# ============================================================
from __future__ import annotations

import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT = "/home/z/my-project/scripts/backtest/charts_pdf"
os.makedirs(OUT, exist_ok=True)

# Famille bleue Template 07 (body clair) + sémantiques
C_BASE = "#2d7ab3"   # accent (XS)
C_DARK = "#1a4a7a"   # header fill (M)
C_LIGHT = "#7fb3d8"  # bleu clair
C_MUTED = "#5a7a96"  # texte secondaire
C_TEXT = "#142840"
C_BORDER = "#c0d0e2"
C_BAD = "#b0392d"    # sémantique négatif
C_GOOD = "#2e7d54"   # sémantique positif

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

def main():
    import json
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "optimisation_v2.json")) as f:
        opt = json.load(f)
    ev = opt["evaluation_finale"]

    # ---------- 1. log-loss / RPS / précision (VAL+TEST) ----------
    # VAL+TEST combinés : moyenne des deux fenêtres
    def combined(name, key):
        v, t = ev[f"{name}|VAL"], ev[f"{name}|TEST"]
        return v[key], t[key]
    configs = [("as-built (local)", "as-built (local)"), ("opt-local", "constantes opt."),
               ("opt-global", "opt. + Elo global")]
    fig, axes = plt.subplots(1, 3, figsize=(11.6, 3.9), constrained_layout=True)
    panels = [("logloss", "Log-loss 1X2", "plus bas = mieux", False),
              ("rps", "RPS", "plus bas = mieux", False),
              ("acc", "Précision 1X2", "plus haut = mieux", True)]
    for ax, (key, title, sub, higher) in zip(axes, panels):
        vals = []
        for name, _ in configs:
            v, t = combined(name, key)
            vals.append((v + t) / 2)
        vm = (ev["marche-B365|VAL"][key] + ev["marche-B365|TEST"][key]) / 2
        vals.append(vm)
        labels = ["as-built", "opt.", "opt. +\nElo global", "marché\nB365"]
        colors = [C_LIGHT, C_BASE, C_DARK, C_BAD]
        bars = ax.bar(range(4), vals, color=colors, width=0.62, edgecolor="none")
        ax.set_xticks(range(4))
        ax.set_xticklabels(labels, fontsize=9)
        ax.set_title(f"{title} ({sub})", fontsize=10.5, loc="left")
        style_ax(ax)
        lo, hi = min(vals), max(vals)
        margin = (hi - lo) * 0.25 + 1e-4
        ax.set_ylim(lo - margin, hi + margin)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + (margin * 0.18 if higher else -margin * 0.18),
                    f"{v:.4f}", ha="center",
                    va="bottom" if higher else "top", fontsize=8.6, color=C_TEXT)
    fig.savefig(os.path.join(OUT, "fig1-metrics.png"))
    plt.close(fig)

    # ---------- 2. calibration ----------
    cal = opt["calibration_test_optglobal"]
    fig, ax = plt.subplots(figsize=(6.4, 4.6), constrained_layout=True)
    xs = [c["annonce"] for c in cal]
    ys = [c["reel"] for c in cal]
    sizes = [max(40, n / 5) for n in (c["n"] for c in cal)]
    ax.plot([0.3, 0.85], [0.3, 0.85], "--", color=C_MUTED, lw=1.2, label="calibration parfaite")
    ax.scatter(xs, ys, s=sizes, color=C_BASE, alpha=0.85, zorder=3, label="opt. + Elo global")
    for c in cal:
        ax.annotate(f"n={c['n']}", (c["annonce"], c["reel"]), fontsize=7.6,
                    xytext=(5, -12), textcoords="offset points", color=C_MUTED)
    ax.set_xlabel("Probabilité annoncée (issue la plus probable)")
    ax.set_ylabel("Fréquence réalisée")
    ax.legend(frameon=False, loc="upper left", fontsize=9)
    style_ax(ax)
    fig.savefig(os.path.join(OUT, "fig2-calibration.png"))
    plt.close(fig)

    # ---------- 3. value bets ----------
    fig, ax = plt.subplots(figsize=(8.6, 4.1), constrained_layout=True)
    disciplines = [("Seuil 2 % (règle actuelle)", -12.76, 3913),
                   ("Seuil 5 %", -11.92, 3108),
                   ("Seuil 8 %", -13.93, 2429),
                   ("Seuil 5 % + cote ≤ 3,0", -7.30, 1130),
                   ("Seuil 5 % + cote ≤ 2,5", -3.74, 766)]
    names = [d[0] for d in disciplines]
    rois = [d[1] for d in disciplines]
    ns = [d[2] for d in disciplines]
    colors = [C_BAD if r < -10 else "#c07a3d" if r < -5 else C_GOOD for r in rois]
    bars = ax.barh(range(len(rois)), rois, color=colors, height=0.58, edgecolor="none")
    ax.set_yticks(range(len(rois)))
    ax.set_yticklabels([f"{n}  ({v} paris)" for n, v in zip(names, ns)], fontsize=9)
    ax.axvline(0, color=C_TEXT, lw=1)
    ax.set_xlabel("ROI (%) — mise plate 1 unité, TEST 2024-26")
    ax.invert_yaxis()
    style_ax(ax)
    ax.grid(axis="y", visible=False)
    for b, r in zip(bars, rois):
        ax.text(r - 0.3, b.get_y() + b.get_height() / 2, f"{r:+.1f} %",
                va="center", ha="right", fontsize=9, color=C_TEXT)
    ax.set_xlim(min(rois) * 1.22, 2.0)
    fig.savefig(os.path.join(OUT, "fig3-valuebets.png"))
    plt.close(fig)

    # ---------- 4. nuls ----------
    fig, ax = plt.subplots(figsize=(8.6, 3.9), constrained_layout=True)
    keys = sorted(opt["par_saison"].keys())   # ex. '2223'
    pred_d = [opt["par_saison"][s]["optglobal"]["draw_pred"] * 100 for s in keys]
    import csv as _csv
    real = {}
    with open("/home/z/my-project/download/backtest-foot/resultats-matchs-val-test.csv",
              encoding="utf-8") as f:
        for r in _csv.DictReader(f):
            real.setdefault(r["saison"], []).append(r["issue"])
    # clés JSON '2223' -> CSV '22-23'
    real_d = [100 * sum(1 for i in real.get(f"{s[:2]}-{s[2:]}", []) if i == "D") /
              max(len(real.get(f"{s[:2]}-{s[2:]}", [])), 1) for s in keys]
    xs = np.arange(len(keys))
    w = 0.38
    ax.bar(xs - w / 2, pred_d, w, color=C_BASE, label="nul prédit (moyenne des probas)", edgecolor="none")
    ax.bar(xs + w / 2, real_d, w, color=C_BORDER, label="nul réel", edgecolor="none")
    ax.set_xticks(xs)
    ax.set_xticklabels([f"{s[:2]}-{s[2:]}" for s in keys], fontsize=9.5)
    ax.set_ylabel("% de matchs nuls")
    ax.legend(frameon=False, fontsize=9, loc="lower right", ncol=2)
    style_ax(ax)
    ax.set_ylim(0, 33)
    fig.savefig(os.path.join(OUT, "fig4-nuls.png"))
    plt.close(fig)

    # ---------- 5. précision par saison ----------
    fig, ax = plt.subplots(figsize=(9.4, 4.0), constrained_layout=True)
    acc_b = [opt["par_saison"][s]["asbuilt"]["acc"] * 100 for s in keys]
    acc_g = [opt["par_saison"][s]["optglobal"]["acc"] * 100 for s in keys]
    acc_m = [opt["par_saison"][s]["marche"]["acc"] * 100 if opt["par_saison"][s]["marche"] else np.nan
             for s in keys]
    xs = np.arange(len(keys))
    ax.plot(xs, acc_b, "o-", color=C_LIGHT, lw=2, ms=4.5, label="as-built")
    ax.plot(xs, acc_g, "o-", color=C_DARK, lw=2, ms=4.5, label="opt. + Elo global")
    ax.plot(xs, acc_m, "s--", color=C_BAD, lw=1.8, ms=4, label="marché B365 dé-margé")
    ax.set_xticks(xs)
    ax.set_xticklabels([f"{s[:2]}-{s[2:]}" for s in keys], fontsize=9.5)
    ax.set_ylabel("Précision 1X2 (%)")
    ax.legend(frameon=False, fontsize=9, loc="lower right", ncol=3)
    style_ax(ax)
    fig.savefig(os.path.join(OUT, "fig5-saisons.png"))
    plt.close(fig)

    print("Graphiques clairs écrits dans", OUT)
    for f in sorted(os.listdir(OUT)):
        print("  ", f)

if __name__ == "__main__":
    main()
