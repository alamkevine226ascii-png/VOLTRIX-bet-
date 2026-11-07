"use client";

/**
 * Football jersey (shirt) icon — white by default, neon when highlighted,
 * exactly like the player tokens scattered on the TACTICS pitch.
 */
export function Jersey({
  size = 34,
  color = "#FFFFFF",
  className = "",
  withNumber,
  number,
}: {
  size?: number;
  color?: string;
  className?: string;
  withNumber?: boolean;
  number?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Jersey"
      className={className}
    >
      <path
        d="M22.5 7.5 L10 13.5 L3.5 26 L14.5 32.5 L18 27.5 V57 H46 V27.5 L49.5 32.5 L60.5 26 L54 13.5 L41.5 7.5 C39.8 11.5 36.3 13.5 32 13.5 C27.7 13.5 24.2 11.5 22.5 7.5 Z"
        fill={color}
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* collar */}
      <path
        d="M22.5 7.5 C24.2 11.5 27.7 13.5 32 13.5 C36.3 13.5 39.8 11.5 41.5 7.5"
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="2"
      />
      {withNumber && number ? (
        <text
          x="32"
          y="40"
          textAnchor="middle"
          fontSize="16"
          fontWeight="900"
          fill={color === "#FFFFFF" ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.8)"}
          fontFamily="var(--font-body), Arial, sans-serif"
        >
          {number}
        </text>
      ) : null}
    </svg>
  );
}

/** Tiny football used next to the player in possession */
export function BallDot({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label="Ball">
      <circle cx="8" cy="8" r="7" fill="#FFFFFF" stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <path
        d="M8 4.6 L10.9 6.7 L9.8 10 L6.2 10 L5.1 6.7 Z"
        fill="#141414"
      />
    </svg>
  );
}
