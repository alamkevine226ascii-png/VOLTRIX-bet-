#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Réplication Python EXACTE du moteur foot
# (src/lib/foot/prediction.ts + montecarlo.ts) pour backtest
# hors-ligne sur les CSV football-data.co.uk.
#
# Fidélité de la réplication (vérifiée ligne à ligne sur prediction.ts) :
#   - fenêtre de données : [saison-1, saison] DANS LA MÊME LIGUE
#     (comme fetchTeamSchedule par ligue ; équipe promue = saison
#     courante seule) — zéro fuite : uniquement les matchs datés
#     STRICTEMENT AVANT le match prédit ;
#   - Elo LOCAL tel qu'implémenté dans l'app (computeElo parcourt
#     l'union des 2 calendriers : seules les 2 équipes accumulent un
#     rating, les adversaires partent de 1500) — répliqué à
#     l'identique, y compris la mémoire des confrontations directes ;
#   - shrinkage SHRINK_K=10, pondération contexte w=gp/(gp+6),
#     ratio global normalisé sur gp (saison courante) comme l'app ;
#   - sémantique de repli « combine » : ratio contexte absent →
#     ratio global seul (pas de mélange avec 1) ;
#   - modificateurs : fatigue ×0.94 (≤3 j de repos OU ≥3 matchs/14 j),
#     derby ×0.92 (paires de l'app, noms football-data), blessures
#     NEUTRES (données indisponibles — facteur 1), altitude dormante
#     (Europe), météo hors λ (audit 21-b) ;
#   - injection forme ×(0.9 + 0.2·f), redistribution Elo 10^(diff/800)
#     à total conservé, bornes λ [0.3,3.8]/[0.25,3.4], arrondi 2 déc. ;
#   - composante Poisson = grille bivariée exacte (ρ, λ3 partagé) ;
#   - eloToProbs / formToProbs / blend 45-30-25 — formules identiques.
# ============================================================
from __future__ import annotations

import csv
import math
import os
from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date as date_cls

import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# ------------------------------------------------------------
# Constantes du moteur — valeurs « as-built » (v2.1, nov. 2026)
# ------------------------------------------------------------

@dataclass
class EngineParams:
    # Références de ligue (globales si per_league_avgs=False)
    league_avg_home: float = 1.52
    league_avg_away: float = 1.22
    per_league_avgs: bool = False          # moyennes saison précédente par ligue
    # Shrinkage / pondération contexte
    shrink_k: float = 10.0
    ctx_weight_div: float = 6.0            # w = gp/(gp+div)
    # Elo
    k_factor: float = 22.0
    home_adv_elo: float = 65.0
    elo_factor_div: float = 800.0          # redistribution 10^(diff/div)
    elo_diff_cap: float = 250.0
    # Forme
    form_elo_scale: float = 170.0          # diff forme -> points Elo équivalents
    form_factor_lo: float = 0.9            # ×(lo + span·f)
    form_factor_span: float = 0.2
    # Contexte (λ)
    fatigue_factor: float = 0.94
    derby_factor: float = 0.92
    lam_home_bounds: tuple = (0.3, 3.8)
    lam_away_bounds: tuple = (0.25, 3.4)
    # Blend
    w_poisson: float = 0.45
    w_elo: float = 0.30
    w_form: float = 0.25
    # Parts de nul (eloToProbs / formToProbs)
    elo_draw_base: float = 0.30
    elo_draw_slope: float = 1.4
    form_draw_base: float = 0.28
    form_draw_slope: float = 1.2
    # Poisson bivarié
    rho: float = 0.10
    grid_max: int = 12

# ------------------------------------------------------------
# Chargement CSV football-data.co.uk
# ------------------------------------------------------------

def parse_fd_date(s: str, season: str) -> date_cls | None:
    """dd/mm/yyyy ou dd/mm/yy, borné à la saison (juillet S → juillet S+1)."""
    s = (s or "").strip()
    if len(s) < 8 or s[2] != "/" or s[5] != "/":
        return None
    try:
        dd, mm = int(s[0:2]), int(s[3:5])
        yy = int(s[6:10]) if len(s) == 10 else 2000 + int(s[6:8])
        d = date_cls(yy, mm, dd)
    except ValueError:
        return None
    y0 = 2000 + int(season[:2])
    lo, hi = date_cls(y0, 7, 1), date_cls(y0 + 1, 7, 31)
    return d if lo <= d <= hi else None

def _f(v) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else float("nan")
    except (TypeError, ValueError):
        return float("nan")

def load_league_season(league: str, season: str) -> list[dict]:
    path = os.path.join(DATA_DIR, f"{league}_{season}.csv")
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="latin-1") as f:
        for r in csv.DictReader(f):
            if not r.get("HomeTeam") or not r.get("AwayTeam"):
                continue
            hg, ag = _f(r.get("FTHG")), _f(r.get("FTAG"))
            d = parse_fd_date(r.get("Date", ""), season)
            if hg < 0 or ag < 0 or d is None:
                continue
            out.append({
                "league": league, "season": season, "date": d,
                "home": r["HomeTeam"].strip(), "away": r["AwayTeam"].strip(),
                "hg": int(hg), "ag": int(ag),
                "b365h": _f(r.get("B365H")), "b365d": _f(r.get("B365D")),
                "b365a": _f(r.get("B365A")),
                "b365_over25": _f(r.get("B365>2.5")), "b365_under25": _f(r.get("B365<2.5")),
            })
    out.sort(key=lambda m: m["date"])
    return out

_HIST_BY_LS: dict[tuple, list] = {}

def _hist_for(league: str, season: str) -> list:
    k = (league, season)
    if k not in _HIST_BY_LS:
        _HIST_BY_LS[k] = load_league_season(league, season)
    return _HIST_BY_LS[k]

def _prev_season(season: str) -> str:
    y = int(season[:2])
    return f"{y-1:02d}{y:02d}"

# ------------------------------------------------------------
# Derbys — paires de prediction.ts, noms football-data
# ------------------------------------------------------------

DERBY_PAIRS = [
    ("Paris SG", "Marseille"), ("Paris SG", "Lyon"), ("Monaco", "Nice"),
    ("Arsenal", "Chelsea"), ("Arsenal", "Tottenham"), ("Chelsea", "Tottenham"),
    ("West Ham", "Tottenham"), ("Man United", "Liverpool"), ("Man United", "Man City"),
    ("Liverpool", "Everton"),
    ("Real Madrid", "Barcelona"), ("Real Madrid", "Ath Madrid"),
    ("Barcelona", "Espanol"), ("Sevilla", "Betis"),
    ("Milan", "Inter"), ("Roma", "Lazio"), ("Juventus", "Torino"),
    ("Bayern Munich", "Dortmund"), ("Schalke 04", "Dortmund"),
]

def _norm(s: str) -> str:
    return "".join(c for c in s.lower() if c.isalpha())

_DERBY_NORM = [(_norm(a), _norm(b)) for a, b in DERBY_PAIRS]

def is_derby(home: str, away: str) -> bool:
    h, w = _norm(home), _norm(away)
    if h == w:
        return False
    for a, b in _DERBY_NORM:
        if ((a in h or h in a or b in h or h in b) and (a in w or w in a or b in w or w in b)):
            return True
    return False

# ------------------------------------------------------------
# Pré-computation des features (une seule fois, paramètres-free)
# ------------------------------------------------------------

@dataclass
class TeamState:
    prev: list = field(default_factory=list)   # matchs saison S-1
    cur: list = field(default_factory=list)    # matchs saison S (avant d)

    def window(self) -> list:
        return self.prev + self.cur

def form_score_of(window: list) -> float:
    """formScoreOf : 6 derniers, poids exp(-0.25·âge), défaut 0.4."""
    played = window[-6:]
    if not played:
        return 0.4
    n = len(played)
    num = den = 0.0
    for i, m in enumerate(played):
        rec = math.exp(-0.25 * (n - 1 - i))
        res = 1.0 if m["gf"] > m["ga"] else (0.5 if m["gf"] == m["ga"] else 0.0)
        num += res * rec
        den += rec
    return num / den if den > 0 else 0.4

def team_features(st: TeamState, role_home: bool, d: date_cls) -> dict:
    """Stats d'une équipe au rôle donné, exactement comme analyzeTeam."""
    win = st.window()
    n_over = len(win)
    gf_over = sum(m["gf"] for m in win) / n_over if n_over else 0.0
    ga_over = sum(m["ga"] for m in win) / n_over if n_over else 0.0
    ctx = [m for m in win if m["is_home"] == role_home]
    n_ctx = len(ctx)
    gf_ctx = sum(m["gf"] for m in ctx) / n_ctx if n_ctx else gf_over
    ga_ctx = sum(m["ga"] for m in ctx) / n_ctx if n_ctx else ga_over
    gp = len(st.cur)  # gamesPlayed (classement = saison courante)
    form = form_score_of(win)
    if win:
        last = max(m["date"] for m in win)
        days = (d - last).days
        m14 = sum(1 for m in win if 0 <= (d - m["date"]).days < 14)
    else:
        days, m14 = None, 0
    return dict(gf_over=gf_over, ga_over=ga_over, n_over=n_over,
                gf_ctx=gf_ctx, ga_ctx=ga_ctx, n_ctx=n_ctx, gp=gp,
                form=form, days=days, m14=m14)

def compute_features(core_leagues: list[str], seasons: list[str], eval_from: str) -> list[dict]:
    """Marche chronologique par ligue/saison → table des matchs évalués."""
    rows = []
    for league in core_leagues:
        states: dict[str, TeamState] = {}
        for season in seasons:
            matches = _hist_for(league, season)
            for st in states.values():
                st.prev, st.cur = st.cur, []
            for m in matches:
                d = m["date"]
                hs = states.setdefault(m["home"], TeamState())
                as_ = states.setdefault(m["away"], TeamState())
                if season >= eval_from:
                    rows.append({
                        "league": league, "season": season, "date": d,
                        "home": m["home"], "away": m["away"],
                        "hg": m["hg"], "ag": m["ag"],
                        "y": 0 if m["hg"] > m["ag"] else (1 if m["hg"] == m["ag"] else 2),
                        "b365h": m["b365h"], "b365d": m["b365d"], "b365a": m["b365a"],
                        "b365_over25": m["b365_over25"], "b365_under25": m["b365_under25"],
                        "derby": 1.0 if is_derby(m["home"], m["away"]) else 0.0,
                        "fh": team_features(hs, True, d),
                        "fa": team_features(as_, False, d),
                    })
                # mise à jour APRÈS (aucune fuite)
                hs.cur.append({"date": d, "gf": m["hg"], "ga": m["ag"], "is_home": True})
                as_.cur.append({"date": d, "gf": m["ag"], "ga": m["hg"], "is_home": False})
    rows.sort(key=lambda r: (r["date"], r["league"]))
    return rows

# ------------------------------------------------------------
# Elo local (union des 2 calendriers) — cache par (K, ADV)
# ------------------------------------------------------------

_EV_CACHE: dict[tuple, tuple] = {}   # (league, team, season) -> (events, dates)

def _team_events(league: str, team: str, season: str):
    key = (league, team, season)
    if key not in _EV_CACHE:
        ev = []
        for m in _hist_for(league, season):
            if m["home"] == team or m["away"] == team:
                ev.append((m["date"], m["home"], m["away"], m["hg"], m["ag"]))
        _EV_CACHE[key] = (ev, [e[0] for e in ev])
    return _EV_CACHE[key]

def _elo_diffs_impl(rows: list[dict], k_factor: float, home_adv: float) -> np.ndarray:
    """eloH − eloA après rejeu de l'union des calendriers (computeElo exact)."""
    out = np.empty(len(rows))
    for i, r in enumerate(rows):
        league, season, d = r["league"], r["season"], r["date"]
        prev = _prev_season(season)
        # fenêtre : saison S-1 ENTIÈRE (toujours antérieure) + saison S avant d
        def window(team):
            ev_prev, _ = _team_events(league, team, prev)
            ev_cur, dates = _team_events(league, team, season)
            cut = bisect_left(dates, d)
            return ev_prev + ev_cur[:cut]
        wh, wa = window(r["home"]), window(r["away"])
        # union dédupliquée (confrontation directe vue des 2 calendriers)
        seen = set()
        events = []
        for e in wh:
            k = (e[0], e[1], e[2])
            if k not in seen:
                seen.add(k)
                events.append(e)
        for e in wa:
            k = (e[0], e[1], e[2])
            if k not in seen:
                seen.add(k)
                events.append(e)
        events.sort(key=lambda e: e[0])
        ratings: dict[str, float] = {}
        for (_dt, h, a, hg, ag) in events:
            rh = ratings.get(h, 1500.0)
            ra = ratings.get(a, 1500.0)
            exp_h = 1.0 / (1.0 + 10 ** ((ra - home_adv - rh) / 400.0))
            act = 1.0 if hg > ag else (0.5 if hg == ag else 0.0)
            delta = k_factor * (act - exp_h)
            ratings[h] = rh + delta
            ratings[a] = ra - delta
        out[i] = ratings.get(r["home"], 1500.0) - ratings.get(r["away"], 1500.0)
    return out

_ELO_CACHE: dict[tuple, np.ndarray] = {}

def elo_diffs(rows: list[dict], k_factor: float, home_adv: float) -> np.ndarray:
    key = (round(k_factor, 3), round(home_adv, 3))
    if key not in _ELO_CACHE:
        _ELO_CACHE[key] = _elo_diffs_impl(rows, k_factor, home_adv)
    return _ELO_CACHE[key]

# ------------------------------------------------------------
# Moyennes de buts par ligue (saison précédente) — implémentation #2
# ------------------------------------------------------------

_PREV_AVG_CACHE: dict[tuple, tuple | None] = {}

def previous_season_avgs(league: str, season: str) -> tuple[float, float] | None:
    key = (league, season)
    if key not in _PREV_AVG_CACHE:
        ms = _hist_for(league, _prev_season(season))
        if len(ms) < 50:
            _PREV_AVG_CACHE[key] = None
        else:
            h = sum(m["hg"] for m in ms) / len(ms)
            a = sum(m["ag"] for m in ms) / len(ms)
            _PREV_AVG_CACHE[key] = (h, a)
    return _PREV_AVG_CACHE[key]

# ------------------------------------------------------------
# Moteur vectorisé
# ------------------------------------------------------------

GMAX = 12
_KS = np.arange(GMAX + 1)
_MASK_HOME = np.array([[1.0 if x > y else 0.0 for y in _KS] for x in _KS])
_MASK_DRAW = np.array([[1.0 if x == y else 0.0 for y in _KS] for x in _KS])
_MASK_AWAY = 1.0 - _MASK_HOME - _MASK_DRAW
_MASK_O15 = np.array([[1.0 if x + y >= 2 else 0.0 for y in _KS] for x in _KS])
_MASK_O25 = np.array([[1.0 if x + y >= 3 else 0.0 for y in _KS] for x in _KS])
_MASK_O35 = np.array([[1.0 if x + y >= 4 else 0.0 for y in _KS] for x in _KS])
_MASK_BTTS = np.array([[1.0 if x >= 1 and y >= 1 else 0.0 for y in _KS] for x in _KS])

def _poisson_rows(lam: np.ndarray) -> np.ndarray:
    lam = np.clip(np.nan_to_num(lam, nan=0.0), 0.0, None)
    out = np.empty((lam.shape[0], GMAX + 1))
    out[:, 0] = np.exp(-lam)
    for k in range(1, GMAX + 1):
        out[:, k] = out[:, k - 1] * lam / k
    return out

def _bivariate_grids(lh: np.ndarray, la: np.ndarray, rho: float) -> np.ndarray:
    """Grilles conjointes (N, 13, 13) — composante partagée λ3."""
    l3 = np.maximum(np.minimum(rho * np.sqrt(lh * la), 0.9 * np.minimum(lh, la)), 0.0)
    p1, p2, p3 = _poisson_rows(lh - l3), _poisson_rows(la - l3), _poisson_rows(l3)
    g = np.zeros((lh.shape[0], GMAX + 1, GMAX + 1))
    for k in range(GMAX + 1):
        g[:, k:, k:] += p1[:, k:, None] * p2[:, None, k:] * p3[:, k, None, None]
    g /= g.sum(axis=(1, 2), keepdims=True)
    return g

def _clamp(x, lo, hi):
    return np.minimum(hi, np.maximum(lo, x))

def _sigmoid10(x):
    return 1.0 / (1.0 + 10.0 ** (-x / 400.0))

def _ratio_null_semantics(avg: np.ndarray, baseline: np.ndarray, ncount: np.ndarray) -> np.ndarray:
    """ratioOf + combine de l'app : NaN = « null » (n=0 → repli)."""
    with np.errstate(invalid="ignore", divide="ignore"):
        raw = np.where(ncount > 0, avg / baseline, np.nan)
        w = np.where(ncount > 0, ncount / (ncount + 10.0), np.nan)
        val = 1.0 + (raw - 1.0) * w          # NaN si n = 0
        return np.where(ncount > 0, val, np.nan)

def run_engine(rows: list[dict], p: EngineParams, elo_diff: np.ndarray) -> dict:
    """Prédiction vectorisée de TOUS les matchs — formules de prediction.ts."""
    n = len(rows)

    def col(side: str, name: str) -> np.ndarray:
        return np.array([float(t[name]) for t in (r[side] for r in rows)])

    # --- références de ligue ---
    if p.per_league_avgs:
        avgs = [previous_season_avgs(r["league"], r["season"]) or (1.52, 1.22) for r in rows]
        avg_h = np.array([a[0] for a in avgs])
        avg_a = np.array([a[1] for a in avgs])
    else:
        avg_h = np.full(n, p.league_avg_home)
        avg_a = np.full(n, p.league_avg_away)
    avg_t = (avg_h + avg_a) / 2.0

    gp_h, gp_a = col("fh", "gp"), col("fa", "gp")
    w_h = _clamp(gp_h / (gp_h + p.ctx_weight_div), 0.15, 0.85)
    w_a = _clamp(gp_a / (gp_a + p.ctx_weight_div), 0.15, 0.85)

    def combine(venue, overall, w):
        both = ~np.isnan(venue) & ~np.isnan(overall)
        only_v = ~np.isnan(venue) & np.isnan(overall)
        only_o = np.isnan(venue) & ~np.isnan(overall)
        return np.where(both, w * venue + (1 - w) * overall,
               np.where(only_v, venue,
               np.where(only_o, overall, 1.0)))

    home_attack = combine(
        _ratio_null_semantics(col("fh", "gf_ctx"), avg_h, col("fh", "n_ctx")),
        _ratio_null_semantics(col("fh", "gf_over"), avg_t, gp_h), w_h)
    away_defense = combine(
        _ratio_null_semantics(col("fa", "ga_ctx"), avg_h, col("fa", "n_ctx")),
        _ratio_null_semantics(col("fa", "ga_over"), avg_t, gp_a), w_a)
    away_attack = combine(
        _ratio_null_semantics(col("fa", "gf_ctx"), avg_a, col("fa", "n_ctx")),
        _ratio_null_semantics(col("fa", "gf_over"), avg_t, gp_a), w_a)
    home_defense = combine(
        _ratio_null_semantics(col("fh", "ga_ctx"), avg_a, col("fh", "n_ctx")),
        _ratio_null_semantics(col("fh", "ga_over"), avg_t, gp_h), w_h)

    lam_h = avg_h * home_attack * away_defense
    lam_a = avg_a * away_attack * home_defense

    # --- modificateurs de contexte ---
    def fatigue_mask(side) -> np.ndarray:
        days = np.array([-1.0 if r[side]["days"] is None else r[side]["days"] for r in rows])
        m14 = col(side, "m14")
        return ((days >= 0) & (days <= 3)) | (m14 >= 3)

    derby = np.array([r["derby"] for r in rows])
    lam_h = np.where(fatigue_mask("fh"), lam_h * p.fatigue_factor, lam_h)
    lam_a = np.where(fatigue_mask("fa"), lam_a * p.fatigue_factor, lam_a)
    lam_h = np.where(derby > 0, lam_h * p.derby_factor, lam_h)
    lam_a = np.where(derby > 0, lam_a * p.derby_factor, lam_a)

    # --- forme + redistribution Elo ---
    form_h, form_a = col("fh", "form"), col("fa", "form")
    lam_h *= p.form_factor_lo + p.form_factor_span * form_h
    lam_a *= p.form_factor_lo + p.form_factor_span * form_a

    diff = _clamp(elo_diff, -p.elo_diff_cap, p.elo_diff_cap)
    f = 10.0 ** (diff / p.elo_factor_div)
    total = lam_h + lam_a
    adj_h, adj_a = lam_h * f, lam_a / f
    s = adj_h + adj_a
    safe = np.isfinite(s) & (s > 0) & np.isfinite(total) & (total > 0)
    lam_h = np.where(safe, total * adj_h / np.where(safe, s, 1.0), lam_h)
    lam_a = np.where(safe, total * adj_a / np.where(safe, s, 1.0), lam_a)

    lam_h = np.where(~np.isfinite(lam_h) | (lam_h <= 0.05), 1.35, lam_h)
    lam_a = np.where(~np.isfinite(lam_a) | (lam_a <= 0.05), 1.15, lam_a)
    lam_h = np.round(_clamp(lam_h, *p.lam_home_bounds), 2)
    lam_a = np.round(_clamp(lam_a, *p.lam_away_bounds), 2)

    # --- composante Poisson bivariée ---
    grids = _bivariate_grids(lam_h, lam_a, p.rho)
    pois_h = (grids * _MASK_HOME).sum(axis=(1, 2))
    pois_d = (grids * _MASK_DRAW).sum(axis=(1, 2))
    pois_a = (grids * _MASK_AWAY).sum(axis=(1, 2))
    over15 = (grids * _MASK_O15).sum(axis=(1, 2))
    over25 = (grids * _MASK_O25).sum(axis=(1, 2))
    over35 = (grids * _MASK_O35).sum(axis=(1, 2))
    btts = (grids * _MASK_BTTS).sum(axis=(1, 2))

    # --- eloToProbs ---
    e_home = _sigmoid10(elo_diff + p.home_adv_elo)
    d_elo = _clamp(p.elo_draw_base - p.elo_draw_slope * (e_home - 0.5) ** 2 * 4, 0.11, 0.30)
    elo_ph = _clamp(e_home - d_elo * 0.5, 0.02, 0.95)
    elo_pa = _clamp(1 - e_home - d_elo * 0.5, 0.02, 0.95)
    zs = elo_ph + d_elo + elo_pa
    elo_ph, d_elo, elo_pa = elo_ph / zs, d_elo / zs, elo_pa / zs

    # --- formToProbs ---
    fdiff = (form_h - form_a) * p.form_elo_scale
    fe_home = _sigmoid10(fdiff)
    d_form = _clamp(p.form_draw_base - p.form_draw_slope * (fe_home - 0.5) ** 2 * 4, 0.12, 0.28)
    form_ph = _clamp(fe_home - d_form * 0.5, 0.03, 0.94)
    form_pa = _clamp(1 - fe_home - d_form * 0.5, 0.03, 0.94)
    zs = form_ph + d_form + form_pa
    form_ph, d_form, form_pa = form_ph / zs, d_form / zs, form_pa / zs

    # --- blend ---
    ph = p.w_poisson * pois_h + p.w_elo * elo_ph + p.w_form * form_ph
    pd = p.w_poisson * pois_d + p.w_elo * d_elo + p.w_form * d_form
    pa = p.w_poisson * pois_a + p.w_elo * elo_pa + p.w_form * form_pa
    tot = ph + pd + pa
    ph, pd, pa = ph / tot, pd / tot, pa / tot

    return {
        "probs": np.stack([ph, pd, pa], axis=1),
        "poisson": np.stack([pois_h, pois_d, pois_a], axis=1),
        "elo": np.stack([elo_ph, d_elo, elo_pa], axis=1),
        "form": np.stack([form_ph, d_form, form_pa], axis=1),
        "lambda": np.stack([lam_h, lam_a], axis=1),
        "over15": over15, "over25": over25, "over35": over35, "btts": btts,
    }

# ------------------------------------------------------------
# Métriques
# ------------------------------------------------------------

def metrics_1x2(probs: np.ndarray, y: np.ndarray) -> dict:
    p = np.clip(probs, 1e-9, 1 - 1e-9)
    onehot = np.eye(3)[y]
    n = len(y)
    logloss = float(-np.mean(np.log(p[np.arange(n), y])))
    brier = float(np.mean(((p - onehot) ** 2).sum(axis=1)))
    cum_p, cum_y = np.cumsum(p, axis=1)[:, :2], np.cumsum(onehot, axis=1)[:, :2]
    rps = float(np.mean(((cum_p - cum_y) ** 2).sum(axis=1)) / 2)
    acc = float(np.mean(p.argmax(axis=1) == y))
    return {"acc": acc, "logloss": logloss, "brier": brier, "rps": rps,
            "draw_pred": float(np.mean(p[:, 1]))}

def metrics_binary(p: np.ndarray, y01: np.ndarray) -> dict:
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return {
        "acc": float(np.mean((p >= 0.5).astype(int) == y01)),
        "logloss": float(-np.mean(y01 * np.log(p) + (1 - y01) * np.log(1 - p))),
        "brier": float(np.mean((p - y01) ** 2)),
    }

def market_probs_1x2(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Dé-margage B365 (deMargin1x2 de l'app) — NaN si cotes absentes."""
    h = np.array([r["b365h"] for r in rows])
    d = np.array([r["b365d"] for r in rows])
    a = np.array([r["b365a"] for r in rows])
    ok = np.isfinite(h) & np.isfinite(d) & np.isfinite(a) & (h > 1.01) & (d > 1.01) & (a > 1.01)
    inv = np.where(ok[:, None], np.stack([1 / np.where(ok, h, 1), 1 / np.where(ok, d, 1),
                                          1 / np.where(ok, a, 1)], axis=1), np.nan)
    s = np.nansum(inv, axis=1)
    valid = ok & (s > 1.001) & (s < 1.4)
    out = np.full_like(inv, np.nan)
    out[valid] = inv[valid] / s[valid, None]
    return out, valid
