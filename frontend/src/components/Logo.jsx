// Original Watchly mark (drawn here, no third-party artwork): a screen with a play glyph and an orbiting seat.
export function Logo({ size = 36, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="Watchly"
    >
      <defs>
        <linearGradient id="wl-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.7 0.22 15)" />
          <stop offset="0.6" stopColor="oklch(0.62 0.2 280)" />
          <stop offset="1" stopColor="oklch(0.7 0.16 235)" />
        </linearGradient>
      </defs>
      <rect x="3" y="6" width="34" height="23" rx="7" fill="url(#wl-g)" />
      <path d="M17 12.5v10l9-5z" fill="#fff" />
      <ellipse
        cx="20"
        cy="34"
        rx="13"
        ry="3"
        fill="none"
        stroke="url(#wl-g)"
        strokeWidth="1.6"
        opacity="0.8"
      />
      <circle cx="31" cy="34.6" r="1.9" fill="#fff" />
    </svg>
  );
}
export default Logo;
