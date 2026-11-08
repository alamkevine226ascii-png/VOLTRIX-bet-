"use client";

import { useState } from "react";

/* ============================================================
   VOLTRIX app — Tête de combattant
   Photo ESPN (headshot) si disponible, sinon médaillon à
   initiales — jamais de photo inventée.
   ============================================================ */

function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function FighterHead({
  name,
  headshotUrl,
  size = 56,
  className = "",
}: {
  name: string;
  headshotUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = headshotUrl && !failed ? headshotUrl : null;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        className={`shrink-0 rounded-full bg-ink-3 object-cover object-top ring-2 ring-white/20 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className={`flex shrink-0 select-none items-center justify-center rounded-full bg-ink-3 font-black tracking-wide text-white ring-2 ring-white/20 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.3)) }}
    >
      {initialsOf(name)}
    </span>
  );
}
