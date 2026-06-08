export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const themeStorageKey = "markdownpad.theme.v1";
const darkColorSchemeQuery = "(prefers-color-scheme: dark)";

export function prefersDarkColorScheme(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(darkColorSchemeQuery).matches
  );
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") {
    return prefersDarkColorScheme() ? "dark" : "light";
  }

  return mode;
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(themeStorageKey);

    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Ignore storage access errors and fall back to following the system.
  }

  return "system";
}

export function storeThemeMode(mode: ThemeMode) {
  try {
    if (mode === "system") {
      localStorage.removeItem(themeStorageKey);
    } else {
      localStorage.setItem(themeStorageKey, mode);
    }
  } catch {
    // Persisting the preference is best-effort only.
  }
}

export function applyResolvedTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const query = window.matchMedia(darkColorSchemeQuery);
  const listener = () => onChange(query.matches ? "dark" : "light");
  query.addEventListener("change", listener);

  return () => query.removeEventListener("change", listener);
}
