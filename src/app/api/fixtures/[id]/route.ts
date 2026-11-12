/**
 * VOLTRIX — API fixture unique (lecture seule, côté serveur).
 *
 * GET /api/fixtures/[id]  (ex. /api/fixtures/foot:fra.1:401861146)
 *   → { id, sport, kickoff, status, data, predFull, engineVersion,
 *       computedAt }
 *
 * Sert l'analyse moteur complète (predFull) aux écrans de détail —
 * le navigateur n'exécute le moteur qu'en repli (API indisponible ou
 * ligne périmée : match à venir dont le coup d'envoi est déjà passé).
 * URL-encoder l'identifiant (les « : » doivent voyager en %3A).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  if (!/^(foot|mma):/.test(decoded)) {
    return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
  }

  try {
    const row = await prisma.fixture.findUnique({ where: { id: decoded } });
    if (!row) {
      return NextResponse.json({ error: "Fixture introuvable." }, { status: 404 });
    }
    return NextResponse.json(row, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=240" },
    });
  } catch (e) {
    console.error("[api/fixtures/:id]", e);
    return NextResponse.json(
      { error: "Base de pré-calcul indisponible." },
      { status: 503 },
    );
  }
}
