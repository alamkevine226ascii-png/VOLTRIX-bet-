"use client";

/* ============================================================
   VOLTRIX front — Réglages
   Connexion à l'API VOLTRIX (URL de base, test via GET /api),
   diagnostic de synchronisation (GET /api/sync/status) et
   réveil manuel (POST /api/sync/wake).
   ============================================================ */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Database, Loader2, Plug, RefreshCw, Rocket } from "lucide-react";
import {
  fetchIdentity,
  fetchSyncStatus,
  getApiBase,
  isValidBase,
  normalizeBase,
  setApiBase,
  wakeSync,
} from "@/lib/voltrix";
import { demoSyncStatus } from "@/lib/demo-data";
import type { IdentityResponse, SyncStatusResponse } from "@/lib/voltrix-types";
import { DemoBadge, ErrorPanel, KpiTile, SectionTitle } from "./ui-bits";
import type { ReactNode } from "react";

export function SettingsScreen({
  apiEpoch,
  onBaseChanged,
  headerSlot,
  isLive,
}: {
  apiEpoch: number;
  onBaseChanged: () => void;
  headerSlot?: ReactNode;
  isLive: boolean;
}) {
  const [input, setInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatusResponse | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [wakeMsg, setWakeMsg] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    setInput(getApiBase());
  }, []);

  useEffect(() => {
    if (!isLive) {
      setSync(demoSyncStatus());
      return;
    }
    setSyncLoading(true);
    fetchSyncStatus()
      .then(setSync)
      .catch(() => setSync(null))
      .finally(() => setSyncLoading(false));
  }, [isLive, apiEpoch]);

  const testAndSave = useCallback(async () => {
    const base = normalizeBase(input);
    if (!isValidBase(base)) {
      setIdentity(null);
      setIdentityError("URL invalide — format attendu : https://ton-deploiement.vercel.app");
      return;
    }
    setTesting(true);
    setIdentityError(null);
    setIdentity(null);
    setApiBase(base);
    onBaseChanged();
    try {
      const res = await fetchIdentity();
      setIdentity(res);
    } catch (e) {
      setIdentityError(e instanceof Error ? e.message : "API injoignable");
    } finally {
      setTesting(false);
    }
  }, [input, onBaseChanged]);

  const disconnect = useCallback(() => {
    setApiBase("");
    setInput("");
    setIdentity(null);
    setIdentityError(null);
    onBaseChanged();
  }, [onBaseChanged]);

  const doWake = useCallback(async () => {
    setWaking(true);
    setWakeMsg(null);
    try {
      await wakeSync();
      setWakeMsg("Synchronisation lancée — les matchs arrivent dans la base (peut prendre quelques minutes).");
    } catch (e) {
      setWakeMsg(e instanceof Error ? e.message : "Réveil impossible");
    } finally {
      setWaking(false);
    }
  }, []);

  const counts = sync?.counts;

  return (
    <div className="flex h-full flex-col bg-ink">
      {/* en-tête */}
      <header className="flex items-center justify-between px-5 pt-6">
        <div className="flex items-center gap-3">
          {headerSlot}
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              {isLive ? "API connectée" : "Mode démo"} {!isLive ? <DemoBadge /> : null}
            </p>
            <h1 className="font-display text-[30px] leading-none tracking-wide text-white">RÉGLAGES</h1>
          </div>
        </div>
      </header>

      <main className="no-scrollbar mt-5 flex-1 overflow-y-auto px-5 pb-28">
        {/* connexion */}
        <SectionTitle>Connexion à l&apos;API VOLTRIX</SectionTitle>
        <div className="rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5">
          <label htmlFor="api-base" className="text-[9px] font-black uppercase tracking-widest text-white/45">
            URL du déploiement
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-full bg-ink-3 px-4 py-3">
            <Plug size={15} className="shrink-0 text-neon" />
            <input
              id="api-base"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://voltrix-api.vercel.app"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="w-full min-w-0 bg-transparent text-[12px] font-bold text-white placeholder:text-white/25 focus:outline-none"
            />
          </div>
          <p className="mt-2 text-[9.5px] leading-relaxed text-white/40">
            L&apos;URL publique de ton déploiement VOLTRIX (Vercel, Railway…). Toutes les requêtes passent par
            un proxy serveur — aucun réglage CORS à faire côté backend.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void testAndSave()}
              disabled={testing}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-neon px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-black transition-transform active:scale-95 disabled:opacity-60"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={3} />}
              {testing ? "Test en cours…" : "Enregistrer & tester"}
            </button>
            {isLive ? (
              <button
                onClick={disconnect}
                className="rounded-full bg-ink-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-white/60 transition-colors hover:text-white"
              >
                Déconnecter
              </button>
            ) : null}
          </div>

          {identityError ? (
            <div className="mt-3 rounded-2xl bg-[#ff5d5d]/15 px-3.5 py-3 ring-1 ring-[#ff5d5d]/30">
              <p className="text-[10.5px] font-bold text-[#ffb1b1]">{identityError}</p>
              <p className="mt-1 text-[9.5px] leading-relaxed text-white/45">
                Vérifie que le déploiement est en ligne et que l&apos;URL est exacte (sans /api final).
              </p>
            </div>
          ) : null}

          {identity ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 rounded-2xl bg-neon/10 px-3.5 py-3 ring-1 ring-neon/40"
            >
              <p className="text-[11px] font-black text-neon">
                {identity.service} — {identity.status}
              </p>
              <p className="mt-1 text-[9.5px] font-semibold text-white/50">
                {identity.endpoints.length} endpoints détectés (matches, predictions, performance, forecasts, cashout…)
              </p>
            </motion.div>
          ) : null}
        </div>

        {/* mode démo */}
        {!isLive ? (
          <>
            <SectionTitle>Mode démo</SectionTitle>
            <div className="rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5">
              <p className="text-[10.5px] font-semibold leading-relaxed text-white/60">
                Aucune URL configurée : l&apos;interface navigue sur des données de démonstration aux formes
                <span className="text-white"> strictement identiques</span> aux réponses de ton API (matchs, pronos
                moteur, marchés, value bets). Renseigne l&apos;URL de ton déploiement
                ci-dessus pour basculer en données réelles — chaque écran se recharge automatiquement.
              </p>
            </div>
          </>
        ) : null}

        {/* synchronisation */}
        <SectionTitle>Synchronisation ESPN → Neon</SectionTitle>
        {syncLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-[26px] bg-ink-2 py-8 ring-1 ring-white/5">
            <Loader2 size={16} className="animate-spin text-neon" />
            <span className="text-[10.5px] font-bold text-white/50">Lecture du diagnostic…</span>
          </div>
        ) : sync && sync.ok ? (
          <div className="rounded-[26px] bg-ink-2 p-4 ring-1 ring-white/5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/60">
                <Database size={12} className="text-neon" />
                Base {sync.db?.connected ? "connectée" : "hors ligne"}
                {sync.db ? <span className="text-white/30">· {sync.db.latencyMs} ms</span> : null}
              </span>
              <button
                onClick={() => void doWake()}
                disabled={waking || !isLive}
                className="flex items-center gap-1.5 rounded-full bg-neon px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-black transition-transform active:scale-95 disabled:opacity-50"
              >
                <Rocket size={11} strokeWidth={2.8} className={waking ? "animate-pulse" : ""} />
                {waking ? "Réveil…" : "Réveiller"}
              </button>
            </div>

            {counts ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <KpiTile label="Matchs" value={counts.matches?.toLocaleString("fr-FR") ?? "—"} tone="neon" />
                <KpiTile label="Équipes" value={counts.teams?.toLocaleString("fr-FR") ?? "—"} />
                <KpiTile label="Compétitions" value={counts.competitions?.toLocaleString("fr-FR") ?? "—"} />
                <KpiTile label="Cotes" value={counts.oddsSnapshots?.toLocaleString("fr-FR") ?? "—"} />
                <KpiTile label="Snapshots" value={counts.forecastSnapshots?.toLocaleString("fr-FR") ?? "—"} />
                <KpiTile label="Pronos" value={counts.predictions?.toLocaleString("fr-FR") ?? "—"} />
              </div>
            ) : null}

            {sync.lastSync ? (
              <p className="mt-3 text-[9px] font-semibold leading-relaxed text-white/35">
                Dernier job : {sync.lastSync.phase} ·{" "}
                {new Date(sync.lastSync.startedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                {sync.lastSync.finishedAt ? ` → ${new Date(sync.lastSync.finishedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : " (en cours)"}
              </p>
            ) : null}

            {wakeMsg ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-3 rounded-2xl bg-neon/10 px-3.5 py-2.5 text-[10px] font-bold leading-relaxed text-neon ring-1 ring-neon/30"
              >
                {wakeMsg}
              </motion.p>
            ) : null}
          </div>
        ) : (
          <ErrorPanel message="Diagnostic indisponible — vérifie la connexion à l'API." isDemo={!isLive} />
        )}

        {/* à propos */}
        <SectionTitle>À propos</SectionTitle>
        <div className="rounded-[26px] bg-ink-2 p-4 text-[9.5px] font-semibold leading-relaxed text-white/45 ring-1 ring-white/5">
          <p>
            Interface pour le système <span className="text-neon">VOLTRIX bet</span> — moteur Poisson + Elo +
            Forme + contexte (météo, blessures, enjeux), prédictions figées anti look-ahead, base Neon
            PostgreSQL synchronisée depuis ESPN.
          </p>
          <p className="mt-2 text-white/30">
            Endpoints consommés : /api/matches · /api/predictions · /api/match/&#123;id&#125; ·
            /api/match/&#123;id&#125;/lineups · /api/performance · /api/forecasts/week · /api/forecasts/report ·
            /api/forecasts/export · /api/bankroll/resolve · /api/cashout · /api/sync/status · /api/sync/wake
          </p>
        </div>
      </main>
    </div>
  );
}
