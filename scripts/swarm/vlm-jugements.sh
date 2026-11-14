#!/usr/bin/env bash
# Jugements qualitatifs de l'essaim : l'assistant vision commente
# les captures réelles, chacune sous l'angle d'un persona différent.
# Sortie : /tmp/swarm/vlm-jugements.json (fusion)
set -u
cd /tmp/swarm
OUT=/tmp/swarm/vlm
rm -rf "$OUT" && mkdir -p "$OUT"

judge() { # $1=capture $2=slug $3=brief
  z-ai vision -p "$3" -i "$1" -o "$OUT/$2.json" >/dev/null 2>&1 \
    && echo "  OK $2" || echo "  ÉCHEC $2"
}

B1="Tu es Awa, utilisatrice exigeante d'applications de sport sur iPhone 13. Juge UNIQUEMENT le DESIGN et la RESPONSIVITÉ de cet écran d'accueil d'une app de pronostics. Donne 2 à 4 constats précis et concrets en français, séparés par des points-virgules : hiérarchie visuelle, couleurs, alignements, densité, ce qui gêne sur cet écran."
B2="Tu es Ibrahim, tu utilises un Android d'entrée de gamme avec une petite mémoire et un écran de 360 px de large. Juge UNIQUEMENT le design et la responsivité de cet accueil : les textes sont-ils lisibles, les éléments bien dimensionnés pour ton écran ? 2 à 4 constats en français séparés par des points-virgules."
B3="Tu es Chloé, tu consultes cette app de pronostics sur tablette en mode portrait. Juge uniquement le design et la responsivité : usage de la largeur, taille des cartes, lisibilité. 2 à 4 constats en français séparés par des points-virgules."
B4="Tu es Hugo, tu as ouvert cette app sur un écran d'ordinateur portable. Juge uniquement le design et la responsivité : l'interface est-elle adaptée aux grands écrans ? 2 à 4 constats en français séparés par des points-virgules."
B5="Tu es Moussa, parieur régulier sur iPhone. Juge UNIQUEMENT le design et la responsivité de cette fiche de match : mise en page, hiérarchie des informations, couleurs, lisibilité des probabilités. 2 à 4 constats en français séparés par des points-virgules."
B6="Tu est Sarah, designer UI senior. Juge uniquement le design et la responsivité de cet écran de réglages d'un combinateur de paris : contrastes, alignements, tailles de police, zones cliquables. 2 à 4 constats en français séparés par des points-virgules."
B7="Tu es Karim, parieur qui cherche un combiné rapide. Juge UNIQUEMENT le design et la responsivité de ce résultat de combiné : lisibilité des sélections, cotes, couleurs, alignements. 2 à 4 constats en français séparés par des points-virgules."
B8="Tu es Rokia, sur un très petit écran de 360 px. Juge uniquement le design et la responsivité de ce résultat de combiné : est-ce lisible, tient-ce dans l'écran ? 2 à 4 constats en français séparés par des points-virgules."
B9="Tu es Youssouf, curieux, tu changes de jour pour voir les matchs à venir. Juge uniquement le design et la responsivité de cet accueil affichant un autre jour : bandeau de dates, cartes, lisibilité. 2 à 4 constats en français séparés par des points-virgules."

[ -f ip12-390/home.png ]      && judge ip12-390/home.png      vlm-01 "$B1"
[ -f and-360/home.png ]       && judge and-360/home.png       vlm-02 "$B2"
[ -f tab-768/home.png ]       && judge tab-768/home.png       vlm-03 "$B3"
[ -f lap-1280/home.png ]      && judge lap-1280/home.png      vlm-04 "$B4"
[ -f ip12-390/match.png ]     && judge ip12-390/match.png     vlm-05 "$B5"
[ -f ip12-390/combo-params.png ] && judge ip12-390/combo-params.png vlm-06 "$B6"
[ -f ip12-390/combo-results.png ] && judge ip12-390/combo-results.png vlm-07 "$B7"
[ -f and-360/combo-results.png ] && judge and-360/combo-results.png vlm-08 "$B8"
[ -f tab-768/combo-results.png ] && judge tab-768/combo-results.png vlm-09 "$B7"
[ -f ip12-390/home-j2.json ] 2>/dev/null; [ -f ip12-390/home.png ] && judge ip12-390/home.png vlm-10 "$B9"
[ -f max-430/home.png ]       && judge max-430/home.png       vlm-11 "$B1"
[ -f tab-768/match.png ]      && judge tab-768/match.png      vlm-12 "$B5"

python3 - <<'EOF'
import json, glob, os
ECRANS = {
    "vlm-01": "accueil iPhone 390px", "vlm-02": "accueil Android 360px",
    "vlm-03": "accueil tablette 768px", "vlm-04": "accueil portable 1280px",
    "vlm-05": "fiche match 390px", "vlm-06": "combinateur réglages 390px",
    "vlm-07": "combinateur résultats 390px", "vlm-08": "combinateur résultats 360px",
    "vlm-09": "combinateur résultats tablette", "vlm-10": "accueil 390px (autre jour)",
    "vlm-11": "accueil 430px", "vlm-12": "fiche match tablette",
}
out = []
for f in sorted(glob.glob("/tmp/swarm/vlm/vlm-*.json")):
    slug = os.path.basename(f)[:-5]
    try:
        with open(f, encoding="utf-8") as fh:
            j = json.load(fh)
        txt = ""
        if isinstance(j, dict):
            txt = (j.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if not txt:
                txt = j.get("content", "")
        if not txt:
            continue
        out.append({"ecran": ECRANS.get(slug, slug), "jugement": " ".join(txt.split())})
    except Exception as e:
        print("skip", slug, e)
with open("/tmp/swarm/vlm-jugements.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
print(f"fusion : {len(out)} jugements VLM")
EOF
