import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "VOLTRIX — Pronostics football",
  description:
    "Interface du système VOLTRIX bet : pronos moteur Poisson/Elo/Forme, marchés, value bets, prévisions figées, performance et portefeuille.",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="antialiased bg-black text-white">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
