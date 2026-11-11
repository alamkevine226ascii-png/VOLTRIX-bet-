"use client";

/* ============================================================
   VOLTRIX app — Réglages
   L'app vit entièrement sur le téléphone : diagnostics du cache
   local, sources de données (endpoints publics ESPN), moteurs
   (versions et philosophie). Plus d'URL d'API, plus de base de
   données — rien à configurer, tout est déjà local.
   ============================================================ */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Cpu, Database, FlaskConical, Globe, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { getCacheStats, clearCache, type CacheStats } from "@/lib/mma/espn";
import { runModelCheck, type ModelCheckResult } from "@/lib/mma/loaders";
import { clearFootballCache } from "@/lib/foot/analyze";
import { LEAGUES } from "@/lib/foot/leagues";
import { predDbClear } from "@/lib/pred-db";
import { KpiTile, SectionTitle } from "./ui-bits";

export function SettingsScreen({ headerSlot }: { headerSlot?: ReactNode }) {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [cleared, setCleared] = useState(false);
  const [clearing, setClearing] = useState(false);

  /* vérification publique du modèle MMA (backtest UFC, exécuté
     dans le navigateur sur les combats terminés récents) */
  const [modelCheck, setModelCheck] = useState<ModelCheckResult | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);

  const runCheck = useCallback(async () => {
    if (checkBusy) return;
    setCheckBusy(true);
    setModelCheck(null);
    setCheckProgress({ done: 0, total: 0 });
    try {
      const res = await runModelCheck((done, total) => {
        setCheckProgress({ done, total });
      });
      setModelCheck(res);
    } catch {
      setModelCheck(null);
    } finally {
      setCheckProgress(null);
      setCheckBusy(false);
    }
  }, [checkBusy]);

  const refresh = useCallback(() => {
    setStats(getCacheStats());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const doClear = useCallback(async () => {
    setClearing(true);
    try {
      clearCache();
      clearFootballCache();
      /* base locale des pronostics (IndexedDB voltrix-pred-db + repli
         localStorage) : vidée elle aussi pour repartir de zéro */
      await predDbClear();
      await new Promise((r) => setTimeout(r, 350));
      refresh();
      setCleared(true);
      setTimeout(() => setCleared(false), 2400);
    } finally {
      setClearing(false);
    }
  }, [refresh]);

  const prio1 = LEAGUES.filter((l) => l.priority === 1).length;

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* en-tête */}
      <header className="flex items-center justify-between px-5 pt-6">
        <div className="flex items-center gap-3">
          {headerSlot}
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              <Smartphone size={11} strokeWidth={2.6} />
              100 % local
            </p>
            <h1 className="font-display text-[30px] leading-none tracking-wide text-white">RÉGLAGES</h1>
          </div>
        </div>
        <button
          onClick={refresh}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-3 text-white transition-colors hover:bg-neon hover:text-black"
          aria-label="Actualiser les statistiques"
        >
          <RefreshCw size={15} strokeWidth={2.2} />
        </button>
      </header>

      <main className="no-scrollbar mt-5 flex-1 overflow-y-auto px-5 pb-28">
        {/* architecture */}
        <SectionTitle>Architecture</SectionTitle>
        <div className="rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5">
          <div className="flex items-start gap-3">
            <Cpu size={18} className="mt-0.5 shrink-0 text-neon" />
            <p className="text-[10.5px] font-semibold leading-relaxed text-white/60">
              Les moteurs d&apos;analyse tournent <span className="text-white">dans votre téléphone</span> : aucune
              requête ne transite par un serveur VOLTRIX, il n&apos;existe plus aucune base de données. Les endpoints
              publics d&apos;ESPN sont appelés directement depuis l&apos;app, mis en cache localement, et tous les
              calculs (probas, marchés, méthodes, rounds) sont exécutés sur l&apos;appareil.
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <KpiTile label="Moteur foot" value="Poisson·Elo·Forme" tone="neon" />
            <KpiTile label="Moteur UFC" value="voltrix-mma-v1" tone="neon" />
            <KpiTile label="Ligues foot suivies" value={`${LEAGUES.length}`} />
            <KpiTile label="Organisation MMA" value="UFC" />
          </div>
          <p className="mt-3 text-[9px] leading-relaxed text-white/30">
            Les deux moteurs sont STRICTEMENT distincts : football (Poisson par morceaux + Elo + forme, marchés
            1X2/O-U/BTTS/1er but) et UFC (dimensions de carrière, méthodes de victoire, rounds de fin réels) n&apos;ont
            aucun paramètre ni modèle en commun — seul le transport HTTP/ESPN est partagé.
          </p>
        </div>

        {/* sources */}
        <SectionTitle>Sources de données</SectionTitle>
        <div className="rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5">
          <div className="flex items-start gap-3">
            <Globe size={18} className="mt-0.5 shrink-0 text-neon" />
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-semibold leading-relaxed text-white/60">
                Endpoints publics ESPN consommés directement par le navigateur (CORS ouvert, aucune clé) :
              </p>
              <ul className="mt-2 space-y-1.5 text-[9.5px] font-semibold text-white/45">
                <li className="break-all">
                  <span className="text-white/70">Football :</span> site.api.espn.com/…/soccer/&#123;ligue&#125;/scoreboard ·
                  /teams/&#123;id&#125;/schedule · /standings · /injuries · /summary (1er but)
                </li>
                <li className="break-all">
                  <span className="text-white/70">UFC :</span> site.api.espn.com/…/mma/ufc/scoreboard ·
                  sports.core.api.espn.com/…/competitions · /athletes · /statistics · /records (méthodes de
                  victoire ET de défaite)
                </li>
                <li className="break-all">
                  <span className="text-white/70">Météo :</span> open-meteo.com (gratuit, sans clé)
                </li>
              </ul>
              <p className="mt-2.5 text-[9px] leading-relaxed text-white/30">
                Cadre d&apos;usage personnel et non commercial — les conditions Disney/ESPN réservent l&apos;usage
                commercial à une licence. Requêtes limitées à 4 simultanées, mises en cache, avec relance polie en cas
                de bridage.
              </p>
            </div>
          </div>
        </div>

        {/* cache local */}
        <SectionTitle>Cache local</SectionTitle>
        <div className="rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/60">
              <Database size={12} className="text-neon" />
              {stats ? `${stats.entries} entrée${stats.entries > 1 ? "s" : ""}` : "—"}
              {stats ? <span className="text-white/30">· ~{stats.approxSizeKb} Ko</span> : null}
            </span>
            <button
              onClick={() => void doClear()}
              disabled={clearing}
              className="flex items-center gap-1.5 rounded-full bg-neon px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-black transition-transform active:scale-95 disabled:opacity-50"
            >
              <Trash2 size={11} strokeWidth={2.8} />
              {clearing ? "Purge…" : "Vider"}
            </button>
          </div>

          {stats && stats.providers.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {stats.providers.slice(0, 4).map((p) => (
                <KpiTile key={p.host} label={p.host} value={`${p.count}`} />
              ))}
            </div>
          ) : null}

          <p className="mt-3 text-[9px] leading-relaxed text-white/30">
            Scoreboards 10 min · calendriers et classements 3 h · fiches combattants 24 h · analyses 30 min (60 s le
            jour du match) · indicateurs dérivés 12 h · prior rounds UFC 7 jours. Tout est stocké sur l&apos;appareil :
            quitter puis rouvrir l&apos;app dans les 10 minutes ne déclenche AUCUN recalcul réseau. Vider le cache force
            une relecture complète d&apos;ESPN.
          </p>

          {cleared ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 flex items-center gap-1.5 rounded-2xl bg-neon/10 px-3.5 py-2.5 text-[10px] font-bold text-neon ring-1 ring-neon/30"
            >
              <Check size={12} strokeWidth={3} />
              Cache et pronostics vidés — les prochaines lectures repartent des sources ESPN.
            </motion.p>
          ) : null}
        </div>

        {/* vérification du modèle MMA (backtest UFC) */}
        <SectionTitle>Vérification du modèle MMA</SectionTitle>
        <div className="rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5">
          <div className="flex items-start gap-3">
            <FlaskConical size={18} className="mt-0.5 shrink-0 text-neon" />
            <p className="text-[10.5px] font-semibold leading-relaxed text-white/60">
              Le pronostic voltrix-mma-v1 est recalculé sur des combats UFC terminés et confronté aux vrais
              vainqueurs — <span className="text-white">dans votre navigateur</span>, sur les données ESPN du jour.
              Le résultat est publié tel quel, y compris s&apos;il est défavorable.
            </p>
          </div>
          <button
            onClick={() => void runCheck()}
            disabled={checkBusy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-neon px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-black transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            <RefreshCw size={13} strokeWidth={2.8} className={checkBusy ? "animate-spin" : ""} />
            {checkBusy
              ? checkProgress && checkProgress.total > 0
                ? `Analyse ${checkProgress.done}/${checkProgress.total}…`
                : "Collecte des combats…"
              : "Vérifier le modèle maintenant"}
          </button>

          {modelCheck ? (
            <div className="mt-3">
              <div className="grid grid-cols-3 gap-2">
                <KpiTile
                  label="Précision"
                  value={modelCheck.accuracyPct != null ? `${modelCheck.accuracyPct} %` : "—"}
                  tone="neon"
                />
                <KpiTile label="Combats analysés" value={`${modelCheck.analyzed}`} />
                <KpiTile label="Ignorés (données insuff.)" value={`${modelCheck.skipped}`} />
              </div>
              {modelCheck.rows.length > 0 ? (
                <div className="mt-2.5 space-y-1">
                  {modelCheck.rows.slice(0, 6).map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-ink-3 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[9px] font-bold text-white/60">
                        {r.fighterA.split(" ").pop()} vs {r.fighterB.split(" ").pop()}
                      </span>
                      <span className={`text-[9px] font-black ${r.correct ? "text-neon" : "text-white/35"}`}>
                        {r.correct ? "✓ prono juste" : "✗ faux"} · {Math.round(r.probability)} %
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-[8.5px] leading-relaxed text-white/30">
                {modelCheck.notes.join(" · ")}
              </p>
            </div>
          ) : null}
        </div>

        {/* honnêteté */}
        <SectionTitle>Engagements du moteur</SectionTitle>
        <div className="rounded-[26px] bg-ink-2 p-4 text-[9.5px] font-semibold leading-relaxed text-white/45 ring-1 ring-white/5">
          <p>
            <span className="text-neon">Rien d&apos;inventé :</span> une donnée absente chez ESPN est affichée
            « — » ou refuse le prono. Les probabilités MMA sont volontairement bornées entre 25 et 75 % — aucun combat n&apos;est
            une certitude statistique.
          </p>
          <p className="mt-2 text-white/30">
            VOLTRIX n&apos;édite aucune cote et ne donne aucun conseil de paris : c&apos;est un outil de lecture
            statistique des données observées.
          </p>
        </div>
      </main>
    </div>
  );
}
