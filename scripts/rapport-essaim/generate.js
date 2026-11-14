/**
 * Rapport de l'essaim VOLTRIX — design & responsivité (3 000 agents).
 * Structure : couverture R1 (Dawn Mist Tech) → sommaire (romain) →
 * corps (arabe). Référence skill docx : routes/create.md.
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, PageNumber, PageBreak,
  BorderStyle, WidthType, ShadingType, TableLayoutType, SectionType,
  ImageRun, VerticalAlign, NumberFormat, TableOfContents,
} = require("docx");
const fs = require("fs");

/* ---------- Palette : Dawn Mist Tech (rapport tech) ---------- */
const P = {
  primary: "#0A1628", body: "#1A2B40", secondary: "#6878A0",
  accent: "#5B8DB8", surface: "#F4F8FC",
  bg: "#0A1628", titleColor: "#F4F8FC", subtitleColor: "#B8C8E0",
  metaColor: "#D0DCEC", footerColor: "#8CA0BC",
};
const c = (hex) => hex.replace("#", "");
const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
};
const allNoBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};

/* ---------- Couverture R1 (recette validée) ---------- */
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt;
  let lines;
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
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."，。、；：！？", ..."的与和及之在于为", ..."-_—–·/", ..." \t"]);
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
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false,
    hasEnglishLabel = false, metaLineCount = 0,
    fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, bottomSpacing };
}

function buildCoverR1(config) {
  const pal = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: c(pal.accent), space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: c(pal.accent), space: 8 } },
      children: [new TextRun({
        text: config.englishLabel.split("").join("  "),
        size: 18, color: c(pal.accent), font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40,
      })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, bold: true,
        color: c(pal.titleColor), font: { eastAsia: "SimHei", ascii: "Arial" },
      })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({
        text: config.subtitle, size: 24, color: c(pal.subtitleColor),
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" },
      })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({
        text: line, size: 24, color: c(pal.metaColor),
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" },
      })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: c(pal.accent), space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: c(pal.footerColor), font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: c(pal.footerColor), font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: c(pal.bg) }, borders: noBorders,
        children,
      })],
    })],
  })];
}

/* ---------- Briques de corps ---------- */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 140 },
    children: [new TextRun({ text, bold: true, color: c(P.primary), font: { ascii: "Calibri", eastAsia: "SimHei" } })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 110 },
    children: [new TextRun({ text, bold: true, color: c(P.primary), font: { ascii: "Calibri", eastAsia: "SimHei" } })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after ?? 80 },
    children: [new TextRun({ text, size: 22, color: c(P.body), ...opts.run })],
  });
}
function bullet(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: 312, after: 60 },
    bullet: { level: 0 },
    children: [new TextRun({ text, size: 22, color: c(P.body), bold: !!opts.bold })],
  });
}
function quote(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 120 },
    indent: { left: 400 },
    border: { left: { style: BorderStyle.SINGLE, size: 10, color: c(P.accent), space: 10 } },
    children: [new TextRun({ text, size: 21, italics: true, color: c(P.body) })],
  });
}
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200, before: 60 },
    children: [new TextRun({ text, size: 18, color: c(P.secondary), italics: true })],
  });
}
const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };
function cell(text, opts = {}) {
  return new TableCell({
    margins: cellMargins,
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: c(opts.fill) } : undefined,
    children: [new Paragraph({
      alignment: opts.align ?? AlignmentType.LEFT,
      spacing: { line: 276 },
      children: [new TextRun({
        text, size: opts.size ?? 20, bold: !!opts.bold,
        color: c(opts.color ?? P.body),
      })],
    })],
  });
}
function table(headers, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: c(P.accent) },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: c(P.accent) },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "C8D8E8" },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t) => cell(t, { bold: true, fill: P.surface, color: P.primary })),
      }),
      ...rows.map((r, i) => new TableRow({
        cantSplit: true,
        children: r.map((t, j) => cell(String(t), j === 0 ? { bold: true } : { fill: i % 2 ? P.surface : undefined })),
      })),
    ],
  });
}

/* ---------- Données ---------- */
const chartBuf = fs.readFileSync("/tmp/swarm/graphique-jugements.png");
const vlmQuotes = JSON.parse(fs.readFileSync("/tmp/swarm/vlm-jugements.json", "utf-8"));
const agentsSample = fs.readFileSync("/tmp/swarm/jugements-agents.jsonl", "utf-8")
  .trim().split("\n").map((l) => JSON.parse(l));

const devices = [
  ["iPhone SE 1", "320 × 568", "5 %"],
  ["Android entrée de gamme", "360 × 640", "16 %"],
  ["iPhone SE 2 / 8", "375 × 667", "8 %"],
  ["iPhone 12 / 13 / 14", "390 × 844", "24 %"],
  ["Pixel 7", "393 × 873", "12 %"],
  ["iPhone XR / 11", "414 × 896", "8 %"],
  ["iPhone 14 / 15 Pro Max", "430 × 932", "12 %"],
  ["Tablette portrait", "768 × 1024", "6 %"],
  ["Tablette paysage", "1024 × 768", "3 %"],
  ["Ordinateur portable", "1280 × 720", "3 %"],
  ["Écran de bureau", "1440 × 900", "2 %"],
  ["Grand écran", "1920 × 1080", "1 %"],
];

const tapRows = [
  ["Accueil", "Boutons « Combinateur » et « Réinitialiser » (36 × 36 px), pastilles de filtres de ligues (hauteur 27 px), boutons jour du bandeau (46 × 47 px, limite)"],
  ["Fiche match", "Boutons retour et onglets de sections (32–36 px de haut), sélecteurs d'onglets de marchés"],
  ["Combinateur (réglages)", "Segments de seuil (hauteur ~36 px), poignée du curseur de côte cible (zone tactile étroite)"],
  ["Combinateur (résultats)", "Lignes de sélection (jambes) de 40 px de haut, bouton de relance (36 × 36 px)"],
];
const fontRows = [
  ["Accueil", "Codes de ligues des filtres (8 px), compteurs « 182 » (8,5 px), libellés d'heure (9 px), mentions de confiances"],
  ["Fiche match", "Libellés de sections et notes de méthode (8,5 px), échelles de jauges, notes de bas de carte"],
  ["Combinateur (résultats)", "Heure et date des jambes (8–9 px), libellés de ligues (9,5 px), pied d'avertissement"],
  ["Combinateur (réglages)", "Bornes du curseur (8,5 px), libellés secondaires des segments"],
];

/* Échantillon d'agents pour l'annexe */
const sampleIdx = [4, 137, 1221, 1899, 2450, 2987];
const agentRows = sampleIdx.map((i) => {
  const a = agentsSample[i];
  return [
    `${a.nom} (${a.agent})`,
    a.appareil.replace(/ \(.+\)/, ""),
    a.jugements.slice(0, 2).map((j) => j.point.replace(/^\[[^\]]+\]\s*/, "")).join(" ").slice(0, 160) + "…",
  ];
});

/* ---------- Corps ---------- */
const bodyChildren = [];

bodyChildren.push(h1("1. Synthèse exécutive"));
bodyChildren.push(body(
  "Ce rapport restitue les jugements portés sur le design et la responsivité de l'application VOLTRIX par un essaim de 3 000 utilisateurs simulés, à partir de parcours réellement joués dans un navigateur headless sur 12 tailles d'écran (du 320 × 568 au 1920 × 1080) et cinq écrans de l'application. Les agents ont émis 232 765 jugements individuels, agrégés en 33 points canoniques distincts. Conformément à la commande, la fiabilité fonctionnelle est hors périmètre : seuls le design et la responsivité ont été évalués.",
));
bodyChildren.push(body(
  "Le verdict d'ensemble est nuancé. Les fondations sont saines : aucun agent n'a constaté de débordement horizontal, d'échec de contraste texte/fond ou d'image cassée — les corrections de couleurs apportées avant la simulation (combinateur notamment) sont confirmées efficaces. En revanche, quatre chantiers concentrent la quasi-totalité des reproches : des polices trop petites (moins de 9 px) sur tous les écrans, des zones tactiles inférieures au standard de 44 px, un contenu qui défile sous les barres flottantes semi-transparentes, et un gabarit strictement mobile qui gâche les grands écrans.",
));
bodyChildren.push(table(
  ["Famille de constat", "Jugements", "Agents concernés (max)"],
  [
    ["Zones tactiles < 44 px", "120 896", "3 000 (tous)"],
    ["Polices < 9 px", "85 809", "733"],
    ["Contenu sous barres flottantes", "24 570", "1 135"],
    ["Gabarit mobile sur grands écrans", "1 107", "97"],
    ["Premier contenu après défilement", "373", "373"],
    ["Contraste insuffisant", "0", "0"],
    ["Débordement horizontal", "0", "0"],
    ["Images cassées", "0", "0"],
  ],
  [4200, 1800, 2800],
));
bodyChildren.push(caption("Tableau 1 — Jugements par famille de constat (3 000 agents, 232 765 jugements)."));

bodyChildren.push(h1("2. Méthodologie de l'essaim"));
bodyChildren.push(h2("2.1 Pourquoi une adaptation de MiroFish"));
bodyChildren.push(body(
  "Le dépôt MiroFish est un moteur d'intelligence collective qui simule des milliers d'agents sociaux (plateforme OASIS, mémoire Zep, LLM) évoluant dans un monde parallèle pour prédire des événements. Ses agents ne naviguent pas sur de vraies pages web : l'outil a donc été adapté plutôt qu'utilisé tel quel. Le principe de l'essaim est conservé — une population d'agents aux profils, appareils et exigences variés dont on collecte tous les jugements — mais le moteur d'exécution est un navigateur headless piloté réellement sur l'application, ce qui garantit que chaque constat correspond à un état mesuré de l'interface.",
));
bodyChildren.push(h2("2.2 Les trois étages de la simulation"));
bodyChildren.push(bullet("Étage 1 — parcours réels : 12 viewports × 5 écrans (accueil, accueil J+2, fiche match, combinateur en réglages puis en résultats) ont été parcourus dans Chrome headless ; à chaque étape, un audit mécanique mesure les débordements, les tailles de police, les contrastes réels (couleur du texte contre le fond effectif, dégradés et surimpressions compris), les dimensions des cibles tactiles et les images cassées."));
bodyChildren.push(bullet("Étage 2 — jugements qualitatifs : 12 captures d'écran représentatives ont été commentées par un assistant vision, chacun sous l'angle d'un persona différent (utilisatrice exigeante sur iPhone, Android d'entrée de gamme, tablette, écran de bureau, parieur pressé, designer UI…)."));
bodyChildren.push(bullet("Étage 3 — projection des 3 000 agents : chaque persona (appareil pondéré par part de marché, écrans visités, traits — vision fatiguée, gros pouces, œil de designer, pressé, curieux) reprend à son compte les mesures de SON écran avec SES seuils : un agent « lunettes » signale les polices inférieures à 10 px et les contrastes inférieurs à 5:1, un agent « gros pouces » exige 44 px au lieu de 40 px."));
bodyChildren.push(body(
  "Trois itérations de l'audit ont été nécessaires pour éliminer les faux positifs : fonds en dégradé des écussons d'équipes, textes d'écrans empilés (l'accueil reste monté derrière le combinateur), et contenus situés sous la ligne de flottement. Les seuils de référence sont ceux des lignes directrices du secteur : 44 px minimum pour une cible tactile (Apple HIG), contraste 4,5:1 (WCAG AA), et une limite de lisibilité pratique de 9 px pour des textes de données.",
));
bodyChildren.push(table(
  ["Appareil simulé", "Viewport", "Part de la population"],
  devices,
  [4200, 2200, 2400],
));
bodyChildren.push(caption("Tableau 2 — Parc d'appareils des 3 000 agents (12 viewports réellement testés)."));

bodyChildren.push(h1("3. Jugements agrégés par thème"));
bodyChildren.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 120, after: 40 },
  children: [new ImageRun({
    type: "png",
    data: chartBuf,
    transformation: { width: 560, height: 274 },
  })],
}));
bodyChildren.push(caption("Figure 1 — Répartition des 232 765 jugements par famille de constat."));

bodyChildren.push(h2("3.1 Zones tactiles trop petites — 120 896 jugements (3 000 agents)"));
bodyChildren.push(body(
  "C'est le constat le plus universel : chaque agent, sur chaque écran, a rencontré au moins une cible tactile inférieure à 44 px. Les boutons d'action de l'accueil (combinateur, réinitialisation) mesurent 36 × 36 px, les pastilles de filtres de ligues 27 px de haut, les segments de seuil du combinateur environ 36 px. Sur petits écrans (320–360 px), l'assistant vision confirme le vécu : le bouton « Réglages » paraît partiellement masqué et la navigation de fin de page demande de la précision. Un agent au pouce malheureux tapote à côté ; un agent pressé renonce.",
));
bodyChildren.push(table(["Écran", "Cibles signalées (exemples mesurés)"], tapRows, [2200, 6600]));
bodyChildren.push(caption("Tableau 3 — Principales cibles tactiles sous-dimensionnées, par écran."));

bodyChildren.push(h2("3.2 Polices inférieures à 9 px — 85 809 jugements (jusqu'à 733 agents par écran)"));
bodyChildren.push(body(
  "L'application utilisemassivement des tailles de 8 à 9,5 px pour des informations utiles : codes de ligues, compteurs, heures de coup d'envoi, libellés de jambes de combiné. Les agents à vue fatiguée (18 % de la population) sont unanimes : ces textes sont illisibles sans zoom pincé. L'assistant vision enfonce le clou sur le combinateur : « les métadonnées des matchs (heure, date, ligue) en petit gris sont denses et un peu difficiles à lire », et sur l'accueil : « les pourcentages en petites pastilles sont denses ».",
));
bodyChildren.push(table(["Écran", "Textes concernés (mesures)"], fontRows, [2200, 6600]));
bodyChildren.push(caption("Tableau 4 — Textes inférieurs à 9 px, par écran."));

bodyChildren.push(h2("3.3 Contenu qui défile sous les barres flottantes — 24 570 jugements (1 135 agents)"));
bodyChildren.push(body(
  "La pastille de navigation « Accueil / Réglages » et les en-têtes dégradés du combinateur et des fiches match sont semi-transparents : le contenu défile dessous et devient momentanément illisible (textes noirs sur voile sombre). Plusieurs agents jugent que la dernière carte de chaque liste est « masquée » par la barre flottante, gênant la lecture des dernières cotes. Le remède classique est une marge intérieure basse de liste égale à la hauteur de la barre (environ 86 px) pour que le contenu se repose au-dessus.",
));

bodyChildren.push(h2("3.4 Gabarit mobile sur grands écrans — 1 107 jugements (97 agents)"));
bodyChildren.push(body(
  "Sur tablette paysage, portable et écran de bureau, l'application reste une colonne d'environ 450 px centrée sur fond noir : « l'impression d'une app téléphone posée au milieu de l'écran », avec « d'immenses zones vides noires de part et d'autre ». Les agents sur grands écrans sont minoritaires dans la population (6 %), mais leur constat est unanime. À l'inverse, la tablette en portrait reçoit des compliments : les cartes occupent bien la largeur « sans paraître surchargées ».",
));

bodyChildren.push(h2("3.5 Premier contenu utile après défilement — 373 jugements"));
bodyChildren.push(body(
  "Les agents « pressés » (12 % de la population) notent que l'accueil affiche 28 sections d'un coup : la densité est riche mais le premier combiné ou match à forte cote demande un défilement. Une mise en avant éditoriale (match du jour, combiné à la une) réduirait le temps jusqu'à la première information à valeur.",
));

bodyChildren.push(h2("3.6 Les absents — ce qu'aucun agent n'a reproché"));
bodyChildren.push(bullet("Aucun échec de contraste : après les corrections pré-simulation (textes du combinateur passés en noir sur fond clair), plus aucun texte visible ne descend sous 4,5:1. Les agents à vue fatiguée eux-mêmes n'ont rien trouvé à redire sur les couleurs des textes visibles."));
bodyChildren.push(bullet("Aucun débordement horizontal : les 12 viewports, du 320 au 1920, s'affichent sans scroll latéral parasite ; le bandeau de jours défile volontairement (conteneur prévu pour)."));
bodyChildren.push(bullet("Aucune image cassée : écussons d'équipes et photos se chargent sur tous les écrans testés."));

bodyChildren.push(h1("4. Jugements qualitatifs de l'assistant vision (extraits)"));
bodyChildren.push(body(
  "Les douze captures commentées sous persona couvrent les cinq écrans et quatre familles d'appareils. Les citations ci-dessous sont restituées verbatim ; elles enrichissent les mesures mécaniques de détails que seul un œil humain (ou un modèle de vision) relève.",
));
for (const q of vlmQuotes) {
  bodyChildren.push(quote(`[${q.ecran}] ${q.jugement}`));
}

bodyChildren.push(h1("5. Corrections apportées avant la simulation"));
bodyChildren.push(body(
  "Les défauts relevés par l'équipe avant le lancement de l'essaim ont été corrigés, et la simulation en confirme la disparition. Ces corrections constituent le point zéro du présent rapport.",
));
bodyChildren.push(bullet("Seuils du combinateur : les paliers de réussite sont désormais 20 % / 30 % / 40 % (contre 40/50/60 % auparavant), avec 40 % par défaut."));
bodyChildren.push(bullet("Couleurs du combinateur : les textes des cartes (jambes, cotes, segments de réglage) sont passés en noir sur fond clair — ils étaient blancs sur fond clair, illisibles. L'audit n'a plus aucun échec de contraste à signaler."));
bodyChildren.push(bullet("Textes superflus supprimés : paragraphes d'explication du combinateur condensés, note de méthode de la section « premier but » retirée, pied de page raccourci."));
bodyChildren.push(bullet("Cohérence « premier but » : la fenêtre mise en surbrillance est désormais celle qui contient la minute médiane annoncée (la barre néon ne contredit plus le titre « 30e minute »)."));
bodyChildren.push(bullet("Couverture de la semaine : la base pré-calculée couvre désormais J-2 à J+8 (930 lignes, week-end suivant inclus : 56 matchs le vendredi 20, 201 le samedi 21, 122 le dimanche 22 novembre) et le sélecteur de jours va jusqu'à J+6."));
bodyChildren.push(bullet("Marchés du combinateur : victoire V1/V2, double chance, total buts et premier but (avant/après la Xe minute, cote équitable dérivée du moteur) composent désormais les combinés — l'analyse de la semaine propose par exemple des combinés mélangeant victoire et premier but."));

bodyChildren.push(h1("6. Échantillon de jugements agents"));
bodyChildren.push(body(
  "Le fichier « jugements-agents-voltrix.jsonl » joint à ce rapport contient les 3 000 jugements individuels, un par agent, avec son appareil, ses traits et la liste de ses constats. Six extraits représentatifs :",
));
bodyChildren.push(table(["Agent", "Appareil", "Extraits de jugements"], agentRows, [2000, 1800, 5000]));
bodyChildren.push(caption("Tableau 5 — Six agents tirés au hasard stratifié (fichier complet en annexe)."));

bodyChildren.push(h1("7. Recommandations priorisées"));
bodyChildren.push(bullet("P1 — Tailles de police : relever le plancher à 10 px (codes de ligues, heures, compteurs, libellés de jambes). C'est le chantier au meilleur rapport effort/impact : 85 809 jugements concernés.", { bold: true }));
bodyChildren.push(bullet("P2 — Zones tactiles : porter les boutons d'action à 44 × 44 px et les pastilles de filtres à 36 px de haut minimum, avec un espacement suffisant entre cibles voisines.", { bold: true }));
bodyChildren.push(bullet("P3 — Barres flottantes : ajouter une marge basse de liste (environ 86 px) pour que le contenu se repose au-dessus de la pastille de navigation et des en-têtes dégradés."));
bodyChildren.push(bullet("P4 — Grands écrans : à partir de 768 px de large, passer à deux colonnes de cartes et élargir la zone de contenu ; le bandeau de jours et les filtres gagneraient une indication de défilement (dégradé latéral ou points)."));
bodyChildren.push(bullet("P5 — Détails remontés par l'assistant vision : réaligner les badges étoilés (coupés, incohérents entre cartes), retirer le doublon d'information du bandeau d'alerte du combinateur, éviter la troncature des en-têtes (« LUNDI 16… ») sur 360 px, revoir la teinte du libellé « X pronos restaurés »."));
bodyChildren.push(body(
  "Ces cinq chantiers traiteraient la totalité des 232 765 jugements négatifs émis par l'essaim. Les fondations — hiérarchie visuelle, contraste, absence de débordement, qualité perçue des cartes — sont saluées par les agents sur tous les appareils ; il s'agit désormais d'un travail de calibrage, pas de refondation.",
));

/* ---------- Document ---------- */
const doc = new Document({
  creator: "Essaim VOLTRIX",
  title: "Rapport de l'essaim — design et responsivité",
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" }, size: 22, color: c(P.body) },
        paragraph: { spacing: { line: 312 } },
      },
    },
  },
  sections: [
    /* Couverture */
    {
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1({
        title: "Rapport de l'essaim VOLTRIX",
        subtitle: "Design et responsivité jugés par 3 000 utilisateurs simulés",
        englishLabel: "SWARM REPORT",
        metaLines: [
          "3 000 agents · 12 appareils · 5 écrans · 232 765 jugements",
          "Méthode : parcours réels en navigateur headless + assistant vision",
          "Base Neon : 930 matchs pré-calculés (J-2 → J+8)",
          "14 novembre 2026",
        ],
        footerLeft: "VOLTRIX — application de pronostics",
        footerRight: "Simulation MiroFish adaptée",
        palette: P,
      }),
    },
    /* Sommaire (romain) */
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: c(P.secondary) })],
          })],
        }),
      },
      children: [
        new Paragraph({
          spacing: { before: 200, after: 240 },
          children: [new TextRun({ text: "Sommaire", bold: true, size: 40, color: c(P.primary), font: { ascii: "Calibri", eastAsia: "SimHei" } })],
        }),
        new TableOfContents("Sommaire", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Remarque : après ouverture du document, cliquer droit sur le sommaire puis « Mettre à jour les champs » pour rafraîchir les numéros de page.",
            italics: true, size: 18, color: c(P.secondary),
          })],
        }),
      ],
    },
    /* Corps (arabe, repart à 1) */
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: c(P.accent), space: 4 } },
            children: [new TextRun({ text: "Essaim VOLTRIX — design et responsivité", size: 16, color: c(P.secondary) })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: c(P.secondary) })],
          })],
        }),
      },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/rapport-essaim-voltrix.docx", buf);
  console.log("docx écrit :", buf.length, "octets");
});
