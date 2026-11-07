"use client";

import type { Team } from "./data";

/**
 * Circular team crest drawn with SVG — colored disc, contrast ring
 * and bold initials, echoing the flat badge style of the mockup.
 */
export function Crest({
  team,
  size = 56,
  className = "",
}: {
  team: Team;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={team.label}
      className={className}
    >
      {/* ring */}
      <circle cx="32" cy="32" r="30" fill={team.ring} />
      {/* body */}
      <circle cx="32" cy="32" r="26" fill={team.primary} />
      {/* subtle top-light */}
      <path
        d="M6 32 A26 26 0 0 1 58 32 A26 26 0 0 1 6 32 Z"
        fill="#FFFFFF"
        opacity="0.08"
      />
      {/* side accent half */}
      <path
        d="M32 6 A26 26 0 0 1 32 58 A26 26 0 0 1 32 6 Z"
        fill="#000000"
        opacity="0.10"
      />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        fill={team.text}
        fontSize={team.initials.length <= 2 ? 21 : team.initials.length === 3 ? 17.5 : 14}
        fontWeight="900"
        fontFamily="var(--font-body), Arial, sans-serif"
        letterSpacing="-0.5"
      >
        {team.initials}
      </text>
    </svg>
  );
}

/** Small mini crest variant used next to the TACTICS title */
export function MiniCrest({
  team,
  size = 34,
  highlighted = false,
}: {
  team: Team;
  size?: number;
  highlighted?: boolean;
}) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full ${
        highlighted ? "bg-neon p-[3px]" : "p-0"
      }`}
      style={{ width: highlighted ? size + 6 : size, height: highlighted ? size + 6 : size }}
    >
      <Crest team={team} size={size} />
    </span>
  );
}
