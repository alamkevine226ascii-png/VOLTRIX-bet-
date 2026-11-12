/* Diagnostic VOLTRIX — rapport Word Business Professional (français)
 * Recette de couverture : R1 (Pure Paragraph Left) — palette DM-1 (Deep Cyan)
 * Architecture : 3 sections (couverture / table des matières / corps)
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  TableLayoutType, PageBreak,
} = require("docx");
const fs = require("fs");
const path = require("path");

/* ---------- Palette DM-1 (Deep Cyan — produit numérique) ---------- */
const COVER = {
  bg: "162235", titleColor: "FFFFFF", subtitleColor: "B0B8C0",
  metaColor: "90989F", footerColor: "687078", accent: "37DCF2",
};
const T = { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" };
const HEAD_COLOR = "0E2A38";

/* ---------- Polices ---------- */
const F  = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "SimSun" };
const FH = { ascii: "Arial", hAnsi: "Arial", eastAsia: "SimHei" };

/* ---------- Bordures ---------- */
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

/* ---------- Couverture : fonctions utilitaires (adaptées texte latin) ---------- */
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."-_—–·/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 36, minPt = 24) {
  const charWidth = (pt) => pt * 11; /* latin gras, largeur moyenne */
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

/* ---------- Recette R1 : Pure Paragraph Cover ---------- */
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 36, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({
        text: config.englishLabel.split("").join("  "),
        size: 18, color: P.accent, font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "SimHei" }, characterSpacing: 40,
      })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, bold: true,
        color: P.titleColor, font: { eastAsia: "SimHei", ascii: "Arial", hAnsi: "Arial" },
      })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({
        text: config.subtitle, size: 24, color: P.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Arial" },
      })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({
        text: line, size: 24, color: P.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial", hAnsi: "Arial" },
      })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: { ascii: "Arial", hAnsi: "Arial" } }),
      new TextRun({ text: "                                        ", size: 16, color: P.footerColor, font: { ascii: "Arial", hAnsi: "Arial" } }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: { ascii: "Arial", hAnsi: "Arial" } }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

/* ---------- Aides corps de document ---------- */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: HEAD_COLOR, font: FH })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: HEAD_COLOR, font: FH })],
  });
}
/* paragraphe : chaîne ou tableau de fragments { t, b } */
function p(content, opts = {}) {
  const frags = typeof content === "string" ? [{ t: content }] : content;
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: opts.after != null ? opts.after : 120, line: 312 },
    keepNext: !!opts.keepNext,
    children: frags.map((f) => new TextRun({
      text: f.t, bold: !!f.b, size: 24, color: "000000", font: F,
    })),
  });
}
function tableCaption(text) {
  return new Paragraph({
    keepNext: true, alignment: AlignmentType.LEFT,
    spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, color: HEAD_COLOR, font: FH })],
  });
}
function cellPara(text, opts = {}) {
  return new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { line: 312 },
    children: [new TextRun({
      text, bold: !!opts.bold, size: 21,
      color: opts.color || "000000", font: opts.head ? FH : F,
    })],
  });
}
function dataTable(widths, headerCells, rows, zebra) {
  const mkCell = (txt, i, opts) => new TableCell({
    children: [cellPara(txt, opts)],
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    width: { size: widths[i], type: WidthType.PERCENTAGE },
    shading: opts.head
      ? { type: ShadingType.CLEAR, fill: T.headerBg }
      : (zebra ? { type: ShadingType.CLEAR, fill: T.surface } : undefined),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: T.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: T.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: T.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headerCells.map((t2, i) => mkCell(t2, i, { head: true, bold: true, color: T.headerText })),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((t2, i) => mkCell(t2, i, { zebraFill: ri % 2 === 1 })),
      })),
    ],
  });
}

/* ---------- En-tête et pied de page ---------- */
const HEADER_TEXT = "VOLTRIX — Diagnostic : rechargement du moteur de prédictions";
function buildHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "C8DDE2", space: 4 } },
      spacing: { after: 0, line: 240 },
      children: [new TextRun({ text: HEADER_TEXT, size: 18, color: "808080", font: FH })],
    })],
  });
}
function buildFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: 240 },
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: F })],
    })],
  });
}

/* ---------- Contenu du corps ---------- */
const body = [];

/* Synthèse exécutive */
body.push(h1("Synthèse exécutive"));
body.push(p([
  { t: "Ce rapport diagnostique l'anomalie suivante : après consultation d'une fiche match ou combat, le retour à l'écran d'accueil déclenche un rechargement complet des données, d'une durée minimale de trente secondes, alors même que le moteur de prédictions venait de terminer ses calculs. " },
]));
body.push(p([
  { t: "L'analyse du code source établit que la cause est " },
  { t: "architecturale et non statistique", b: true },
  { t: ". L'application ne maintient à l'écran que le sommet de sa pile de navigation : ouvrir une fiche démonte intégralement l'écran d'accueil et détruit son état (listes de matchs, pronostics affichés, filtres, date, position de défilement). Au retour, l'écran se reconstruit à vide et relance l'ensemble de la chaîne de chargement. Un facteur amplificateur aggrave le délai dès que l'absence dépasse une minute : la durée de vie du cache des scores du jour est fixée à soixante secondes, ce qui transforme le rechargement en un véritable re-scan réseau de plusieurs dizaines de requêtes. Les prédictions elles-mêmes sont correctement persistées en base locale pendant quinze minutes : le délai perçu provient donc du rechargement des données, et non du recalcul des pronostics." },
]));
body.push(p([
  { t: "La recommandation prioritaire est de " },
  { t: "conserver l'écran d'accueil monté sous la fiche détaillée", b: true },
  { t: " (empilement des écrans), complétée par un cache mémoire de la journée. Le retour attendu passe alors à moins d'une seconde, sans aucune requête réseau lors des retours rapides. Conformément à la demande, aucune modification de code n'a été effectuée à ce stade." },
]));

/* 1. Contexte */
body.push(h1("1. Contexte et symptôme constaté"));
body.push(h2("1.1 Scénario observé"));
body.push(p("Le flux concerné est le suivant : l'utilisateur ouvre l'application ; le moteur de prédictions termine ses calculs et affiche les cartes de matchs et de combats ; l'utilisateur ouvre une fiche (match de football ou combat de MMA) et y reste environ vingt secondes ; en revenant à l'accueil, il constate un rechargement complet — squelettes de chargement, puis reconstruction progressive des listes — d'une durée d'au moins trente secondes."));
body.push(h2("1.2 Impact et périmètre"));
body.push(p("Cet effet dégrade directement l'expérience : navigation perçue comme lente, perte de la position de défilement et du filtre actif à chaque consultation d'une fiche, consommation réseau inutile sur mobile, et risque d'abandon de la consultation multi-fiches. Le périmètre couvert par ce diagnostic est l'écran d'accueil et la navigation vers les écrans de détail."));
body.push(p([
  { t: "Précision importante : ", b: true },
  { t: "la durée de vingt secondes passée sur la fiche n'est pas la cause du problème. La perte d'état se produit à l'instant de la navigation, quelle que soit la durée de la consultation. En revanche, au-delà d'environ une minute d'absence, l'expiration du cache des scores du jour (durée de vie : soixante secondes) rend un re-scan réseau complet inévitable et allonge d'autant le rechargement." },
]));

/* 2. Méthode */
body.push(h1("2. Méthode de diagnostic"));
body.push(p("Le diagnostic repose sur une analyse statique du code source de l'application, menée par lecture directe des fichiers concernés, sans exécution du moteur ni modification du code, conformément à la demande. Les fichiers examinés sont : la racine de navigation (VoltrixApp.tsx), l'écran d'accueil (HomeScreen.tsx), la couche de chargement du football (lib/foot/bridge.ts et lib/foot/espn.ts), la chaîne d'enrichissement du MMA (lib/mma-bridge.ts) et la base locale de pronostics (lib/pred-db.ts). Les numéros de ligne cités correspondent à l'état du code à la date d'analyse. Chaque constat est rattaché à un emplacement précis du code ; aucune donnée n'a été extrapolée."));

/* 3. Diagnostic */
body.push(h1("3. Diagnostic : cause racine et mécanisme"));
body.push(h2("3.1 Cause racine : l'écran d'accueil est démonté à chaque navigation"));
body.push(p([
  { t: "La racine de navigation gère une pile d'écrans, mais ne rend à l'écran que l'élément situé au sommet de cette pile (VoltrixApp.tsx, lignes 127 à 160). Dès l'ouverture d'une fiche match ou combat, l'écran d'accueil est " },
  { t: "démonté", b: true },
  { t: " : la totalité de son état local (HomeScreen.tsx, lignes 371 à 397) est détruite — listes de matchs et de combats, pronostics affichés, filtre actif, date sélectionnée, position de défilement. Au retour, le composant se remonte à vide et son effet de chargement (lignes 485 à 487) s'exécute de nouveau, systématiquement." },
]));
body.push(h2("3.2 La chaîne de rechargement déclenchée au retour"));
body.push(p("La fonction de chargement commence par remettre explicitement les données à zéro (données de matchs à null, pronostics à vide — HomeScreen.tsx, lignes 454 à 459), ce qui affiche les squelettes. Elle relance ensuite le scan complet des compétitions de football en trois vagues de priorité, avec quatre requêtes parallèles (lib/foot/bridge.ts, lignes 84 à 129), puis rejoue l'intégralité de la chaîne MMA : événements, photos et drapeaux des combattants, formes récentes et pronostics express (lib/mma-bridge.ts, lignes 357 à 466). Lorsque les caches de bas niveau sont encore valides, seule l'orchestration est rejouée ; lorsqu'ils ont expiré, chaque étape repasse par le réseau."));
body.push(h2("3.3 Facteurs amplificateurs"));
body.push(p([
  { t: "Quatre facteurs allongent le rechargement. " },
  { t: "Premièrement", b: true },
  { t: ", la durée de vie du cache des scores du jour est de soixante secondes (lib/foot/espn.ts, ligne 25) : passé ce délai, le re-scan devient un véritable re-scan réseau de plusieurs dizaines de requêtes, ce qui explique l'ordre de grandeur des trente secondes observées. " },
  { t: "Deuxièmement", b: true },
  { t: ", la donnée agrégée du jour (listes finales prêtes à afficher) n'est mise en cache nulle part : seules les réponses réseau brutes disposent de durées de vie. " },
  { t: "Troisièmement", b: true },
  { t: ", en environnement de développement, le mode StrictMode de React exécute chaque effet deux fois, ce qui double la durée perçue. " },
  { t: "Quatrièmement", b: true },
  { t: ", les vagues de scan s'exécutent séquentiellement entre priorités, ce qui borne la vitesse de reconstruction." },
]));
body.push(h2("3.4 Ce qui fonctionne déjà correctement"));
body.push(p([
  { t: "Un point mérite d'être souligné : les pronostics de football et de MMA sont déjà persistés dans une base locale IndexedDB, avec une durée de validité de quinze minutes pour les événements à venir, de dix minutes en direct et de six heures une fois terminés (HomeScreen.tsx, lignes 45 à 53 et 519 à 564). Tant que ces entrées sont valides, " },
  { t: "le moteur statistique ne recalcule rien au retour", b: true },
  { t: " : les pronostics sont relus instantanément depuis la base locale. Le délai de trente secondes perçu provient donc du re-chargement et de la ré-hydratation des listes de matchs et de combats, et non du recalcul des prédictions. Le problème est réel côté données, mais ne remet pas en cause le travail déjà accompli côté persistance des calculs." },
]));

/* 4. Options */
body.push(h1("4. Options de résolution"));
body.push(p("Cinq options ont été identifiées. Elles sont décrites ici de manière conceptuelle, sans implémentation, conformément à la demande."));
body.push(h2("4.1 Option A — Conserver l'accueil monté sous la fiche (priorité 1)"));
body.push(p("Modifier uniquement la racine de navigation : au lieu de remplacer l'écran courant, empiler la fiche détaillée par-dessus un écran d'accueil maintenu en vie — le modèle des applications mobiles natives, où la vue précédente reste montée sous la nouvelle. L'accueil n'est jamais démonté : le retour devient instantané, l'état, le filtre et la position de défilement sont intacts, et aucune requête n'est relancée. Effort : faible (un seul fichier concerné). Risque : faible (empreinte mémoire marginale)."));
body.push(h2("4.2 Option B — Cache mémoire de la journée"));
body.push(p("Conserver le résultat agrégé du jour (listes de football et de MMA, date) dans une structure vivant hors du cycle de vie du composant, de sorte qu'elle survive aux démontages pendant toute la session. Au remontage, l'écran s'affiche immédiatement depuis ce cache, puis se rafraîchit en arrière-plan si nécessaire. Effort : faible. Cette option complète l'option A et couvre les cas où l'accueil serait malgré tout démonté."));
body.push(h2("4.3 Option C — État global de l'application"));
body.push(p("Déplacer les données partagées (listes, pronostics, filtres, date) vers un magasin d'état monté à la racine de l'application, indépendant de la navigation. C'est la solution la plus pérenne si l'application gagne de nouveaux écrans partageant les mêmes données, mais elle suppose une refonte de l'organisation de l'état. Effort : moyen."));
body.push(h2("4.4 Option D — Persistance session des listes"));
body.push(p("Étendre le mécanisme de base locale déjà en place pour les pronostics aux listes du jour, avec une validité courte (deux à cinq minutes). Cette option couvre le cas supplémentaire du rechargement complet du navigateur, qu'aucune des options précédentes ne traite. Effort : faible."));
body.push(h2("4.5 Option E — Calculs dans un fil séparé (Web Worker)"));
body.push(p("Déplacer les calculs lourds du moteur vers un fil d'exécution séparé. Cette option ne supprime pas le rechargement, mais élimine tout gel de l'interface pendant les phases de calcul. Elle constitue une amélioration de confort indépendante. Effort : moyen à élevé. À noter : une déportation des calculs vers un serveur a été écartée d'emblée, car contraire au principe d'une application entièrement exécutée dans le navigateur."));
body.push(p("Le tableau suivant compare les cinq options.", { keepNext: true, after: 80 }));
body.push(tableCaption("Tableau 1 : Comparatif des cinq options de résolution"));
body.push(dataTable(
  [26, 12, 30, 12, 20],
  ["Option", "Effort", "Impact sur le symptôme", "Risque", "Délai estimé"],
  [
    ["A — Accueil conservé monté", "Faible", "Total : retour instantané, état conservé", "Faible", "1 à 2 heures"],
    ["B — Cache mémoire de journée", "Faible", "Fort : affichage immédiat au remontage", "Faible", "Environ 1 heure"],
    ["C — État global (store)", "Moyen", "Fort, mais refonte de l'architecture d'état", "Moyen", "3 à 5 heures"],
    ["D — Persistance session", "Faible", "Moyen : couvre le rechargement du navigateur", "Faible", "Environ 1 heure"],
    ["E — Web Worker", "Moyen à élevé", "Indirect : supprime le gel, pas le rechargement", "Moyen", "3 à 5 heures"],
  ],
  false,
));
body.push(p("Les options A et B sont cumulatives : la première supprime le déclenchement du problème, la seconde en garantit la conséquence bénigne si le démontage survient malgré tout. Les options C, D et E répondent à des cas d'usage supplémentaires (croissance de l'application, rechargement navigateur, fluidité des calculs).", { after: 160 }));

/* 5. Recommandation */
body.push(h1("5. Recommandation et plan d'action"));
body.push(h2("5.1 Recommandation"));
body.push(p([
  { t: "La priorité est donnée à " },
  { t: "l'option A", b: true },
  { t: " : elle supprime la totalité du symptôme dans le flux décrit, pour un effort limité à un fichier. Elle est complétée par l'option B en filet de sécurité et par l'option D pour couvrir le rechargement du navigateur. L'option C est recommandée à moyen terme si l'application s'enrichit de nouveaux écrans ; l'option E reste une amélioration de confort à planifier séparément." },
]));
body.push(p("Le plan d'action ci-dessous récapitule les interventions, leur priorité, leur effort estimé, leur propriétaire et le résultat attendu.", { keepNext: true, after: 80 }));
body.push(tableCaption("Tableau 2 : Plan d'action proposé"));
body.push(dataTable(
  [26, 9, 10, 17, 38],
  ["Action", "Priorité", "Effort", "Propriétaire", "Résultat attendu"],
  [
    ["A — Empilement des écrans (accueil maintenu)", "P1", "1 à 2 heures", "Développeur VOLTRIX", "Retour inférieur à 1 seconde ; zéro requête réseau au retour rapide ; défilement conservé"],
    ["B — Cache mémoire de la journée", "P2", "Environ 1 heure", "Développeur VOLTRIX", "Affichage immédiat après tout démontage de l'accueil"],
    ["D — Persistance session des listes", "P3", "Environ 1 heure", "Développeur VOLTRIX", "Rechargement du navigateur instantané pour des données de moins de 5 minutes"],
    ["E — Calculs en Web Worker", "P4", "3 à 5 heures", "Développeur VOLTRIX", "Interface fluide pendant les calculs du moteur"],
  ],
  false,
));
body.push(p([
  { t: "Trois critères mesurables valideront la correction : " },
  { t: "durée du retour depuis une fiche inférieure à une seconde ; aucune requête réseau lors d'un retour après une absence de moins d'une minute ; conservation intégrale de la position de défilement et du filtre actif", b: true },
  { t: "." },
], { after: 160 }));

/* Conclusion */
body.push(h1("Conclusion"));
body.push(p("Le problème rapporté est un défaut architectural précisément localisé : la navigation par remplacement d'écran détruit l'état de l'accueil à chaque consultation d'une fiche, et la chaîne de rechargement qui s'ensuit est allongée par une durée de cache courte sur les scores du jour. Il n'est imputable ni au temps passé sur la fiche, ni au moteur statistique, dont les résultats sont déjà persistés quinze minutes. Les correctifs identifiés sont simples, progressifs et cumulables, l'option A suffisant à elle seule à supprimer le symptôme dans le flux décrit. Conformément à la demande, aucune modification du code n'a été réalisée ; la prochaine étape est la validation des options retenues, puis la mise en œuvre de l'option A."));

/* ---------- Assemblage du document ---------- */
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: "VOLTRIX",
  title: "Diagnostic — Rechargement du moteur de prédictions VOLTRIX",
  styles: {
    default: {
      document: {
        run: { font: F, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FH, size: 32, bold: true, color: HEAD_COLOR },
        paragraph: { spacing: { before: 360, after: 160, line: 312 } },
      },
      heading2: {
        run: { font: FH, size: 28, bold: true, color: HEAD_COLOR },
        paragraph: { spacing: { before: 240, after: 120, line: 312 } },
      },
    },
  },
  sections: [
    /* Section 1 : couverture — marges nulles, ni en-tête ni pied de page */
    {
      properties: {
        page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1({
        title: "Rechargement du moteur de prédictions VOLTRIX",
        subtitle: "Diagnostic technique et options de résolution",
        englishLabel: "TECHNICAL DIAGNOSTIC REPORT",
        metaLines: [
          "Application : VOLTRIX — Next.js, calculs exécutés dans le navigateur",
          "Périmètre : écran d'accueil, navigation vers une fiche match ou combat",
          "Date d'analyse : 11 novembre 2026",
          "Statut : diagnostic — aucune modification de code effectuée",
        ],
        footerLeft: "VOLTRIX — Document technique interne",
        footerRight: "11 novembre 2026",
        palette: COVER,
      }),
    },
    /* Section 2 : table des matières — numérotation romaine */
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: buildHeader() },
      footers: { default: buildFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360, line: 480, lineRule: "atLeast" },
          children: [new TextRun({ text: "Table des matières", bold: true, size: 32, color: HEAD_COLOR, font: FH })],
        }),
        new TableOfContents("Table des matières", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Remarque : cette table des matières est générée par champs. Après toute modification du document, cliquer avec le bouton droit sur la table puis choisir « Mettre à jour les champs » pour actualiser les numéros de page.",
            italics: true, size: 18, color: "888888", font: F,
          })],
        }),
      ],
    },
    /* Section 3 : corps — numérotation arabe repartant de 1 */
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: buildHeader() },
      footers: { default: buildFooter() },
      children: body,
    },
  ],
});

const OUT = "/home/z/my-project/download/Diagnostic_Rechargement_Moteur_VOLTRIX_BusinessProfessional_2026-11-11.docx";
fs.mkdirSync(path.dirname(OUT), { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("OK ->", OUT, buf.length, "octets");
});
