/**
 * VOLTRIX — Job de pré-calcul serveur (architecture n°6).
 *
 * Récupère les matchs de football et combats MMA des 9 prochains jours
 * sur ESPN, exécute les moteurs de pronostics (le même code TypeScript
 * que le navigateur) et écrit le tout dans la base PostgreSQL Neon.
 * L'app n'a ensuite plus qu'à lire /api/fixtures : aucun calcul moteur
 * côté utilisateur.
 *
 * Exécution : `bun scripts/precompute/run.ts` (ou via GitHub Actions,
 * voir .github/workflows/precompute.yml).
 *
 * Variables d'environnement :
 *   DATABASE_URL / DIRECT_DATABASE_URL — base Neon (requis)
 *   PRECOMPUTE_DAYS   — fenêtre en jours (défaut 9 : J+0..J+8,
 *                        toute la semaine + le week-end suivant)
 *   PRECOMPUTE_START  — premier offset de jour (défaut 0) : permet
 *                        de rejouer un seul jour (backfill ciblé)
 *   PRECOMPUTE_CONCURRENCY — analyses moteur en parallèle (défaut 4 ;
 *                        réduire à 2 sur machine limitée en mémoire)
 *   PRECOMPUTE_MAX_FOOT — limite de matchs analysés (tests de fumée)
 *   PRECOMPUTE_MAX_MMA  — limite de combats analysés (tests de fumée)
 *
 * Incrémental : une ligne dont predQuick existe déjà avec la bonne
 * version de moteur et dont le statut n'a pas changé n'est PAS
 * recalculée — seule sa fiche (scores/statuts du scan) est rafraîchie.
 * Les calculs complets ne portent que sur les nouveaux matchs, les
 * changements de version moteur et les débuts de match.
 */

import { PrismaClient, Prisma } from "@prisma/client";

import { FOOT_PARAMS_VERSION } from "../../src/lib/foot/league-params";
import { MODEL_VERSION } from "../../src/lib/mma/prediction";
import {
  loadFootballDay,
  analyzeFootballMatch,
  quickPredOf,
} from "../../src/lib/foot/bridge";
import {
  loadMmaUpcoming,
  hydrateMmaHeadshots,
  hydrateMmaForms,
  loadMmaFightDetail,
} from "../../src/lib/mma-bridge";
import type { MmaEventGroup, MmaQuickPred } from "../../src/lib/mma-types";

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const prisma = new PrismaClient({
  /* Vercel/Neon injectent parfois channel_binding=require, que le
     moteur Prisma ne connaît pas : on le retire sans toucher à la
     variable d'environnement d'origine. */
  datasourceUrl: process.env.DATABASE_URL?.replace(/[?&]channel_binding=[^&]*/g, ""),
});

/** JSON nullable Prisma : le moteur exige un sentinel explicite pour
 * distinguer « champ NULL en base » d'un oubli. */
function jsonOrNull(v: object | null): object | typeof Prisma.DbNull {
  return v ?? Prisma.DbNull;
}

const DAYS = Math.max(1, parseInt(process.env.PRECOMPUTE_DAYS ?? "9", 10) || 9);
const START = Math.max(0, parseInt(process.env.PRECOMPUTE_START ?? "0", 10) || 0);
const CONCURRENCY = Math.max(1, parseInt(process.env.PRECOMPUTE_CONCURRENCY ?? "4", 10) || 4);
const MAX_FOOT = parseInt(process.env.PRECOMPUTE_MAX_FOOT ?? "0", 10) || Infinity;
const MAX_MMA = parseInt(process.env.PRECOMPUTE_MAX_MMA ?? "0", 10) || Infinity;

const t0 = Date.now();
const stats = {
  footScanned: 0,
  footStored: 0,
  footComputed: 0,
  footRefreshed: 0,
  footFailed: 0,
  mmaScanned: 0,
  mmaStored: 0,
  mmaComputed: 0,
  mmaRefreshed: 0,
  mmaFailed: 0,
};

function log(msg: string): void {
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
}

/** Jour YYYY-MM-DD (UTC) à +n jours d'aujourd'hui. */
function dayAt(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Concurrence bornée : exécute `tasks` au plus `limit` à la fois. */
async function mapLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/* ------------------------------------------------------------------ */
/* Football : 7 jours de scan -> analyse moteur -> upsert              */
/* ------------------------------------------------------------------ */

async function precomputeFootball(): Promise<void> {
  log(`Football — fenêtre ${DAYS} jour(s), moteur ${FOOT_PARAMS_VERSION}`);

  for (let offset = START; offset < START + DAYS; offset++) {
    const day = dayAt(offset);
    const res = await loadFootballDay(day).catch((e) => {
      log(`  ${day} : scan impossible (${e instanceof Error ? e.message : e})`);
      return null;
    });
    if (!res) continue;

    const matches = res.leagues.flatMap((l) =>
      l.matches.map((m) => ({ match: m, leagueCode: l.code })),
    );
    stats.footScanned += matches.length;
    log(`  ${day} : ${matches.length} match(s) sur ${res.leagues.length} ligues`);

    let computedToday = 0;
    await mapLimited(matches, CONCURRENCY, async ({ match, leagueCode }) => {
      if (computedToday >= MAX_FOOT) return;
      const id = `foot:${leagueCode}:${match.id}`;
      try {
        const existing = await prisma.fixture.findUnique({ where: { id } });

        /* Recalcul complet nécessaire si : jamais calculé, version de
           moteur différente, prono absent, ou statut changé depuis le
           dernier passage (début/fin de match). */
        const staleStatus =
          existing != null && existing.status !== match.status;
        const needEngine =
          !existing?.predQuick ||
          existing.engineVersion !== FOOT_PARAMS_VERSION ||
          staleStatus;

        let predQuick: object | null = (existing?.predQuick as object | null) ?? null;
        let predFull: object | null = (existing?.predFull as object | null) ?? null;

        if (needEngine) {
          const detail = await analyzeFootballMatch(match.id, leagueCode, day, {}).catch(
            () => null,
          );
          if (detail) {
            predFull = detail as unknown as object;
            predQuick = quickPredOf(detail) as unknown as object;
            stats.footComputed++;
            computedToday++;
          } else if (existing) {
            /* moteur indisponible pour ce match : on conserve l'existant */
            stats.footFailed++;
          }
        } else {
          stats.footRefreshed++;
        }

        /* Jours sous lesquels ESPN liste ce match : union avec les jours
           déjà connus (un match après minuit UTC peut apparaître sous
           deux jours consécutifs — il doit rester visible sur chacun). */
        const dayKeys = Array.from(
          new Set([...(existing?.dayKeys ?? []), day]),
        ).sort();

        await prisma.fixture.upsert({
          where: { id },
          create: {
            id,
            sport: "foot",
            leagueCode,
            kickoff: match.date,
            status: match.status,
            dayKeys,
            data: match as unknown as object,
            predQuick: jsonOrNull(predQuick),
            predFull: jsonOrNull(predFull),
            engineVersion: FOOT_PARAMS_VERSION,
          },
          update: {
            kickoff: match.date,
            status: match.status,
            dayKeys,
            data: match as unknown as object,
            ...(predQuick ? { predQuick } : {}),
            ...(predFull ? { predFull } : {}),
            engineVersion: FOOT_PARAMS_VERSION,
          },
        });
        stats.footStored++;
      } catch (e) {
        stats.footFailed++;
        log(`    ✗ ${id} : ${e instanceof Error ? e.message : e}`);
      }
    });
    log(`  ${day} : cumul ${stats.footStored} lignes en base`);
  }
}

/* ------------------------------------------------------------------ */
/* MMA : fenêtre J-2..J+7 -> hydratation -> détail -> upsert           */
/* ------------------------------------------------------------------ */

async function precomputeMma(): Promise<void> {
  log(`MMA — moteur ${MODEL_VERSION}`);

  const base = await loadMmaUpcoming().catch(() => null);
  if (!base) {
    log("  scan MMA impossible — abandon de la branche MMA");
    return;
  }
  const withHeads = await hydrateMmaHeadshots(base).catch(() => base);
  const { res: withForms, preds } = await hydrateMmaForms(withHeads).catch(
    () => ({ res: withHeads, preds: {} as Record<string, MmaQuickPred> }),
  );
  log(
    `  ${withForms.totalFights} combats scannés, ${Object.keys(preds).length} pronos express`,
  );

  /* Fenêtre stockée : J-2 (navigation bandeau) → J+7 (pré-calcul). */
  const fromMs = Date.now() - 2 * 86400000;
  const toMs = Date.now() + 7 * 86400000;
  const groups: MmaEventGroup[] = withForms.events
    .map((g) => ({
      ...g,
      fights: g.fights.filter(
        (f) => new Date(f.date).getTime() >= fromMs && new Date(f.date).getTime() < toMs,
      ),
    }))
    .filter((g) => g.fights.length > 0);

  const fights = groups.flatMap((g) => g.fights.map((f) => ({ fight: f, group: g })));
  stats.mmaScanned = fights.length;
  log(`  ${fights.length} combats dans la fenêtre J-2..J+7`);

  let computed = 0;
  await mapLimited(fights, 3, async ({ fight, group }) => {
    if (computed >= MAX_MMA) return;
    const id = `mma:${fight.id}`;
    try {
      const existing = await prisma.fixture.findUnique({ where: { id } });

      const staleStatus = existing != null && existing.status !== fight.status;
      const needEngine =
        !existing?.predFull ||
        existing.engineVersion !== MODEL_VERSION ||
        staleStatus;

      let predFull: object | null = (existing?.predFull as object | null) ?? null;
      if (needEngine) {
        const detail = await loadMmaFightDetail(fight.id).catch(() => null);
        if (detail) {
          predFull = detail as unknown as object;
          stats.mmaComputed++;
          computed++;
        } else if (existing) {
          stats.mmaFailed++;
        }
      } else {
        stats.mmaRefreshed++;
      }

      /* Métadonnées du groupe événement (sans les combats) pour
         reconstruire MmaEventsResponse côté API. */
      const { fights: _omit, ...groupMeta } = group;

      await prisma.fixture.upsert({
        where: { id },
        create: {
          id,
          sport: "mma",
          leagueCode: "ufc",
          kickoff: fight.date,
          status: fight.status,
          dayKeys: [],
          eventMeta: groupMeta as unknown as object,
          data: fight as unknown as object,
          predQuick: preds[fight.id]
            ? (preds[fight.id] as unknown as object)
            : Prisma.DbNull,
          predFull: jsonOrNull(predFull),
          engineVersion: MODEL_VERSION,
        },
        update: {
          kickoff: fight.date,
          status: fight.status,
          eventMeta: groupMeta as unknown as object,
          data: fight as unknown as object,
          ...(preds[fight.id]
            ? { predQuick: preds[fight.id] as unknown as object }
            : {}),
          ...(predFull ? { predFull } : {}),
          engineVersion: MODEL_VERSION,
        },
      });
      stats.mmaStored++;
    } catch (e) {
      stats.mmaFailed++;
      log(`    ✗ ${id} : ${e instanceof Error ? e.message : e}`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Nettoyage : lignes périmées (coup d'envoi > 3 jours dans le passé)  */
/* ------------------------------------------------------------------ */

async function purgeExpired(): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
  const removed = await prisma.fixture.deleteMany({
    where: { kickoff: { lt: cutoff } },
  });
  if (removed.count > 0)
    log(`Purge : ${removed.count} ligne(s) périmée(s) supprimée(s)`);
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  log("Démarrage du pré-calcul VOLTRIX");
  await precomputeFootball();
  await precomputeMma();
  await purgeExpired();

  log(
    `Terminé en ${Math.round((Date.now() - t0) / 1000)}s — ` +
      `foot : ${stats.footStored} lignes (${stats.footComputed} calculs moteur, ` +
      `${stats.footRefreshed} rafraîchis, ${stats.footFailed} échecs) — ` +
      `mma : ${stats.mmaStored} lignes (${stats.mmaComputed} calculs, ` +
      `${stats.mmaRefreshed} rafraîchis, ${stats.mmaFailed} échecs)`,
  );

  /* Échec global manifeste : le job CI doit l'être aussi. */
  if (stats.footStored + stats.mmaStored === 0) {
    throw new Error("Aucune ligne écrite — vérifier la connexion ESPN ou la base.");
  }
}

main()
  .catch((e) => {
    console.error("Échec du pré-calcul :", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
