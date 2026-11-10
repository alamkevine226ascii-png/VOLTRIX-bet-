#!/usr/bin/env python3
# ============================================================
# VOLTRIX — Rapport PDF de backtest du moteur football
# Voie Report (ReportLab) — Template 07 Crystal Blue (body clair)
# Règles appliquées : TocDocTemplate + multiBuild, Paragraph()
# dans toutes les cellules, colWidths ≤ largeur disponible,
# fit_image, safe_keep_together, CondPageBreak anti-orphelin,
# marges symétriques, palette unique famille bleue.
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

# ---------- chemins ----------
HERE = os.path.dirname(os.path.abspath(__file__))
CHARTS = os.path.join(HERE, "charts_pdf")
OUT_BODY = os.path.join(HERE, "rapport_body.pdf")

# ---------- polices (liste autorisée uniquement) ----------
FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC-Bold", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf"))
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")
registerFontFamily("NotoSerifSC", normal="NotoSerifSC", bold="NotoSerifSC-Bold")

sys.path.insert(0, "/home/z/my-project/skills/pdf/scripts")
from pdf import install_font_fallback  # noqa: E402
install_font_fallback()

# ---------- palette Template 07 (corps clair, famille bleue) ----------
PAGE_BG = colors.HexColor("#f5f8fc")
CARD_BG = colors.HexColor("#e4ecf5")
TABLE_STRIPE = colors.HexColor("#eef3fa")
HEADER_FILL = colors.HexColor("#1a4a7a")
BORDER = colors.HexColor("#c0d0e2")
ACCENT = colors.HexColor("#2d7ab3")
TEXT_PRIMARY = colors.HexColor("#142840")
TEXT_MUTED = colors.HexColor("#5a7a96")

# ---------- page ----------
MARGIN = 1.9 * cm
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
H1_ORPHAN = (PAGE_H - 2 * MARGIN) * 0.18

# ---------- styles ----------
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

# ---------- gabarit avec TOC ----------
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            self.notify("TOCEntry", (level, text, self.page, key))

def on_page(canvas, doc):
    canvas.saveState()
    # fond de page bleu très clair (famille Template 07)
    canvas.setFillColor(PAGE_BG)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    # en-tête
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - 1.15 * cm, "VOLTRIX bet — Backtest du moteur football")
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 1.3 * cm, PAGE_W - MARGIN, PAGE_H - 1.3 * cm)
    # pied de page
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, 1.25 * cm, PAGE_W - MARGIN, 1.25 * cm)
    canvas.setFont("FreeSerif", 7.5)
    canvas.drawString(MARGIN, 0.9 * cm, "Moteur voltrix-foot-v2 · football-data.co.uk 2010-2026")
    canvas.drawRightString(PAGE_W - MARGIN, 0.9 * cm, f"Page {doc.page}")
    canvas.restoreState()

# ---------- helpers ----------
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
    """data_rows : listes de chaînes ; ratios : proportions (somme 1)."""
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
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), TABLE_STRIPE))
        else:
            style.append(("BACKGROUND", (0, i), (-1, i), colors.white))
    t.setStyle(TableStyle(style))
    return t

def callout_row(items):
    """items : [(valeur, libellé), ...] — bandeau de statistiques."""
    n = len(items)
    cells, labels = [], []
    for v, lab in items:
        cells.append(Paragraph(f"<b>{v}</b>", S["stat"]))
        labels.append(Paragraph(lab, S["statlab"]))
    w = AVAIL_W / n
    t = Table([cells, labels], colWidths=[w] * n)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("BOX", (0, 0), (-1, -1), 0.8, ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
    ]))
    return t

def section(story, title, level=0):
    story.append(CondPageBreak(H1_ORPHAN) if level == 0 else Spacer(1, 6))
    story.append(H(title, level))

# ============================================================
# Données numériques (issues des runs backtest)
# ============================================================
with open(os.path.join(HERE, "optimisation_v2.json"), encoding="utf-8") as f:
    OPT = json.load(f)
with open(os.path.join(HERE, "baseline_results.json"), encoding="utf-8") as f:
    BASE = json.load(f)

EV = OPT["evaluation_finale"]
PG = OPT["params_opt_global"]

# n cotes OU marché (VAL+TEST) — recompté depuis les données
import numpy as np  # noqa: E402
sys.path.insert(0, HERE)
from voltrix_foot import compute_features  # noqa: E402
rows = compute_features(["E0", "E1", "SP1", "D1", "I1", "F1"],
                        [f"{y:02d}{(y+1)%100:02d}" for y in range(9, 26)], "1011")
seasons = np.array([r["season"] for r in rows])
ou_o = np.array([r["b365_over25"] for r in rows])
ou_u = np.array([r["b365_under25"] for r in rows])
ou_n = int(((seasons > "2324") & np.isfinite(ou_o) & np.isfinite(ou_u) &
            (ou_o > 1.01) & (ou_u > 1.01)).sum())
draw_real_test = float(np.mean([r["y"] == 1 for r, s in zip(rows, seasons) if s > "2324"]))

def ev(name, w, k):
    return EV[f"{name}|{w}"][k]

def fmt_pct(x, d=2):
    return f"{x*100:.{d}f} %"

# ============================================================
# Construction du document
# ============================================================
doc = TocDocTemplate(
    OUT_BODY, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=1.85 * cm, bottomMargin=1.7 * cm,
    title="Backtest du moteur football VOLTRIX",
    author="Z.ai", creator="Z.ai",
    subject="Évaluation hors-échantillon du moteur voltrix-foot sur football-data.co.uk 2010-2026",
)
story = []

# ---------- TOC ----------
story.append(Paragraph("<b>Sommaire</b>", S["h1"]))
story.append(HRFlowable(width="100%", color=ACCENT, thickness=1.2, spaceAfter=10))
toc = TableOfContents()
toc.levelStyles = [S["toc0"], S["toc1"]]
story.append(toc)
story.append(PageBreak())

# ---------- 1. Synthèse ----------
section(story, "1. Synthèse exécutive")
story.append(P(
    "Ce rapport présente le backtest complet du moteur de prédiction football de VOLTRIX "
    "(voltrix-foot-v2), répliqué à l'identique en Python et rejoué sur 37 715 matchs "
    "issus de football-data.co.uk : six championnats (Premier League, Championship, LaLiga, "
    "Bundesliga, Serie A, Ligue 1) couvrant les saisons 2010-11 à 2025-26. La méthodologie "
    "est strictement anti-fuite : chaque match n'est prédit qu'avec les données antérieures à "
    "sa date, la fenêtre de deux saisons reproduit exactement le chargement de l'application, "
    "et les constantes ont été optimisées sur la fenêtre de validation (2022-24) avant d'être "
    "évaluées une seule fois sur la fenêtre de test (2024-26)."))
story.append(Spacer(1, 6))
story.append(callout_row([
    ("37 715", "matchs évalués<br/>(6 ligues, 16 saisons)"),
    (fmt_pct(ev("opt-global", "TEST", "acc")), "précision 1X2 en test<br/>(as-built : 50,09 %)"),
    ("−0,0113", "log-loss gagné en test<br/>(1,0166 → 1,0053)"),
    ("−3,7 %", "ROI value bets avec la<br/>discipline calibrée (vs −12,8 %)"),
]))
story.append(Spacer(1, 10))
story.append(P(
    "Trois enseignements majeurs ressortent. Premièrement, le moteur as-built est déjà "
    "sain : 50,1 % de précision et un log-loss de 1,017 en test, à 1,8 points de précision "
    "du marché Bet365 dé-margé — l'écart attendu pour un modèle sans information de marché. "
    "Deuxièmement, la recalibration des constantes (parts de nul, pondérations du blend, "
    "paramètres Elo) apporte un gain homogène et sans surapprentissage : le log-loss de test "
    "passe de 1,0166 à 1,0110, porté surtout par la correction de la sous-estimation des nuls "
    "(23,1 % prédit contre 25,7 % réel). Troisièmement, la simulation de value betting "
    "démontre que la règle actuelle (seuil d'edge de 2 %, sans plafond de cote) perd 12,8 % "
    "en mise plate sur la fenêtre de test : la discipline retenue — seuil 5 % et cote "
    "plafonnée à 2,5 — réduit cette perte de 71 %."))

# ---------- 2. Méthodologie ----------
section(story, "2. Méthodologie et garanties anti-fuite")
section(story, "2.1 Données et réplication du moteur", 1)
story.append(P(
    "Les fichiers CSV de football-data.co.uk fournissent, par ligue et par saison, la date, "
    "les équipes, le score final et les cotes Bet365 (1X2, et Over/Under 2,5 à partir de "
    "2019-20). Le moteur a été répliqué ligne à ligne depuis src/lib/foot/prediction.ts : "
    "calcul des forces d'attaque/défense avec retrait vers la moyenne (SHRINK_K = 10), "
    "pondération contexte contre global (w = gp/(gp+6)), modificateurs de fatigue et de derby, "
    "injection de forme, redistribution Elo à total de buts conservé, puis grille conjointe "
    "du Poisson bivarié (ρ = 0,10) dont sont tirés le 1X2, l'Over/Under et le BTTS. L'Elo "
    "est rejoué exactement comme dans l'application : il couvre l'union des calendriers des "
    "deux équipes sur la fenêtre de deux saisons, les adversaires partant de 1500."))
story.append(BUL("Fenêtre par équipe : saison précédente + saison courante de la même ligue — "
                 "une équipe promue n'a que sa saison courante, comme les calendriers ESPN par ligue de l'app."))
story.append(BUL("Un match n'est prédit qu'avec des matchs strictement antérieurs à sa date ; "
                 "la saison 2009-10 sert uniquement de warm-up et n'est pas évaluée."))
story.append(BUL("Blessures : données indisponibles dans la source → modificateur neutre (×1). "
                 "Son impact maximal dans l'app est de 8 % sur λ, en pratique bien moins."))
story.append(BUL("Altitude et météo : dormantes en Europe (aucun stade des six ligues au-dessus "
                 "de 1 500 m ; la météo ne touche plus les λ depuis l'audit 21-b)."))
section(story, "2.2 Découpage temporel et protocole", 1)
story.append(P(
    "L'échantillon est découpé en trois fenêtres strictement chronologiques : entraînement "
    "2010-22 (28 425 matchs, aucune optimisation n'y est directe), validation 2022-24 "
    "(4 682 matchs, seul espace où les constantes sont cherchées, par descente coordonnée "
    "sur des grilles grossières en deux passes) et test 2024-26 (4 608 matchs, évalué une "
    "seule fois, après fixation définitive des constantes). Les métriques sont la précision "
    "1X2, le log-loss multi-classes, le score de Brier et le RPS (score de probabilité "
    "rangé, standard football). Le marché Bet365 dé-margé sert d'étalon ; ses cotes étant "
    "collectées le vendredi pour les matchs du week-end, elles constituent une référence "
    "légèrement plus faible que des cotes de clôture."))
story.append(Paragraph(
    "« Un backtest qui regarde ne serait-ce qu'un match d'avance surestime tout. Ici, chaque "
    "prédiction est faite comme si l'utilisateur consultait l'app la veille du match. »",
    S["quote"]))

# ---------- 3. As-built ----------
section(story, "3. Performance du moteur as-built")
rows_t1 = []
for name, label in (("as-built (local)", "As-built (v2.1)"), ("opt-local", "Constantes optimisées"),
                    ("opt-global", "Opt. + Elo global (piste v3)"), ("marche-B365", "Marché Bet365 dé-margé")):
    for w, wl in (("VAL", "Validation 2022-24"), ("TEST", "Test 2024-26")):
        rows_t1.append([label, wl,
                        fmt_pct(ev(name, w, "acc")), f"{ev(name, w, 'logloss'):.4f}",
                        f"{ev(name, w, 'brier'):.4f}", f"{ev(name, w, 'rps'):.4f}",
                        fmt_pct(ev(name, w, "draw_pred"), 1)])
t1 = table(rows_t1, ["Configuration", "Fenêtre", "Précision", "Log-loss", "Brier", "RPS", "E[nul]"],
           [0.235, 0.165, 0.11, 0.11, 0.11, 0.11, 0.16], left_cols=(0,))
story.append(t1)
story.append(Paragraph("Table 1 — Métriques 1X2 par configuration. E[nul] = part de nuls "
                       "prédite ; le taux réel est de 25,3 % (validation) et "
                       f"{draw_real_test*100:.1f} % (test).", S["caption"]))
story.append(P(
    "Le moteur as-built atteint 50,1 % de précision en test pour un log-loss de 1,0166, "
    "contre 51,9 % et 0,9873 pour le marché. La décomposition par composante est "
    "instructive : l'Elo seul (50,3 % en test) est légèrement plus précis que le blend "
    "complet, tandis que la forme seule (44,6 %) est le maillon faible — sous le niveau du "
    "« toujours domicile » (44,6 % en test sur cette période où l'avantage du terrain "
    "s'est réduit). Le blend reste néanmoins le meilleur en log-loss, la forme apportant "
    "de la diversité plus que du signal. Le point de calibration le plus dégradé est le "
    "nul : 23,1 % prédit contre 25,7 % réel, soit une perte sèche de log-loss sur "
    "l'issue la plus fréquente après la victoire à domicile."))
story.extend(figure(os.path.join(CHARTS, "fig1-metrics.png"),
                    "Figure 1 — Log-loss, RPS et précision 1X2 (moyenne validation + test) : "
                    "les trois configurations du moteur face au marché Bet365 dé-margé.", 225))
bl = BASE["by_league_val_test"]
rows_t2 = [[ln, str(int(2280 if k == "E0" else 0)) if False else "", "", "", ""]
           for k, ln in []]  # placeholder vide
league_order = [("Premier League", "E0"), ("Championship", "E1"), ("LaLiga", "SP1"),
                ("Bundesliga", "D1"), ("Serie A", "I1"), ("Ligue 1", "F1")]
# précision par ligue marché : recalcul rapide depuis baseline (données as-built)
rows_t2 = []
for ln, _ in league_order:
    d = bl[ln]
    rows_t2.append([ln, fmt_pct(d["acc"]), f"{d['logloss']:.4f}", fmt_pct(d["rps"], 4)])
t2 = table(rows_t2, ["Championnat (validation + test)", "Précision as-built", "Log-loss", "RPS"],
           [0.40, 0.22, 0.19, 0.19], left_cols=(0,))
story.append(t2)
story.append(Paragraph("Table 2 — Performance as-built par championnat, fenêtres validation et "
                       "test combinées (n = 1 224 à 2 208 par ligue).", S["caption"]))
story.append(P(
    "Le Championship est la ligue la plus difficile (44,4 % de précision, log-loss 1,058) — "
    "c'est aussi celle où le marché est le moins bon (46,9 %) : 24 équipes, beaucoup de "
    "relégations et de rotations. Les cinq autres championnats se tiennent entre 51 et 53 %. "
    "Partout, l'écart au marché est de 1,5 à 3 points de précision, l'ordre de grandeur "
    "attendu entre un modèle public fondé sur les résultats et un bookmaker agrégant aussi "
    "des informations d'équipes, de blessures et de mise."))

# ---------- 4. Optimisation ----------
section(story, "4. Recalibration des constantes")
story.append(P(
    "La descente coordonnée sur la fenêtre de validation fait ressortir des mouvements "
    "cohérents, que la fenêtre de test confirme ensuite sans retournement. Le gain le plus "
    "net vient de la part de nul : la formule eloToProbs sous-estimait structurellement les "
    "nuls (base 0,30 avec pente 1,4) ; la recalibration monte la base à 0,36 et réduit la "
    "pente à 0,7, ce qui ramène le nul prédit de 23,1 % à 25,2 %. Les pondérations du blend "
    "glissent de 45/30/25 vers 40/35/25 au profit de l'Elo, dont le facteur K descend à 10 "
    "avec un avantage du terrain porté à 110 points — logique pour un Elo local dont les "
    "ratings sont comprimés vers 1500. Le modificateur de fatigue (×0,94) est neutralisé "
    "par la recherche : il n'améliore rien, preuve à l'appui de sa suppression. Enfin "
    "l'amplitude d'injection de la forme est réduite (0,2 → 0,1), cohérent avec la faiblesse "
    "du signal de forme isolé."))
rows_t3 = [
    ["Part de nul (Elo)", "base 0,30 / pente 1,4", "base 0,36 / pente 0,7", "nul prédit 23,1 → 25,2 %"],
    ["Part de nul (forme)", "base 0,28 / pente 1,2", "base 0,32 / pente 0,6", "calibration du nul"],
    ["Blend Poisson/Elo/Forme", "45 / 30 / 25", "40 / 35 / 25", "log-loss −0,002"],
    ["Elo (K, avantage terrain)", "K = 22, +65", "K = 10, +110", "log-loss −0,002"],
    ["Redistribution Elo", "10^(diff/800)", "10^(diff/1000)", "λ moins sensibles à l'Elo"],
    ["Injection de forme", "×(0,9 + 0,2·f)", "×(0,9 + 0,1·f)", "signal de forme atténué"],
    ["Bornes λ domicile/extérieur", "[0,3 ; 3,8] / [0,25 ; 3,4]", "[0,25 ; 4,4] / [0,20 ; 4,0]", "queues moins tronquées"],
    ["Fatigue (≤3 j ou 3 matchs/14 j)", "λ × 0,94", "neutralisée (×1,0)", "aucun gain mesurable"],
    ["Derby", "λ × 0,92", "λ × 0,88", "gain marginal (−0,0003)"],
    ["ρ Poisson bivarié", "0,10", "0,10 (inchangé)", "grille confirmée"],
]
t3 = table(rows_t3, ["Paramètre", "As-built (v2.1)", "Optimisé (v2.2)", "Effet mesuré"],
           [0.26, 0.24, 0.24, 0.26], left_cols=(0, 1, 2, 3))
story.append(t3)
story.append(Paragraph("Table 3 — Constantes recalibrées sur la validation 2022-24 ; la fenêtre "
                       "de test confirme chaque direction (log-loss 1,0166 → 1,0110).", S["caption"]))
story.extend(figure(os.path.join(CHARTS, "fig4-nuls.png"),
                    "Figure 2 — Calibration des nuls par saison (fenêtres validation + test) : "
                    "la moyenne des probabilités de nul colle désormais au taux réel.", 215))
story.extend(figure(os.path.join(CHARTS, "fig2-calibration.png"),
                    "Figure 3 — Calibration des probabilités en test 2024-26 : chaque point "
                    "représente un intervalle de probabilité annoncée (taille ∝ effectif).", 225))

# ---------- 5. Elo global ----------
section(story, "5. Elo global : la piste v3 chiffrée")
story.append(P(
    "L'Elo de l'application est « local » : il ne voit que les matchs des deux équipes "
    "concernées, tous les adversaires étant notés 1500 par défaut. Nous avons testé la "
    "variante « globale », où le classement Elo de toute la ligue est mis à jour match après "
    "match — chaque équipe étant notée à travers toutes ses rencontres. Attention : notre "
    "première implémentation de ce test enregistrait le rating après la mise à jour par le "
    "match courant, une fuite classique qui faisait apparaître un log-loss absurde de 0,963, "
    "mieux que le marché. Corrigée (différence enregistrée avant la mise à jour), la "
    "variante donne un gain réel mais honnête : log-loss de test 1,0053 contre 1,0110 pour "
    "l'Elo local optimisé, soit la moitié du gain total de ce backtest."))
story.append(P(
    "Cette piste n'est pas appliquée aujourd'hui : l'API scoreboard d'ESPN ne supporte pas "
    "les plages de dates (HTTP 400), reconstruire l'Elo d'une ligue entière exigerait une "
    "trentaine de requêtes par ligue au premier chargement — lourd pour une app 100 % "
    "navigateur. Elle reste documentée comme évolution v3 prioritaire si un jour le moteur "
    "peut s'appuyer sur un état persistant par ligue reconstruit en arrière-plan."))
story.extend(figure(os.path.join(CHARTS, "fig5-saisons.png"),
                    "Figure 4 — Précision 1X2 par saison : as-built, optimisé + Elo global, et "
                    "marché Bet365 dé-margé (fenêtres validation + test).", 225))
story.append(P(
    "L'hybride 65 % marché + 35 % modèle — exactement ce que l'application affiche déjà "
    "dans les profils de risque depuis la task 61 — atteint pour sa part 51,5 % de précision "
    "et 0,9908 de log-loss en test, en utilisant l'information de marché. C'est le meilleur "
    "compromis pratique : le moteur brut reste indépendant (pour les value bets), l'affichage "
    "utilise le marché quand il existe."))

# ---------- 6. Marchés de buts ----------
section(story, "6. Marchés de buts et moyennes par ligue")
story.append(P(
    "Sur l'Over/Under 2,5, le modèle optimisé atteint 54,5 % de précision et 0,6995 de "
    "log-loss sur validation + test, contre 57,9 % et 0,6736 au marché (sous-échantillon de "
    f"{ou_n} matchs disposant des cotes O/U Bet365). Le BTTS reste le marché le plus difficile "
    "(environ 50 % de précision). L'apport des moyennes de buts par ligue — l'implémentation "
    "n°2 du plan d'amélioration — est mesuré ici : remplacer les constantes globales 1,52/1,22 "
    "par les moyennes réelles de la saison précédente de chaque championnat améliore la "
    "précision O/U 2,5 de +0,3 point (54,25 → 54,54 %) et le log-loss de 0,0013, sans effet "
    "détectable sur le 1X2. L'écart entre ligues est massif : 3,13 buts par match en Bundesliga "
    "contre 2,45 en Championship — une échelle globale ne peut pas être juste partout."))
rows_t5 = [[lp, f"{d['home']:.2f}", f"{d['away']:.2f}", f"{d['total']:.2f}"]
           for lp, d in OPT["league_params"].items()]
t5 = table(rows_t5[:14], ["Code football-data", "Buts/match domicile", "Buts/match extérieur", "Total"],
           [0.28, 0.26, 0.26, 0.20])
story.append(t5)
story.append(Paragraph("Table 4 — Moyennes de buts empiriques par championnat (saison 2025-26, "
                       "source football-data.co.uk) : valeurs injectées dans league-params.ts.",
                       S["caption"]))

# ---------- 7. Value bets ----------
section(story, "7. Value bets : la discipline avant l'edge")
story.append(P(
    "La simulation rejoue la logique exacte de buildValueBets : probabilités brutes du modèle "
    "contre cotes Bet365, pari plat d'une unité quand l'edge dépasse un seuil. Sur la fenêtre "
    "de test (4 608 matchs), la règle actuelle — seuil 2 %, sans plafond — génère 3 913 paris "
    "et un retour sur mise de −12,8 %. Le diagnostic est net : les sélections se concentrent "
    "sur les outsiders (cote moyenne 4,36) alors que les paris gagnants sortent à 3,13 — le "
    "biais favori/outsider classique des bookmakers, que le modèle amplifie en surestimant "
    "les probabilités extrêmes. Par issue au seuil de 5 % : domicile −16,2 %, extérieur "
    "−11,9 %, nul −3,9 %."))
story.append(P(
    "Augmenter le seuil seul ne suffit pas (−11,9 % à 5 %, −13,9 % à 8 %) : c'est le "
    "plafond de cote qui corrige la sélection. La discipline retenue — seuil d'edge de 5 % "
    "et cote plafonnée à 2,5 — ramène le ROI à −3,7 % sur 766 paris, soit le niveau de la "
    "marge du bookmaker : le modèle ne trouve pas d'edge positif contre Bet365 dans cet "
    "échantillon, mais la discipline protège l'utilisateur de la quasi-totalité des pertes "
    "évitables. Ces chiffres alimentent directement l'implémentation n°5."))
story.extend(figure(os.path.join(CHARTS, "fig3-valuebets.png"),
                    "Figure 5 — ROI en mise plate des disciplines de value betting testées "
                    "(1X2, fenêtre de test 2024-26).", 215))
rows_t4 = [
    ["Seuil 2 % (règle actuelle)", "3 913", "27,8 %", "4,36", "−12,8 %"],
    ["Seuil 5 %", "3 108", "27,2 %", "4,59", "−11,9 %"],
    ["Seuil 8 %", "2 429", "25,4 %", "4,88", "−13,9 %"],
    ["Seuil 5 % + cote ≤ 3,0", "1 130", "42,7 %", "2,27", "−7,3 %"],
    ["Seuil 5 % + cote ≤ 2,5", "766", "48,4 %", "2,03", "−3,7 %"],
]
t4 = table(rows_t4, ["Discipline", "Paris", "Réussite", "Cote moy.", "ROI"],
           [0.34, 0.13, 0.15, 0.16, 0.22], left_cols=(0,))
story.append(t4)
story.append(Paragraph("Table 5 — Simulation value betting 1X2 (mise plate, test 2024-26) : "
                       "seule la combinaison seuil + plafond de cote protège.", S["caption"]))

# ---------- 8. Limites ----------
section(story, "8. Limites et lecture honnête")
story.append(BUL("Cotes de référence : Bet365 collectées le vendredi, pas des cotes de "
                 "clôture — l'étalon marché est légèrement plus faible que le vrai marché de clôture."))
story.append(BUL("Blessures absentes de la source : le backtest neutralise le modificateur ; "
                 "l'app, elle, l'applique (impact plafonné à 8 % sur λ)."))
story.append(BUL("Pas de xG : football-data.co.uk ne fournit pas les buts attendus ; le moteur "
                 "repose sur les buts réels, plus bruités."))
story.append(BUL("Le classement (gamesPlayed) est approché par le décompte des matchs de "
                 "saison courante — exact à un match près de la valeur ESPN."))
story.append(BUL("Optimisation sur 4 682 matchs de validation avec des grilles grossières : "
                 "les gains mesurés en test (−0,005 de log-loss pour les constantes) sont du "
                 "même ordre que le bruit d'échantillonnage au seuil de 95 % ; la cohérence "
                 "des directions entre validation et test est l'argument principal."))
story.append(BUL("Six championnats seulement : les ligues hors Europe et les coupes ne sont "
                 "pas couvertes par ce backtest."))

# ---------- 9. Application ----------
section(story, "9. Ce qui est appliqué dans l'application")
story.append(P(
    "À l'issue de ce backtest, les changements suivants sont intégrés au moteur de "
    "l'application (version voltrix-foot-v2.2) : recalibration des parts de nul Elo et "
    "forme, pondérations du blend 40/35/25, paramètres Elo K = 10 et avantage terrain "
    "+110 avec redistribution /1000, amplitude de forme réduite à 0,1, bornes λ élargies, "
    "neutralisation du modificateur de fatigue, moyennes de buts par championnat via "
    "league-params.ts (implémentation n°2), et discipline de value betting seuil 5 % + "
    "cote ≤ 2,5 avec suivi persistant ROI/Brier (implémentation n°5). L'Elo global est "
    "documenté comme piste v3. Les constantes sont versionnées dans "
    "src/lib/foot/league-params.ts avec la référence de ce backtest, afin que toute future "
    "recalibration parte d'une base tracée."))

doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print("OK :", OUT_BODY)
