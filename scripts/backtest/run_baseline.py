#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Backtest de RÉFÉRENCE du moteur foot « as-built »
# Données : football-data.co.uk, 6 ligues cœur (E0 E1 SP1 D1 I1 F1)
# Saisons évaluées : 2010-11 → 2025-26 (16 saisons, fenêtre 2 saisons
#                    anti-fuite — 2009-10 sert de warm-up)
# Split temporel : TRAIN 2010-22 | VALIDATION 2022-24 | TEST 2024-26
# Métriques : accuracy, log-loss, Brier, RPS (1X2) ; O/U 2.5, BTTS ;
#             baselines (priors, toujours-domicile, marché B365 dé-margé)
# ============================================================
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from voltrix_foot import (EngineParams, compute_features, elo_diffs, market_probs_1x2,
                          metrics_1x2, metrics_binary, run_engine)

CORE = ["E0", "E1", "SP1", "D1", "I1", "F1"]
SEASONS_ALL = [f"{y:02d}{(y+1)%100:02d}" for y in range(9, 26)]  # 0910 → 2526
EVAL_FROM = "1011"
TRAIN_END = "2122"    # inclus
VAL_END = "2324"      # inclus
# TEST = 2425 → 2526

LEAGUE_NAMES = {"E0": "Premier League", "E1": "Championship", "SP1": "LaLiga",
                "D1": "Bundesliga", "I1": "Serie A", "F1": "Ligue 1"}

def window_of(season: str) -> str:
    if season <= TRAIN_END:
        return "TRAIN 2010-22"
    if season <= VAL_END:
        return "VALIDATION 2022-24"
    return "TEST 2024-26"

def main():
    t0 = time.time()
    print("Chargement + features (une seule passe)…")
    rows = compute_features(CORE, SEASONS_ALL, EVAL_FROM)
    print(f"  {len(rows)} matchs évalués en {time.time()-t0:.1f}s")

    y = np.array([r["y"] for r in rows])
    seasons = np.array([r["season"] for r in rows])
    leagues = np.array([r["league"] for r in rows])
    wmask = np.array([window_of(s) for s in seasons])
    tot_goals = np.array([r["hg"] + r["ag"] for r in rows])
    y_over25 = (tot_goals >= 3).astype(int)
    y_btts = np.array([1 if (r["hg"] >= 1 and r["ag"] >= 1) else 0 for r in rows])

    # Elo as-built (K=22, ADV=65) — calculé une fois, mis en cache
    t1 = time.time()
    ediff = elo_diffs(rows, 22.0, 65.0)
    print(f"  Elo local calculé en {time.time()-t1:.1f}s")

    # ---- moteur as-built ----
    t2 = time.time()
    res = run_engine(rows, EngineParams(), ediff)
    print(f"  Moteur vectorisé : {time.time()-t2:.1f}s")

    # ---- baselines ----
    mkt, mkt_ok = market_probs_1x2(rows)
    base_rate = np.eye(3)[np.bincount(y).argmax()]
    prior = np.bincount(y, minlength=3) / len(y)

    results = {}
    def report(tag: str, probs: np.ndarray, mask: np.ndarray):
        results[tag] = metrics_1x2(probs[mask], y[mask])

    n_rows = len(rows)
    for w in ["TRAIN 2010-22", "VALIDATION 2022-24", "TEST 2024-26"]:
        m = wmask == w
        report(f"voltrix-asbuilt|{w}", res["probs"], m)
        report(f"poisson-seul|{w}", res["poisson"], m)
        report(f"elo-seul|{w}", res["elo"], m)
        report(f"forme-seule|{w}", res["form"], m)
        report(f"toujours-domicile|{w}", np.tile([1.0, 0.0, 0.0], (n_rows, 1)), m)
        report(f"priors-entrainement|{w}", np.tile(prior, (n_rows, 1)), m)
        mo = m & mkt_ok
        if mo.sum() > 0:
            results[f"marche-B365|{w}"] = metrics_1x2(mkt[mo], y[mo])

    # ---- marchés de buts (bruts, non calibrés) ----
    for w in ["VALIDATION 2022-24", "TEST 2024-26"]:
        m = wmask == w
        results[f"OU25-modele|{w}"] = metrics_binary(res["over25"][m], y_over25[m])
        results[f"BTTS-modele|{w}"] = metrics_binary(res["btts"][m], y_btts[m])
        # marché O/U 2.5 quand dispo
        ou_ok = m & np.isfinite(np.array([r["b365_over25"] for r in rows])) & \
                np.isfinite(np.array([r["b365_under25"] for r in rows]))
        if ou_ok.sum() > 0:
            o = np.array([r["b365_over25"] for r in rows])
            u = np.array([r["b365_under25"] for r in rows])
            inv_sum = 1/o + 1/u
            p_mkt = np.where(ou_ok, (1/o) / inv_sum, np.nan)
            sel = ou_ok & (inv_sum > 1.001) & (inv_sum < 1.3)
            if sel.sum() > 0:
                results[f"OU25-marche|{w}"] = metrics_binary(p_mkt[sel], y_over25[sel])

    # ---- affichage ----
    print("\n================ RÉSULTATS 1X2 ================")
    print(f"{'modèle':<28}{'fenêtre':<20}{'n':>7}{'acc':>8}{'logloss':>9}{'brier':>8}{'RPS':>8}{'E[nul]':>8}")
    for tag, m in results.items():
        if "OU25" in tag or "BTTS" in tag:
            continue
        name, w = tag.rsplit("|", 1)
        print(f"{name:<28}{w:<20}{int(m['acc']*0 + len([1]))*0 or '':<0}"
              f"{m.get('n', ''):>7}{m['acc']:>8.4f}{m['logloss']:>9.4f}{m['brier']:>8.4f}"
              f"{m['rps']:>8.4f}{m['draw_pred']:>8.3f}")

    print("\n================ MARCHÉS DE BUTS ================")
    for tag, m in results.items():
        if "OU25" in tag or "BTTS" in tag:
            name, w = tag.rsplit("|", 1)
            print(f"{name:<28}{w:<20}{'':>7}{m['acc']:>8.4f}{m['logloss']:>9.4f}{m['brier']:>8.4f}")

    # taux de nuls réel
    for w in ["TRAIN 2010-22", "VALIDATION 2022-24", "TEST 2024-26"]:
        m = wmask == w
        print(f"\n{w}: taux réel H/D/A = "
              f"{np.mean(y[m]==0):.3f}/{np.mean(y[m]==1):.3f}/{np.mean(y[m]==2):.3f}"
              f" | matchs={m.sum()} | buts/match={tot_goals[m].mean():.3f}")

    # par ligue (test)
    print("\n================ PAR LIGUE (fenêtres VAL+TEST) ================")
    m = wmask != "TRAIN 2010-22"
    for lg in CORE:
        lm = m & (leagues == lg)
        if lm.sum() == 0:
            continue
        r = metrics_1x2(res["probs"][lm], y[lm])
        rr = metrics_1x2(res["probs"][lm & mkt_ok], y[lm & mkt_ok]) if (lm & mkt_ok).sum() else None
        mm = metrics_1x2(mkt[lm & mkt_ok], y[lm & mkt_ok]) if (lm & mkt_ok).sum() else None
        print(f"{LEAGUE_NAMES[lg]:<16} n={lm.sum():>5} | modèle acc={r['acc']:.4f} "
              f"ll={r['logloss']:.4f} | marché acc={mm['acc']:.4f} ll={mm['logloss']:.4f}"
              if mm else f"{LEAGUE_NAMES[lg]:<16} n={lm.sum():>5} | modèle acc={r['acc']:.4f} ll={r['logloss']:.4f}")

    out = {
        "n_matches": len(rows),
        "results": {k: v for k, v in results.items()},
        "by_league_val_test": {
            LEAGUE_NAMES[lg]: metrics_1x2(res["probs"][(wmask != "TRAIN 2010-22") & (leagues == lg)],
                                          y[(wmask != "TRAIN 2010-22") & (leagues == lg)])
            for lg in CORE
        },
    }
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "baseline_results.json"), "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nSauvé : baseline_results.json | total {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
