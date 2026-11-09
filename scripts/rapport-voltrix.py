# -*- coding: utf-8 -*-
"""Rapport technique VOLTRIX — corps du document (ReportLab).

Structure : TOC auto (TocDocTemplate + multiBuild) puis 8 chapitres.
Couverture générée séparément (Template 01, html2poster.js) et fusionnée.
"""
import os
import sys
import hashlib

PDF_SKILL_DIR = '/home/z/my-project/skills/pdf'
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, 'scripts'))

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Image, KeepTogether, CondPageBreak,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from PIL import Image as PILImage

# ------------------------------------------------------------------
# Polices (uniquement les polices autorisées)
# ------------------------------------------------------------------
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif', f'{FONT_DIR}/truetype/freefont/FreeSerif.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Bold', f'{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Italic', f'{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-BoldItalic', f'{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
registerFontFamily('FreeSerif', normal='FreeSerif', bold='FreeSerif-Bold',
                   italic='FreeSerif-Italic', boldItalic='FreeSerif-BoldItalic')

from pdf import install_font_fallback
install_font_fallback()

# ------------------------------------------------------------------
# Palette cascade (générée par palette.cascade — copiée telle quelle)
# ------------------------------------------------------------------
PAGE_BG       = colors.HexColor('#f6f6f7')
SECTION_BG    = colors.HexColor('#eff0f0')
CARD_BG       = colors.HexColor('#eceeef')
TABLE_STRIPE  = colors.HexColor('#ebeced')
HEADER_FILL   = colors.HexColor('#384a52')
COVER_BLOCK   = colors.HexColor('#5e737e')
BORDER        = colors.HexColor('#bbc9cf')
ICON          = colors.HexColor('#406b81')
ACCENT        = colors.HexColor('#3895c3')
ACCENT_2      = colors.HexColor('#c3465b')
TEXT_PRIMARY  = colors.HexColor('#222526')
TEXT_MUTED    = colors.HexColor('#767d80')
SEM_SUCCESS   = colors.HexColor('#477d59')
SEM_WARNING   = colors.HexColor('#9c7c3c')
SEM_ERROR     = colors.HexColor('#95443c')

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_ROW_EVEN = colors.white
TABLE_ROW_ODD = TABLE_STRIPE

# ------------------------------------------------------------------
# Document
# ------------------------------------------------------------------
OUT_BODY = '/tmp/rapport-body.pdf'
MARGIN = 0.95 * inch
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN

DOC_TITLE = 'VOLTRIX — Rapport technique et test utilisateur'


class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))


def on_page(canvas, doc):
    canvas.saveState()
    # En-tête : titre + filet accent
    canvas.setFont('FreeSerif', 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - 0.55 * inch, DOC_TITLE)
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    # Pied : auteur + numéro de page
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
    canvas.setFont('FreeSerif', 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, 0.45 * inch, 'Z.ai · novembre 2026')
    canvas.drawRightString(PAGE_W - MARGIN, 0.45 * inch, 'Page %d' % doc.page)
    canvas.restoreState()


# ------------------------------------------------------------------
# Styles
# ------------------------------------------------------------------
S = {}
S['h1'] = ParagraphStyle('H1', fontName='FreeSerif', fontSize=20, leading=26,
                         textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10)
S['h2'] = ParagraphStyle('H2', fontName='FreeSerif', fontSize=14.5, leading=20,
                         textColor=TEXT_PRIMARY, spaceBefore=16, spaceAfter=8)
S['h3'] = ParagraphStyle('H3', fontName='FreeSerif', fontSize=11.5, leading=16,
                         textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=6)
S['body'] = ParagraphStyle('Body', fontName='FreeSerif', fontSize=10.5, leading=16.5,
                           textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY,
                           spaceBefore=0, spaceAfter=8)
S['bullet'] = ParagraphStyle('Bullet', fontName='FreeSerif', fontSize=10.5, leading=16,
                             textColor=TEXT_PRIMARY, alignment=TA_LEFT,
                             leftIndent=14, bulletIndent=2, spaceAfter=4)
S['formula'] = ParagraphStyle('Formula', fontName='FreeSerif', fontSize=11.5, leading=18,
                              textColor=TEXT_PRIMARY, alignment=TA_CENTER,
                              spaceBefore=4, spaceAfter=4)
S['caption'] = ParagraphStyle('Caption', fontName='FreeSerif', fontSize=8.5, leading=12,
                              textColor=TEXT_MUTED, alignment=TA_CENTER,
                              spaceBefore=3, spaceAfter=6)
S['th'] = ParagraphStyle('TH', fontName='FreeSerif', fontSize=9.5, leading=13,
                         textColor=colors.white, alignment=TA_CENTER)
S['td'] = ParagraphStyle('TD', fontName='FreeSerif', fontSize=9.5, leading=13,
                         textColor=TEXT_PRIMARY, alignment=TA_LEFT)
S['tdc'] = ParagraphStyle('TDC', fontName='FreeSerif', fontSize=9.5, leading=13,
                          textColor=TEXT_PRIMARY, alignment=TA_CENTER)
S['stat'] = ParagraphStyle('Stat', fontName='FreeSerif', fontSize=20, leading=24,
                           textColor=ACCENT, alignment=TA_CENTER)
S['statlab'] = ParagraphStyle('StatLab', fontName='FreeSerif', fontSize=8.5, leading=11,
                              textColor=TEXT_MUTED, alignment=TA_CENTER)
S['quote'] = ParagraphStyle('Quote', fontName='FreeSerif-Italic', fontSize=10.5,
                            leading=16.5, textColor=TEXT_PRIMARY,
                            leftIndent=24, spaceBefore=6, spaceAfter=8)
S['toc0'] = ParagraphStyle('TOC0', fontName='FreeSerif', fontSize=12, leading=20,
                           leftIndent=16, textColor=TEXT_PRIMARY)
S['toc1'] = ParagraphStyle('TOC1', fontName='FreeSerif', fontSize=10, leading=16,
                           leftIndent=36, textColor=TEXT_MUTED)
S['toctitle'] = ParagraphStyle('TOCTitle', fontName='FreeSerif', fontSize=18, leading=24,
                               textColor=HEADER_FILL, spaceAfter=14)

story = []


# ------------------------------------------------------------------
# Aides
# ------------------------------------------------------------------
def add_heading(text, style, level=0):
    key = 'h_' + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="%s"/><b>%s</b>' % (key, text), style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def H1(text):
    story.append(CondPageBreak(0.22 * (PAGE_H - 2 * MARGIN)))
    story.append(add_heading(text, S['h1'], 0))


def H2(text):
    story.append(CondPageBreak(0.14 * (PAGE_H - 2 * MARGIN)))
    story.append(add_heading(text, S['h2'], 1))


def H3(text):
    story.append(Paragraph('<b>%s</b>' % text, S['h3']))


def _nbsp_dash(text):
    """Empêche un tiret cadratin de commencer une ligne (espace insécable avant)."""
    return text.replace(' — ', '\u00a0— ')


def P(text):
    story.append(Paragraph(_nbsp_dash(text), S['body']))


def B(text):
    story.append(Paragraph(_nbsp_dash(text), S['bullet'], bulletText='•'))


def FORMULA(text, note=None):
    """Encadré de formule : fond clair + filet accent à gauche."""
    rows = [[Paragraph(text, S['formula'])]]
    if note:
        rows.append([Paragraph(note, S['caption'])])
    t = Table(rows, colWidths=[AVAIL_W * 0.92], hAlign='CENTER')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CARD_BG),
        ('LINEBEFORE', (0, 0), (0, -1), 2.5, ACCENT),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 14),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(Spacer(1, 6))
    story.append(t)
    story.append(Spacer(1, 8))


def make_table(headers, rows, ratios, caption=None, align_center_cols=None):
    """Tableau standardisé : en-tête HEADER_FILL, rayures TABLE_STRIPE."""
    widths = [r * AVAIL_W for r in ratios]
    data = [[Paragraph('<b>%s</b>' % h, S['th']) for h in headers]]
    for row in rows:
        cells = []
        for j, cell in enumerate(row):
            st = S['tdc'] if (align_center_cols and j in align_center_cols) else S['td']
            cells.append(Paragraph(cell, st))
        data.append(cells)
    t = Table(data, colWidths=widths, hAlign='CENTER', repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        style.append(('BACKGROUND', (0, i), (-1, i),
                      TABLE_ROW_ODD if i % 2 == 1 else TABLE_ROW_EVEN))
    t.setStyle(TableStyle(style))
    story.append(Spacer(1, 10))
    story.append(t)
    if caption:
        story.append(Spacer(1, 4))
        story.append(Paragraph(caption, S['caption']))
    story.append(Spacer(1, 10))


def callout_row(items):
    """Rangée de 3 encadrés statistiques (data-to-ink)."""
    n = len(items)
    gap = 10
    w = (AVAIL_W - gap * (n - 1)) / n
    cells = []
    for stat, label in items:
        inner = Table(
            [[Paragraph('<b>%s</b>' % stat, S['stat'])],
             [Paragraph(label, S['statlab'])]],
            colWidths=[w - 8])
        inner.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), CARD_BG),
            ('BOX', (0, 0), (-1, -1), 1, ACCENT),
            ('TOPPADDING', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, -1), (-1, -1), 9),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        cells.append(inner)
    row = Table([cells], colWidths=[w] * n, hAlign='CENTER')
    row.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(Spacer(1, 8))
    story.append(row)
    story.append(Spacer(1, 10))


def embed_image(path, max_width=None, max_height=None):
    if max_width is None:
        max_width = AVAIL_W
    if max_height is None:
        max_height = A4[1] * 0.35
    pil = PILImage.open(path)
    ow, oh = pil.size
    ratio = min(max_width / ow, max_height / oh, 1.0)
    return Image(path, width=ow * ratio, height=oh * ratio)


def figure(path, caption, max_w=None, max_h=None):
    img = embed_image(path, max_w, max_h)
    story.append(Spacer(1, 12))
    story.append(KeepTogether([img, Spacer(1, 4), Paragraph(caption, S['caption'])]))
    story.append(Spacer(1, 10))


DL = '/home/z/my-project/download/'

# ------------------------------------------------------------------
# Table des matières
# ------------------------------------------------------------------
story.append(Paragraph('<b>Table des matières</b>', S['toctitle']))
toc = TableOfContents()
toc.levelStyles = [S['toc0'], S['toc1']]
story.append(toc)
story.append(PageBreak())

# ==================================================================
# 1. RÉSUMÉ EXÉCUTIF
# ==================================================================
H1('1. Résumé exécutif')

P("VOLTRIX est une application web mobile de lecture statistique du sport : elle agrège les "
  "données publiques d'ESPN pour le football (140 compétitions suivies) et l'UFC (MMA), puis "
  "calcule localement, dans le navigateur de l'utilisateur, des probabilités et des lectures de "
  "marchés pour chaque match ou combat. Aucune donnée ne transite par un serveur VOLTRIX : "
  "l'application appelle directement les endpoints publics d'ESPN, met tout en cache sur "
  "l'appareil, et exécute l'intégralité des calculs côté client.")

P("Ce rapport répond à trois demandes : retirer la fonctionnalité « compos » (compositions "
  "d'équipes) des matchs de football ; tester l'application comme le ferait un vrai utilisateur ; "
  "documenter le fonctionnement de l'application, la récupération des informations pour chaque "
  "sport, les formules mathématiques de chaque pronostic, et tout ce qui reste à revoir. Les "
  "trois volets ont été traités : le retrait est effectif (l'onglet Compos et son moteur dédié "
  "ont été supprimés du code), le test a été mené le 9 novembre 2026 sur les données réelles "
  "d'ESPN du jour, et l'intégralité des formules a été extraite du code source pour ce document.")

callout_row([
    ('140', 'compétitions de football suivies'),
    ('2', 'moteurs de pronostics distincts (foot / MMA)'),
    ('75 %', 'précision du backtest MMA (12 combats)'),
])

P("Le test utilisateur s'est déroulé sans erreur bloquante : accueil, changement de dates, "
  "fiches de matchs football (quatre onglets), fiches de combats UFC (cinq onglets), réglages, "
  "cache local et vérification du modèle MMA ont tous fonctionné sur données réelles. Deux "
  "anomalies d'infrastructure ont été détectées et corrigées pendant le test : le blocage "
  "intermittent de l'API core d'ESPN (erreurs 403) et le blocage complet du modèle de rounds "
  "MMA, désormais recalculé depuis le scoreboard (6 requêtes au lieu d'environ 130). Les points "
  "restant à revoir — dates en anglais sur les cartes de matchs à venir, somme des arrondis à "
  "101 % dans l'onglet Rounds, pronostics affichés sur des matchs déjà terminés, entre autres — "
  "sont détaillés et priorisés au chapitre 8.")

# ==================================================================
# 2. FONCTIONNEMENT DE L'APPLICATION
# ==================================================================
H1('2. Fonctionnement de l\u2019application')

H2('2.1 Architecture : tout est local')

P("L'application est une application web monopage (Next.js / React) conçue pour un usage "
  "mobile. Sa caractéristique structurante est l'absence totale de backend applicatif : les "
  "moteurs de calcul (football et MMA) s'exécutent dans le navigateur, et les seules requêtes "
  "réseau émises ciblent les API publiques d'ESPN — gratuites, sans clé, et ouverts au CORS — "
  "ainsi que le service météo open-meteo.com. Il n'existe plus aucune base de données côté "
  "serveur ; la persistance repose entièrement sur l'appareil.")

P("Deux mécanismes de stockage complètent cette architecture. D'une part un cache HTTP "
  "hiérarchisé (mémoire puis sessionStorage) par endpoint et par donnée, avec des durées de "
  "vie adaptées : 10 minutes pour les scoreboards, 3 heures pour les calendriers et les "
  "classements, 24 heures pour les fiches de combattants, 7 jours pour le prior de rounds UFC. "
  "D'autre part une base IndexedDB (« voltrix-pred-db ») qui stocke les pronostics déjà "
  "calculés : une analyse consultée puis quittée est restaurée à la réouverture (« N pronos "
  "restaurés · base locale ») sans recalcul réseau, conformément à l'exigence produit « le "
  "calcul n'est fait qu'une fois ».")

H2('2.2 Navigation et écrans')

P("La navigation comporte deux entrées : Accueil et Réglages. L'écran d'accueil présente un "
  "sélecteur de dates glissant sur sept jours (du samedi précédent au vendredi suivant), un "
  "compteur global « TOUS · N » suivi des filtres par championnat, puis la liste des cartes : "
  "matchs de football regroupés par ligue (score ou heure, logos, cotes du 1X2 quand ESPN en "
  "publie, mini-probabilités et étoiles de confiance pour les matchs à venir) et combats UFC "
  "regroupés par événement (palmarès des deux combattants, probabilité de victoire, verdict "
  "« avantage net / léger / indécis »). Des filtres rapides permettent de sauter directement à "
  "un événement UFC futur.")

P("L'écran de détail d'un match de football s'ouvre sur un héros illustré par la photo du "
  "stade réel où se joue la rencontre, puis une barre d'onglets. Depuis le retrait demandé, il "
  "reste quatre onglets : Synthèse (prono du moteur, cotes, enjeux, buts attendus, scores "
  "exacts les plus probables, premier but attendu), Marchés (value bets avec edge et critère "
  "de Kelly, échelle Plus/Moins, les deux équipes marquent, mouvement de cotes), H2H "
  "(confrontations réelles sur deux saisons) et Contexte (enjeux de classement, alertes "
  "effectifs et fatigue, profils Elo / forme / buts des équipes, stade). L'onglet « Compos » "
  "qui affichait les compositions d'équipes a été intégralement supprimé — le chapitre 7 "
  "vérifie sa disparition effective dans l'application testée.")

P("L'écran de détail d'un combat UFC propose cinq onglets : Synthèse (favori, probabilités "
  "bornées, méthode clé, rounds attendus, facteurs clés et points de vigilance, scénarios les "
  "plus probables), Méthode (répartition KO/TKO, soumission, décision de chaque combattant, "
  "lecture de la distance), Rounds (distribution de la fin du combat par round), Combattants "
  "(fiches biographiques, statistiques de carrière moyennes, dimensions du moteur en barres "
  "face à face) et H2H (historique des confrontations). L'écran Réglages décrit "
  "l'architecture, les sources de données, l'état du cache local (nombre d'entrées, "
  "fournisseurs), et permet de lancer la vérification du modèle MMA — un backtest honnête qui "
  "recalcule le pronostic sur des combats terminés et publie le taux de réussite, y compris "
  "s'il est défavorable.")

H2('2.3 Principes d\u2019honnêteté')

P("Trois engagements structurent toute l'application. Premièrement, rien n'est inventé : une "
  "donnée absente chez ESPN est affichée « — » ou fait refuser le pronostic ; le moteur MMA "
  "n'émet aucun avis en dessous de trois dimensions comparables. Deuxièmement, les "
  "probabilités MMA sont volontairement bornées entre 25 et 75 % — aucun combat n'est une "
  "certitude statistique. Troisièmement, l'application n'édite aucune cote et ne donne aucun "
  "conseil de paris : c'est un outil de lecture statistique des données observées, "
  "informatif par nature.")

# ==================================================================
# 3. FOOTBALL — RÉCUPÉRATION DES INFORMATIONS
# ==================================================================
H1('3. Football — récupération des informations')

H2('3.1 Les sources')

P("Toutes les informations football proviennent des endpoints publics d'ESPN, appelés "
  "directement par le navigateur. Le catalogue de compétitions suit 140 ligues et coupes "
  "(top 5 européens, coupes d'Europe, divisions inférieures anglaises, championnats "
  "américains et asiatiques, coupes africaines, mondial et Coupe des clubs), chacune validée "
  "en amont (code ESPN vérifié, scoreboard répondant). La météo du lieu du match, purement "
  "descriptive, vient d'open-meteo.com via son API de géocodage puis de prévision, toutes "
  "deux gratuites et sans clé.")

make_table(
    ['Information', 'Endpoint ESPN', 'Actualisation (cache)'],
    [
        ['Matchs du jour, cotes, statut live',
         'soccer/{ligue}/scoreboard?dates=JJMMAAAA', '10 minutes'],
        ['Historique des équipes (2 saisons)',
         'soccer/{ligue}/teams/{id}/schedule?seasons=…', '3 heures'],
        ['Classement, rang, points',
         'soccer/{ligue}/standings?season=…', '3 heures'],
        ['Blessés et incertains',
         'soccer/{ligue}/injuries', '3 heures'],
        ['Minutes réelles des premiers buts',
         'soccer/{ligue}/summary?event={id}', '6 heures'],
        ['Cotes 1X2 et Over/Under',
         'incluses dans le scoreboard (DraftKings…)', 'avec le scoreboard'],
        ['Météo du stade',
         'open-meteo.com (géocodage + prévision)', 'à la demande'],
    ],
    [0.28, 0.44, 0.28],
    caption="Tableau 1 — Sources de données football et durées de cache.",
    align_center_cols={2},
)

H2('3.2 La chaîne de traitement')

P("Au chargement de l'accueil, l'application interroge le scoreboard de chaque ligue pour la "
  "date choisie (requêtes limitées à quatre simultanées, avec reprise polie en cas de "
  "bridage). Pour chaque match, une « analyse légère » est déduite du scoreboard : identité, "
  "ligue, statut, cotes et probabilités express. Ce n'est qu'à l'ouverture de la fiche "
  "complète d'un match que l'analyse lourde est déclenchée : calendriers des deux équipes "
  "sur la saison courante et la précédente, classement, blessés, météo, et minutes réelles "
  "des premiers buts des douze derniers matchs de chaque équipe. Le résultat est mis en "
  "cache 30 minutes (60 secondes le jour du match) et archivé dans la base IndexedDB : une "
  "fiche consultée deux fois ne coûte qu'un calcul.")

P("Les cotes exploitées sont celles que ESPN publie dans le scoreboard (provider type "
  "DraftKings), en priorité les cotes de fermeture, avec repli sur les cotes d'ouverture "
  "quand la fermeture n'existe pas. Elles servent à deux choses distinctes : la calibration "
  "des marchés de buts (chapitre 4) et la détection de value bets — cette dernière utilise "
  "les probabilités brutes du modèle, jamais les probabilités calibrées, afin d'éviter une "
  "comparaison circulaire du modèle à lui-même.")

P("Enfin, pour les environnements où le navigateur ne peut pas joindre ESPN directement "
  "(réseau verrouillé, navigateur de test sans internet), l'application embarque un relai "
  "même-origine optionnel (route /api/espn/…) qui transmet les requêtes telles quelles en "
  "imposant un User-Agent accepté par le CDN d'ESPN. C'est ce relai, activé par variables "
  "d'environnement, qui a permis le test utilisateur du chapitre 7 — le navigateur de test "
  "n'ayant pas d'accès internet direct.")

# ==================================================================
# 4. FOOTBALL — FORMULES DES PRONOSTICS
# ==================================================================
H1('4. Football — formules des pronostics')

P("Le moteur football est un ensemble de trois modèles complémentaires — un modèle de buts "
  "(Poisson), un modèle de force (Elo) et un modèle de dynamique (forme) — fusionnés par "
  "pondération fixe, puis étendus à tous les marchés par la grille de scores du Poisson. "
  "Chaque brique est détaillée ci-dessous avec les constantes exactes du code.")

H2('4.1 Forces d\u2019attaque et de défense (rétrécissement bayésien)')

P("Pour chaque équipe, on calcule les buts marqués et encaissés par match, globalement et "
  "par contexte (domicile / extérieur). Un ratio mesuré sur n matchs n'étant fiable qu'à "
  "hauteur de n/(n+K), chaque ratio est retiré vers la moyenne de ligue :")

FORMULA("ratio = 1 + (mesure / référence − 1) × n / (n + K),  avec K = 10",
        "Références de ligue : 1,52 but marqué par match à domicile, 1,22 à l'extérieur "
        "(moyenne 1,37 par équipe). Sans ce retrait, une coupe à 2 matchs de données produirait des λ aberrants.")

P("Le ratio retenu mélange ensuite la statistique du contexte du match (domicile pour "
  "l'équipe locale, extérieur pour le visiteur) et la statistique globale, avec un poids "
  "croissant avec le nombre de matchs joués : w = matchs / (matchs + 6), borné à "
  "[0,15 ; 0,85].")

H2('4.2 Buts attendus (λ) et modificateurs de contexte')

FORMULA("λ<sub>dom</sub> = 1,52 × Att<sub>dom</sub> × Déf<sub>ext</sub>   ·   "
        "λ<sub>ext</sub> = 1,22 × Att<sub>ext</sub> × Déf<sub>dom</sub>",
        "Le produit attaque-défense croise la force offensive d'une équipe avec la fragilité "
        "défensive de l'adversaire dans le même contexte.")

P("Quatre modificateurs de contexte ajustent ensuite ces λ de base. La fatigue (moins de "
  "quatre jours de repos, ou trois matchs ou plus sur quatorze jours) multiplie le λ de "
  "l'équipe concernée par 0,94. Les blessures réduisent le λ de 2 % par absent au-delà des "
  "deux premiers (les listes ESPN comptant toujours quelques joueurs de rotation), le "
  "facteur étant borné à [0,92 ; 1]. Les derbys (34 paires de rivalités recensées, du "
  "Classique au Superclásico) resserrent le match : λ × 0,92 des deux côtés. Enfin la forme "
  "récente injecte un bonus ou malus borné :")

FORMULA("λ × (0,9 + 0,2 × f),  où f = Σ résultat<sub>i</sub> · e<super>−0,25·âge<sub>i</sub></super> / Σ e<super>−0,25·âge<sub>i</sub></super>",
        "Résultat codé 1 / 0,5 / 0 (victoire / nul / défaite) sur les six derniers matchs ; "
        "la pondération exponentielle (demi-vie d'environ trois matchs) donne aux rencontres "
        "récentes plus de poids. La météo n'influence plus les λ (retrait validé).")

P("La force Elo relative redistribue ensuite les buts attendus entre les deux équipes en "
  "préservant leur total — le modèle ne gonfle pas le nombre de buts, il les répartit :")

FORMULA("f<sub>Elo</sub> = 10<super>ΔElo/800</super> (ΔElo borné à ±250) ;  "
        "λ'<sub>dom</sub> = T × (λ<sub>dom</sub>·f<sub>Elo</sub>) / (λ<sub>dom</sub>·f<sub>Elo</sub> + λ<sub>ext</sub>/f<sub>Elo</sub>)",
        "T = λ<sub>dom</sub> + λ<sub>ext</sub> avant redistribution ; λ'<sub>ext</sub> = T − λ'<sub>dom</sub>.")

P("Des garde-fous ferment l'étape : valeurs finales bornées à [0,30 ; 3,80] pour le "
  "domicile et [0,25 ; 3,40] pour l'extérieur, repli sur 1,35 / 1,15 si une donnée "
  "invalide produit un λ non exploitable.")

H2('4.3 Le modèle Poisson (grille de scores)')

P("Chaque équipe est modélisée par une loi de Poisson indépendante de paramètre son λ. La "
  "probabilité de chaque score exact (i buts à j buts) est le produit des deux lois, sur "
  "une grille 0 à 12 buts par équipe, renormalisée pour sommer exactement à 1 :")

FORMULA("P(i, j) = [e<super>−λ<sub>dom</sub></super> · λ<sub>dom</sub><super>i</super> / i!] × "
        "[e<super>−λ<sub>ext</sub></super> · λ<sub>ext</sub><super>j</super> / j!]",
        "Grille 0..12 × 0..12 renormalisée — la troncature de l'ancienne grille 0..8 "
        "perdait jusqu'à 1 % de masse sur les matchs prolifiques et biaisait tous les marchés dérivés.")

P("Tous les marchés de buts se déduisent de cette grille par sommation : le 1X2 (somme des "
  "cases victoire du domicile, cas d'égalité et victoire de l'extérieur), le Plus/Moins aux lignes "
  "1,5 / 2,5 / 3,5 (somme des cases "
  "i+j supérieur ou inférieur à la ligne), et les scores exacts les plus probables (les "
  "trois premières cases de la grille). Les deux équipes marquent (BTTS) admettent une "
  "forme fermée exacte :")

FORMULA("P(BTTS oui) = (1 − e<super>−λ<sub>dom</sub></super>) × (1 − e<super>−λ<sub>ext</sub></super>)",
        "Probabilité que chaque équipe marque au moins un but, Poisson indépendantes.")

P("La première équipe à marquer combine la part du λ de chaque équipe et la probabilité "
  "qu'un but soit marqué : P(dom ouvre) = λ<sub>dom</sub>/(λ<sub>dom</sub>+λ<sub>ext</sub>) × "
  "(1 − e<super>−(λ<sub>dom</sub>+λ<sub>ext</sub>)</super>), et symétriquement pour "
  "l'extérieur — la probabilité de 0-0 absorbe l'arrondi pour que la somme fasse "
  "exactement 1.")

H2('4.4 Le modèle Elo')

P("Les classements Elo sont rejoués depuis les calendriers des deux équipes : chaque match "
  "terminé des deux dernières saisons met à jour les ratings dans l'ordre chronologique, "
  "en dédupliquant par identifiant d'événement. L'avantage du terrain est intégré au score "
  "attendu (et non ajouté après coup) :")

FORMULA("E<sub>dom</sub> = 1 / (1 + 10<super>(R<sub>ext</sub> − 65 − R<sub>dom</sub>)/400</super>)   ·   "
        "R' = R + 22 × (S − E)",
        "S = 1 / 0,5 / 0 selon le résultat réel ; K = 22 ; avantage domicile = 65 points ; "
        "ratings initiaux à 1500.")

P("La conversion en probabilités 1X2 utilise un taux de nul décroissant avec l'écart de "
  "force : P(nul) = 0,30 − 1,4 × (E − 0,5)<super>2</super> × 4, borné à [0,11 ; 0,30], puis "
  "P(dom) = E − P(nul)/2 et P(ext) = 1 − E − P(nul)/2, le tout renormalisé.")

H2('4.5 Le modèle de forme')

P("La forme convertit l'écart des scores de forme en équivalent Elo : un point de forme "
  "valant environ 85 points Elo, l'écart (f<sub>dom</sub> − f<sub>ext</sub>) × 170 traverse la "
  "même logistique que l'Elo, avec un plafond de nul légèrement plus bas (0,28 au lieu de "
  "0,30) car deux équipes inégales sur la forme produisent statistiquement moins de nuls :")

FORMULA("e = 1 / (1 + 10<super>−Δ·170/400</super>)   ·   "
        "P(nul) = 0,28 − 1,2 × (e − 0,5)<super>2</super> × 4",
        "Le reste de la conversion suit le modèle Elo (partage du nul, renormalisation).")

H2('4.6 L\u2019ensemble final et la confiance')

figure(DL + 'chart-ensemble-foot.png',
       'Figure 1 — Pondérations de l\u2019ensemble 1X2 : 45 % Poisson, 30 % Elo, 25 % forme.',
       max_h=230)

FORMULA("P(VOLTRIX) = 0,45 × P(Poisson) + 0,30 × P(Elo) + 0,25 × P(Forme)",
        "Somme pondérée issue des trois modèles, renormalisée à 1 sur les trois issues.")

P("Le score de confiance (1 à 5 étoiles) récompense l'écart entre les deux issues les plus "
  "probables, le consensus des trois modèles sur l'issue la plus probable (les trois doivent "
  "désigner le même vainqueur), et la profondeur de données : confiance = 1 + min(2 ; "
  "10 × écart) + 1 si consensus + 0,5 par équipe ayant au moins cinq matchs joués — le tout "
  "borné à [1 ; 5]. Les libellés vont de « Très faible » à « Élevé ».")

H2('4.7 Calibration sur le marché')

P("Quand ESPN publie une ligne Over/Under avec ses deux cotes, le modèle s'ancre dessus. "
  "Les probabilités implicites 1/cote sont d'abord dé-margées (leur somme dépasse 1 de la "
  "marge du bookmaker), puis un facteur d'échelle s est cherché par dichotomie (bornes "
  "[0,05 ; 12], 60 itérations) pour que le Poisson recalé sur les λ × s reproduise la "
  "probabilité marché de la ligne réelle :")

FORMULA("p<sub>marché</sub>(Over L) = (1/c<sub>over</sub>) / (1/c<sub>over</sub> + 1/c<sub>under</sub>)   ;   "
        "s tel que  P(Over L ; λ·s) = p<sub>marché</sub>(Over L)",
        "Les probabilités calibrées servent à l'affichage ; les probabilités brutes restent "
        "la référence des value bets — sinon l'edge comparerait le modèle à lui-même.")

H2('4.8 Value bets et critère de Kelly')

P("Pour chaque issue dotée d'une cote (1X2 complet, ligne Over/Under du marché), l'edge "
  "mesure l'écart entre la probabilité du modèle et celle du bookmaker : edge = "
  "p<sub>modèle</sub> × cote − 1. Seuls les edge strictement supérieurs à 2 % sont retenus, "
  "et la part de bankroll suggérée suit le critère de Kelly, borné à 10 % par prudence :")

FORMULA("edge = p × c − 1, retenu au-delà de 2 %   ·   Kelly = edge / (c − 1), plafonné à 10 %",
        "Au plus quatre value bets par match, triés par edge décroissant. Sans cote publiée, "
        "aucun value bet n'est fabriqué.")

P("Un détecteur de mouvement de cotes compare enfin ouverture et fermeture : une baisse de "
  "8 % ou plus signale « argent massif » sur l'équipe concernée, une hausse de 8 % un doute "
  "du marché ; un déplacement de la ligne de buts est signalé tel quel.")

H2('4.9 Le moteur du premier but')

P("La minute du premier but est prédite par un moteur dédié, alimenté par les minutes "
  "réelles des premiers buts des douze derniers matchs terminés de chaque équipe (summaries "
  "ESPN, plus petit but du match toutes équipes confondues, les 0-0 comptant comme "
  "survie). La distribution de chaque équipe sur six fenêtres de quinze minutes plus le "
  "0-0 est lissée vers le profil de ligue (retrait bayésien, α = 6 pseudo-matchs), puis "
  "convertie en hazards cumulés aux bords de fenêtres. Les deux équipes fusionnent par "
  "addition des hazards pondérée par la fiabilité de leurs échantillons, et le tout est mis "
  "à l'échelle par le rythme de buts du match :")

FORMULA("H<sub>match</sub>(t) = [(1 − (w<sub>dom</sub>+w<sub>ext</sub>)/2) · H<sub>ligue</sub>(t) + "
        "w<sub>dom</sub>/2 · H<sub>dom</sub>(t) + w<sub>ext</sub>/2 · H<sub>ext</sub>(t)] × ρ",
        "w = m/(m+α) est le poids de l'échantillon de chaque équipe ; ρ = λ<sub>match</sub> / "
        "λ<sub>échantillons</sub> borné à [0,55 ; 1,9] — un match à λ élevé avance le premier but.")

FORMULA("P(fenêtre w) = S(w−1) − S(w),  où S(t) = e<super>−H(t)</super>",
        "Par télescopage, les six fenêtres plus le 0-0 somment exactement à 1. La minute "
        "attendue est la médiane (première minute où la probabilité cumulée atteint 50 %), "
        "par interpolation linéaire de la survie.")

P("Quand aucune minute réelle n'est exploitable chez ESPN pour ces équipes (petites "
  "coupes, jeunes catégories), le moteur le dit honnêtement et retombe sur le profil "
  "empirique de ligue, étiqueté comme tel dans la fiche.")

# ==================================================================
# 5. MMA — RÉCUPÉRATION DES INFORMATIONS
# ==================================================================
H1('5. MMA — récupération des informations')

H2('5.1 Les sources')

P("L'analyse MMA se focalise sur l'UFC (choix produit : PFL et Bellator restent décodables "
  "pour les historiques croisés mais ne sont plus scannés). Les combats à venir sont lus "
  "dans le scoreboard UFC ; l'analyse complète d'un combat croise ensuite quatre familles "
  "de ressources sur l'API core et l'API common d'ESPN :")

make_table(
    ['Information', 'Endpoint', 'Actualisation (cache)'],
    [
        ['Événements et combats à venir',
         'site.api /mma/ufc/scoreboard', '10 minutes'],
        ['Détail d\u2019un combat (format 3 ou 5 rounds)',
         'core /…/competitions/{id}', '1 heure'],
        ['Statut (round de fin, méthode)',
         'core /…/competitions/{id}/status', '1 heure'],
        ['Fiche biographique du combattant',
         'core /…/athletes/{id}', '24 heures'],
        ['Statistiques de carrière moyennes',
         'core /…/statistics, /records', '12 à 24 heures'],
        ['Historique des combats (eventsMap)',
         'site.web.api /common/v3/mma', '24 heures'],
        ['Prior de rounds UFC (6 événements)',
         'scoreboard des événements passés', '7 jours'],
    ],
    [0.34, 0.36, 0.30],
    caption="Tableau 2 — Sources de données MMA et durées de cache.",
    align_center_cols={2},
)

H2('5.2 La fenêtre dérivée (8 derniers combats)')

P("Pour chaque combattant, le moteur construit une fenêtre dérivée sur ses huit derniers "
  "combats terminés : frappes significatives absorbées par minute, défense contre les "
  "frappes, défense contre les takedowns (calculées à partir des statistiques des "
  "adversaires), durée moyenne de combat, et surtout le round de fin réel de chaque combat "
  "(champ status.period publié par ESPN) ainsi que sa méthode. Les no-contests sont "
  "corrigés — l'historique ESPN les étiquette « défaite » alors qu'ils ne comptent pas. "
  "Cette fenêtre alimente à la fois les dimensions « calculées » du pronostic et le modèle "
  "de rounds personnalisé.")

H2('5.3 Le prior UFC (modèle de rounds)')

P("La distribution de référence des fins de combat par round est recalculée sur les six "
  "derniers événements UFC terminés (environ 70 combats), séparément pour les formats à 3 "
  "et 5 rounds, puis mise en cache sept jours. Depuis l'audit du 9 novembre 2026, ce prior "
  "est lu directement dans le scoreboard — qui publie déjà le round de fin "
  "(status.period), le format (format.regulation.periods) et l'horloge du round final "
  "(status.clock) de chaque combat — soit 6 requêtes au lieu d'environ 130 appels à l'API "
  "core, dont le CDN bloque les ressources /competitions en rafale. Une décision "
  "s'identifie par « dernier round prévu atteint et horloge pleine » (au moins 295 "
  "secondes sur 300) ; tout autre cas avec un round de fin inférieur ou égal au format est "
  "une fin anticipée.")

# ==================================================================
# 6. MMA — FORMULES DES PRONOSTICS
# ==================================================================
H1('6. MMA — formules des pronostics')

P("Le moteur MMA (voltrix-mma-v1) n'est pas un modèle de buts : c'est une comparaison "
  "multidimensionnelle des deux carrières, agrégée en un avantage unique, transformé en "
  "probabilité bornée. Sa philosophie est l'explicité : chaque dimension utilisée est "
  "affichée avec son poids, et les dimensions manquantes sont listées.")

H2('6.1 Les onze dimensions et leur score')

P("Chaque dimension compare une statistique des deux combattants et produit deux indices "
  "compris entre 0 et 100, amortis par un ε propre à la dimension — l'écart typique en "
  "dessous duquel deux carrières ne se distinguent pas :")

FORMULA("score<sub>A</sub> = 50 + 50 × (x − y) / (x + y + ε)",
        "Pour les dimensions où « moins est mieux » (frappes absorbées), x et y sont "
        "inversés. Si l'écart entre les deux scores reste sous 6 points, la dimension est "
        "déclarée neutre. Une statistique absente rend la dimension indisponible — jamais "
        "imputée.")

figure(DL + 'chart-dimensions-mma.png',
       'Figure 2 — Poids des onze dimensions dans le pronostic (valeurs publiques du moteur).',
       max_h=250)

P("Les dimensions se répartissent en trois familles : la forme récente (sur cinq combats) "
  "porte le poids le plus fort (1,5) ; le debout — volume, précision, absorption de "
  "frappes — pèse 1,2 chacune ; la lutte, la défense, le pouvoir de finition, "
  "l'expérience et la soumission complètent la grille, l'envergure physique restant "
  "annecdotique (0,6). Les dimensions « absorption », « défense frappes » et « défense "
  "takedown » sont calculées sur la fenêtre dérivée ; les autres viennent des statistiques "
  "de carrière ESPN.")

H2('6.2 De l\u2019agrégation à la probabilité bornée')

P("L'avantage agrégé somme les écarts à 50 pondérés par les poids des dimensions, puis est "
  "normalisé dans [−1 ; 1]. Une transformation logistique de pente 2,6 le convertit en "
  "probabilité, aussitôt bornée :")

FORMULA("a = Σ w<sub>i</sub> (score<sub>i</sub> − 50) / (Σ w<sub>i</sub> × 50)   ·   "
        "p = 1 / (1 + e<super>−2,6·a</super>)",
        "La probabilité affichée est bornée à [25 % ; 75 %] : p(A) + p(B) = 100 %, et aucun "
        "combat n'est présenté comme une certitude statistique.")

P("Si moins de trois dimensions sont comparables, le moteur refuse le pronostic et "
  "l'explique. L'étiquette de marge traduit l'écart à 50 % : « indécis » en dessous de six "
  "points, « avantage léger » jusqu'à quinze, puis « avantage marqué » et « avantage net ». "
  "La confiance (Limitée / Moyenne / Bonne, puis 2 à 5 étoiles) combine la couverture "
  "globale des dimensions (45 %) et la couverture des six dimensions cœur — forme, volume, "
  "précision, absorption, lutte, pouvoir de finition (55 %).")

H2('6.3 Méthodes de victoire et scénarios')

P("La méthode de victoire la plus probable croise les façons de gagner du favori avec les "
  "façons de perdre de l'adversaire — deux signaux indépendants que le moteur moyenne "
  "quand ils existent tous les deux :")

FORMULA("part(X bat Y par KO) = [KO<sub>victoires</sub>(X)/V(X) + KO<sub>défaites</sub>(Y)/D(Y)] / 2",
        "Idem pour les soumissions ; la décision complète à 1. Les scénarios affichés "
        "valent p(X) × part(X, méthode) — ils somment exactement à 1 sur les six cas.")

P("La probabilité que le combat aille au terme suit la même logique : priorité au modèle "
  "de rounds (voir ci-dessous), repli sur la somme des parts de décision des deux "
  "combattants, bornée à [5 % ; 95 %].")

H2('6.4 Le modèle de rounds personnalisé')

P("Les taux personnels de chaque combattant (parts de ses victoires finies au round r, ou "
  "aux points) sont fondus avec le prior UFC par un rétrécissement de type Dirichlet de "
  "force n<sub>0</sub> = 6 pseudo-victoires :")

FORMULA("taux<sub>fusionné</sub>(r) = (n<sub>0</sub> × prior(r) + observé(r)) / (n<sub>0</sub> + victoires documentées)",
        "Moins de trois victoires documentées : le taux rejoint le prior et l'étiquette "
        "l'indique (« base : prior UFC »). La part du prior, affichée, décroît avec les données.")

FORMULA("P(fini au round r) = p<sub>A</sub> · taux<sub>A</sub>(r) + p<sub>B</sub> · taux<sub>B</sub>(r)",
        "La fusion des deux combattants produit la distribution du combat ; la part de "
        "décision suit la même formule. Le nombre de rounds attendus vaut "
        "Σ r·P(fini au round r) + R × P(décision).")

H2('6.5 Pronostic express et vérification')

P("Sur les cartes de liste (sans analyse lourde), un pronostic express compare un score "
  "simple par combattant — 60 % de taux de victoire et 40 % de forme sur cinq combats — "
  "via une logistique de pente 2,2 bornée à [30 % ; 70 %]. C'est lui qui alimente les "
  "« avantage net / léger / indécis » des listes d'événements.")

P("L'écran Réglages permet enfin de rejouer le moteur complet sur des combats UFC "
  "terminés et de confronter ses pronostics aux vrais vainqueurs. Le test du 9 novembre "
  "2026 (données du jour) donne 75 % de justesse sur 12 combats analysés, 0 ignorés — le "
  "résultat est publié tel quel, avec la mention du biais de recul inévitable (les "
  "statistiques de carrière utilisées sont celles connues aujourd'hui).")

# ==================================================================
# 7. TEST UTILISATEUR COMPLET
# ==================================================================
H1('7. Test utilisateur complet')

H2('7.1 Méthodologie et environnement')

P("L'application a été testée le 9 novembre 2026 comme le ferait un vrai utilisateur : "
  "navigation à la main dans un navigateur au format mobile (viewport 390 × 844), sur les "
  "données réelles d'ESPN du jour — matchs du lundi 9 novembre, événements UFC à venir. "
  "Chaque écran a été ouvert, chaque onglet consulté, chaque bouton actionné ; les "
  "captures d'écran qui jalonnent ce chapitre proviennent de cette session. Aucune donnée "
  "n'a été simulée.")

P("Une contrainte d'environnement mérite d'être signalée : le navigateur du banc de test "
  "n'a pas d'accès internet direct, là où l'application en production appelle ESPN depuis "
  "l'appareil de l'utilisateur. Le relai même-origine prévu par l'application pour ce cas "
  "(chapitre 3.2) a donc été activé — c'est un mécanisme prévu par le code, pas une "
  "modification du moteur. La date affichée par l'application a par ailleurs été "
  "confrontée à l'horloge des serveurs d'ESPN : elles concordent exactement (lundi "
  "9 novembre 2026).")

H2('7.2 Déroulé et résultats')

make_table(
    ['Étape', 'Vérification', 'Résultat'],
    [
        ['Accueil', 'Chargement des matchs du jour (8 ligues présentes : Norvège, FA Cup en direct 117\u2019, '
         'LaLiga 2, Colombie, Bolivie, Paraguay, Liga F, Équateur) + UFC 334 et 6 événements futurs', 'OK'],
        ['Accueil', 'Scores, cotes et probabilités des cartes ; état vide explicite les jours sans match', 'OK'],
        ['Sélecteur de dates', 'Passage au samedi 7 novembre : 213 matchs, 25+ championnats, filtres par ligue', 'OK'],
        ['Fiche match (Synthèse)', 'Prono 5 étoiles Aurora 70 % / 15 % / 16 %, cotes 1,77-3,95-3,85, λ 2,93-0,54, '
         'scores exacts 2-0 (13,4 %), 1er but attendu 21e minute sur 24 matchs réels', 'OK'],
        ['Fiche match (Synthèse)', 'Dépliage « Détail du calcul » : 4 composantes + λ', 'OK'],
        ['Fiche match (Marchés)', '2 value bets (edge +23 %, Kelly 10 %), échelle O/U 1,5-2,5-3,5, BTTS, '
         'mouvement de cotes, provider DraftKings', 'OK'],
        ['Fiche match (H2H)', '3 confrontations réelles sur 2 saisons, comptage par identifiant', 'OK'],
        ['Fiche match (Contexte)', 'Enjeux, profils Elo / forme / buts, stade réel', 'OK'],
        ['Fiche match', 'Onglet « Compos » : ABSENT (retrait effectif de la fonctionnalité)', 'OK'],
        ['Fiche combat (Synthèse)', 'Nunes 55 % - Harrison 45 %, 8/11 dimensions, points de vigilance, '
         'scénarios Nunes décision 34,7 %…', 'OK'],
        ['Fiche combat (Méthode)', 'Répartitions KO / soumission / décision, distance 55 %', 'OK'],
        ['Fiche combat (Rounds)', 'Distribution par round (R2 29 %, décision 36 %), 3,5 rounds attendus, '
         'prior sur 70 combats', 'OK'],
        ['Fiche combat (Combattants)', 'Fiches biographiques, stats de carrière, 11 dimensions en barres', 'OK'],
        ['Fiche combat (H2H)', '« Première rencontre » correctement signalée', 'OK'],
        ['Réglages', 'Architecture, sources, cache (436 entrées, 4 fournisseurs)', 'OK'],
        ['Réglages', 'Vérification du modèle MMA : 75 % sur 12 combats, détail juste / faux', 'OK'],
        ['Navigation', 'Retour, réanalyser, rafraîchir, changement de date, filtres UFC', 'OK'],
        ['Console', 'Aucune erreur JavaScript sur l\u2019ensemble de la session', 'OK'],
    ],
    [0.16, 0.72, 0.12],
    caption='Tableau 3 — Déroulé du test utilisateur du 9 novembre 2026 (18 vérifications).',
    align_center_cols={2},
)

H2('7.3 Captures du test')

P("Les captures ci-dessous illustrent les écrans majeurs traversés pendant la session, "
  "dans l'ordre du déroulé.")

_shots = [
    ('test-02-accueil-matchs.png', 'Accueil — matchs du lundi 9 novembre (direct FA Cup, pronos Bolivie/Colombie).'),
    ('test-03-detail-synthese.png', 'Fiche match — Synthèse (prono 5 étoiles, scores exacts, premier but).'),
    ('test-04-marches.png', 'Fiche match — Marchés (value bets, Plus/Moins, BTTS).'),
    ('test-06-mma-nunes.png', 'Fiche combat UFC — Synthèse (Nunes-Harrison, probabilités bornées).'),
    ('test-08-mma-rounds.png', 'Fiche combat — Rounds (distribution par round, rounds attendus 3,5).'),
    ('test-10-backtest.png', 'Réglages — vérification du modèle MMA (75 % sur 12 combats).'),
]
for i in range(0, len(_shots), 2):
    pair = _shots[i:i + 2]
    cells = []
    caps = []
    for path, cap in pair:
        img = embed_image(DL + path, max_width=170, max_height=355)
        cells.append(img)
        caps.append(Paragraph(cap, S['caption']))
    t = Table([cells, caps], colWidths=[AVAIL_W / 2] * 2, hAlign='CENTER')
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, 0), 'TOP'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(Spacer(1, 8))
    story.append(t)
    story.append(Spacer(1, 6))

story.append(Paragraph('Figures 3 à 8 — Captures de la session de test (ordinateur de banc, '
                       'format mobile 390 × 844, données ESPN réelles).', S['caption']))

H2('7.4 Anomalies détectées et corrigées pendant le test')

P("Deux anomalies d'infrastructure ont été découvertes pendant la session et corrigées "
  "dans la foulée — le test a donc aussi joué son rôle de banc de validation.")

B("<b>Blocage intermittent de l'API core d'ESPN (403).</b> Les ressources "
  "/competitions et /status de sports.core.api.espn.com sont bloquées par le CDN en "
  "l'absence de Referer espn.com, et de façon aléatoire dès que plusieurs requêtes "
  "départ en rafale. Corrections : le relai même-origine envoie désormais le Referer "
  "adéquat, rejoue chaque requête jusqu'à quatre fois avec pause croissante, et débite-"
  "limite globalement ses appels amont (espacement de 250 ms) ; le délai d'annulation "
  "côté client est passé de 15 à 45 secondes pour couvrir les files d'attente du relai.")
B("<b>Modèle de rounds bloqué « en préparation ».</b> Le prior UFC exigeait environ 130 "
  "appels à l'API core (détail + statut de chaque combat de six événements), "
  "majoritairement rejetés en environnement bridé — le modèle n'aboutissait jamais. "
  "Correction : le prior est désormais calculé depuis le scoreboard site.api, qui publie "
  "déjà round de fin, format et horloge finale (6 requêtes, aucune dépendance à l'API "
  "core). Vérifié sur le combat Nunes-Harrison : prior prêt en quelques secondes, "
  "distribution par round et 3,5 rounds attendus affichés.")

P("Une troisième anomalie, purement cosmétique cette fois, a été relevée mais volontairement "
  "non corrigée pendant la session afin d'être tracée au chapitre 8 : l'heure des matchs à "
  "venir s'affiche en anglais et dans un fuseau étranger (« MON, NOVEMBER 9TH AT 7:00 PM "
  "EST ») sur les cartes de l'accueil.")

# ==================================================================
# 8. POINTS À REVOIR
# ==================================================================
H1('8. Points à revoir et recommandations')

P("Ce chapitre recense tout ce que le test et la lecture du code ont révélé comme "
  "perfectible, y compris les points déjà connus mais non corrigés. Trois niveaux de "
  "priorité : P1 (à corriger en premier, impact utilisateur direct), P2 (confort et "
  "cohérence), P3 (gains de long terme).")

H2('8.1 Priorité P1 — à corriger en premier')

make_table(
    ['Point', 'Constat', 'Recommandation'],
    [
        ['Dates en anglais sur les cartes',
         'Les matchs à venir affichent « MON, NOVEMBER 9TH AT 7:00 PM EST » : libellé brut '
         'd\u2019ESPN, non traduit, et fuseau nord-américain inadapté à une application en français.',
         'Formater localement (Intl.DateTimeFormat fr-FR) et convertir vers le fuseau '
         'de l\u2019utilisateur.'],
        ['Somme des arrondis à 101 %',
         'Onglet Rounds : 6 + 29 + 20 + 0 + 10 + 36 = 101 % — chaque pourcentage est '
         'arrondi indépendamment.',
         'Arrondir n−1 valeurs et affecter le résidu à la dernière (méthode déjà '
         'utilisée par le moteur du 1er but).'],
        ['Barres à 0 % invisibles',
         'Le round 4 à 0 % n\u2019affiche aucune barre ni repère.',
         'Conserver une barre filaire minimale ou afficher « 0 % » en clair.'],
    ],
    [0.22, 0.42, 0.36],
    caption='Tableau 4 — Points P1 relevés lors du test.',
)

H2('8.2 Priorité P2 — confort et cohérence')

make_table(
    ['Point', 'Constat', 'Recommandation'],
    [
        ['Pronos sur matchs terminés',
         'La fiche d\u2019un match déjà joué (prolongation incluse) affiche encore un '
         '« prono du moteur » sans mention post-match.',
         'Étiqueter « lecture post-match » ou masquer le prono une fois le résultat connu.'],
        ['Rounds : ré-ouverture nécessaire',
         'À la première consultation, l\u2019onglet Rounds affiche « en préparation » tant '
         'que la collecte de fond n\u2019est pas terminée.',
         'Rafraîchir la fiche automatiquement à l\u2019arrivée du prior (état réactif).'],
        ['« ROUNDS ATTENDUS : — »',
         'Quand les fenêtres dérivées des combattants échouent, la valeur reste vide sans '
         'explication.',
         'Afficher la raison (données ESPN insuffisantes) à la place du tiret.'],
        ['Cache « ~0 Ko »',
         'L\u2019estimation de taille du cache s\u2019affiche à 0 Ko pour 436 entrées.',
         'Compter les tailles réelles stockées plutôt qu\u2019une estimation.'],
        ['Chargement à froid',
         'Les scoreboards des 140 ligues partent tous en même temps ; à froid, l\u2019accueil '
         'peut patienter (autour de 45 s sur le banc de test, file du relai).',
         'Séquencer par priorité de ligue (top ligues d\u2019abord), compléter en tâche de fond.'],
        ['Cotes absentes',
         'La plupart des championnats suivis n\u2019ont pas de cotes ESPN (« pas de cotes ») : '
         'ni value bets ni calibration.',
         'L\u2019affichage est honnête ; envisager une source de cotes secondaire si le '
         'besoin apparaît.'],
    ],
    [0.22, 0.42, 0.36],
    caption='Tableau 5 — Points P2 relevés lors du test.',
)

H2('8.3 Priorité P3 — gains de long terme')

B("<b>Sélecteur de dates limité à sept jours</b> pour le football : impossible de sauter "
  "directement à une date lointaine (les filtres rapides n'existent que pour les "
  "événements UFC). Un calendrier déroulant serait bienvenu.")
B("<b>Météo descriptive uniquement</b> : la donnée open-meteo est une condition « current », "
  "pas la prévision au coup d'envoi ; elle a été sagement retirée des λ, mais la fiche "
  "Contexte pourrait le préciser.")
B("<b>Résilience CDN</b> : malgré les reprises du relai, l'API core d'ESPN reste "
  "intermittente en environnement bridé ; les fenêtres dérivées des combattants "
  "(absorption, défenses) pourraient tirer parti du même repli scoreboard que le prior de "
  "rounds.")
B("<b>Accessibilité</b> : certains libellés descendent à 7-9 px (bancs, notes de bas de "
  "fiche) ; un palier minimal à 10 px améliorerait la lisibilité.")
B("<b>PFL / Bellator</b> : décodables mais exclus du scan (choix produit UFC uniquement) — "
  "à réévaluer si l'offre de données s'élargit.")
B("<b>Backtest football</b> : l'équivalent du backtest MMA n'existe pas encore côté "
  "football ; un rejoue du moteur sur les journées passées mesurerait la calibration "
  "annoncée contre la réalité.")

H2('8.4 Verdict d\u2019ensemble')

P("Sur les dix-huit vérifications du test, dix-huit passent : navigation, données réelles, "
  "calculs, affichages, cache, backtest — et le retrait demandé des compositions est "
  "effectif dans l'interface comme dans le code. Les trois anomalies d'affichage restantes "
  "(P1) sont circonscrites et simples à corriger ; aucune n'entache l'intégrité des "
  "pronostics. L'application tient ses promesses d'honnêteté — probabilités bornées, "
  "données absentes signalées, aucune cote éditée — et son architecture entièrement locale "
  "la rend robuste et peu coûteuse à faire tourner. Les recommandations du présent "
  "chapitre constituent la feuille de route naturelle de la prochaine itération.")

# ------------------------------------------------------------------
# Construction
# ------------------------------------------------------------------
doc = TocDocTemplate(
    OUT_BODY, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=MARGIN, bottomMargin=MARGIN,
    title=DOC_TITLE, author='Z.ai', creator='Z.ai',
    subject='Fonctionnement de l\u2019application VOLTRIX, formules des pronostics, '
            'test utilisateur et points à revoir',
)
doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print('Corps généré :', OUT_BODY)
