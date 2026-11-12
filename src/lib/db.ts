/**
 * VOLTRIX — client Prisma côté serveur (singleton).
 *
 * ⚠️ Serveur uniquement : ce module ne doit JAMAIS être importé par un
 * composant client — la clé Neon vit dans les variables d'environnement
 * serveur (DATABASE_URL / DIRECT_DATABASE_URL), jamais dans le bundle
 * navigateur (aucun préfixe NEXT_PUBLIC_).
 *
 * Consommé par les routes /api/fixtures et le job de pré-calcul.
 * Robustesse : l'intégration Neon de Vercel injecte parfois des
 * paramètres de connexion libpq (channel_binding) que le moteur Prisma
 * ne connaît pas — on les retire ici, sans toucher à l'environnement.
 */

import { PrismaClient } from "@prisma/client";

function sanitizedUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  return url.replace(/[?&]channel_binding=[^&]*/g, "");
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: sanitizedUrl(),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
