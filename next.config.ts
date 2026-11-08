import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
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
