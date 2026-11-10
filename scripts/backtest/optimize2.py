#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Optimisation v2 + analyses complémentaires
#   1. Elo GLOBAL corrigé (zéro fuite : diff enregistré AVANT la
#      mise à jour par le résultat du match courant) ;
#   2. descente coordonnée COMPLÈTE avec Elo global comme source ;
#   3. effet des moyennes par ligue (impl. #2) sur 1X2 ET O/U 2.5/BTTS ;
#   4. simulation value-bets (seuils d'edge 2→15 %, ROI flat) ;
#   5. calibration par buckets + table par saison (matériel du rapport).
# ============================================================
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date as date_cls

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from voltrix_foot import (EngineParams, compute_features, elo_diffs, load_league_season,
                          market_probs_1x2, metrics_1x2, metrics_binary, run_engine,
                          previous_season_avgs)

CORE = ["E0", "E1", "SP1", "D1", "I1", "F1"]
SEASONS_ALL = [f"{y:02d}{(y+1)%100:02d}" for y in range(9, 26)]
EVAL_FROM = "1011"
TRAIN_END, VAL_END = "2122", "2324"

# ------------------------------------------------------------
# Elo GLOBAL corrigé — diff AVANT mise à jour (zéro fuite)
# ------------------------------------------------------------

_LEAGUE_HIST: dict[str, list] = {}   # ligue -> tous les matchs triés par date
_POS_INDEX: dict = {}                # (ligue, saison, date, dom, ext) -> [index rows]

def _league_hist(league: str) -> list:
    if league not in _LEAGUE_HIST:
        ms = []
        for season in SEASONS_ALL:
            ms.extend(load_league_season(league, season))
        _LEAGUE_HIST[league] = sorted(ms, key=lambda m: m["date"])
    return _LEAGUE_HIST[league]

def build_pos_index(rows: list[dict]):
    if _POS_INDEX:
        return
    for i, r in enumerate(rows):
        _POS_INDEX.setdefault((r["league"], r["season"], r["date"], r["home"], r["away"]), []).append(i)

def global_elo_diffs(rows: list[dict], k_factor: float, home_adv: float,
                     decay: float | None = None) -> np.ndarray:
    """Elo global par ligue, mémoire continue inter-saisons.
    decay : facteur de rappel vers 1500 entre saisons (None = aucun)."""
    build_pos_index(rows)
    out = np.full(len(rows), np.nan)
    for league in CORE:
        ratings: dict[str, float] = {}
        last_season = None
        for m in _league_hist(league):
            if decay is not None and m["season"] != last_season and last_season is not None:
                for t in ratings:
                    ratings[t] = 1500.0 + (ratings[t] - 1500.0) * decay
            last_season = m["season"]
            rh, ra = ratings.get(m["home"], 1500.0), ratings.get(m["away"], 1500.0)
            # ⚠️ diff enregistré AVANT la mise à jour (le match ne se prédit pas lui-même)
            for i in _POS_INDEX.get((league, m["season"], m["date"], m["home"], m["away"]), []):
                out[i] = rh - ra
            exp_h = 1.0 / (1.0 + 10 ** ((ra - home_adv - rh) / 400.0))
            act = 1.0 if m["hg"] > m["ag"] else (0.5 if m["hg"] == m["ag"] else 0.0)
            delta = k_factor * (act - exp_h)
            ratings[m["home"]], ratings[m["away"]] = rh + delta, ra - delta
    assert not np.isnan(out).any(), "matchs sans Elo global — incohérence d'indexation"
    return out

# ------------------------------------------------------------
# Descente coordonnée (source d'Elo paramétrable)
# ------------------------------------------------------------

def evaluate(rows, y, m_val, params, ediff):
    res = run_engine(rows, params, ediff)
    return metrics_1x2(res["probs"][m_val], y[m_val]), res

GROUPS: list[tuple[str, list[dict]]] = [
    ("blend", [dict(w_poisson=wp, w_elo=we, w_form=round(1 - wp - we, 2))
               for wp in (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65)
               for we in (0.15, 0.20, 0.25, 0.30, 0.35, 0.40)
               if 0.10 <= 1 - wp - we <= 0.45]),
    ("elo", [dict(k_factor=k, home_adv_elo=a)
             for k in (10, 14, 18, 22, 26, 30, 40) for a in (40, 50, 65, 80, 95, 110)]),
    ("nul-elo", [dict(elo_draw_base=b, elo_draw_slope=s)
                 for b in (0.26, 0.28, 0.30, 0.32, 0.34, 0.36) for s in (0.7, 1.0, 1.4, 1.8)]),
    ("nul-forme", [dict(form_draw_base=b, form_draw_slope=s)
                   for b in (0.24, 0.26, 0.28, 0.30, 0.32) for s in (0.6, 0.9, 1.2, 1.6)]),
    ("shrinkage", [dict(shrink_k=k) for k in (4, 6, 8, 10, 14, 18, 24)]),
    ("rho-bivarie", [dict(rho=r) for r in (0.0, 0.05, 0.10, 0.15, 0.20)]),
    ("injection-forme", [dict(form_elo_scale=sc, form_factor_span=sp)
                         for sc in (110, 140, 170, 200, 240)
                         for sp in (0.10, 0.15, 0.20, 0.25)]),
    ("redistribution-elo", [dict(elo_factor_div=d) for d in (500, 600, 800, 1000, 1200)]),
    ("moyennes-ligue", [dict(per_league_avgs=False), dict(per_league_avgs=True)]),
    ("bornes-lambda", [dict(lam_home_bounds=h, lam_away_bounds=a)
                       for h, a in (((0.3, 3.8), (0.25, 3.4)),
                                    ((0.25, 4.4), (0.20, 4.0)),
                                    ((0.35, 3.4), (0.30, 3.0)),
                                    ((0.2, 5.0), (0.15, 4.6)))]),
    ("fatigue-derby", [dict(fatigue_factor=f, derby_factor=d)
                       for f in (1.00, 0.94) for d in (1.00, 0.92, 0.88)]),
]

def coord_descent(rows, y, m_val, params, ediff_fn, label, max_passes=2):
    print(f"\n===== Descente coordonnée [{label}] =====")
    ediff = ediff_fn(params)
    cur, _ = evaluate(rows, y, m_val, params, ediff)
    print(f"départ : VAL ll={cur['logloss']:.4f} acc={cur['acc']:.4f} E[nul]={cur['draw_pred']:.3f}")
    log = []
    for pass_i in range(1, max_passes + 1):
        improved = False
        for gname, variants in GROUPS:
            best_ll, best_v, best_m = cur["logloss"], None, None
            for v in variants:
                trial = EngineParams(**{**params.__dict__, **v})
                if "k_factor" in v or "home_adv_elo" in v:
                    ed = ediff_fn(trial)
                else:
                    ed = ediff
                mv, _ = evaluate(rows, y, m_val, trial, ed)
                if mv["logloss"] < best_ll - 1e-6:
                    best_ll, best_v, best_m = mv["logloss"], v, mv
            if best_v is not None:
                if "k_factor" in best_v or "home_adv_elo" in best_v:
                    ediff = ediff_fn(EngineParams(**{**params.__dict__, **best_v}))
                params = EngineParams(**{**params.__dict__, **best_v})
                cur = best_m
                improved = True
                print(f"  P{pass_i} {gname:<20} → {best_v} | ll={best_ll:.4f} "
                      f"acc={best_m['acc']:.4f} E[nul]={best_m['draw_pred']:.3f}")
                log.append({"passe": pass_i, "groupe": gname, "choix": best_v, "val_logloss": best_ll})
        if not improved:
            print("  convergence")
            break
    return params, ediff, log

# ------------------------------------------------------------
# Value bets : simulation ROI à seuils d'edge variés
# ------------------------------------------------------------

def valuebet_sim(probs, y, odds_h, odds_d, odds_a, mask, thresholds):
    """Pari plat 1u quand edge = p×cote − 1 > seuil (logique exacte de
    buildValueBets : cotes B365, probas BRUTES du modèle)."""
    odds = np.stack([odds_h, odds_d, odds_a], axis=1)
    valid = mask & np.isfinite(odds).all(axis=1) & (odds > 1.01).all(axis=1)
    out = {}
    for t in thresholds:
        edges = np.where(valid[:, None], probs * odds - 1.0, np.nan)
        sel = valid[:, None] & (edges > t)
        n_bets = int(sel.sum())
        if n_bets == 0:
            out[t] = {"n": 0}
            continue
        stakes = n_bets
        rets = 0.0
        hits = 0
        for o in range(3):
            m = sel[:, o]
            if m.sum() == 0:
                continue
            won = (y[m] == o)
            rets += (odds[m, o] * won).sum()
            hits += int(won.sum())
        out[round(t, 2)] = {
            "n": n_bets, "hit_rate": hits / n_bets,
            "roi": (rets - stakes) / stakes, "profit": rets - stakes,
            "avg_odds": float((odds[sel]).mean()),
        }
    return out

# ------------------------------------------------------------
# Calibration par buckets (proba max annoncée vs réalisée)
# ------------------------------------------------------------

def calibration_table(probs, y, mask, edges=(0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01)):
    p = probs[mask]
    yy = y[mask]
    pmax = p.max(axis=1)
    arg = p.argmax(axis=1)
    hit = (arg == yy).astype(float)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (pmax >= lo) & (pmax < hi)
        if m.sum() < 30:
            continue
        rows.append({"bucket": f"{lo:.1f}–{hi:.1f}", "n": int(m.sum()),
                     "annonce": float(pmax[m].mean()), "reel": float(hit[m].mean())})
    return rows

# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

def main():
    t0 = time.time()
    rows = compute_features(CORE, SEASONS_ALL, EVAL_FROM)
    y = np.array([r["y"] for r in rows])
    seasons = np.array([r["season"] for r in rows])
    leagues = np.array([r["league"] for r in rows])
    m_train = seasons <= TRAIN_END
    m_val = (seasons > TRAIN_END) & (seasons <= VAL_END)
    m_test = seasons > VAL_END
    m_vt = m_val | m_test
    tot_goals = np.array([r["hg"] + r["ag"] for r in rows])
    y_over25 = (tot_goals >= 3).astype(int)
    y_btts = np.array([1 if (r["hg"] >= 1 and r["ag"] >= 1) else 0 for r in rows])
    odds_h = np.array([r["b365h"] for r in rows])
    odds_d = np.array([r["b365d"] for r in rows])
    odds_a = np.array([r["b365a"] for r in rows])
    ou_o = np.array([r["b365_over25"] for r in rows])
    ou_u = np.array([r["b365_under25"] for r in rows])
    print(f"{len(rows)} matchs | VAL {m_val.sum()} | TEST {m_test.sum()} | "
          f"{time.time()-t0:.0f}s")

    # ---- 1. Elo global HONNÊTE (fuite corrigée), constantes as-built ----
    print("\n----- Elo global corrigé, grille K×ADV (VAL) -----")
    glob_cache = {}
    def glob_ediff_factory():
        def f(params):
            key = (round(params.k_factor, 3), round(params.home_adv_elo, 3))
            if key not in glob_cache:
                glob_cache[key] = global_elo_diffs(rows, params.k_factor, params.home_adv_elo)
            return glob_cache[key]
        return f
    gf = glob_ediff_factory()
    base = EngineParams()
    best = (9.9, None, None)
    for K in (14, 18, 22, 26, 30):
        for A in (40, 50, 65, 80, 95):
            trial = EngineParams(**{**base.__dict__, "k_factor": K, "home_adv_elo": A})
            mv, _ = evaluate(rows, y, m_val, trial, gf(trial))
            if mv["logloss"] < best[0]:
                best = (mv["logloss"], K, A)
            print(f"  K={K:>2} ADV={A:>3}: VAL ll={mv['logloss']:.4f} acc={mv['acc']:.4f}")
    ll0, K0, A0 = best
    print(f"  → meilleur Elo global as-built: K={K0} ADV={A0} ll={ll0:.4f}")

    # ---- 2. Descente coordonnée complète avec Elo global ----
    params_glob = EngineParams(k_factor=K0, home_adv_elo=A0)
    params_glob, ediff_glob, log_glob = coord_descent(
        rows, y, m_val, params_glob, gf, "Elo global + constantes")

    # ---- 3. Constantes optimisées LOCALES : réutilisation du résultat de
    #         optimize.py (descente déjà effectuée) — pas de recalcul ----
    params_loc = EngineParams(
        k_factor=14, home_adv_elo=95, w_poisson=0.50, w_elo=0.30, w_form=0.20,
        elo_draw_base=0.34, elo_draw_slope=0.7, form_draw_base=0.32, form_draw_slope=0.6,
        lam_home_bounds=(0.25, 4.4), lam_away_bounds=(0.20, 4.0),
        fatigue_factor=1.0, derby_factor=0.88)
    ediff_loc = elo_diffs(rows, params_loc.k_factor, params_loc.home_adv_elo)

    # ---- Évaluations finales croisées (TEST touché ici, une fois) ----
    print("\n================ ÉVALUATION FINALE (TEST 2024-26) ================")
    res_base = run_engine(rows, EngineParams(), elo_diffs(rows, 22.0, 65.0))
    res_loc = run_engine(rows, params_loc, ediff_loc)
    res_glob = run_engine(rows, params_glob, ediff_glob)
    mkt, mkt_ok = market_probs_1x2(rows)

    final = {}
    for name, res in (("as-built (local)", res_base),
                      ("opt-local", res_loc),
                      ("opt-global", res_glob)):
        for wname, m in (("TRAIN", m_train), ("VAL", m_val), ("TEST", m_test)):
            mm = metrics_1x2(res["probs"][m], y[m])
            final[f"{name}|{wname}"] = mm
            print(f"{name:<16} {wname:<6} acc={mm['acc']:.4f} ll={mm['logloss']:.4f} "
                  f"brier={mm['brier']:.4f} RPS={mm['rps']:.4f} E[nul]={mm['draw_pred']:.3f}")
    for wname, m in (("VAL", m_val), ("TEST", m_test)):
        mm = metrics_1x2(mkt[m & mkt_ok], y[m & mkt_ok])
        final[f"marche-B365|{wname}"] = mm
        print(f"{'marche-B365':<16} {wname:<6} acc={mm['acc']:.4f} ll={mm['logloss']:.4f} "
              f"brier={mm['brier']:.4f} RPS={mm['rps']:.4f} E[nul]={mm['draw_pred']:.3f}")

    # hybride 65 % marché + 35 % modèle (comme l'affichage risk-profile de l'app)
    hybrid = 0.65 * np.where(mkt_ok[:, None], mkt, np.nan) + 0.35 * res_glob["probs"]
    ok = mkt_ok & np.isfinite(hybrid).all(axis=1)
    hybrid = np.nan_to_num(hybrid)
    hybrid /= hybrid.sum(axis=1, keepdims=True)
    for wname, m in (("VAL", m_val & ok), ("TEST", m_test & ok)):
        mm = metrics_1x2(hybrid[m], y[m])
        final[f"hybride-65/35|{wname}"] = mm
        print(f"{'hybride 65/35':<16} {wname:<6} acc={mm['acc']:.4f} ll={mm['logloss']:.4f} "
              f"RPS={mm['rps']:.4f}")

    # ---- 4. Moyennes par ligue : effet 1X2 + O/U 2.5 + BTTS (opt-global) ----
    print("\n----- Moyennes par ligue (impl. #2) : effet sur tous les marchés -----")
    p_noleague = EngineParams(**{**params_glob.__dict__, "per_league_avgs": False})
    p_league = EngineParams(**{**params_glob.__dict__, "per_league_avgs": True})
    r_nl = run_engine(rows, p_noleague, ediff_glob)
    r_lg = run_engine(rows, p_league, ediff_glob)
    ou_valid = m_vt & np.isfinite(ou_o) & np.isfinite(ou_u) & (ou_o > 1.01) & (ou_u > 1.01)
    for name, r in (("global 1.52/1.22", r_nl), ("par ligue (S-1)", r_lg)):
        m1 = metrics_1x2(r["probs"][m_vt], y[m_vt])
        mo = metrics_binary(r["over25"][m_vt], y_over25[m_vt])
        mb = metrics_binary(r["btts"][m_vt], y_btts[m_vt])
        print(f"  {name:<20} 1X2 ll={m1['logloss']:.4f} acc={m1['acc']:.4f} | "
              f"OU2.5 acc={mo['acc']:.4f} ll={mo['logloss']:.4f} | "
              f"BTTS acc={mb['acc']:.4f} ll={mb['logloss']:.4f}")
    # marché OU 2.5 pour référence
    if ou_valid.sum():
        inv_sum = 1 / ou_o + 1 / ou_u
        p_mkt_ou = (1 / ou_o) / inv_sum
        sel = ou_valid & (inv_sum > 1.001) & (inv_sum < 1.3)
        mo = metrics_binary(p_mkt_ou[sel], y_over25[sel])
        print(f"  {'marché OU2.5 B365':<20} {'':>22} OU2.5 acc={mo['acc']:.4f} ll={mo['logloss']:.4f}")

    # ---- 5. Value bets (seuils) sur VAL+TEST, opt-global brut ----
    print("\n----- Value bets 1X2 : ROI à seuils d'edge (VAL+TEST, mise plate 1u) -----")
    vb = valuebet_sim(res_glob["probs"], y, odds_h, odds_d, odds_a, m_vt,
                      (0.02, 0.03, 0.05, 0.08, 0.10, 0.15, 0.20))
    for t, v in vb.items():
        if v.get("n"):
            print(f"  seuil {t:>4}: {v['n']:>5} paris | réussite {v['hit_rate']:.3f} | "
                  f"ROI {v['roi']:+.4f} | cote moy {v['avg_odds']:.2f}")
    # value bets sur O/U 2.5 (même logique)
    p_over_model = r_lg["over25"] if p_league.per_league_avgs else r_nl["over25"]
    sel = ou_valid & (np.abs((1/ou_o + 1/ou_u) - 1) < 0.15)
    print("  — O/U 2.5 (proba over du modèle vs cote over B365) —")
    for t in (0.02, 0.05, 0.08, 0.12):
        edge = p_over_model * ou_o - 1.0
        edge_u = (1 - p_over_model) * ou_u - 1.0
        bets_o = sel & (edge > t)
        bets_u = sel & (edge_u > t)
        n = int(bets_o.sum() + bets_u.sum())
        if n == 0:
            print(f"  seuil {t:>4}: 0 pari")
            continue
        ret = (ou_o[bets_o] * y_over25[bets_o]).sum() + \
              (ou_u[bets_u] * (1 - y_over25[bets_u])).sum()
        hits = int(y_over25[bets_o].sum() + (1 - y_over25[bets_u]).sum())
        print(f"  seuil {t:>4}: {n:>5} paris | réussite {hits/n:.3f} | ROI {(ret-n)/n:+.4f}")

    # ---- 6. Calibration + table par saison (matériel rapport) ----
    cal_glob = calibration_table(res_glob["probs"], y, m_test)
    print("\n----- Calibration (TEST, opt-global) -----")
    for c in cal_glob:
        print(f"  {c['bucket']}: n={c['n']:>5} annoncé={c['annonce']:.3f} réalisé={c['reel']:.3f}")

    per_season = {}
    for s in sorted(set(seasons)):
        m = seasons == s
        if not m.any() or s <= TRAIN_END:
            continue
        a = metrics_1x2(res_base["probs"][m], y[m])
        b = metrics_1x2(res_glob["probs"][m], y[m])
        c = metrics_1x2(mkt[m & mkt_ok], y[m & mkt_ok]) if (m & mkt_ok).sum() else None
        per_season[s] = {"asbuilt": a, "optglobal": b, "marche": c}

    # moyennes de buts réelles par ligue (dernière saison complète) → league-params.ts
    league_params = {}
    for lg in CORE + ["E2", "E3", "EC", "SC0", "SC1", "SP2", "I2", "D2", "F2",
                      "N1", "B1", "P1", "T1", "G1"]:
        avgs = previous_season_avgs(lg, "2526") or previous_season_avgs(lg, "2425")
        if avgs:
            league_params[lg] = {"home": round(avgs[0], 3), "away": round(avgs[1], 3),
                                 "total": round(avgs[0] + avgs[1], 3)}
    print("\n----- Moyennes 2025-26 par ligue (league-params.ts) -----")
    for lg, v in league_params.items():
        print(f"  {lg}: dom {v['home']} / ext {v['away']} (total {v['total']})")

    out = {
        "config": {"ligues": CORE, "saisons": f"{EVAL_FROM}→2526", "n": len(rows),
                   "train_fin": TRAIN_END, "val_fin": VAL_END},
        "elo_global_init": {"k": K0, "adv": A0, "val_logloss": ll0},
        "params_opt_global": params_glob.__dict__,
        "params_opt_local": params_loc.__dict__,
        "progression_global": log_glob,
        "progression_local": "voir optimize.py (descente locale)",
        "evaluation_finale": final,
        "valuebets_1x2": {str(k): v for k, v in vb.items()},
        "calibration_test_optglobal": cal_glob,
        "par_saison": per_season,
        "league_params": league_params,
    }
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "optimisation_v2.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    np.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "probs_optglobal.npy"),
            res_glob["probs"])
    print(f"\nSauvé : {dest} | total {time.time()-t0:.0f}s")
    print("\nPARAMS OPT-GLOBAL :")
    for k, v in params_glob.__dict__.items():
        print(f"  {k} = {v}")

if __name__ == "__main__":
    main()
