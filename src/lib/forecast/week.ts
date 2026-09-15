// ============================================================
// VOLTRIX bet — Prévisions hebdomadaires : semaines calendaires
// Semaine = lundi 00:00 UTC → dimanche 24:00 UTC (convention
// calendaire unique, documentée — ESPN horodate en UTC).
// ============================================================

export const DAY_MS = 86_400_000;

/** Lundi 00:00 UTC de la semaine contenant `d`. */
export function mondayOf(d: Date): Date {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(t).getUTCDay(); // 0 = dimanche
  const back = (dow + 6) % 7; // lundi = 0
  return new Date(t - back * DAY_MS);
}

/** Semaine par défaut = semaine courante (UTC). */
export function currentWeekStart(): Date {
  return mondayOf(new Date());
}

/** Paramètre API ?start=YYYY-MM-DD (n'importe quel jour de la semaine visée). */
export function weekStartFromParam(param: string | null | undefined): Date {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    const d = new Date(`${param}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return mondayOf(d);
  }
  return currentWeekStart();
}

export function weekEnd(start: Date): Date {
  return new Date(start.getTime() + 7 * DAY_MS);
}

export function prevWeekStart(start: Date): Date {
  return new Date(start.getTime() - 7 * DAY_MS);
}

export function nextWeekStart(start: Date): Date {
  return new Date(start.getTime() + 7 * DAY_MS);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const fmtDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'UTC' });
const fmtMonthYear = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const fmtFull = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** « Semaine du 14 au 20 septembre 2026 » (gère le changement de mois/année). */
export function weekLabelFr(start: Date): string {
  const end = new Date(weekEnd(start).getTime() - 1); // dimanche 23:59:59.999
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  if (sameMonth && sameYear) {
    return `Semaine du ${fmtDay.format(start)} au ${fmtDay.format(end)} ${fmtMonthYear.format(end)}`;
  }
  if (sameYear) {
    const m1 = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' }).format(start);
    return `Semaine du ${fmtDay.format(start)} ${m1} au ${fmtDay.format(end)} ${fmtMonthYear.format(end)}`;
  }
  return `Semaine du ${fmtFull.format(start)} au ${fmtFull.format(end)}`;
}

/** « lun. 14 sept. » — en-tête de jour dans la liste. */
const fmtDayHeader = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
export function dayHeaderFr(d: Date): string {
  return fmtDayHeader.format(d);
}
