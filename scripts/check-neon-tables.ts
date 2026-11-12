import { PrismaClient } from "@prisma/client";
/* VOLTRIX — inspection rapide de la base Neon (tables en schéma public). */
const p = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL!.replace(/[?&]channel_binding=[^&]*/g, ""),
});
const t = await p.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
console.log("Tables en public :", t.map(r => r.table_name).join(", ") || "(aucune)");
await p.$disconnect();
