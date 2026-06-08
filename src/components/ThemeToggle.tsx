import type { ResolvedTheme } from "../theme";

interface ThemeToggleProps {
  resolvedTheme: ResolvedTheme;
  onToggle: () => void;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <g
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <line x1="12" y1="2.5" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="21.5" y2="12" />
        <line x1="5.1" y1="5.1" x2="6.8" y2="6.8" />
        <line x1="17.2" y1="17.2" x2="18.9" y2="18.9" />
        <line x1="5.1" y1="18.9" x2="6.8" y2="17.2" />
        <line x1="17.2" y1="6.8" x2="18.9" y2="5.1" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 13.6A8 8 0 1 1 10.4 4a6.4 6.4 0 0 0 9.6 9.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ThemeToggle({ resolvedTheme, onToggle }: ThemeToggleProps) {
  const isDark = resolvedTheme === "dark";
  const label = isDark
    ? "ライトモードに切り替え"
    : "ダークモードに切り替え";

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
