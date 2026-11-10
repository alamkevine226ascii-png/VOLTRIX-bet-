#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Rapport PDF de backtest du moteur MMA
# Voie Report (ReportLab) — Template 07 Crystal Blue (body clair)
# Même gabarit que le rapport football : TocDocTemplate,
# Paragraph() partout, fit_image, table(), header/footer.
# ============================================================
from __future__ import annotations

import csv
import hashlib
import json
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (CondPageBreak, HRFlowable, Image, KeepTogether,
                                PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

HERE = os.path.dirname(os.path.abspath(__file__))
CHARTS = os.path.join(HERE, "charts_pdf")
OUT_BODY = os.path.join(HERE, "rapport_body.pdf")

FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")

sys.path.insert(0, "/home/z/my-project/skills/pdf/scripts")
from pdf import install_font_fallback  # noqa: E402
install_font_fallback()

PAGE_BG = colors.HexColor("#f5f8fc")
CARD_BG = colors.HexColor("#e4ecf5")
TABLE_STRIPE = colors.HexColor("#eef3fa")
HEADER_FILL = colors.HexColor("#1a4a7a")
BORDER = colors.HexColor("#c0d0e2")
ACCENT = colors.HexColor("#2d7ab3")
TEXT_PRIMARY = colors.HexColor("#142840")
TEXT_MUTED = colors.HexColor("#5a7a96")

MARGIN = 1.9 * cm
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
H1_ORPHAN = (PAGE_H - 2 * MARGIN) * 0.18

S = {}
S["h1"] = ParagraphStyle("H1", fontName="FreeSerif-Bold", fontSize=19, leading=24,
                         textColor=HEADER_FILL, spaceBefore=20, spaceAfter=8)
S["h2"] = ParagraphStyle("H2", fontName="FreeSerif-Bold", fontSize=14, leading=19,
                         textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=6)
S["body"] = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=16,
                           textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=8)
S["bullet"] = ParagraphStyle("Bullet", parent=S["body"], leftIndent=14, bulletIndent=4,
                             spaceAfter=4, alignment=TA_LEFT)
S["caption"] = ParagraphStyle("Caption", fontName="FreeSerif-Italic", fontSize=8.5,
                              leading=11.5, textColor=TEXT_MUTED, alignment=TA_CENTER,
                              spaceBefore=3, spaceAfter=6)
S["th"] = ParagraphStyle("TH", fontName="FreeSerif-Bold", fontSize=9,
                         leading=11.5, textColor=colors.white, alignment=TA_CENTER)
S["td"] = ParagraphStyle("TD", fontName="FreeSerif", fontSize=9, leading=11.5,
                         textColor=TEXT_PRIMARY, alignment=TA_CENTER)
S["tdl"] = ParagraphStyle("TDL", parent=S["td"], alignment=TA_LEFT)
S["stat"] = ParagraphStyle("Stat", fontName="FreeSerif-Bold", fontSize=20, leading=24,
                           textColor=ACCENT, alignment=TA_CENTER)
S["statlab"] = ParagraphStyle("StatLab", fontName="FreeSerif", fontSize=8, leading=10.5,
                              textColor=TEXT_MUTED, alignment=TA_CENTER)
S["quote"] = ParagraphStyle("Quote", fontName="FreeSerif-Italic", fontSize=10.5,
                            leading=16, textColor=TEXT_MUTED, leftIndent=24,
                            borderPadding=0, spaceBefore=6, spaceAfter=10)
S["toc0"] = ParagraphStyle("TOC0", fontName="FreeSerif-Bold", fontSize=11.5, leading=18,
                           textColor=TEXT_PRIMARY, leftIndent=6)
S["toc1"] = ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=10, leading=15,
                           textColor=TEXT_MUTED, leftIndent=24)


class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            self.notify("TOCEntry", (level, text, self.page, key))


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAGE_BG)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - 1.15 * cm, "VOLTRIX bet — Backtest du moteur MMA")
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 1.3 * cm, PAGE_W - MARGIN, PAGE_H - 1.3 * cm)
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, 1.25 * cm, PAGE_W - MARGIN, 1.25 * cm)
    canvas.setFont("FreeSerif", 7.5)
    canvas.drawString(MARGIN, 0.9 * cm,
                      "Moteur voltrix-mma-v1 · ufcstats / BestFightOdds 1998-2026")
    canvas.drawRightString(PAGE_W - MARGIN, 0.9 * cm, f"Page {doc.page}")
    canvas.restoreState()


def H(text, level=0):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    style = S["h1"] if level == 0 else S["h2"]
    p = Paragraph(f'<a name="{key}"/><b>{text}</b>', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def P(text):
    return Paragraph(text, S["body"])


def BUL(text):
    return Paragraph(f"• {text}", S["bullet"])


def fit_image(path, max_w, max_h):
    im = PILImage.open(path)
    ow, oh = im.size
    ratio = min(max_w / ow if ow > max_w else 1.0, max_h / oh if oh > max_h else 1.0)
    return Image(path, width=ow * ratio, height=oh * ratio)


def figure(path, caption, max_h=250):
    img = fit_image(path, AVAIL_W, max_h)
    img.hAlign = "CENTER"
    return [Spacer(1, 14), img, Paragraph(caption, S["caption"]), Spacer(1, 10)]


def table(data_rows, header, ratios, left_cols=()):
    widths = [r * AVAIL_W for r in ratios]
    rows = [[Paragraph(f"<b>{h}</b>", S["th"]) for h in header]]
    for r in data_rows:
        rows.append([Paragraph(c, S["tdl"] if i in left_cols else S["td"])
                     for i, c in enumerate(r)])
    t = Table(rows, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(rows)):
        style.append(("BACKGROUND", (0, i), (-1, i),
                      TABLE_STRIPE if i % 2 == 0 else colors.white))
    t.setStyle(TableStyle(style))
    return t


def section(story, title, level=0):
    story.append(CondPageBreak(H1_ORPHAN if level == 0 else H1_ORPHAN * 0.55))
    story.append(H(title, level))


def stat_block(items):
    """items : [(valeur, libellé), ...] — bloc de statistiques."""
    n = len(items)
    cells = [[], []]
    for v, lab in items:
        cells[0].append(Paragraph(f"<b>{v}</b>", S["stat"]))
        cells[1].append(Paragraph(lab, S["statlab"]))
    w = AVAIL_W / n
    t = Table([cells[0], cells[1]], colWidths=[w] * n)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("BOX", (0, 0), (-1, -1), 0.8, BORDER),
        ("LINEBEFORE", (1, 0), (-1, -1), 0.8, BORDER),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


# ============================================================
# Données
# ============================================================
with open(os.path.join(HERE, "replay_results.json")) as f:
    R = json.load(f)

AB = R["asBuilt"]
MK = R["market"]
COV = R["coverage"]
DIS = R["marketDisagreement"]
METH = R["methodPrediction"]

def pct(x, d=2):
    return f"{100 * x:.{d}f} %".replace(".", ",")


story = []

# ---------- 1. Résumé exécutif ----------
section(story, "1. Résumé exécutif")
story.append(P(
    "Ce document mesure, pour la première fois, la performance réelle du moteur de "
    "pronostics MMA de VOLTRIX (voltrix-mma-v1 : onze dimensions agrégées, transformation "
    "logistique, probabilités bornées) sur l'intégralité de l'historique de combats UFC "
    "disponible dans le jeu de données public DanMcInerney/mma-ai : 7 704 combats entre "
    "octobre 1998 et août 2026, avec statistiques brutes par round issues d'ufcstats.com "
    "et cotes de clôture BestFightOdds pour 6 546 d'entre eux. Le moteur a été rejoué "
    "combat par combat, dans l'ordre chronologique, en ne montrant au modèle que des "
    "informations strictement antérieures à chaque combat — la méthodologie anti-fuite "
    "exigée lors de l'audit des lacunes."))
story.append(Spacer(1, 6))
story.append(stat_block([
    (pct(AB["TEST"]["acc"]), "Précision vainqueur<br/>test 2025-26 (n = 563)"),
    (pct(MK["TEST"]["acc"]), "Référence marché<br/>cotes de clôture"),
    (f"{AB['TEST']['brier']:.4f}".replace(".", ","), "Score de Brier<br/>test"),
    (pct(COV["predicted"] / COV["decided"], 1), "Combats décidés<br/>couverts par le moteur"),
]))
story.append(Spacer(1, 10))
story.append(P(
    "Trois enseignements majeurs se dégagent. Premièrement, le moteur délivre une "
    "précision honnête et remarquablement stable — environ 56 % de vainqueurs corrects "
    "sur toute la période moderne, sans aucune régression entre l'époque d'apprentissage "
    "et la période de test. Deuxièmement, la calibration des probabilités est d'ores et "
    "déjà excellente : la recherche en grille sur la pente logistique, les bornes et le "
    "poids de la forme ne trouve aucune amélioration qui dépasse le bruit d'échantillonnage "
    "— les constantes actuelles (K = 2,6, bornes 25-75 %) sont validées par ce backtest. "
    "Troisièmement, l'écart avec le marché des cotes est massif (56 % contre 71 % sur la "
    "période de test) : onze dimensions construites sur les seules statistiques de combat "
    "ne peuvent pas rivaliser avec des cotes de clôture qui incorporent l'information de "
    "tout le marché. Ce constat fixe le plafond réaliste de l'architecture actuelle et "
    "priorise la suite : enrichissement dimensionnel plutôt que recalibration."))

# ---------- 2. Données et méthodologie ----------
section(story, "2. Données et méthodologie")

section(story, "2.1 Source et périmètre", 1)
story.append(P(
    "Le jeu de données DanMcInerney/mma-ai (Hugging Face, licence spécifique, août 2026) "
    "contient les dumps PostgreSQL d'un pipeline complet : 764 événements, 7 704 combats, "
    "4 587 combattants, statistiques brutes par round (coups significatifs tentés/réussis, "
    "takedowns, tentatives de soumission, temps de contrôle, cibles tête/corps/jambes, "
    "positions distance/clinch/sol) et une base de cotes BestFightOdds couvrant 6 546 "
    "combats avec probabilités implicites sans vig de clôture. Les valeurs agrégées "
    "pré-calculées du jeu de données ont été écartées au profit des comptes bruts par "
    "round de la table fight_stats_core, seuls les totaux reconstitués par somme des "
    "rounds et les durées vérifiées (décision de 3 rounds = 900 s exactement, arrêts "
    "concordants avec le round et la seconde de fin) étant utilisés."))
story.append(BUL("Période : octobre 1998 → août 2026 ; 1 073 combats avant 2010, 6 631 après."))
story.append(BUL("Combats décidés (vainqueur désigné) : 7 561 ; nuls et sans-contest exclus "
                 "des métriques."))
story.append(BUL("Cotes : cotes de clôture décimales converties en probabilités implicites "
                 "sans vig (somme à 1 par combat), utilisées uniquement comme référence, "
                 "jamais comme entrée du modèle."))

section(story, "2.2 Rejeu anti-fuite", 1)
story.append(P(
    "Le moteur voltrix-mma-v1 a été porté en script Node hors ligne, à l'identique de "
    "src/lib/mma : calcul des onze dimensions (forme sur 5 combats, volume et précision "
    "de carrière, absorption et défenses sur les 8 derniers combats, lutte, défense de "
    "takedown, soumissions, pouvoir de finition, expérience, envergure), amortissements ε "
    "et planchers floor par dimension, agrégation pondérée par les poids publics, "
    "transformation logistique de pente 2,6, bornage des probabilités à 25-75 % et refus "
    "de pronostic sous trois dimensions comparables. Les états (statistiques de carrière, "
    "fenêtre de 8 combats, forme) sont mis à jour séquentiellement dans l'ordre "
    "chronologique : pour chaque combat évalué, le modèle ne voit que les combats "
    "strictement antérieurs. La validation a porté le portage au centième près : les "
    "statistiques de carrière reconstituées de Jon Jones avant UFC 309 (SLpM 4,29 contre "
    "4,30 publié, précision 57,9 % contre environ 57 %) confirment l'exactitude de la "
    "reconstruction."))
story.append(BUL("Découpage temporel : apprentissage avant 2023, validation 2023-24, "
                 "test 2025-26 — aucune constante n'est ajustée sur le test."))
story.append(BUL("Métriques : précision du vainqueur, score de Brier et log-loss sur la "
                 "probabilité du vainqueur ; calibration symétrisée (chaque combat compté "
                 "dans les deux orientations) pour neutraliser tout artefact d'ordre."))

section(story, "2.3 Artefacts du jeu de données identifiés et neutralisés", 1)
story.append(P(
    "Deux particularités ont été détectées et traitées. D'une part, avant 2010, le "
    "premier combattant listé est toujours le vainqueur (ordre « vainqueur d'abord », "
    "vérifié sur des combats célèbres : Serra-Saint Pierre 2007, Liddell-Silva 2007, "
    "Saint Pierre-Hughes 2006) — les issues restent correctes et seuls les labels "
    "positionnels sont biaisés ; comme le moteur est rigoureusement symétrique "
    "(l'échange des deux combattants ne change pas son pronostic), ses métriques sont "
    "invariantes par échange et l'évaluation reste valide sur toute la période. La "
    "baseline naïve « toujours le premier combattant » n'est néanmoins pas rapportable "
    "avant 2010 (100 % par construction). D'autre part, la base ne couvre que l'UFC : "
    "les carrières reconstituées ignorent les combats hors UFC, comme le font aussi les "
    "statistiques de carrière ESPN utilisées par l'application — l'écart de périmètre est "
    "donc le même dans le backtest et dans l'app."))

# ---------- 3. Résultats ----------
section(story, "3. Résultats du moteur tel que construit")
rows_t = []
for s, lab in [("TRAIN", "Apprentissage (< 2023)"), ("VAL", "Validation (2023-24)"),
               ("TEST", "Test (2025-26)")]:
    rows_t.append([lab, f"{AB[s]['n']}", pct(AB[s]["acc"]),
                   f"{AB[s]['brier']:.4f}".replace(".", ","),
                   f"{AB[s]['logloss']:.4f}".replace(".", ","),
                   f"{MK[s]['n']}", pct(MK[s]["acc"])])
rows_t.append(["2010 → 2026 (hors artefact)", f"{AB['since2010']['n']}",
               pct(AB["since2010"]["acc"]),
               f"{AB['since2010']['brier']:.4f}".replace(".", ","),
               f"{AB['since2010']['logloss']:.4f}".replace(".", ","), "—", "—"])
story.append(table(rows_t,
                   ["Fenêtre", "n modèle", "Précision", "Brier", "Log-loss",
                    "n marché", "Précision marché"],
                   [0.26, 0.10, 0.13, 0.12, 0.12, 0.11, 0.16], left_cols=(0,)))
story.append(Paragraph("Table 1 — Métriques du moteur par fenêtre temporelle ; la référence "
                       "marché (cotes de clôture sans vig) est rappelée à droite.",
                       S["caption"]))
story.append(P(
    "Le moteur prédit le vainqueur dans 75,1 % des combats décidés (5 682 sur 7 561) : "
    "les refus concernent les débuts dans l'organisation, pour lesquels moins de trois "
    "dimensions sont comparables — c'est le comportement de prudence voulu par la "
    "conception. Sur ces combats couverts, la précision est de 56,0 % en apprentissage, "
    "55,8 % en validation et 56,5 % en test : aucune dégradation temporelle, signe que "
    "le modèle ne surapprend pas une époque particulière. La précision est identique "
    "sur la seule période moderne (55,8 % depuis 2010), ce qui écarte un quelconque "
    "effet de l'artefact pré-2010."))
story.extend(figure(os.path.join(CHARTS, "fig1-metrics.png"),
                    "Figure 1 — Précision, Brier et log-loss par fenêtre : le moteur (bleu) "
                    "face à la référence marché (rouge). Le marché domine nettement, "
                    "mais le moteur est stable dans le temps.", max_h=225))
story.extend(figure(os.path.join(CHARTS, "fig3-annees.png"),
                    "Figure 2 — Précision par année (barres : effectifs prédits). Les "
                    "premières années sont bruitées (faibles effectifs, historiques courts) ; "
                    "la précision se stabilise autour de 55-58 % à partir de 2010.", max_h=225))

# ---------- 4. Calibration ----------
section(story, "4. Calibration et recherche de constantes")
rows_c = []
for b in R["calibrationSym"]:
    if b["n"] > 0:
        rows_c.append([f"{b['lo']}-{b['hi']} %", f"{b['n']}",
                       pct(b["avgPred"] / 100, 1), pct(b["wins"] / b["n"], 1)])
story.append(table(rows_c,
                   ["Classe de probabilité prédite", "Combats", "Prédit (moy.)",
                    "Observé"],
                   [0.34, 0.18, 0.24, 0.24]))
story.append(Paragraph("Table 2 — Calibration symétrisée : la fréquence observée suit la "
                       "probabilité prédite au point près entre 40 et 70 %, avec un léger "
                       "surcroît de confiance aux extrêmes (72,6 % prédits, 62,8 % observés).",
                       S["caption"]))
story.extend(figure(os.path.join(CHARTS, "fig2-calibration.png"),
                    "Figure 3 — Courbe de calibration symétrisée (taille des points "
                    "proportionnelle à l'effectif) : la courbe du moteur longe la "
                    "diagonale sur le cœur de la distribution.", max_h=265))
story.append(P(
    "Une recherche en grille de 112 configurations a été menée sur la période "
    "d'apprentissage avec sélection sur la validation : pente logistique K de 2,6 à 12, "
    "bornes de probabilité de (25, 75) à (10, 90), poids de la forme de 1,0 à 2,5. "
    "Résultat net : aucune configuration ne bat la version actuelle au-delà du bruit. "
    "La meilleure candidate (K = 2,6, poids de forme 2,5) gagne 0,4 point de précision "
    "en validation — moins d'un quart de l'erreur-type d'échantillonnage (1,9 point sur "
    "670 combats) — et les pentes plus agressives dégradent systématiquement le log-loss. "
    "Le bornage à 25-75 % n'est jamais actif assez souvent pour distinguer les variantes : "
    "l'amortissement des dimensions fait déjà le travail de compression. Conclusion : les "
    "constantes du moteur sont validées telles quelles par le backtest."))
story.extend(figure(os.path.join(CHARTS, "fig5-grille.png"),
                    "Figure 4 — Log-loss de validation par pente logistique et poids de "
                    "forme : le minimum se situe à K = 2,6, la configuration exacte du "
                    "moteur en production.", max_h=235))

# ---------- 5. Analyses complémentaires ----------
section(story, "5. Analyses complémentaires")

section(story, "5.1 Face au marché des cotes", 1)
story.append(P(
    "Sur les 5 015 combats couverts à la fois par le moteur et par des cotes de clôture "
    "déséquilibrées, le modèle suit le favori du marché dans 61,1 % des cas. Quand il le "
    "suit, sa précision grimpe à 67,8 % ; quand il le contredit (38,9 % des combats), "
    "elle s'effondre à 36,7 % — bien en dessous du hasard. Autrement dit, toute la "
    "valeur du modèle se concentre dans les combats où il rejoint le marché, et ses "
    "divergences sont presque toujours des erreurs. C'est la signature attendue d'un "
    "modèle sans accès aux cotes face à un marché efficient : l'information du marché "
    "subsume celle des statistiques de combat publiques."))
story.extend(figure(os.path.join(CHARTS, "fig4-marche.png"),
                    "Figure 5 — À gauche, précision du modèle selon qu'il suit ou contredit "
                    "le favori du marché ; à droite, distribution des probabilités prédites "
                    "(la compression vers 40-60 % voulue par la conception est nettement "
                    "visible).", max_h=225))

section(story, "5.2 Méthode de victoire et étiquette de confiance", 1)
story.append(BUL("La « méthode de victoire » du favori (KO/TKO, soumission, décision, "
                 "déduite de la répartition de ses victoires) est correcte dans 45,7 % "
                 "des cas où le favori gagne (n = 3 086) — exactement le niveau du hasard "
                 "informé (47,0 % en prenant toujours la méthode la plus fréquente). "
                 "Ce module est une information de style, pas un prédicteur : l'app "
                 "le présente comme tel et doit continuer à le faire."))
story.append(BUL("L'étiquette de confiance de l'app (formule 0,45 × couverture + 0,55 × "
                 "couverture cœur) est « Bonne » pour 100 % des 5 682 pronostics de ce "
                 "rejeu : la couverture dimensionnelle est presque toujours complète "
                 "quand le moteur accepte de pronostiquer. Cette étiquette ne discrimine "
                 "donc rien ici — elle ne retrouverait de l'intérêt que nourrie au volume "
                 "de données (nombre de combats dans la fenêtre, ancienneté des stats)."))
story.append(BUL("Le nombre de dimensions comparables n'apporte pas non plus de gradient "
                 "exploitable : 56,3 % avec 6-8 dimensions contre 56,0 % avec 9-11."))

# ---------- 6. Limites ----------
section(story, "6. Limites et lecture honnête")
story.append(BUL("Périmètre UFC seul : les combats PFL, ONE ou Bellator traités par l'app "
                 "ne sont pas couverts ; les styles de jeu y diffèrent et la précision "
                 "peut varier."))
story.append(BUL("La forme reconstituée ignore les combats hors UFC (l'ESPN de l'app peut, "
                 "lui, afficher une forme légèrement différente pour certains combattants "
                 "ayant lutté ailleurs)."))
story.append(BUL("Les statistiques manquantes d'ufcstats sont rares mais réelles ; elles "
                 "sont traitées comme indisponibles (dimension retirée), comme dans l'app."))
story.append(BUL("L'écart au marché (56 % contre 71 % en test) n'est pas une anomalie du "
                 "portage : c'est la limite structurelle d'un modèle public sans cotes. "
                 "L'estimation initiale de 62-65 % de plafond pour ce moteur était trop "
                 "optimiste ; le plafond mesuré de l'architecture à onze dimensions est "
                 "d'environ 56-58 %."))
story.append(BUL("La grille de calibration explore pente, bornes et poids de forme ; elle "
                 "ne re-pondère pas les onze dimensions une à une (sur-apprentissage quasi "
                 "certain avec 670 combats de validation — laissé comme piste documentée)."))
story.append(BUL("Les tournois des années 1990 (plusieurs combats dans la même soirée) sont "
                 "rejoués dans l'ordre des identifiants internes, qui peut différer de "
                 "l'ordre réel de la soirée ; l'impact est marginal et limité aux premières "
                 "années."))

# ---------- 7. Conclusions ----------
section(story, "7. Conclusions et suite appliquée")
story.append(P(
    "Ce backtest remplit sa mission : il établit la référence mesurée du moteur MMA et "
    "valide ses constantes. En synthèse : précision de 56,5 % en test (n = 563) et de "
    "55,8 % sur toute la période moderne ; calibration quasi parfaite sur le cœur de la "
    "distribution ; refus de pronostic sur un quart des combats (débuts) conforme à la "
    "conception ; aucune constante à changer. Les suites appliquées à l'application sont "
    "les suivantes :"))
story.append(BUL("Aucune recalibration : K = 2,6, bornes 25-75 % et poids des dimensions "
                 "sont confirmés ; la référence de ce backtest est désormais citée dans "
                 "le code du moteur."))
story.append(BUL("La « méthode de victoire » reste présentée comme information de style "
                 "(mesure : aucune valeur prédictive au-delà de la fréquence de base)."))
story.append(BUL("Priorité donnée à l'implémentation n° 4 du plan d'amélioration — "
                 "enrichissement dimensionnel (cibles tête/corps/jambes et positions "
                 "distance/clinch/sol, disponibles dans les mêmes sources ESPN) — car "
                 "c'est le seul levier identifié pour élever le plafond de 56 % vers "
                 "58-60 % sans toucher au principe « sans cotes » du moteur."))
story.append(BUL("Suivi de la recommandation n° 5 : l'écran de suivi ROI/Brier déjà livré "
                 "pour le football pourra réutiliser ce même harnais de rejeu pour "
                 "surveiller la dérive du moteur MMA en production."))

doc = TocDocTemplate(OUT_BODY, pagesize=A4,
                     leftMargin=MARGIN, rightMargin=MARGIN,
                     topMargin=2.1 * cm, bottomMargin=1.9 * cm,
                     title="Backtest du moteur MMA VOLTRIX",
                     author="VOLTRIX bet")
toc = TableOfContents()
toc.levelStyles = [S["toc0"], S["toc1"]]

story.insert(0, H("Table des matières"))
story.insert(1, toc)
story.insert(2, PageBreak())

doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print("OK :", OUT_BODY)

# ---------- export CSV des résultats par combat (validation + test) ----------
csv_path = os.path.join(HERE, "resultats-combats-val-test.csv")
with open(csv_path, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["date", "combattant_A", "combattant_B", "vainqueur_est_A",
                "probabilite_A_pct", "confiance", "dimensions", "methode_reelle",
                "round_fin", "probabilite_marche_A"])
    for r in R["rows"]:
        if r["split"] == "TRAIN":
            continue
        w.writerow([r["date"], r["f1"], r["f2"], "oui" if r["winnerIsF1"] else "non",
                    f"{r['pA']:.1f}".replace(".", ","), f"{r['confidence']:.0f}",
                    r["nDims"], r["method"], r["endRound"],
                    f"{r['marketIp1']:.4f}".replace(".", ",") if r["marketIp1"] is not None else ""])
print("OK :", csv_path)
