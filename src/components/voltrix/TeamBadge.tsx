"use client";

/* ============================================================
   VOLTRIX front — Écusson d'équipe
   Logo ESPN si fourni, sinon médaillon à initiales sur fond
   déterministe (couleur stable par nom d'équipe).
   ============================================================ */

import { useState } from "react";

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function TeamBadge({
  name,
  logo,
  size = 48,
  className = "",
}: {
  name: string;
  logo?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hue = hashHue(name);
  const style: React.CSSProperties = {
    width: size,
    height: size,
    background: `linear-gradient(140deg, hsl(${hue} 45% 32%), hsl(${(hue + 40) % 360} 50% 20%))`,
    fontSize: Math.max(10, Math.round(size * 0.3)),
  };

  if (logo && !failed) {
    return (
      // logos ESPN distants — <img> simple, tailles dynamiques
       
      <img
        src={logo}
        alt={`Logo ${name}`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full bg-white object-contain p-[3px] ring-1 ring-white/25 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-black tracking-wide text-white ring-1 ring-white/25 ${className}`}
      style={style}
    >
      {initialsOf(name)}
    </span>
  );
}
