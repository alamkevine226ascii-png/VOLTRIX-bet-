#!/usr/bin/env python3
"""Agrège les jugements en points canoniques (catégorie × écran × classe)."""
import json
import re
from collections import defaultdict

SWARM = "/tmp/swarm"

with open(f"{SWARM}/jugements-agents.jsonl", encoding="utf-8") as fh:
    agents = [json.loads(l) for l in fh]

SCREENS = ["accueil", "accueil (J+2)", "fiche match", "combinateur (réglages)", "combinateur (résultats)"]

def canon(j: str):
    """Point verbatim → classe canonique."""
    m = re.match(r"\[([^\]]+)\]\s*(.*)", j)
    screen = m.group(1) if m else "?"
    txt = m.group(2) if m else j
    if "déborde horizontalement" in txt or "sort de l'écran" in txt:
        return screen, "Débordement horizontal / élément hors écran"
    if "trop petit" in txt and "Bouton" in txt:
        return screen, "Boutons plus petits que 44 px (zone tactile réduite)"
    if "illisible sur" in txt:
        return screen, "Textes en moins de 9 px (illisibles)"
    if "Contraste insuffisant" in txt:
        return screen, "Contraste texte/fond insuffisant"
    if "barre flottante" in txt:
        return screen, "Contenu qui défile sous les barres flottantes"
    if "gabarit mobile" in txt:
        return screen, "Gabarit mobile non adapté aux grands écrans"
    if "premier contenu utile" in txt:
        return screen, "Premier contenu utile après défilement"
    if "image ne charge pas" in txt or "icône cassée" in txt:
        return screen, "Images cassées"
    if "Rien à signaler" in txt:
        return screen, "Satisfaction"
    return screen, "Autre"

agg = defaultdict(lambda: {"n": 0, "agents": [], "exemples": []})
total_jugements = 0
for a in agents:
    for j in a["jugements"]:
        total_jugements += 1
        sc, cls = canon(j["point"])
        key = (cls, sc)
        agg[key]["n"] += 1
        if len(agg[key]["agents"]) < 3:
            agg[key]["agents"].append(a["nom"])
        if len(agg[key]["exemples"]) < 2:
            agg[key]["exemples"].append(j["point"][:170])

with open(f"{SWARM}/vlm-jugements.json", encoding="utf-8") as fh:
    vlm = json.load(fh)

print(f"Agents : {len(agents)} · jugements émis : {total_jugements}")
print(f"Points canoniques : {len(agg)}\n")
ORDER = [
    "Textes en moins de 9 px (illisibles)",
    "Boutons plus petits que 44 px (zone tactile réduite)",
    "Contenu qui défile sous les barres flottantes",
    "Contraste texte/fond insuffisant",
    "Débordement horizontal / élément hors écran",
    "Gabarit mobile non adapté aux grands écrans",
    "Premier contenu utile après défilement",
    "Images cassées",
    "Autre",
]
for cls in ORDER:
    rows = [(sc, v) for (c, sc), v in agg.items() if c == cls]
    if not rows:
        continue
    tot = sum(v["n"] for _, v in rows)
    print(f"### {cls} — {tot} jugements d'agents")
    for sc, v in sorted(rows, key=lambda x: -x[1]["n"]):
        print(f"  [{sc}] {v['n']} agents — ex. {v['agents'][0]}")
    print()

print(f"### Jugements qualitatifs de l'assistant vision : {len(vlm)}")
