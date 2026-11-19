import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* v2.5 : plus de ignoreBuildErrors — tsc doit être PROPRE au build
     (les erreurs types étaient masquées par ce drapeau : check() 2 args,
     examples/websocket…). La CI vérifie tsc --noEmit avant build. */
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  /* indicateur dev "N" masqué : il flottait à côté de la capsule
     de navigation et polluait la maquette mobile */
  devIndicators: false,
  /* Relai ESPN : voir src/app/api/espn/[...path]/route.ts —
     même-origine optionnel, utilisé seulement si les variables
     NEXT_PUBLIC_ESPN_*_BASE pointent dessus. */
};

export default nextConfig;
