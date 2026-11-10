#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Grid-search des constantes du moteur foot
# Méthode : descente coordonnée par groupes (grilles grossières,
#   2 passes max) sur la fenêtre VALIDATION 2022-24 (log-loss 1X2).
#   Anti-surapprentissage : grilles rares, TRAIN surveillé, TEST
#   touché UNE SEULE FOIS à la fin.
# Variantes structurelles testées : moyennes par ligue (impl. #2),
#   ρ du Poisson bivarié, Elo GLOBAL vs Elo local (quantification).
# Sorties : constantes-optimisees.json + tableaux de progression.
# ============================================================
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from voltrix_foot import (EngineParams, compute_features, elo_diffs, market_probs_1x2,
                          metrics_1x2, run_engine)

CORE = ["E0", "E1", "SP1", "D1", "I1", "F1"]
SEASONS_ALL = [f"{y:02d}{(y+1)%100:02d}" for y in range(9, 26)]
EVAL_FROM = "1011"
TRAIN_END, VAL_END = "2122", "2324"

def build():
    rows = compute_features(CORE, SEASONS_ALL, EVAL_FROM)
    y = np.array([r["y"] for r in rows])
    seasons = np.array([r["season"] for r in rows])
    m_train = np.array([s <= TRAIN_END for s in seasons])
    m_val = np.array([TRAIN_END < s <= VAL_END for s in seasons])
    m_test = np.array([s > VAL_END for s in seasons])
    return rows, y, m_train, m_val, m_test

# ---- Elo global (variante structurelle) : ratings portés par toute la ligue
def global_elo_diffs(rows, k_factor, home_adv, reset_each_season=False):
    """Elo GLOBAL par ligue (toutes équipes interconnectées), mémoire
    inter-saisons continue. Quantifie l'écart vs l'Elo local de l'app."""
    league_states: dict[str, dict[str, float]] = {}
    out = np.empty(len(rows))
    # marche chronologique : historique complet par ligue
    by_league: dict[str, list] = {}
    for league in CORE:
        ms = []
        for season in SEASONS_ALL:
            ms.extend(_hist(league, season))
        by_league[league] = sorted(ms, key=lambda m: m["date"])
    # associer chaque row à sa position dans la marche
    pos = {(r["league"], r["season"], r["date"], r["home"], r["away"]): i
           for i, r in enumerate(rows)}
    for league in CORE:
        ratings: dict[str, float] = {}
        last_season = None
        for m in by_league[league]:
            if reset_each_season and m["season"] != last_season:
                ratings = {}
            last_season = m["season"]
            rh, ra = ratings.get(m["home"], 1500.0), ratings.get(m["away"], 1500.0)
            exp_h = 1.0 / (1.0 + 10 ** ((ra - home_adv - rh) / 400.0))
            act = 1.0 if m["hg"] > m["ag"] else (0.5 if m["hg"] == m["ag"] else 0.0)
            delta = k_factor * (act - exp_h)
            ratings[m["home"]], ratings[m["away"]] = rh + delta, ra - delta
            i = pos.get((league, m["season"], m["date"], m["home"], m["away"]))
            if i is not None:
                out[i] = ratings[m["home"]] - ratings[m["away"]]
    return out

_HIST_CACHE: dict = {}
def _hist(league, season):
    k = (league, season)
    if k not in _HIST_CACHE:
        from voltrix_foot import load_league_season
        _HIST_CACHE[k] = load_league_season(league, season)
    return _HIST_CACHE[k]

# ---- descente coordonnée ----
def evaluate(rows, y, m_val, params, elo_override=None):
    ed = elo_override if elo_override is not None else \
        elo_diffs(rows, params.k_factor, params.home_adv_elo)
    res = run_engine(rows, params, ed)
    return metrics_1x2(res["probs"][m_val], y[m_val]), res, ed

GROUPS: list[tuple[str, list[dict]]] = [
    ("blend", [dict(w_poisson=wp, w_elo=we, w_form=round(1 - wp - we, 2))
               for wp in (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60)
               for we in (0.15, 0.20, 0.25, 0.30, 0.35, 0.40)
               if 0.10 <= 1 - wp - we <= 0.45]),
    ("elo", [dict(k_factor=k, home_adv_elo=a)
             for k in (14, 18, 22, 26, 30, 34) for a in (40, 50, 65, 80, 95)]),
    ("nul-elo", [dict(elo_draw_base=b, elo_draw_slope=s)
                 for b in (0.26, 0.28, 0.30, 0.32, 0.34) for s in (0.7, 1.0, 1.4, 1.8, 2.2)]),
    ("nul-forme", [dict(form_draw_base=b, form_draw_slope=s)
                   for b in (0.24, 0.26, 0.28, 0.30, 0.32) for s in (0.6, 0.9, 1.2, 1.6, 2.0)]),
    ("shrinkage", [dict(shrink_k=k) for k in (4, 6, 8, 10, 14, 18, 24)]),
    ("rho-bivarie", [dict(rho=r) for r in (0.0, 0.05, 0.10, 0.15, 0.20, 0.25)]),
    ("injection-forme", [dict(form_elo_scale=sc, form_factor_span=sp)
                         for sc in (110, 140, 170, 200, 240)
                         for sp in (0.10, 0.15, 0.20, 0.25, 0.30)]),
    ("redistribution-elo", [dict(elo_factor_div=d) for d in (500, 600, 800, 1000, 1200, 1500)]),
    ("moyennes-ligue", [dict(per_league_avgs=False), dict(per_league_avgs=True)]),
    ("bornes-lambda", [dict(lam_home_bounds=h, lam_away_bounds=a)
                       for h, a in (( (0.3, 3.8), (0.25, 3.4)),   # as-built
                                    ((0.25, 4.4), (0.20, 4.0)),
                                    ((0.35, 3.4), (0.30, 3.0)),
                                    ((0.2, 5.0), (0.15, 4.6)) )]),
    ("fatigue-derby", [dict(fatigue_factor=f, derby_factor=d)
                       for f in (1.00, 0.94, 0.90) for d in (1.00, 0.92, 0.88)]),
]

def main():
    t0 = time.time()
    rows, y, m_train, m_val, m_test = build()
    print(f"{len(rows)} matchs | VAL n={m_val.sum()} | TEST n={m_test.sum()}")

    params = EngineParams()  # départ = as-built
    log = []

    cur_val, _, _ = evaluate(rows, y, m_val, params)
    print(f"départ as-built : VAL logloss={cur_val['logloss']:.4f} acc={cur_val['acc']:.4f} "
          f"RPS={cur_val['rps']:.4f} E[nul]={cur_val['draw_pred']:.3f}")

    for pass_i in (1, 2):
        print(f"\n----- PASSE {pass_i} -----")
        improved_any = False
        for gname, variants in GROUPS:
            best_ll, best_v, best_tag = cur_val["logloss"], None, "inchangé"
            for v in variants:
                trial = EngineParams(**{**params.__dict__, **v})
                mv, _, _ = evaluate(rows, y, m_val, trial)
                if mv["logloss"] < best_ll - 1e-6:
                    best_ll, best_v, best_tag = mv["logloss"], v, mv
            if best_v is not None:
                params = EngineParams(**{**params.__dict__, **best_v})
                cur_val = best_tag
                improved_any = True
                print(f"  {gname:<20} → {best_v} | VAL ll={best_ll:.4f} acc={best_tag['acc']:.4f} "
                      f"E[nul]={best_tag['draw_pred']:.3f}")
                log.append({"passe": pass_i, "groupe": gname, "choix": best_v,
                            "val_logloss": best_ll})
            else:
                print(f"  {gname:<20} → inchangé (ll={cur_val['logloss']:.4f})")
        if not improved_any:
            print("convergence : aucun groupe n'améliore → arrêt")
            break

    # ---- évaluation finale : TRAIN / VAL / TEST, as-built vs optimisé ----
    print("\n================ ÉVALUATION FINALE ================")
    ediff_opt = elo_diffs(rows, params.k_factor, params.home_adv_elo)
    res_opt = run_engine(rows, params, ediff_opt)
    res_base = run_engine(rows, EngineParams(), elo_diffs(rows, 22.0, 65.0))

    final = {}
    for name, res in (("as-built", res_base), ("optimisé", res_opt)):
        for wname, m in (("TRAIN", m_train), ("VALIDATION", m_val), ("TEST", m_test)):
            final[f"{name}|{wname}"] = metrics_1x2(res["probs"][m], y[m])
            print(f"{name:<10} {wname:<12} acc={final[f'{name}|{wname}']['acc']:.4f} "
                  f"ll={final[f'{name}|{wname}']['logloss']:.4f} "
                  f"brier={final[f'{name}|{wname}']['brier']:.4f} "
                  f"RPS={final[f'{name}|{wname}']['rps']:.4f} "
                  f"E[nul]={final[f'{name}|{wname}']['draw_pred']:.3f}")

    # ---- variante structurelle : Elo global ----
    print("\n----- Variante Elo GLOBAL (quantification de l'écart) -----")
    for K, A in ((22, 65), (params.k_factor, params.home_adv_elo)):
        gdiff = global_elo_diffs(rows, K, A)
        p2 = EngineParams(**{**params.__dict__, "k_factor": K, "home_adv_elo": A})
        r2 = run_engine(rows, p2, gdiff)
        mv = metrics_1x2(r2["probs"][m_val], y[m_val])
        mt = metrics_1x2(r2["probs"][m_test], y[m_test])
        print(f"  Elo global K={K} ADV={A}: VAL ll={mv['logloss']:.4f} acc={mv['acc']:.4f} | "
              f"TEST ll={mt['logloss']:.4f} acc={mt['acc']:.4f}")
        final[f"elo-global-K{K}-A{A}|VALIDATION"] = mv
        final[f"elo-global-K{K}-A{A}|TEST"] = mt

    out = {
        "params_optimises": params.__dict__,
        "progression": log,
        "evaluation_finale": final,
        "config": {"train_end": TRAIN_END, "val_end": VAL_END,
                   "ligues": CORE, "saisons": f"{EVAL_FROM}→2526", "n": len(rows)},
    }
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "constant_search.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"\nSauvé : {dest} | {time.time()-t0:.1f}s")
    print("\nConstantes optimisées :")
    for k, v in params.__dict__.items():
        print(f"  {k} = {v}")

if __name__ == "__main__":
    main()
