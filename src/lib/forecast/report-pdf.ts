// ============================================================
// VOLTRIX bet — Prévisions hebdomadaires : RAPPORT PDF (§17)
// Rapport hebdomadaire professionnel, 100 % serveur (pdf-lib).
// Structure : Résumé → 1X2 → O/U 2.5 → BTTS → Confiance →
// Calibration → Compétitions → Détail des matchs → Diagnostic.
// IMPORTANT (§17) : le diagnostic est descriptif et statistique —
// il ne transforme JAMAIS les résultats en promesses de gains.
// ============================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { WeekStats } from './metrics';

export interface ReportMatchRow {
  matchId: string;
  kickoff: Date | string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  hasSnapshot: boolean;
  pick1x2Label?: string;
  p1x2?: string; // « 68/19/13 »
  pickOu25Label?: string;
  pOu?: string;
  pickBttsLabel?: string;
  pBtts?: string;
  confidence?: number;
  resultLabel: string; // « 2–1 » / « Reporté » / « À venir »
  verdict: string; // « 1X2 OK · O/U KO · BTTS — »
}

export interface ReportInput {
  weekLabel: string;
  startISO: string;
  endISO: string;
  generatedAt: string;
  stats: WeekStats;
  matches: ReportMatchRow[];
  voidMatches: number;
  matchesWithoutSnapshot: number;
  matchesWithoutOdds: number;
}

// ---------- Palette (impression : fond blanc, accents olive/volt) ----------

const INK = rgb(0.10, 0.10, 0.12);
const GRAY = rgb(0.42, 0.44, 0.47);
const LIGHT = rgb(0.72, 0.74, 0.76);
const VOLT = rgb(0.48, 0.55, 0.0); // olive-volt (lisible sur blanc)
const VOLT_BG = rgb(0.953, 0.976, 0.867); // #f3f9dd
const ROW_BG = rgb(0.968, 0.971, 0.976);

const A4: [number, number] = [595.28, 841.89];
const M = 44; // marge

// ---------- Sanitization WinAnsi (obligatoire) ----------
// Les polices standard PDF (Helvetica) encodent en WinAnsi/cp1252 :
// tout caractère hors jeu fait lever une exception (ex: « − » U+2212,
// « ≥ », ou noms d'équipes ESPN en turc/grec/cyrillique). Le sanitizeur
// central garantit qu'AUCUN drawText ne peut échouer, quel que soit le
// contenu de la base.
const CP1252_HIGH = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
const SYMBOL_MAP: Record<string, string> = {
  '\u2212': '-', // minus mathématique
  '\u2265': '>=',
  '\u2264': '<=',
  '\u2192': '->',
  '\u2190': '<-',
  '\u2248': '~',
  '\u2713': 'V',
  '\u2714': 'V',
  '\u2717': 'X',
  '\u2718': 'X',
  '\u26a0': '(!)',
  '\u2605': '*',
  '\u2606': '*',
  '\u00a0': ' ',
  '\u202f': ' ',
  '\u200b': '',
  '\u0142': 'l', // ł (polonais — NFD ne le décompose pas)
  '\u0141': 'L', // Ł
  '\u0111': 'd', // đ
  '\u0110': 'D', // Đ
};

/** Caractère encodable en WinAnsi/cp1252 (polices standard PDF). */
function encodable(c: number): boolean {
  if (c <= 0xff) return !(c >= 0x7f && c <= 0x9f); // 0x7F-0x9F non définis en cp1252
  return CP1252_HIGH.has(c);
}

function win(s: string): string {
  // 1) symboles connus → équivalents encodables
  let out = s.replace(/[\u2212\u2265\u2264\u2192\u2190\u2248\u2713\u2714\u2717\u2718\u26a0\u2605\u2606\u00a0\u202f\u200b\u0142\u0141\u0111\u0110]/g, (c) => SYMBOL_MAP[c] ?? '?');
  // 2) par caractère : gardé si encodable, sinon translittération NFD
  //    (accent retiré : ş → s, ő → o, ą → a…) — les accents français
  //    (é, è, à, ç…) sont directement encodables et RESTENT INTACTS.
  out = [...out].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (encodable(c)) return ch;
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (base.length === 1 && encodable(base.codePointAt(0)!)) return base;
    return '?';
  }).join('');
  return out;
}

const pct = (x: number | null | undefined, digits = 1): string =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits).replace('.', ',')} %`;
const num = (x: number | null | undefined, digits = 4): string =>
  x === null || x === undefined ? '—' : x.toFixed(digits).replace('.', ',');
const dt = (iso: Date | string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }) +
    ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
};

/** Découpe un texte en lignes tenant dans maxW (mots entiers). */
function wrapText(s: string, f: PDFFont, size: number, maxW: number): string[] {
  if (f.widthOfTextAtSize(s, size) <= maxW) return [s];
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(t, size) <= maxW) {
      cur = t;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Mini-moteur de mise en page A4 (flux texte + tableaux paginés). */
class Layout {
  doc!: PDFDocument;
  page!: PDFPage;
  y = 0;
  font!: PDFFont;
  bold!: PDFFont;
  static readonly PAGE_H = A4[1];
  static readonly CONTENT_BOTTOM = M + 26;

  static async create(): Promise<Layout> {
    const l = new Layout();
    l.doc = await PDFDocument.create();
    l.doc.setTitle('VOLTRIX — Rapport hebdomadaire des prévisions');
    l.doc.setAuthor('VOLTRIX bet');
    l.doc.setSubject('Suivi et audit des prédictions du moteur');
    l.font = await l.doc.embedFont(StandardFonts.Helvetica);
    l.bold = await l.doc.embedFont(StandardFonts.HelveticaBold);
    l.addPage();
    return l;
  }

  addPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
  }

  ensure(h: number): void {
    if (this.y - h < Layout.CONTENT_BOTTOM) {
      this.addPage();
    }
  }

  text(
    s: string,
    o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; indent?: number; gap?: number } = {}
  ): void {
    const size = o.size ?? 9;
    const f = o.bold ? this.bold : this.font;
    const x0 = (o.x ?? M) + (o.indent ?? 0);
    const maxW = A4[0] - M - x0; // retour à la ligne automatique sur la marge droite
    const lines = wrapText(win(s), f, size, maxW);
    for (const line of lines) {
      this.ensure(size + 3);
      this.page.drawText(line, { x: x0, y: this.y - size, size, font: f, color: o.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= Math.max(0, (o.gap ?? 4) - 3);
  }

  sectionTitle(n: string, title: string): void {
    this.ensure(46);
    this.y -= 8;
    this.page.drawRectangle({ x: M, y: this.y - 22, width: A4[0] - 2 * M, height: 22, color: VOLT_BG });
    this.page.drawText(`${n}`, { x: M + 8, y: this.y - 15.5, size: 11, font: this.bold, color: VOLT });
    this.page.drawText(win(title), { x: M + 34, y: this.y - 15.5, size: 11, font: this.bold, color: INK });
    this.y -= 30;
  }

  /** Tableau paginé — l'en-tête se répète à chaque nouvelle page. */
  table(
    cols: Array<{ w: number; label: string; align?: 'left' | 'right' | 'center' }>,
    rows: Array<Array<string>>,
    o: { fontSize?: number; rowH?: number; colorFor?: (row: string[]) => ReturnType<typeof rgb> } = {}
  ): void {
    const fs = o.fontSize ?? 7.6;
    const rowH = o.rowH ?? 15.5;
    const totalW = A4[0] - 2 * M;
    const drawHeader = () => {
      this.ensure(rowH + 4);
      this.page.drawRectangle({ x: M, y: this.y - rowH, width: totalW, height: rowH, color: INK });
      let x = M;
      for (const c of cols) {
        const label = win(c.label);
        const tx = c.align === 'right' ? x + c.w - 6 - this.bold.widthOfTextAtSize(label, fs) : c.align === 'center' ? x + (c.w - this.bold.widthOfTextAtSize(label, fs)) / 2 : x + 6;
        this.page.drawText(label, { x: tx, y: this.y - rowH + (rowH - fs) / 2 + 1, size: fs, font: this.bold, color: rgb(1, 1, 1) });
        x += c.w;
      }
      this.y -= rowH;
    };
    drawHeader();
    let stripe = false;
    for (const row of rows) {
      if (this.y - rowH < Layout.CONTENT_BOTTOM) {
        this.addPage();
        drawHeader();
        stripe = false;
      }
      if (stripe) {
        this.page.drawRectangle({ x: M, y: this.y - rowH, width: totalW, height: rowH, color: ROW_BG });
      }
      stripe = !stripe;
      const color = o.colorFor?.(row) ?? INK;
      let x = M;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const s = win(row[i] ?? '');
        const fnt = this.font;
        let txt = s;
        if (fnt.widthOfTextAtSize(txt, fs) > c.w - 10) {
          let lo = 1;
          let hi = txt.length;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (fnt.widthOfTextAtSize(txt.slice(0, mid) + '…', fs) <= c.w - 10) lo = mid;
            else hi = mid - 1;
          }
          txt = txt.slice(0, lo) + '…';
        }
        const tw = fnt.widthOfTextAtSize(txt, fs);
        const tx = c.align === 'right' ? x + c.w - 6 - tw : c.align === 'center' ? x + (c.w - tw) / 2 : x + 6;
        this.page.drawText(txt, { x: tx, y: this.y - rowH + (rowH - fs) / 2 + 1, size: fs, font: fnt, color });
        x += c.w;
      }
      this.y -= rowH;
    }
    this.y -= 6;
  }

  kv(key: string, value: string, valueColor?: ReturnType<typeof rgb>): void {
    this.ensure(14);
    this.page.drawText(win(key), { x: M + 8, y: this.y - 11, size: 9, font: this.font, color: GRAY });
    this.page.drawText(win(value), { x: M + 210, y: this.y - 11, size: 9, font: this.bold, color: valueColor ?? INK });
    this.y -= 15;
  }

  footerAll(): void {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      p.drawLine({
        start: { x: M, y: M + 16 },
        end: { x: A4[0] - M, y: M + 16 },
        thickness: 0.5,
        color: LIGHT,
      });
      p.drawText(win('VOLTRIX bet — Suivi et audit des prévisions · document statistique, ne constitue pas un conseil de mise'), {
        x: M,
        y: M + 5,
        size: 6.5,
        font: this.font,
        color: GRAY,
      });
      const label = `${i + 1} / ${pages.length}`;
      const w = this.font.widthOfTextAtSize(label, 6.5);
      p.drawText(label, { x: A4[0] - M - w, y: M + 5, size: 6.5, font: this.font, color: GRAY });
    });
  }
}

// ---------- Diagnostic automatique (descriptif, §17) ----------

function buildDiagnostic(input: ReportInput): string[] {
  const s = input.stats;
  const lines: string[] = [];

  const markets = [
    { name: '1X2', acc: s.m1x2.accuracy, brier: s.m1x2.brier, n: s.m1x2.n },
    { name: 'O/U 2.5', acc: s.ou25.accuracy, brier: s.ou25.brier, n: s.ou25.n },
    { name: 'BTTS', acc: s.btts.accuracy, brier: s.btts.brier, n: s.btts.n },
  ];
  const scored = markets.filter((m) => m.n > 0);
  if (scored.length === 0) {
    lines.push("Aucun match évaluable cette semaine : le diagnostic statistique sera disponible dès que des résultats définitifs seront rattachés aux prédictions figées.");
    return lines;
  }
  const bestAcc = [...scored].sort((a, b) => (b.acc ?? 0) - (a.acc ?? 0))[0];
  const worstAcc = [...scored].sort((a, b) => (a.acc ?? 1) - (b.acc ?? 1))[0];
  const bestBrier = [...scored].sort((a, b) => (a.brier ?? 2) - (b.brier ?? 2))[0];
  lines.push(
    `Marché le plus performant (accuracy) : ${bestAcc.name} avec ${pct(bestAcc.acc)} sur ${bestAcc.n} prédictions évaluables. ` +
      `Le Brier le plus bas est également observé sur ${bestBrier.name} (${num(bestBrier.brier)}), ce qui en fait le marché où le modèle a été le plus précis en probabilité cette semaine.`
  );
  if (bestAcc.name !== worstAcc.name) {
    lines.push(
      `Marché le moins performant (accuracy) : ${worstAcc.name} avec ${pct(worstAcc.acc)} sur ${worstAcc.n} prédictions. ` +
        `Un écart entre accuracy et Brier entre marchés est attendu : chaque marché mesure une capacité différente (ordinalité du 1X2, quantité de buts, buts des deux équipes).`
    );
  }

  // Gradient de confiance (mesuré, pas supposé)
  const hi = s.confidence.filter((c) => c.level >= 4 && c.n > 0);
  const lo = s.confidence.filter((c) => c.level <= 3 && c.n > 0);
  const hiN = hi.reduce((a, c) => a + c.n, 0);
  const loN = lo.reduce((a, c) => a + c.n, 0);
  const hiAcc = hiN > 0 ? hi.reduce((a, c) => a + c.correct, 0) / hiN : null;
  const loAcc = loN > 0 ? lo.reduce((a, c) => a + c.correct, 0) / loN : null;
  if (hiAcc !== null && loAcc !== null) {
    lines.push(
      `Confiance : les niveaux 4-5 affichent ${pct(hiAcc)} (${hiN} prédictions) contre ${pct(loAcc)} pour les niveaux 1-3 (${loN} prédictions). ` +
        (hiAcc > loAcc
          ? 'Le gradient attendu (plus confiant = plus souvent correct) est observé cette semaine.'
          : "Le gradient attendu n'est PAS observé cette semaine : les prédictions les plus confiantes n'ont pas été plus souvent correctes. À surveiller sur plusieurs semaines avant toute conclusion.") +
        ' Sur un échantillon hebdomadaire, cet indicateur reste bruité : seul un historique de plusieurs mois permet de le valider.'
    );
  } else {
    lines.push('Confiance : échantillon insuffisant cette semaine pour comparer les niveaux 1-3 et 4-5.');
  }

  // Calibration
  const calIssues: string[] = [];
  for (const [name, table] of [['1X2', s.calibration1x2], ['O/U 2.5', s.calibrationOu25], ['BTTS', s.calibrationBtts]] as const) {
    for (const b of table) {
      if (b.n >= 10 && b.predicted !== null && b.observed !== null && Math.abs(b.predicted - b.observed) > 0.10) {
        calIssues.push(`${name} ${b.bucket} : annoncé ${pct(b.predicted, 0)}, observé ${pct(b.observed, 0)} (n=${b.n})`);
      }
    }
  }
  if (calIssues.length > 0) {
    lines.push(`Écarts de calibration supérieurs à 10 points (tranches avec n ≥ 10) : ${calIssues.join(' ; ')}. Une calibration exacte ne peut être jugée qu'à grande échelle (centaines de prédictions par tranche).`);
  } else {
    lines.push('Calibration : aucun écart supérieur à 10 points détecté dans les tranches disposant d au moins 10 prédictions (ou tranches encore vides).');
  }

  // Données / anomalies
  const notes: string[] = [];
  if (input.matchesWithoutSnapshot > 0) notes.push(`${input.matchesWithoutSnapshot} match(s) de la semaine sans prédiction figée (analysés trop tard — après coup d'envoi — ou analyse moteur indisponible : aucune prédiction n'est publiée dans ce cas, règle anti-fuite).`);
  if (input.matchesWithoutOdds > 0) notes.push(`${input.matchesWithoutOdds} prédiction(s) sans cotes disponibles au moment de la génération (calibration marché non appliquée sur les marchés de buts pour ces matchs).`);
  if (input.voidMatches > 0) notes.push(`${input.voidMatches} match(s) reporté(s)/annulé(s)/suspendu(s) : exclus des statistiques (VOID), leurs prédictions restent conservées à l'identique.`);
  if (notes.length === 0) notes.push('Aucune anomalie de données détectée cette semaine.');
  lines.push(...notes);

  lines.push(
    "Rappel : ce rapport est un instrument de suivi et d audit. Une semaine observe ; plusieurs semaines évaluent. Aucune décision de modification du modèle ne doit être prise sur la base d une seule semaine, et ce document ne constitue pas une promesse de gains."
  );
  return lines;
}

// ---------- Génération ----------

export async function buildWeeklyReportPdf(input: ReportInput): Promise<Uint8Array> {
  const L = await Layout.create();
  const s = input.stats;

  // ---------- Page 1 — Résumé ----------
  L.page.drawRectangle({ x: 0, y: A4[1] - 120, width: A4[0], height: 120, color: rgb(0.06, 0.06, 0.08) });
  L.page.drawText('VOLTRIX', { x: M, y: A4[1] - 52, size: 26, font: L.bold, color: rgb(0.91, 1, 0) });
  L.page.drawText('RAPPORT HEBDOMADAIRE DES PRÉVISIONS', { x: M, y: A4[1] - 74, size: 12, font: L.bold, color: rgb(1, 1, 1) });
  L.page.drawText(win(input.weekLabel), { x: M, y: A4[1] - 92, size: 10, font: L.font, color: rgb(0.75, 0.77, 0.8) });
  L.page.drawText(win(`Généré le ${dt(input.generatedAt)} (UTC) · Moteur en production au moment de chaque prédiction`), {
    x: M,
    y: A4[1] - 107,
    size: 7.5,
    font: L.font,
    color: rgb(0.6, 0.62, 0.65),
  });
  L.y = A4[1] - 140;

  L.sectionTitle('01', 'Résumé de la semaine');
  L.kv('Période', `${input.startISO} au ${input.endISO} (semaine calendaire UTC)`);
  L.kv('Matchs de la semaine (registre)', String(input.matches.length));
  L.kv('Matchs avec prédiction figée', `${s.matchesAnalyzed}`);
  L.kv('Matchs terminés (résultat final)', `${s.matchesFinished}`);
  L.kv('Matchs en attente (à venir / en direct)', `${s.matchesPending}`);
  L.kv('Matchs VOID (reportés / annulés)', `${s.matchesVoid}`, GRAY);
  L.kv('Prédictions évaluables (résultat valide)', `${s.globalEvaluable}`);
  L.kv('Taux de réussite global (3 marchés)', pct(s.globalAccuracy), VOLT);
  L.y -= 4;
  L.text('Réussite par marché :', { bold: true, size: 9.5 });
  L.kv('1X2 — corrects / évaluables', `${s.m1x2.correct} / ${s.m1x2.n} — ${pct(s.m1x2.accuracy)}`);
  L.kv('O/U 2.5 — corrects / évaluables', `${s.ou25.correct} / ${s.ou25.n} — ${pct(s.ou25.accuracy)}`);
  L.kv('BTTS — corrects / évaluables', `${s.btts.correct} / ${s.btts.n} — ${pct(s.btts.accuracy)}`);
  L.y -= 6;
  L.text(
    "Méthode : chaque prédiction a été générée et figée avant le coup d'envoi (predictionTime < kickoff, vérifié à la publication) avec le moteur en production. Les résultats sont récupérés après match auprès de la source officielle et stockés séparément des prédictions. Les métriques ne portent que sur les prédictions à résultat valide ; les matchs VOID sont exclus.",
    { size: 7.8, color: GRAY, gap: 2 }
  );

  // ---------- Page 2 — 1X2 ----------
  L.addPage();
  L.sectionTitle('02', 'Performance 1X2');
  L.kv('Prédictions évaluables', `${s.m1x2.n}`);
  L.kv('Correctes / incorrectes', `${s.m1x2.correct} / ${s.m1x2.incorrect}`);
  L.kv('Accuracy', pct(s.m1x2.accuracy), VOLT);
  L.kv('Brier Score (multiclasse, 0 = parfait)', num(s.m1x2.brier));
  L.kv('LogLoss (−ln p issue réelle)', num(s.m1x2.logLoss));
  L.kv('RPS (ranked probability score)', num(s.m1x2.rps));
  L.y -= 8;
  L.text('Calibration — probabilité annoncée du pick vs fréquence observée', { bold: true, size: 9 });
  L.table(
    [
      { w: 110, label: 'Probabilité annoncée' },
      { w: 70, label: 'Nombre', align: 'right' },
      { w: 105, label: 'Annoncé (moyenne)', align: 'right' },
      { w: 105, label: 'Observé', align: 'right' },
      { w: 127, label: 'Écart' },
    ],
    s.calibration1x2.map((b) => {
      const gap = b.observed !== null && b.predicted !== null ? b.observed - b.predicted : null;
      return [b.bucket, String(b.n), pct(b.predicted, 1), pct(b.observed, 1), gap === null ? '—' : `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1).replace('.', ',')} pts`];
    }),
    { fontSize: 8 }
  );
  L.text(
    "Lecture : « VOLTRIX annonce 70 % » est bien calibré si l'événement se produit environ 70 % du temps dans la tranche. Des tranches clairsemées (faible n) restent non concluantes.",
    { size: 7.6, color: GRAY }
  );

  // ---------- Page 3 — O/U 2.5 ----------
  L.addPage();
  L.sectionTitle('03', 'Performance O/U 2.5');
  L.kv('Prédictions évaluables', `${s.ou25.n}`);
  L.kv('Correctes / incorrectes', `${s.ou25.correct} / ${s.ou25.incorrect}`);
  L.kv('Accuracy', pct(s.ou25.accuracy), VOLT);
  L.kv('Brier Score (binaire)', num(s.ou25.brier));
  L.kv('LogLoss (binaire)', num(s.ou25.logLoss));
  L.y -= 8;
  L.text('Calibration — probabilité annoncée du pick vs fréquence observée', { bold: true, size: 9 });
  L.table(
    [
      { w: 110, label: 'Probabilité annoncée' },
      { w: 70, label: 'Nombre', align: 'right' },
      { w: 105, label: 'Annoncé (moyenne)', align: 'right' },
      { w: 105, label: 'Observé', align: 'right' },
      { w: 127, label: 'Écart' },
    ],
    s.calibrationOu25.map((b) => {
      const gap = b.observed !== null && b.predicted !== null ? b.observed - b.predicted : null;
      return [b.bucket, String(b.n), pct(b.predicted, 1), pct(b.observed, 1), gap === null ? '—' : `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1).replace('.', ',')} pts`];
    }),
    { fontSize: 8 }
  );
  L.text(
    "La probabilité utilisée est celle du côté piqué (calibrée marché quand des cotes existaient au moment de la prédiction). Les probabilités brutes (pré-calibration) sont conservées dans l'export JSON/CSV pour audit.",
    { size: 7.6, color: GRAY }
  );

  // ---------- Page 4 — BTTS ----------
  L.addPage();
  L.sectionTitle('04', 'Performance BTTS (les deux équipes marquent)');
  L.kv('Prédictions évaluables', `${s.btts.n}`);
  L.kv('Correctes / incorrectes', `${s.btts.correct} / ${s.btts.incorrect}`);
  L.kv('Accuracy', pct(s.btts.accuracy), VOLT);
  L.kv('Brier Score (binaire)', num(s.btts.brier));
  L.kv('LogLoss (binaire)', num(s.btts.logLoss));
  L.y -= 8;
  L.text('Calibration — probabilité annoncée du pick vs fréquence observée', { bold: true, size: 9 });
  L.table(
    [
      { w: 110, label: 'Probabilité annoncée' },
      { w: 70, label: 'Nombre', align: 'right' },
      { w: 105, label: 'Annoncé (moyenne)', align: 'right' },
      { w: 105, label: 'Observé', align: 'right' },
      { w: 127, label: 'Écart' },
    ],
    s.calibrationBtts.map((b) => {
      const gap = b.observed !== null && b.predicted !== null ? b.observed - b.predicted : null;
      return [b.bucket, String(b.n), pct(b.predicted, 1), pct(b.observed, 1), gap === null ? '—' : `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1).replace('.', ',')} pts`];
    }),
    { fontSize: 8 }
  );

  // ---------- Page 5 — Confiance ----------
  L.addPage();
  L.sectionTitle('05', 'Performance par niveau de confiance (1X2)');
  L.text(
    "Objectif (§13 du cahier des charges) : vérifier si une confiance plus élevée correspond réellement à de meilleures performances. Marché évalué : 1X2 (la confiance est produite par le moteur pour ce marché).",
    { size: 8, color: GRAY }
  );
  L.y -= 4;
  L.table(
    [
      { w: 90, label: 'Confiance' },
      { w: 110, label: 'Prédictions', align: 'right' },
      { w: 110, label: 'Correctes', align: 'right' },
      { w: 110, label: 'Accuracy', align: 'right' },
      { w: 107, label: 'Brier 1X2', align: 'right' },
    ],
    s.confidence.map((c) => [`${c.level} / 5`, String(c.n), String(c.correct), pct(c.accuracy), num(c.brier)]),
    { fontSize: 8.4 }
  );
  L.text(
    'Un faible échantillon hebdomadaire par niveau est normal : cette table devient interprétante après plusieurs semaines d historique accumulé.',
    { size: 7.6, color: GRAY }
  );

  // ---------- Page 6 — Compétitions ----------
  L.addPage();
  L.sectionTitle('06', 'Performance par compétition');
  L.text(
    "Les compétitions dont l'échantillon est insuffisant (n < 30) sont marquées « Échantillon insuffisant » : leur performance hebdomadaire n'est PAS présentée comme significative (§15).",
    { size: 8, color: GRAY }
  );
  L.y -= 4;
  L.table(
    [
      { w: 128, label: 'Compétition' },
      { w: 46, label: 'n', align: 'right' },
      { w: 66, label: 'Acc. 1X2', align: 'right' },
      { w: 66, label: 'Brier 1X2', align: 'right' },
      { w: 66, label: 'Acc. O/U', align: 'right' },
      { w: 66, label: 'Acc. BTTS', align: 'right' },
      { w: 100, label: 'Fiabilité échantillon' },
    ],
    s.leagues.map((l) => [
      l.leagueName,
      String(l.n),
      pct(l.acc1x2, 0),
      num(l.brier1x2, 3),
      pct(l.accOu25, 0),
      pct(l.accBtts, 0),
      l.sufficient ? 'Suffisant (n ≥ 30)' : 'Échantillon insuffisant — n < 30',
    ]),
    { fontSize: 7.4 }
  );

  // ---------- Page 7 — Détail des matchs (paginé) ----------
  L.addPage();
  L.sectionTitle('07', 'Détail des matchs');
  L.text(`${input.matches.length} matchs · « — » = non applicable (pas de prédiction figée / non évaluable)`, { size: 7.6, color: GRAY });
  L.y -= 2;
  L.table(
    [
      { w: 46, label: 'Date' },
      { w: 108, label: 'Match' },
      { w: 62, label: 'Compétition' },
      { w: 84, label: '1X2 (pick · H/X/A)' },
      { w: 56, label: 'O/U 2.5' },
      { w: 50, label: 'BTTS' },
      { w: 22, label: 'Conf', align: 'center' },
      { w: 38, label: 'Résultat', align: 'center' },
      { w: 55, label: 'Verdict' },
    ],
    input.matches.map((m) => [
      dt(m.kickoff).slice(0, 5),
      `${m.homeTeam} - ${m.awayTeam}`,
      m.leagueName,
      m.hasSnapshot ? `${m.pick1x2Label} · ${m.p1x2}` : '—',
      m.hasSnapshot ? `${m.pickOu25Label} · ${m.pOu}` : '—',
      m.hasSnapshot ? `${m.pickBttsLabel} · ${m.pBtts}` : '—',
      m.hasSnapshot ? `${m.confidence}/5` : '—',
      m.resultLabel,
      m.verdict,
    ]),
    { fontSize: 6.3, rowH: 14 }
  );

  // ---------- Dernière page — Diagnostic ----------
  L.addPage();
  L.sectionTitle('08', 'Diagnostic automatique');
  for (const line of buildDiagnostic(input)) {
    L.text(line, { size: 8.6, indent: 4, gap: 6 });
  }
  L.y -= 8;
  L.page.drawRectangle({ x: M, y: L.y - 44, width: A4[0] - 2 * M, height: 40, color: VOLT_BG });
  L.page.drawText(
    win("Ce diagnostic reste descriptif et statistique (cahier des charges §17) : il n'émet aucune promesse de gains,"),
    { x: M + 10, y: L.y - 14, size: 8, font: L.bold, color: INK }
  );
  L.page.drawText(
    win("ne recommande aucune mise, et aucune modification du modèle ne doit être décidée sur une seule semaine."),
    { x: M + 10, y: L.y - 26, size: 8, font: L.font, color: INK }
  );

  L.footerAll();
  return L.doc.save();
}
