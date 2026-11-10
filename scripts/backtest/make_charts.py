#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Graphiques + CSV du backtest football
# Sorties (download/backtest-foot/) :
#   chart-logloss.png, chart-calibration.png, chart-valuebets.png,
#   chart-saisons.png, chart-nuls.png
#   resultats-matchs-val-test.csv, constantes-optimisees.json
# ============================================================
from __future__ import annotations

import csv
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from voltrix_foot import (EngineParams, compute_features, elo_diffs, market_probs_1x2,
                          metrics_1x2, run_engine)

OUT = "/home/z/my-project/download/backtest-foot"
os.makedirs(OUT, exist_ok=True)

CORE = ["E0", "E1", "SP1", "D1", "I1", "F1"]
LEAGUE_NAMES = {"E0": "Premier League", "E1": "Championship", "SP1": "LaLiga",
                "D1": "Bundesliga", "I1": "Serie A", "F1": "Ligue 1"}
SEASONS = [f"{y:02d}{(y+1)%100:02d}" for y in range(9, 26)]
TRAIN_END, VAL_END = "2122", "2324"

# Style VOLTRIX (fond sombre lisible)
plt.rcParams.update({
    "figure.facecolor": "#0f1420", "axes.facecolor": "#0f1420",
    "axes.edgecolor": "#3a4258", "axes.labelcolor": "#e8eaf0",
    "text.color": "#e8eaf0", "xtick.color": "#c7ccd8", "ytick.color": "#c7ccd8",
    "grid.color": "#262d40", "font.size": 10, "axes.titlesize": 12,
    "savefig.facecolor": "#0f1420", "savefig.dpi": 150,
})
C_MODEL = "#4f9cff"; C_OPT = "#2ecc71"; C_GLOB = "#f5a623"; C_MKT = "#e74c6c"

def main():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "optimisation_v2.json")) as f:
        opt = json.load(f)

    rows = compute_features(CORE, SEASONS, "1011")
    y = np.array([r["y"] for r in rows])
    seasons = np.array([r["season"] for r in rows])
    leagues = np.array([r["league"] for r in rows])
    m_val = (seasons > TRAIN_END) & (seasons <= VAL_END)
    m_test = seasons > VAL_END
    m_vt = m_val | m_test

    # refaire tourner les 3 configs + marché
    pg = opt["params_opt_global"]
    params_glob = EngineParams(**{**pg, "lam_home_bounds": tuple(pg["lam_home_bounds"]),
                                  "lam_away_bounds": tuple(pg["lam_away_bounds"])})
    # Elo global : recalcul via le module optimize2 (import léger)
    from optimize2 import global_elo_diffs
    ediff_glob = global_elo_diffs(rows, params_glob.k_factor, params_glob.home_adv_elo)
    res_glob = run_engine(rows, params_glob, ediff_glob)
    res_base = run_engine(rows, EngineParams(), elo_diffs(rows, 22.0, 65.0))
    pl = opt["params_opt_local"]
    params_loc = EngineParams(**{**pl, "lam_home_bounds": tuple(pl["lam_home_bounds"]),
                                 "lam_away_bounds": tuple(pl["lam_away_bounds"])})
    res_loc = run_engine(rows, params_loc, elo_diffs(rows, params_loc.k_factor, params_loc.home_adv_elo))
    mkt, mkt_ok = market_probs_1x2(rows)

    # ---------- 1. log-loss / RPS / acc (VAL+TEST) ----------
    configs = [("As-built (local)", res_base["probs"]), ("Constantes optimisées", res_loc["probs"]),
               ("Opt. + Elo global", res_glob["probs"]), ("Marché B365 dé-margé", mkt)]
    fig, axes = plt.subplots(1, 3, figsize=(12.5, 4.2), constrained_layout=True)
    for ax, (metric, title) in zip(axes, [("logloss", "Log-loss 1X2 (plus bas = mieux)"),
                                          ("rps", "RPS (plus bas = mieux)"),
                                          ("acc", "Précision 1X2 (plus haut = mieux)")]):
        vals, labs = [], []
        for name, probs in configs:
            m = m_vt if name != "Marché B365 dé-margé" else (m_vt & mkt_ok)
            vals.append(metrics_1x2(probs[m], y[m])[metric])
            labs.append(name)
        colors = [C_MODEL, C_OPT, C_GLOB, C_MKT]
        bars = ax.bar(range(len(vals)), vals, color=colors, width=0.62)
        ax.set_xticks(range(len(vals)))
        ax.set_xticklabels(["as-built", "opt.", "opt.+Elo\nglobal", "marché\nB365"], fontsize=8.5)
        ax.set_title(title, fontsize=10)
        ax.grid(axis="y", alpha=0.4)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v, f"{v:.4f}", ha="center",
                    va="bottom" if metric == "acc" else "top", fontsize=8.5)
        if metric == "acc":
            ax.set_ylim(0.45, max(vals) + 0.012)
        else:
            ax.set_ylim(0, max(vals) * 1.12)
    fig.suptitle("Backtest 6 ligues 2022-26 (VALIDATION+TEST, n=9 290) — 1X2", fontsize=12)
    fig.savefig(os.path.join(OUT, "chart-logloss.png"))
    plt.close(fig)

    # ---------- 2. calibration ----------
    cal = opt["calibration_test_optglobal"]
    fig, ax = plt.subplots(figsize=(5.6, 4.6), constrained_layout=True)
    xs = [c["annonce"] for c in cal]; ys = [c["reel"] for c in cal]
    ns = [c["n"] for c in cal]
    sizes = [max(28, n / 6) for n in ns]
    ax.plot([0.3, 0.85], [0.3, 0.85], "--", color="#8892b0", lw=1, label="parfaite calibration")
    ax.scatter(xs, ys, s=sizes, color=C_GLOB, alpha=0.85, zorder=3, label="opt.+Elo global (TEST)")
    for c in cal:
        ax.annotate(f"n={c['n']}", (c["annonce"], c["reel"]), fontsize=7.5,
                    xytext=(4, -11), textcoords="offset points", color="#c7ccd8")
    ax.set_xlabel("Probabilité annoncée (max des 3 issues)")
    ax.set_ylabel("Fréquence réalisée")
    ax.set_title("Calibration des probabilités — TEST 2024-26")
    ax.legend(fontsize=8.5)
    ax.grid(alpha=0.4)
    fig.savefig(os.path.join(OUT, "chart-calibration.png"))
    plt.close(fig)

    # ---------- 3. value bets ----------
    fig, ax = plt.subplots(figsize=(7.4, 4.4), constrained_layout=True)
    disciplines = [("Seuil 2 % (règle actuelle)", -0.1276, 3913),
                   ("Seuil 5 %", -0.1192, 3108),
                   ("Seuil 8 %", -0.1393, 2429),
                   ("Seuil 5 % + cote ≤ 3,0", -0.0730, 1130),
                   ("Seuil 5 % + cote ≤ 2,5", -0.0374, 766)]
    names = [d[0] for d in disciplines]; rois = [d[1] * 100 for d in disciplines]
    ns = [d[2] for d in disciplines]
    colors = ["#e74c6c" if r < -10 else "#f5a623" if r < -5 else "#2ecc71" for r in rois]
    bars = ax.barh(range(len(rois)), rois, color=colors, height=0.6)
    ax.set_yticks(range(len(rois)))
    ax.set_yticklabels([f"{n}\n({v} paris)" for n, v in zip(names, ns)], fontsize=8.5)
    ax.axvline(0, color="#e8eaf0", lw=1)
    ax.set_xlabel("ROI (%) — mise plate 1u, TEST 2024-26")
    ax.set_title("Value bets 1X2 : la discipline protège, elle ne crée pas d'edge")
    ax.grid(axis="x", alpha=0.4)
    for b, r in zip(bars, rois):
        ax.text(r - 0.25 if r < 0 else r + 0.25, b.get_y() + b.get_height() / 2,
                f"{r:+.1f} %", va="center", ha="right" if r < 0 else "left", fontsize=9)
    ax.set_xlim(min(rois) * 1.25, 2.5)
    fig.savefig(os.path.join(OUT, "chart-valuebets.png"))
    plt.close(fig)

    # ---------- 4. précision par saison ----------
    fig, ax = plt.subplots(figsize=(8.6, 4.4), constrained_layout=True)
    s_list = sorted(set(seasons) - set(s for s in seasons if s <= TRAIN_END))
    xs = np.arange(len(s_list))
    acc_b, acc_g, acc_m = [], [], []
    for s in s_list:
        m = seasons == s
        acc_b.append(metrics_1x2(res_base["probs"][m], y[m])["acc"])
        acc_g.append(metrics_1x2(res_glob["probs"][m], y[m])["acc"])
        mm = m & mkt_ok
        acc_m.append(metrics_1x2(mkt[mm], y[mm])["acc"] if mm.sum() else np.nan)
    ax.plot(xs, [a * 100 for a in acc_b], "o-", color=C_MODEL, label="as-built", ms=4)
    ax.plot(xs, [a * 100 for a in acc_g], "o-", color=C_GLOB, label="opt. + Elo global", ms=4)
    ax.plot(xs, [a * 100 for a in acc_m], "s--", color=C_MKT, label="marché B365 dé-margé", ms=4)
    ax.set_xticks(xs)
    ax.set_xticklabels([f"{s[:2]}-{s[2:]}" for s in s_list], fontsize=8.5)
    ax.set_ylabel("Précision 1X2 (%)")
    ax.set_title("Précision par saison (2022-26 : fenêtres validation + test)")
    ax.legend(fontsize=8.5, loc="lower right")
    ax.grid(alpha=0.4)
    fig.savefig(os.path.join(OUT, "chart-saisons.png"))
    plt.close(fig)

    # ---------- 5. calibration des nuls ----------
    fig, ax = plt.subplots(figsize=(7.4, 4.2), constrained_layout=True)
    s_list2 = sorted(set(seasons) - set(s for s in seasons if s <= TRAIN_END))
    pred_d, real_d = [], []
    for s in s_list2:
        m = seasons == s
        pred_d.append(res_glob["probs"][m][:, 1].mean() * 100)
        real_d.append((y[m] == 1).mean() * 100)
    xs = np.arange(len(s_list2))
    w = 0.38
    ax.bar(xs - w / 2, pred_d, w, color=C_GLOB, label="nul prédit (moyenne des probas)")
    ax.bar(xs + w / 2, real_d, w, color="#8892b0", label="nul réel")
    ax.set_xticks(xs)
    ax.set_xticklabels([f"{s[:2]}-{s[2:]}" for s in s_list2], fontsize=8.5)
    ax.set_ylabel("%")
    ax.set_title("Calibration des matchs nuls — avant : 23,1 % prédit vs 25,7 % réel")
    ax.legend(fontsize=8.5)
    ax.grid(axis="y", alpha=0.4)
    fig.savefig(os.path.join(OUT, "chart-nuls.png"))
    plt.close(fig)

    # ---------- CSV par match (VAL+TEST) ----------
    dest = os.path.join(OUT, "resultats-matchs-val-test.csv")
    with open(dest, "w", newline="", encoding="utf-8") as f:
        wcsv = csv.writer(f)
        wcsv.writerow(["ligue", "saison", "date", "domicile", "exterieur", "buts_dom",
                       "buts_ext", "issue", "p_dom", "p_nul", "p_ext", "lambda_dom",
                       "lambda_ext", "p_over25", "p_btts", "cote_dom_B365", "cote_nul_B365",
                       "cote_ext_B365", "fenetre"])
        for i, r in enumerate(rows):
            if not m_vt[i]:
                continue
            p = res_glob["probs"][i]
            lam = res_glob["lambda"][i]
            wcsv.writerow([LEAGUE_NAMES.get(r["league"], r["league"]),
                           f"{r['season'][:2]}-{r['season'][2:]}", r["date"].isoformat(),
                           r["home"], r["away"], r["hg"], r["ag"],
                           ["H", "D", "A"][r["y"]],
                           f"{p[0]:.4f}", f"{p[1]:.4f}", f"{p[2]:.4f}",
                           f"{lam[0]:.2f}", f"{lam[1]:.2f}",
                           f"{res_glob['over25'][i]:.4f}", f"{res_glob['btts'][i]:.4f}",
                           r["b365h"] if np.isfinite(r["b365h"]) else "",
                           r["b365d"] if np.isfinite(r["b365d"]) else "",
                           r["b365a"] if np.isfinite(r["b365a"]) else "",
                           "VALIDATION" if m_val[i] else "TEST"])
    print(f"CSV : {dest} ({int(m_vt.sum())} matchs)")

    # ---------- constantes (JSON lisible) ----------
    with open(os.path.join(OUT, "constantes-optimisees.json"), "w", encoding="utf-8") as f:
        json.dump({
            "version": "voltrix-foot-v2 (backtest 2026-11)",
            "source": "football-data.co.uk — 6 ligues, 37 715 matchs 2010-26, "
                      "split temporel train 2010-22 / validation 2022-24 / test 2024-26",
            "applique_dans_l_app": {
                "elo_draw_base": pg["elo_draw_base"], "elo_draw_slope": pg["elo_draw_slope"],
                "form_draw_base": pg["form_draw_base"], "form_draw_slope": pg["form_draw_slope"],
                "w_poisson": pg["w_poisson"], "w_elo": pg["w_elo"], "w_form": pg["w_form"],
                "k_factor": pg["k_factor"], "home_adv_elo": pg["home_adv_elo"],
                "elo_factor_div": pg["elo_factor_div"],
                "form_factor_span": pg["form_factor_span"],
                "lam_home_bounds": pg["lam_home_bounds"], "lam_away_bounds": pg["lam_away_bounds"],
                "fatigue_factor": pg["fatigue_factor"], "derby_factor": pg["derby_factor"],
                "per_league_avgs_pour_marches_de_buts": True,
            },
            "piste_v3_non_appliquee": {
                "elo_global": "log-loss TEST 1,0053 vs 1,0110 (Elo local optimisé) — "
                              "nécessite le chargement de toute la ligue, non implémenté "
                              "car l'API ESPN scoreboard ne supporte pas les plages de dates",
            },
            "league_params": opt["league_params"],
            "evaluation_finale": opt["evaluation_finale"],
        }, f, indent=2, ensure_ascii=False)
    print("Graphiques + CSV + constantes écrits dans", OUT)

if __name__ == "__main__":
    main()
