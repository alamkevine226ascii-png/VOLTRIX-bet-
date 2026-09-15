// ============================================================
// VOLTRIX bet — Partage d'images (Web Share API + repli PNG)
// Rendu canvas 720px : header de marque éclair VOLTRIX, carte
// match (ligue / équipes / prono / proba / étoiles / value bet)
// ou carte combiné (jambes + bande côte totale).
// Initiales dessinées au lieu des écussons (évite le canvas
// tainted si le CDN ESPN n'envoie pas d'en-têtes CORS).
// ============================================================

export interface ShareCard {
  canvas: HTMLCanvasElement;
  fileName: string;
}

export interface MatchCardInput {
  leagueName: string;
  homeName: string;
  awayName: string;
  pick: string; // libellé du prono
  prob: number; // 0..1
  confidence: number; // 1..5
  edge?: number | null; // value bet (0.12 = +12 %)
  timeLabel?: string;
}

export interface ComboCardInput {
  legs: Array<{ pick: string; matchLabel: string; odds: number }>;
  comboOdds: number;
  comboProb: number;
  stakeLabel: string;
}

// ---------- Palette de marque ----------

const BG = '#0a0a0c';
const CARD = '#141418';
const SOFT = 'rgba(255,255,255,0.06)';
const VOLT = '#e8ff00';
const WHITE = '#f4f4f2';
const MUTED = 'rgba(244,244,242,0.55)';
const GREEN = '#a3e635';
const RED = '#ff4d5e';

const W = 720;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** En-tête de marque commun : éclair + VOLTRIX bet */
function drawHeader(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, 128);

  // pastille jaune + éclair dessiné (pas d'emoji : rendu constant partout)
  ctx.fillStyle = VOLT;
  roundRect(ctx, 40, 36, 56, 56, 16);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(74, 44);
  ctx.lineTo(58, 68);
  ctx.lineTo(69, 68);
  ctx.lineTo(64, 84);
  ctx.lineTo(82, 60);
  ctx.lineTo(70, 60);
  ctx.lineTo(74, 44);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = WHITE;
  ctx.font = '700 30px Arial, sans-serif';
  ctx.fillText('VOLTRIX', 112, 66);
  const brandW = ctx.measureText('VOLTRIX').width;
  ctx.fillStyle = VOLT;
  roundRect(ctx, 112 + brandW + 10, 44, 48, 28, 7);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText('bet', 112 + brandW + 10 + 10, 65);

  ctx.fillStyle = MUTED;
  ctx.font = '400 16px Arial, sans-serif';
  ctx.fillText('Pronostics football · Poisson · Elo · Forme', 112, 94);
}

/** Pied de page : disclaimer 18+ */
function drawFooter(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, y, W, 64);
  ctx.fillStyle = MUTED;
  ctx.font = '400 15px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('VOLTRIX bet · Combiné informatif · Joue responsable, 18+', W / 2, y + 38);
  ctx.textAlign = 'left';
}

/** 5 étoiles de confiance dessinées */
function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, level: number, size = 18): void {
  for (let i = 0; i < 5; i++) {
    ctx.font = `${size}px Arial, sans-serif`;
    ctx.fillStyle = i < level ? VOLT : 'rgba(255,255,255,0.14)';
    ctx.fillText('★', x + i * (size + 4), y);
  }
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

// ---------- Carte match ----------

export function buildMatchCard(input: MatchCardInput): ShareCard {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 780; // hauteur fixée : évite tout débordement du footer
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, canvas.height);
  drawHeader(ctx);

  // Carte match
  const cardX = 32;
  const cardW = W - 64;
  const cardY = 152;
  ctx.fillStyle = CARD;
  roundRect(ctx, cardX, cardY, cardW, 480, 28);
  ctx.fill();

  ctx.fillStyle = MUTED;
  ctx.font = '700 17px Arial, sans-serif';
  ctx.fillText(input.leagueName.toUpperCase() + (input.timeLabel ? ` · ${input.timeLabel}` : ''), cardX + 28, cardY + 48);

  // Équipes avec initiales
  ctx.font = '700 30px Arial, sans-serif';
  const homeLines = wrapText(ctx, input.homeName, cardW - 200);
  const awayLines = wrapText(ctx, input.awayName, cardW - 200);
  let teamY = cardY + 100;
  const drawTeam = (name: string, lines: string[]) => {
    ctx.fillStyle = VOLT;
    roundRect(ctx, cardX + 28, teamY - 24, 40, 40, 20);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '700 14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(initialsOf(name).slice(0, 3), cardX + 48, teamY + 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = WHITE;
    ctx.font = '700 26px Arial, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, cardX + 84, teamY + i * 30));
    teamY += Math.max(52, lines.length * 30 + 16);
  };
  drawTeam(input.homeName, homeLines);
  drawTeam(input.awayName, awayLines);

  // Séparateur
  ctx.fillStyle = SOFT;
  ctx.fillRect(cardX + 28, teamY + 6, cardW - 56, 2);
  teamY += 44;

  // Prono
  ctx.fillStyle = MUTED;
  ctx.font = '700 15px Arial, sans-serif';
  ctx.fillText('PRONOSTIC', cardX + 28, teamY);
  teamY += 36;
  ctx.fillStyle = VOLT;
  ctx.font = '700 30px Arial, sans-serif';
  const pickLines = wrapText(ctx, input.pick, cardW - 56);
  pickLines.forEach((l, i) => ctx.fillText(l, cardX + 28, teamY + i * 38));
  teamY += pickLines.length * 38 + 22;

  // Proba + étoiles
  ctx.fillStyle = WHITE;
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText(`${Math.round(input.prob * 100)} % de chances`, cardX + 28, teamY);
  drawStars(ctx, cardX + cardW - 28 - 5 * 22, teamY - 8, input.confidence, 18);

  // Value bet
  if (input.edge != null && input.edge > 0.02) {
    ctx.fillStyle = 'rgba(232,255,0,0.12)';
    roundRect(ctx, cardX + 28, teamY + 24, 210, 40, 20);
    ctx.fill();
    ctx.fillStyle = VOLT;
    ctx.font = '700 17px Arial, sans-serif';
    ctx.fillText(`⚡ VALUE +${Math.round(input.edge * 100)} %`, cardX + 48, teamY + 50);
  }

  drawFooter(ctx, canvas.height - 64);
  return { canvas, fileName: 'voltrix-prono.png' };
}

// ---------- Carte combiné ----------

export function buildComboCard(input: ComboCardInput): ShareCard {
  const legRowH = 118;
  const headerH = 128;
  const titleH = 88;
  const bodyH = input.legs.length * legRowH + 150;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = headerH + titleH + bodyH + 64;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, canvas.height);
  drawHeader(ctx);

  // Bandeau PARIS COMBINÉ
  let y = headerH + 8;
  ctx.fillStyle = VOLT;
  roundRect(ctx, 32, y, W - 64, 56, 18);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = '800 22px Arial, sans-serif';
  ctx.fillText('🎫 PARIS COMBINÉ', 56, y + 36);
  ctx.font = '700 18px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${input.legs.length} sélections`, W - 56, y + 36);
  ctx.textAlign = 'left';

  y += 80;
  // Jambes
  for (const leg of input.legs) {
    ctx.fillStyle = CARD;
    roundRect(ctx, 32, y, W - 64, legRowH - 18, 22);
    ctx.fill();

    ctx.fillStyle = WHITE;
    ctx.font = '700 22px Arial, sans-serif';
    const pickLines = wrapText(ctx, leg.pick, W - 240);
    pickLines.slice(0, 2).forEach((l, i) => ctx.fillText(l, 60, y + 42 + i * 26));

    ctx.fillStyle = MUTED;
    ctx.font = '400 16px Arial, sans-serif';
    const labelLines = wrapText(ctx, leg.matchLabel, W - 240);
    ctx.fillText(labelLines[0] ?? '', 60, y + 42 + Math.min(pickLines.length, 2) * 26 + 12);

    ctx.fillStyle = VOLT;
    ctx.font = '800 28px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(leg.odds.toFixed(2), W - 60, y + 48);
    ctx.textAlign = 'left';

    y += legRowH;
  }

  // Bande côte totale
  ctx.fillStyle = 'rgba(232,255,0,0.08)';
  roundRect(ctx, 32, y + 4, W - 64, 130, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,255,0,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, 32, y + 4, W - 64, 130, 24);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = '700 15px Arial, sans-serif';
  ctx.fillText('CÔTE TOTALE', 60, y + 44);
  ctx.fillStyle = VOLT;
  ctx.font = '800 52px Arial, sans-serif';
  ctx.fillText(input.comboOdds.toFixed(2), 60, y + 104);

  ctx.textAlign = 'right';
  ctx.fillStyle = WHITE;
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText(`Probabilité ${Math.round(input.comboProb * 100)} %`, W - 60, y + 56);
  ctx.fillStyle = MUTED;
  ctx.font = '400 16px Arial, sans-serif';
  ctx.fillText(input.stakeLabel, W - 60, y + 92);
  ctx.textAlign = 'left';

  drawFooter(ctx, canvas.height - 64);
  return { canvas, fileName: 'voltrix-combine.png' };
}

// ---------- Partage (Web Share API, repli téléchargement) ----------

export async function shareCard(card: ShareCard): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => card.canvas.toBlob(resolve, 'image/png'));
  const file = blob ? new File([blob], card.fileName, { type: 'image/png' }) : null;

  // 1. Partage natif avec fichier (mobile / PWA)
  if (file && typeof navigator.share === 'function') {
    const canShareFiles =
      typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : true;
    if (canShareFiles) {
      await navigator.share({
        files: [file],
        title: 'VOLTRIX bet',
        text: 'Mon pronostic VOLTRIX bet ⚡',
      });
      return;
    }
  }

  // 2. Repli : téléchargement du PNG
  if (!blob) throw new Error('Rendu image impossible');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = card.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
