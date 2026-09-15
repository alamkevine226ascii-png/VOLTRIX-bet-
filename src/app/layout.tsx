import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const voltrixDisplay = Space_Grotesk({
  variable: "--font-voltrix-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const voltrixSans = Inter({
  variable: "--font-voltrix-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VOLTRIX bet — Pronostics Football",
  description:
    "Pronostics football intelligents générés par un moteur mathématique : Poisson, Elo, forme récente, H2H, météo et détection de value bets sur tous les matchs du jour.",
  applicationName: "VOLTRIX bet",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VOLTRIX bet",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="dark" suppressHydrationWarning>
      <body
        className={`${voltrixSans.variable} ${voltrixDisplay.variable} antialiased bg-background text-foreground font-sans`}
      >
        {children}
        <Toaster />
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    // Anti-vieille-version : si un SW précédent contrôlait la page et qu'un
    // nouveau prend le relais (skipWaiting + claim), on recharge une seule
    // fois pour exécuter le nouveau code — l'utilisateur ne voit jamais
    // une UI périmée, sans action manuelle.
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (!hadController) return;
      hadController = false;
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(function(){});
  });
}`,
          }}
        />
      </body>
    </html>
  );
}
