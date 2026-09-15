// Assemblage du dossier de suivi VOLTRIX bet — DOCX 3 sections (couverture R1 / sommaire / corps)
const {
  Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, SectionType, TableOfContents,
} = require("docx");
const fs = require("fs");

const { PAL, FONT_BODY, FONT_HEAD, buildCoverR1 } = require("./suivi-helpers");
const { c1, c2, c3, c4 } = require("./suivi-content1");
const { c5, c6, c7, annexe } = require("./suivi-content2");

const DOC_TITLE = "VOLTRIX bet \u2014 Dossier de suivi projet";
const OUT = "/home/z/my-project/download/VOLTRIX-bet-Dossier-de-suivi-projet.docx";

const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

function pageNumFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT_BODY })],
    })],
  });
}

function bodyHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 0 },
      children: [new TextRun({ text: DOC_TITLE, size: 18, color: "888888", font: FONT_BODY })],
    })],
  });
}

// ── Couverture (recette R1, palette IG-1) ──
const coverChildren = buildCoverR1({
  title: "VOLTRIX bet",
  subtitle: "Dossier de suivi projet \u2014 travaux r\u00e9alis\u00e9s, constats et feuille de route",
  englishLabel: "PROJECT STATUS REPORT",
  metaLines: [
    "Application : PWA de pronostics football (donn\u00e9es ESPN)",
    "P\u00e9riode couverte : 2 \u2013 13 septembre 2026 \u00b7 Tasks 1 \u00e0 22",
    "Version du moteur : v2.1 \u00b7 2 850 pronostics en base",
    "\u00c9dition du 13 septembre 2026",
  ],
  footerLeft: "VOLTRIX bet \u2014 document interne",
  footerRight: "13/09/2026",
  palette: {
    bg: PAL.bg, accent: PAL.accent,
    titleColor: PAL.cover.titleColor, subtitleColor: PAL.cover.subtitleColor,
    metaColor: PAL.cover.metaColor, footerColor: PAL.cover.footerColor,
  },
});

// ── Sommaire (section 2, num\u00e9rotation romaine) ──
const frontMatter = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 360, line: 312 },
    children: [new TextRun({ text: "Sommaire", bold: true, size: 32, color: PAL.headingColor, font: FONT_HEAD })],
  }),
  new TableOfContents("Sommaire", { hyperlink: true, headingStyleRange: "1-3" }),
  new Paragraph({
    spacing: { before: 200, line: 312 },
    children: [new TextRun({
      text: "Remarque : ce sommaire est g\u00e9n\u00e9r\u00e9 par codes de champ. Apr\u00e8s toute modification du document, faites un clic droit sur le sommaire puis choisissez \u00ab Mettre \u00e0 jour les champs \u00bb pour actualiser la pagination.",
      italics: true, size: 18, color: "888888", font: FONT_BODY,
    })],
  }),
];

const doc = new Document({
  creator: "VOLTRIX bet",
  title: DOC_TITLE,
  description: "Suivi de projet : travaux r\u00e9alis\u00e9s, constats et feuille de route (Tasks 1 \u00e0 22)",
  styles: {
    default: {
      document: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 32, bold: true, color: PAL.headingColor },
        paragraph: { spacing: { before: 400, after: 180, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 28, bold: true, color: PAL.headingColor },
        paragraph: { spacing: { before: 280, after: 130, line: 312 }, outlineLevel: 1 },
      },
      heading3: {
        run: { font: { ascii: "Times New Roman", eastAsia: "SimHei" }, size: 24, bold: true, color: PAL.headingColor },
        paragraph: { spacing: { before: 220, after: 110, line: 312 }, outlineLevel: 2 },
      },
    },
  },
  sections: [
    {
      // Section 1 : couverture — marges 0, pas de pied de page
      properties: {
        page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: coverChildren,
    },
    {
      // Section 2 : sommaire — num\u00e9rotation romaine
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageNumFooter() },
      children: frontMatter,
    },
    {
      // Section 3 : corps — num\u00e9rotation arabe repartant de 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: bodyHeader() },
      footers: { default: pageNumFooter() },
      children: [...c1, ...c2, ...c3, ...c4, ...c5, ...c6, ...c7, ...annexe],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("DOCX \u00e9crit :", OUT, "(" + Math.round(buf.length / 1024) + " Ko)");
}).catch((e) => { console.error(e); process.exit(1); });
