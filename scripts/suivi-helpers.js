// Helpers du dossier de suivi VOLTRIX bet — palette IG-1 (Ink Gold), recette R1
const {
  Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, PageBreak,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, VerticalAlign,
} = require("docx");
const fs = require("fs");

// ── Palette IG-1 (Ink Gold) ──
const PAL = {
  bg: "1A1A1A", accent: "C9A84C",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "C9A84C", headerText: "1A1A1A", accentLine: "C9A84C", innerLine: "DDD5C0", surface: "F5F2E8" },
  headingColor: "1A1A1A", body: "000000", secondary: "555555",
};

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

const FONT_BODY = { ascii: "Times New Roman", eastAsia: "SimSun" };
const FONT_HEAD = { ascii: "Times New Roman", eastAsia: "SimHei" };

function safeText(v, ph) {
  if (v === undefined || v === null || v === "" || String(v) === "NaN" || String(v) === "undefined") {
    return ph || "\u3010\u00e0 compl\u00e9ter\u3011";
  }
  return String(v);
}

// ── Largeur estim\u00e9e d'un texte (CJK = pt\u00d720 twips, latin = pt\u00d711) ──
function estimateTextWidth(text, pt) {
  let w = 0;
  for (const ch of text) w += /[\u4e00-\u9fff\u3000-\u303f]/.test(ch) ? pt * 20 : pt * 11;
  return w;
}

function splitTitleLines(title, maxWidthTwips, pt) {
  if (estimateTextWidth(title, pt) <= maxWidthTwips) return [title];
  const words = title.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (estimateTextWidth(cand, pt) <= maxWidthTwips || !cur) cur = cand;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // pas de ligne orpheline tr\u00e8s courte
  if (lines.length > 1 && lines[lines.length - 1].length <= 3) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    lines = splitTitleLines(title, maxWidthTwips, titlePt);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, maxWidthTwips, minPt); titlePt = minPt; }
  return { titlePt, titleLines: lines };
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
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ── Recette R1 : couverture paragraphe pur, align\u00e9e \u00e0 gauche ──
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400,
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
        size: 18, color: P.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40,
      })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, bold: true,
        color: P.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" },
      })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({
        text: config.subtitle, size: 24, color: P.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" },
      })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({
        text: safeText(line), size: 24, color: P.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" },
      })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: { ascii: "Arial", eastAsia: "Microsoft YaHei" } }),
      new TextRun({ text: "                                        ", font: { ascii: "Arial" } }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: { ascii: "Arial", eastAsia: "Microsoft YaHei" } }),
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
        verticalAlign: VerticalAlign.TOP,
        children,
      })],
    })],
  })];
}

// ── Constructeurs du corps ──
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, keepNext: true,
    spacing: { before: 400, after: 180, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: PAL.headingColor, font: FONT_HEAD })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, keepNext: true,
    spacing: { before: 280, after: 130, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: PAL.headingColor, font: FONT_HEAD })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3, keepNext: true,
    spacing: { before: 220, after: 110, line: 312 },
    children: [new TextRun({ text, bold: true, size: 24, color: PAL.headingColor, font: FONT_HEAD })],
  });
}

// para("texte") ou para([["normal "], ["gras", true], [" suite"]])
function para(content, opts = {}) {
  const segs = Array.isArray(content) ? content : [[content, false]];
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: opts.noIndent ? undefined : { firstLine: 480 },
    spacing: { line: 312, after: opts.after !== undefined ? opts.after : 120, before: opts.before || 0 },
    children: segs.map(([t, b]) => new TextRun({
      text: safeText(t), bold: !!b, size: 24, color: PAL.body, font: FONT_BODY,
    })),
  });
}

function bullet(content) {
  const segs = Array.isArray(content) ? content : [[content, false]];
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    bullet: { level: 0 },
    spacing: { line: 312, after: 60 },
    children: segs.map(([t, b]) => new TextRun({
      text: safeText(t), bold: !!b, size: 24, color: PAL.body, font: FONT_BODY,
    })),
  });
}

// ── Tableaux ──
let TABLE_N = 0, FIG_N = 0;

function tableCaption(text) {
  TABLE_N += 1;
  return new Paragraph({
    keepNext: true, alignment: AlignmentType.LEFT,
    spacing: { before: 220, after: 90, line: 312 },
    children: [
      new TextRun({ text: "Tableau " + TABLE_N + " \u2014 ", bold: true, size: 21, color: PAL.headingColor, font: FONT_BODY }),
      new TextRun({ text, bold: true, size: 21, color: PAL.headingColor, font: FONT_BODY }),
    ],
  });
}

function cellPara(content, { bold = false, header = false } = {}) {
  const segs = Array.isArray(content) ? content : [[content, bold]];
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: 312 },
    children: segs.map(([t, b]) => new TextRun({
      text: safeText(t), bold: header ? true : !!b, size: 20,
      color: header ? PAL.table.headerText : PAL.body, font: FONT_BODY,
    })),
  });
}

// rows : tableau de tableaux (chaque cellule = string ou tableau de segments)
function dataTable({ headers, rows, widths, zebra = true }) {
  const nCols = headers.length;
  const colW = widths || Array(nCols).fill(Math.floor(100 / nCols));
  const margins = { top: 60, bottom: 60, left: 120, right: 120 };
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: headers.map((htext, i) => new TableCell({
      children: [cellPara(htext, { header: true })],
      shading: { type: ShadingType.CLEAR, fill: PAL.table.headerBg },
      margins, width: { size: colW[i], type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
    })),
  });
  const dataRows = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, ci) => new TableCell({
      children: [cellPara(c)],
      shading: zebra && ri % 2 === 1
        ? { type: ShadingType.CLEAR, fill: PAL.table.surface }
        : undefined,
      margins, width: { size: colW[ci], type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: PAL.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...dataRows],
  });
}

// ── Encadr\u00e9 verdict ──
function callout(title, text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NB, bottom: NB, right: NB, insideHorizontal: NB, insideVertical: NB,
      left: { style: BorderStyle.SINGLE, size: 24, color: PAL.accent },
    },
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: PAL.table.surface },
        margins: { top: 140, bottom: 140, left: 220, right: 180 },
        children: [
          new Paragraph({
            spacing: { line: 312, after: 60 },
            children: [new TextRun({ text: title, bold: true, size: 22, color: PAL.headingColor, font: FONT_HEAD })],
          }),
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED, spacing: { line: 312 },
            children: [new TextRun({ text: safeText(text), size: 22, color: PAL.body, font: FONT_BODY })],
          }),
        ],
      })],
    })],
  });
}

// ── Figures ──
function figure(path, widthPx, heightPx, captionText) {
  FIG_N += 1;
  const buf = fs.readFileSync(path);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, keepNext: true,
      spacing: { before: 200, after: 60 },
      children: [new ImageRun({ data: buf, transformation: { width: widthPx, height: heightPx }, type: "png" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200, line: 312 },
      children: [
        new TextRun({ text: "Figure " + FIG_N + " \u2014 ", bold: true, italics: true, size: 20, color: PAL.secondary, font: FONT_BODY }),
        new TextRun({ text: captionText, italics: true, size: 20, color: PAL.secondary, font: FONT_BODY }),
      ],
    }),
  ];
}

module.exports = {
  PAL, NB, noBorders, allNoBorders, FONT_BODY, FONT_HEAD,
  buildCoverR1, h1, h2, h3, para, bullet,
  tableCaption, dataTable, callout, figure, safeText,
};
