import { NextRequest, NextResponse } from "next/server";

/* ============================================================
   VOLTRIX app — Relai même-origine OPTIONNEL vers ESPN
   Par défaut, l'app appelle ESPN directement depuis le navigateur
   (CORS ouvert). Ce relai ne sert que lorsque les bases
   NEXT_PUBLIC_ESPN_*_BASE pointent dessus :
   - réseaux verrouillés qui bloquent les origines tierces ;
   - environnements de test dont le navigateur n'a pas internet.
   Il impose un User-Agent accepté par ESPN (le CDN 403 les UA
   exotiques type HeadlessChrome) et transmet tel quel statuts
   et corps (404 -> 404 : une donnée absente n'est jamais fabriquée).
   ============================================================ */

const HOSTS: Record<string, string> = {
  site: "https://site.api.espn.com",
  siteweb: "https://site.web.api.espn.com",
  core: "https://sports.core.api.espn.com",
};

const UA = "Mozilla/5.0 (compatible; VOLTRIX-App/1.0; +local)";

/* Débit limité global (audit 2026-11-09) : le CDN ESPN bloque l'IP en
   rafale sur /competitions et /status (403 massifs dès ~3 requêtes
   simultanées). On sérialise TOUTES les requêtes relai avec un espacement
   minimum — indispensable en environnement de test où tout passe par une
   seule IP ; sans effet sur un déploiement où le navigateur appelle ESPN
   directement. */
const MIN_SPACING_MS = 250;
let lastStart = 0;
let chain: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastStart + MIN_SPACING_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run.then(task);
}

async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const first = path[0];
  const rest = path.slice(1);
  const target = first ? HOSTS[first] : undefined;
  if (!target || rest.length === 0) {
    return NextResponse.json({ error: "Relai ESPN : hôte inconnu" }, { status: 400 });
  }
  const url = `${target}/${rest.join("/")}${req.nextUrl.search}`;
  try {
    /* Audit 2026-11-09 (test utilisateur) : sports.core.api.espn.com
       bloque INTERMITTEMMENT (403 aléatoires, CDN type Akamai) certaines
       ressources (/competitions, /status) même avec Referer espn.com.
       Rejouées jusqu'à 4 fois avec pause croissante, et débit limité
       globalement (voir enqueue plus haut). */
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const res = await enqueue(async () => {
      let r: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        r = await fetch(url, {
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
            Referer: "https://www.espn.com/",
          },
          signal: ctrl.signal,
          cache: "no-store",
        });
        clearTimeout(timer);
        if (r.status !== 403 && r.status !== 429) break;
        await sleep(350 + attempt * 350);
      }
      return r!;
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Relai ESPN : amont injoignable" }, { status: 502 });
  }
}

export const GET = handler;
export const dynamic = "force-dynamic";
