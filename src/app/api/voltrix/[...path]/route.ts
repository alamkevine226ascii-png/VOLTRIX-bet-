// ============================================================
// VOLTRIX front — Proxy même-origine vers l'API VOLTRIX
// L'API VOLTRIX (dépôt backend) n'expose pas d'en-têtes CORS :
// le navigateur ne peut pas l'appeler directement depuis une autre
// origine. Ce proxy serveur relaie chaque requête :
//   /api/voltrix/<chemin>?<query>  →  {BASE}/<chemin>?<query>
// BASE provient de l'en-tête x-voltrix-base (ou du paramètre
// __base pour les liens téléchargeables type PDF/CSV), sinon de
// la variable d'environnement VOLTRIX_API_BASE.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function resolveBase(req: NextRequest): { base: string | null; error?: string } {
  const header = req.headers.get("x-voltrix-base");
  const param = req.nextUrl.searchParams.get("__base");
  const env = process.env.VOLTRIX_API_BASE ?? process.env.NEXT_PUBLIC_VOLTRIX_API ?? "";
  for (const raw of [header, param, env]) {
    if (!raw) continue;
    let candidate = raw.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
    try {
      const u = new URL(candidate);
      if (!u.hostname || u.username || u.password) continue;
      return { base: u.origin };
    } catch {
      return { base: null, error: "URL de base invalide" };
    }
  }
  return { base: null, error: "Aucune URL d'API VOLTRIX configurée" };
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }): Promise<NextResponse> {
  const { path } = await ctx.params;
  const { base, error } = resolveBase(req);
  if (!base) {
    return NextResponse.json({ error: error ?? "Base absente" }, { status: 400 });
  }

  // Reconstruit la requête amont : chemin + query SANS __base.
  // Les chemins client sont DÉJÀ complets ("/api/matches"…) — le
  // catch-all capture ["api","matches"], on les recolle tels quels.
  const sub = (path ?? []).map((s) => encodeURIComponent(decodeURIComponent(s))).join("/");
  const qs = new URLSearchParams(req.nextUrl.searchParams);
  qs.delete("__base");
  const url = `${base}/${sub}${qs.size > 0 ? `?${qs.toString()}` : ""}`;

  const method = req.method.toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json, application/pdf, text/csv, */*" };
  const contentType = req.headers.get("content-type");
  if (contentType && method !== "GET" && method !== "HEAD") headers["Content-Type"] = contentType;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 115_000);
  try {
    const body = method === "GET" || method === "HEAD" ? undefined : await req.text();
    const upstream = await fetch(url, {
      method,
      headers,
      body,
      signal: ctrl.signal,
      cache: "no-store",
    });

    const buf = await upstream.arrayBuffer();
    const outHeaders: Record<string, string> = {};
    const ct = upstream.headers.get("content-type");
    if (ct) outHeaders["Content-Type"] = ct;
    const cd = upstream.headers.get("content-disposition");
    if (cd) outHeaders["Content-Disposition"] = cd;
    outHeaders["Cache-Control"] = "no-store";
    outHeaders["X-Voltrix-Upstream-Status"] = String(upstream.status);

    return new NextResponse(buf, { status: upstream.status, headers: outHeaders });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Délai dépassé vers l'API VOLTRIX" : "API VOLTRIX injoignable";
    return NextResponse.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(req, ctx);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(req, ctx);
}
