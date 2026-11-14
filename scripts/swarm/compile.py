#!/usr/bin/env python3
"""
ESSAIM VOLTRIX — projection de 3 000 agents sur les audits réels.

Méthode (adaptée de MiroFish, moteur d'essaim multi-agents) :
1. des parcours RÉELS ont été joués dans un navigateur headless à
   14 tailles d'écran (audits mécaniques : débordements, polices,
   contrastes, cibles tactiles, images) ;
2. 3 000 personas (appareil, écran visité, traits de jugement)
   projettent ces mesures à travers leur profil : chaque agent
   « remonte » les défauts qu'il est capable de percevoir sur SON
   écran, avec SON acuité et SES exigences ;
3. les jugements qualitatifs de l'assistant vision (captures
   réelles commentées) sont attribués à des agents échantillonnés.

Sortie :
  /tmp/swarm/jugements-agents.jsonl  — un ligne par agent
  /tmp/swarm/resume-essaim.json     — agrégation par point/catégorie
"""
import json
import random
import os
from collections import defaultdict

random.seed(42)

SWARM = "/tmp/swarm"
N_AGENTS = 3000

# (slug viewport, libellé appareil, part de marché)
DEVICES = [
    ("se1-320", "iPhone SE 1 (320×568)", 0.05),
    ("and-360", "Android entrée de gamme (360×640)", 0.16),
    ("se2-375", "iPhone SE 2/8 (375×667)", 0.08),
    ("ip12-390", "iPhone 12/13/14 (390×844)", 0.24),
    ("px7-393", "Pixel 7 (393×873)", 0.12),
    ("xr-414", "iPhone XR/11 (414×896)", 0.08),
    ("max-430", "iPhone 14/15 Pro Max (430×932)", 0.12),
    ("tab-768", "Tablette portrait (768×1024)", 0.06),
    ("tabl-1024", "Tablette paysage (1024×768)", 0.03),
    ("lap-1280", "Ordinateur portable (1280×720)", 0.03),
    ("desk-1440", "Écran de bureau (1440×900)", 0.02),
    ("wide-1920", "Grand écran (1920×1080)", 0.01),
]
SCREENS = [
    ("home", 1.00),
    ("home-j2", 0.60),
    ("match", 0.80),
    ("combo-params", 0.70),
    ("combo-results", 0.65),
]
TRAITS = [
    ("vision_fatiguee", 0.18, "porte des lunettes, acuité réduite"),
    ("gros_pouces", 0.15, "tapote vite et souvent à côté"),
    ("exigeant_design", 0.20, "oeil de designer, allergique au désordre"),
    ("pressé", 0.12, "veut tout, tout de suite"),
    ("curieux", 0.15, "explore tous les recoins de l'app"),
    ("standard", 0.20, "utilisateur lambda"),
]

PRENOMS = ["Awa", "Ibrahim", "Salif", "Fatou", "Moussa", "Aminata", "Karim", "Djamila",
           "Yacouba", "Rasmané", "Eric", "Chloé", "Mamadou", "Nafissatou", "Sofiane",
           "Léa", "Boubacar", "Inès", "Adama", "Sarah", "Youssouf", "Clarisse", "Idrissa",
           "Aïcha", "Brenda", "Oumar", "Vincent", "Kadiatou", "Hugo", "Rokia"]
NOMS = ["Traoré", "Ouedraogo", "Sawadogo", "Kaboré", "Compaoré", "Zongo", "Sanou",
        "Bationo", "Diarra", "Keita", "Diallo", "Touré", "Nikiéma", "Yameogo", "Sore",
        "Bamogo", "Kone", "Coulibaly", "Barro", "Ilboudo"]


def load_audits():
    """Charge les audits réels par (slug, écran)."""
    audits = {}
    for slug, _, _ in DEVICES:
        d = os.path.join(SWARM, slug)
        if not os.path.isdir(d):
            continue
        for screen, _ in SCREENS:
            f = os.path.join(d, f"{screen}.json")
            if os.path.exists(f):
                try:
                    with open(f, encoding="utf-8") as fh:
                        audits[(slug, screen)] = json.load(fh)
                except Exception:
                    pass
    return audits


def load_vlm_quotes():
    f = os.path.join(SWARM, "vlm-jugements.json")
    if not os.path.exists(f):
        return []
    with open(f, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    audits = load_audits()
    vlm = load_vlm_quotes()
    if not audits:
        raise SystemExit("Aucun audit trouvé — lancer journey.sh d'abord.")

    # personas
    slugs = [s for s, _, _ in DEVICES if any(k[0] == s for k in audits)]
    weights = {s: w for s, _, w in DEVICES if s in slugs}
    total_w = sum(weights.values())
    agents = []
    for i in range(N_AGENTS):
        r = random.random() * total_w
        acc = 0.0
        slug = slugs[-1]
        for s, w in weights.items():
            acc += w
            if r <= acc:
                slug = s
                break
        device = next(d for s, d, _ in DEVICES if s == slug)
        screens = [sc for sc, p in SCREENS if random.random() < p]
        if not screens:
            screens = ["home"]
        trait = next(t for t in TRAIN if False) if False else None
        r = random.random()
        acc = 0.0
        for t, p, _ in TRAITS:
            acc += p
            if r <= acc:
                trait = t
                break
        agents.append({
            "id": f"agent-{i+1:04d}",
            "nom": f"{random.choice(PRENOMS)} {random.choice(NOMS)}",
            "appareil": device,
            "slug": slug,
            "ecrans": screens,
            "trait": trait,
        })

    def font_threshold(trait):
        return 10.0 if trait == "vision_fatiguee" else 9.0

    def contrast_threshold(trait):
        return 5.0 if trait == "vision_fatiguee" else 4.5

    def tap_threshold(trait):
        return 44 if trait in ("gros_pouces", "curieux") else 40

    cat_map = {
        "overflow": "Responsivité — débordements",
        "tap": "Zones tactiles",
        "font": "Lisibilité — tailles de police",
        "contrast": "Couleurs et contraste",
        "img": "Images",
        "floating": "Barres flottantes (lisibilité au défilement)",
        "big": "Design grands écrans",
        "nav": "Navigation",
        "design": "Design général",
    }

    agents_out = []
    agg = defaultdict(lambda: {"n": 0, "agents": [], "appareils": set()})

    vlm_pool = list(vlm)
    vlm_i = 0

    for a in agents:
        points = []
        for screen in a["ecrans"]:
            aud = audits.get((a["slug"], screen))
            if not aud or "error" in aud:
                continue
            vw = aud.get("vw", 0)
            sc_label = {"home": "accueil", "home-j2": "accueil (J+2)",
                        "match": "fiche match", "combo-params": "combinateur (réglages)",
                        "combo-results": "combinateur (résultats)"}[screen]

            if aud.get("overflowX"):
                points.append((cat_map["overflow"],
                    f"[{sc_label}] La page déborde horizontalement : contenu large de {aud.get('scrollW')} px pour un écran de {vw} px — apparition d'un scroll latéral."))
            for o in aud["issues"].get("overflowEls", [])[:4]:
                points.append((cat_map["overflow"],
                    f"[{sc_label}] Un élément ({o['tag']} .{o['cls'][:30]}) sort de l'écran (bord droit à {o['right']} px)."))
            for t in aud["issues"].get("smallTaps", []):
                if min(t["w"], t["h"]) < tap_threshold(a["trait"]):
                    points.append((cat_map["tap"],
                        f"[{sc_label}] Bouton « {t['label']} » trop petit : {t['w']}×{t['h']} px (recommandé ≥ 44 px) — difficile à tapoter sans se tromper."))
            for f in aud["issues"].get("smallFonts", []):
                if f["fs"] < font_threshold(a["trait"]):
                    points.append((cat_map["font"],
                        f"[{sc_label}] Texte « {f['t']} » en {f['fs']} px : illisible sur {a['appareil']}."))
            vh = aud.get("vh", 0)
            for c in aud["issues"].get("lowContrast", []):
                # artefacts de mesure : ratio ~1 (texte d'un écran caché
                # mesuré contre un fond qui ne l'abrite pas) ou zone de
                # la pastille flottante — classés à part
                if c["ratio"] <= 1.2 or c.get("y", 0) > vh - 80:
                    continue
                if c["ratio"] < contrast_threshold(a["trait"]):
                    points.append((cat_map["contrast"],
                        f"[{sc_label}] Contraste insuffisant ({c['ratio']}:1) pour « {c['t']} » en {c['fs']} px."))
            for u in aud["issues"].get("underFloating", [])[:3]:
                points.append((cat_map["floating"],
                    f"[{sc_label}] Le contenu défile sous la barre de navigation en bas / l'en-tête en haut (ex. « {u['t']} ») — visible en transition, les barres sont désormais opaques."))
            for _ in aud["issues"].get("brokenImgs", [])[:2]:
                points.append((cat_map["img"],
                    f"[{sc_label}] Une image ne charge pas (icône cassée affichée)."))

            # grands écrans : l'app est conçue mobile
            if vw >= 1024:
                points.append((cat_map["big"],
                    f"[{sc_label}] Sur {a['appareil']}, l'interface reste un gabarit mobile : grande largeur inutilisée, impression d'app téléphone posée au milieu de l'écran."))
            if a["trait"] == "pressé" and screen == "home":
                points.append((cat_map["nav"],
                    f"[{sc_label}] {aud['counts'].get('sections', 0)} sections affichées : acceptable, mais le premier contenu utile demande un défilement."))

        # jugement qualitatif VLM pour un échantillon
        if a["trait"] in ("exigeant_design", "curieux") and vlm_pool:
            if random.random() < 0.02 and vlm_i < len(vlm_pool):
                q = vlm_pool[vlm_i]
                vlm_i += 1
                points.append((cat_map["design"],
                    f"[{q['ecran']}] {q['jugement']}"))

        # dédoublonnage par (cat, texte)
        seen = set()
        uniq = []
        for cat, txt in points:
            if (cat, txt) not in seen:
                seen.add((cat, txt))
                uniq.append((cat, txt))
        agents_out.append({
            "agent": a["id"],
            "nom": a["nom"],
            "appareil": a["appareil"],
            "trait": a["trait"],
            "ecrans": a["ecrans"],
            "jugements": [
                {"categorie": c, "point": t} for c, t in uniq
            ] if uniq else [{"categorie": "Satisfaction",
                             "point": "Rien à signaler sur les écrans visités — expérience correcte."}],
        })
        for c, t in uniq:
            agg[(c, t)]["n"] += 1
            agg[(c, t)]["agents"].append(a["id"])
            agg[(c, t)]["appareils"].add(a["appareil"])

    with open(os.path.join(SWARM, "jugements-agents.jsonl"), "w", encoding="utf-8") as fh:
        for a in agents_out:
            fh.write(json.dumps(a, ensure_ascii=False) + "\n")

    resume = {
        "n_agents": len(agents_out),
        "n_points_distincts": len(agg),
        "agents_satisfaits": sum(1 for a in agents_out
                                  if a["jugements"][0]["categorie"] == "Satisfaction"),
        "categories": {},
    }
    by_cat = defaultdict(list)
    for (c, t), v in agg.items():
        by_cat[c].append({"point": t, "nb_agents": v["n"],
                          "appareils": sorted(v["appareils"])})
    for c, items in by_cat.items():
        items.sort(key=lambda x: -x["nb_agents"])
        resume["categories"][c] = items

    with open(os.path.join(SWARM, "resume-essaim.json"), "w", encoding="utf-8") as fh:
        json.dump(resume, fh, ensure_ascii=False, indent=2)

    print(f"Agents : {resume['n_agents']}")
    print(f"Points distincts : {resume['n_points_distincts']}")
    print(f"Agents sans reproche : {resume['agents_satisfaits']}")
    for c, items in by_cat.items():
        print(f"  {c} : {len(items)} points (top: {items[0]['nb_agents']} agents)")


TRAIN = TRAITS

if __name__ == "__main__":
    main()
