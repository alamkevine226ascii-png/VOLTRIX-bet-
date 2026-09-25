// ============================================================
// Audit 20-d — Script 2 : Prédictions dégénérées → impact Combinator
// 1. Matchs du jour via /api/matches (dev)
// 2. POST /api/predictions par lots de 6 (pauses 300-400 ms)
// 3. Classification « dégénéré » : λ plancher (0.45/0.45), confiance basse,
//    absence de cotes réelles — fréquence réelle mesurée.
// 4. Reconstruit le vivier de jambes EXACTEMENT comme combo/page.tsx
//    (imports RÉELS de src/lib) puis compare buildCombo avec/sans filtre
//    de qualité de données : comboProb, EV affiché, Kelly conseillée.
// ============================================================

import {
  PROFILES,
  buildCombo,
  fairOdds,
  type ComboLeg,
  type ComboResult,
} from '../src/lib/combo';
import {
  calibrateTotals,
  dcFromMarket,
  deMarginOverUnder,
  oddsWithMargin,
} from '../src/lib/market-odds';
import type { LightMatch, MatchesResponse, QuickPred } from '../src/lib/types';

const DEV = 'http://localhost:3000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LINES = [1.5, 2.5, 3.5];

async function main() {
  // ---------- 1. Matchs du jour ----------
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${DEV}/api/matches?date=${today}`);
  const data: MatchesResponse = await res.json();
  const all = data.leagues.flatMap((l) => l.matches);
  const upcoming = all.filter((m) => m.status === 'pre').sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  console.log(`Journée ${data.date} : ${all.length} matchs, ${upcoming.length} à venir (pre)`);
  const sample = upcoming.slice(0, 24); // ≥ 15 matchs demandés
  console.log(`Échantillon analysé : ${sample.length} matchs\n`);

  // ---------- 2. Analyse par lots de 6 ----------
  const preds = new Map<string, QuickPred>();
  for (let i = 0; i < sample.length; i += 6) {
    const batch = sample.slice(i, i + 6);
    try {
      const r = await fetch(`${DEV}/api/predictions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: batch.map((m) => ({ matchId: m.id, leagueCode: m.leagueCode, date: m.date })) }),
      });
      const j = await r.json();
      for (const p of j.results ?? []) if (p) preds.set(p.matchId, p);
    } catch {}
    console.log(`  lot ${Math.floor(i / 6) + 1}/${Math.ceil(sample.length / 6)} : cumul ${preds.size} prédictions`);
    await sleep(350);
  }

  // ---------- 3. Classification ----------
  let degenerate = 0;
  let withRealOu = 0;
  const rows: string[] = [];
  for (const m of sample) {
    const p = preds.get(m.id);
    if (!p) {
      rows.push(`${m.home.name} vs ${m.away.name} — PAS DE PRÉDICTION`);
      continue;
    }
    const lamTotal = p.lambda?.total ?? -1;
    const floor = lamTotal >= 0 && lamTotal < 1.05; // 0.45+0.45=0.90 (+ε)
    const lowConf = p.confidence <= 2;
    const realOu = p.ouOdds?.line != null && p.ouOdds?.over != null && p.ouOdds?.under != null;
    if (realOu) withRealOu++;
    const deg = floor || lowConf;
    if (deg) degenerate++;
    rows.push(
      `${deg ? 'DEG ' : 'ok  '} ${m.home.name.slice(0, 18).padEnd(18)} vs ${m.away.name.slice(0, 18).padEnd(18)} λ=${(p.lambda?.home ?? 0).toFixed(2)}/${(p.lambda?.away ?? 0).toFixed(2)} conf=${p.confidence} OUréelle=${realOu ? `ligne ${p.ouOdds!.line}` : 'non'} cote1X2=${m.mlHome != null ? 'oui' : 'non'} under2.5=${(p.overUnder.find((o) => o.line === 2.5)?.under ?? 0).toFixed(2)}`
    );
  }
  console.log('\n--- Détail par match ---');
  for (const r of rows) console.log(r);
  console.log(
    `\n>>> FRÉQUENCE RÉELLE : ${degenerate}/${preds.size} prédictions dégénérées (${Math.round((degenerate / Math.max(1, preds.size)) * 100)} %) — ${withRealOu} avec ligne O/U réelle`
  );

  // ---------- 4. Vivier de jambes (miroir exact de buildCandidates) ----------
  const buildCandidates = (matches: LightMatch[], map: Map<string, QuickPred>): ComboLeg[] => {
    const legs: ComboLeg[] = [];
    for (const m of matches) {
      const p = map.get(m.id);
      if (!p) continue;
      const base = {
        matchId: m.id,
        leagueCode: m.leagueCode,
        leagueShort: m.leagueShort,
        leagueName: m.leagueName,
        matchDate: m.date,
        homeName: m.home.name,
        awayName: m.away.name,
        homeLogo: m.home.logo,
        awayLogo: m.away.logo,
        confidence: p.confidence,
      };
      const mlReal = [m.mlHome, m.mlDraw, m.mlAway].every((o) => o != null && o > 1.01);
      const sides = [
        { pick: `Victoire ${m.home.name}`, prob: p.probs.home, odds: m.mlHome },
        { pick: 'Match nul', prob: p.probs.draw, odds: m.mlDraw },
        { pick: `Victoire ${m.away.name}`, prob: p.probs.away, odds: m.mlAway },
      ];
      for (const s of sides) {
        legs.push({ ...base, market: '1X2', pick: s.pick, prob: s.prob, odds: s.odds ?? fairOdds(s.prob), oddsSource: s.odds != null && s.odds > 1.01 ? 'real' : 'estimate' });
      }
      if (mlReal) {
        const dc = dcFromMarket(m.mlHome!, m.mlDraw!, m.mlAway!);
        if (dc) {
          const dcs = [
            { pick: `${m.home.shortName} ou Nul (1X)`, prob: dc.prob1X, odds: dc.odds1X },
            { pick: 'Pas de nul (12)', prob: dc.prob12, odds: dc.odds12 },
            { pick: `${m.away.shortName} ou Nul (X2)`, prob: dc.probX2, odds: dc.oddsX2 },
          ];
          for (const d of dcs) legs.push({ ...base, market: 'Double Chance', pick: d.pick, prob: d.prob, odds: d.odds, oddsSource: 'market' });
        }
      } else {
        const dcs = [
          { pick: `${m.home.shortName} ou Nul (1X)`, prob: p.probs.home + p.probs.draw },
          { pick: 'Pas de nul (12)', prob: p.probs.home + p.probs.away },
          { pick: `${m.away.shortName} ou Nul (X2)`, prob: p.probs.draw + p.probs.away },
        ];
        for (const d of dcs) legs.push({ ...base, market: 'Double Chance', pick: d.pick, prob: d.prob, odds: fairOdds(d.prob), oddsSource: 'estimate' });
      }
      const realOu =
        p.ouOdds?.line != null && p.ouOdds?.over != null && p.ouOdds?.under != null
          ? { line: p.ouOdds.line, over: p.ouOdds.over, under: p.ouOdds.under }
          : null;
      let calibrated: ReturnType<typeof calibrateTotals> | null = null;
      if (realOu && p.lambda) {
        const dm = deMarginOverUnder(realOu.over!, realOu.under!);
        if (dm) calibrated = calibrateTotals(p.lambda.home, p.lambda.away, realOu.line!, dm.pOver, LINES);
      }
      for (const line of LINES) {
        const modelLine = p.overUnder.find((o) => o.line === line);
        const isRealLine = realOu != null && Math.abs(realOu.line - line) < 0.01;
        const overP = calibrated ? calibrated.over[line] : modelLine?.over ?? 0;
        const underP = calibrated ? 1 - overP : modelLine?.under ?? 0;
        if (!Number.isFinite(overP) || !Number.isFinite(underP) || overP <= 0.02 || underP <= 0.02) continue;
        legs.push({ ...base, market: `O/U ${line}`, pick: `Plus de ${line} buts`, prob: overP, odds: isRealLine ? realOu!.over! : oddsWithMargin(overP), oddsSource: isRealLine ? 'real' : calibrated ? 'market' : 'estimate' });
        legs.push({ ...base, market: `O/U ${line}`, pick: `Moins de ${line} buts`, prob: underP, odds: isRealLine ? realOu!.under! : oddsWithMargin(underP), oddsSource: isRealLine ? 'real' : calibrated ? 'market' : 'estimate' });
      }
      const bttsYes = calibrated ? calibrated.btts : p.btts.yes;
      legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Oui', prob: bttsYes, odds: fairOdds(bttsYes), oddsSource: 'estimate' });
      legs.push({ ...base, market: 'BTTS', pick: 'Les 2 équipes marquent : Non', prob: 1 - bttsYes, odds: fairOdds(1 - bttsYes), oddsSource: 'estimate' });
    }
    return legs;
  };

  const candidates = buildCandidates(sample, preds);
  const isDegenerateLeg = (l: ComboLeg) => {
    const p = preds.get(l.matchId);
    if (!p) return true;
    return (p.lambda?.total ?? 0) < 1.05 || p.confidence <= 2;
  };
  const nDegLegs = candidates.filter(isDegenerateLeg).length;
  console.log(`\nVivier : ${candidates.length} jambes, dont ${nDegLegs} issues de prédictions dégénérées (${Math.round((nDegLegs / candidates.length) * 100)} %)`);

  // Top jambes « sous 2.5 » par proba : d'où viennent les 90 % ?
  const unders = candidates
    .filter((l) => l.pick.startsWith('Moins de'))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 6);
  console.log('\n--- Top 6 jambes « Moins de » par proba affichée ---');
  for (const l of unders) {
    const p = preds.get(l.matchId)!;
    console.log(
      `${l.prob.toFixed(3)} @ cote ${l.odds.toFixed(2)} (${l.oddsSource}) λ=${p.lambda?.home?.toFixed(2)}/${p.lambda?.away?.toFixed(2)} conf=${p.confidence} — ${l.homeName} vs ${l.awayName} [${l.pick}] EV affiché ${(l.prob * l.odds - 1).toFixed(2)}`
    );
  }

  // ---------- 5. buildCombo avec/sans filtre qualité ----------
  const run = (pool: ComboLeg[], label: string) => {
    console.log(`\n--- ${label} (${pool.length} jambes) ---`);
    for (const target of [3, 5, 10, 20]) {
      for (const profile of ['equilibre', 'agressif'] as const) {
        const c: ComboResult | null = buildCombo(pool, target, 8, profile, 7);
        if (!c) {
          console.log(`cible ×${target} ${PROFILES[profile].label.padEnd(9)} : AUCUN ticket (cote hors de portée)`);
          continue;
        }
        const degLegs = c.legs.filter(isDegenerateLeg).length;
        const stake = Math.round(c.kelly * 1000);
        console.log(
          `cible ×${String(target).padEnd(3)} ${PROFILES[profile].label.padEnd(9)} : ${c.legs.length} jambes, cote ${c.comboOdds.toFixed(2)}, P=${(c.comboProb * 100).toFixed(1)} %, EV affiché ${(c.comboEV * 100).toFixed(0)} %, Kelly ${(c.kelly * 100).toFixed(1)} % → mise ${stake} €, jambes dégénérées=${degLegs}/${c.legs.length}`
        );
        for (const l of c.legs) console.log(`      · ${l.pick.padEnd(34)} ${(l.prob * 100).toFixed(0)}% @${l.odds.toFixed(2)} (${l.oddsSource}) — ${l.homeName.slice(0, 14)} vs ${l.awayName.slice(0, 14)}${isDegenerateLeg(l) ? '  ← DEG' : ''}`);
      }
    }
  };

  run(candidates, 'SANS filtre qualité (comportement actuel)');
  run(
    candidates.filter((l) => !isDegenerateLeg(l)),
    'AVEC filtre qualité proposé (confiance ≥ 3 ET λ_total > 1.05)'
  );

  console.log('\n✅ Script 2 terminé.');
}

main();
