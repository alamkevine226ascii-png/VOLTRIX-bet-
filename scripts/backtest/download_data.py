#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Backtest football : téléchargement football-data.co.uk
# Source : https://www.football-data.co.uk (gratuit, pas de clé).
# URL pattern : https://www.football-data.co.uk/mmz4281/{SSSS}/{LIGUE}.csv
#   SSSS = code saison (0910 = 2009-10, ..., 2526 = 2025-26)
# Ligues cœur (historique complet 2009-10 → 2025-26) : E0 E1 SP1 D1 I1 F1
# Ligues annexes (3 dernières saisons, pour league-params.ts) : autres
# ============================================================
import os
import sys
import time
import urllib.request

BASE = "https://www.football-data.co.uk/mmz4281"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

def seasons_between(start: str, end: str):
    """Liste des codes saisons 'YYZZ' entre start et end inclus."""
    out = []
    y = int(start[:2]) * 100 + int(start[2:])  # ex 0910 -> 910
    y0, y1 = int(start[:2]), int(end[:2])
    for yy in range(y0, y1 + 1):
        out.append(f"{yy:02d}{(yy + 1) % 100:02d}")
    return out

# Cœur du backtest : 6 championnats (correspondent aux ligues priorité 1
# de l'app : eng.1 eng.2 esp.1 ita.1 ger.1 fra.1) — 17 saisons.
CORE = ["E0", "E1", "SP1", "D1", "I1", "F1"]
CORE_SEASONS = seasons_between("0910", "2526")

# Annexes : 3 dernières saisons complètes (moyennes de buts par ligue).
EXTRA = ["E2", "E3", "EC", "SC0", "SC1", "SP2", "I2", "D2", "F2",
         "N1", "B1", "P1", "T1", "G1"]
EXTRA_SEASONS = ["2324", "2425", "2526"]

def download(league: str, season: str) -> tuple[bool, str]:
    url = f"{BASE}/{season}/{league}.csv"
    dest = os.path.join(DATA_DIR, f"{league}_{season}.csv")
    if os.path.exists(dest) and os.path.getsize(dest) > 10_000:
        return True, "cache"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
        # Validation minimale : entête CSV attendu
        head = raw[:400].decode("latin-1", errors="replace")
        if "Div" not in head or "FTHG" not in head:
            return False, "format-inattendu"
        with open(dest, "wb") as f:
            f.write(raw)
        return True, f"{len(raw)//1024} Ko"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"

def main():
    jobs = [(lg, s) for lg in CORE for s in CORE_SEASONS]
    jobs += [(lg, s) for lg in EXTRA for s in EXTRA_SEASONS]
    ok = miss = 0
    for league, season in jobs:
        success, note = download(league, season)
        if success:
            ok += 1
            if note != "cache":
                print(f"  {league} {season}: OK ({note})")
        else:
            miss += 1
            print(f"  {league} {season}: ECHEC ({note})")
        time.sleep(0.25)  # poli
    print(f"\n=== {ok} fichiers OK, {miss} échecs, dossier {DATA_DIR} ===")

if __name__ == "__main__":
    sys.exit(main())
