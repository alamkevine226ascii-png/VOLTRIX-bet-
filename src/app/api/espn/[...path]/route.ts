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

async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const [hostKey, ...rest] = path;
  const target = HOSTS[hostKey];
  if (!target || rest.length === 0) {
    return NextResponse.json({ error: "Relai ESPN : hôte inconnu" }, { status: 400 });
  }
  const url = `${target}/${rest.join("/")}${req.nextUrl.search}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
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
