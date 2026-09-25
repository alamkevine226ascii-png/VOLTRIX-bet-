"""Test empirique de soccerdata depuis le sandbox VOLTRIX.

Question : le dépôt probberechts/soccerdata permet-il d'utiliser Sofascore
depuis NOTRE IP (datacenter, bloquée 403 par Cloudflare) ?
Et au passage : FBref (xG) et ClubElo (ratings) sont-ils accessibles ?

Chaque source est testée avec un budget temps raisonnable et un message
d'erreur propre — le script ne doit jamais crasher brutalement.
"""

import sys
import time
import traceback

import soccerdata as sd

LEAGUE = "ENG-Premier League"


def try_source(name: str, fn, budget_s: int = 90) -> None:
    print(f"\n=== {name} ===", flush=True)
    t0 = time.time()
    try:
        df = fn()
        dt = time.time() - t0
        if df is None or len(df) == 0:
            print(f"Résultat VIDE en {dt:.1f}s")
            return
        print(f"OK — {len(df)} lignes en {dt:.1f}s")
        print("Colonnes:", list(df.columns)[:14])
        print(df.head(2).to_string(max_colwidth=18))
    except Exception as e:  # noqa: BLE001 — on veut tout voir
        dt = time.time() - t0
        msg = str(e).replace("\n", " ")[:220]
        print(f"ÉCHEC après {dt:.1f}s : {type(e).__name__}: {msg}")


# 1) Sofascore — la question principale de l'utilisateur
def sofascore_test():
    sofa = sd.Sofascore(leagues=LEAGUE, seasons="26-27")
    return sofa.read_schedule()


# 2) FBref — la valeur réelle du dépôt pour nous : xG, stats détaillées
def fbref_test():
    fb = sd.FBref(leagues=LEAGUE, seasons="26-27")
    return fb.read_schedule()


# 3) ClubElo — ratings Elo prêts à l'emploi (petit CSV)
def clubelo_test():
    ce = sd.ClubElo()
    return ce.read_by_date()  # ratings du jour, toutes équipes


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "sofa"):
        try_source("Sofascore (read_schedule 26-27)", sofascore_test, 60)
    if which in ("all", "fbref"):
        try_source("FBref (read_schedule 26-27)", fbref_test, 120)
    if which in ("all", "clubelo"):
        try_source("ClubElo (read_by_date)", clubelo_test, 45)
