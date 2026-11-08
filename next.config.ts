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
};

export default nextConfig;
