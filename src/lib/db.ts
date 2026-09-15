import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Si le client en cache global date d'avant la dernière génération
// (modèle manquant), on le remplace par un client frais.
// Task 28 : le marqueur est le modèle `match` (noyau Neon) — un client
// d'avant la migration Neon (SQLite, sans Match) est ainsi REJETÉ et
// remplacé par le client PostgreSQL/Neon, sans redémarrage du serveur
// (Turbopack recompile après `prisma generate`, le singleton bascule).
function clientHasModels(client: PrismaClient): boolean {
  return typeof (client as unknown as Record<string, unknown>).match !== 'undefined'
}

export const db: PrismaClient =
  globalForPrisma.prisma && clientHasModels(globalForPrisma.prisma)
    ? globalForPrisma.prisma
    : new PrismaClient({
        log: ['warn', 'error'],
      })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
