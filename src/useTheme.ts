import { useCallback, useEffect, useState } from "react";
import {
  applyResolvedTheme,
  readStoredThemeMode,
  resolveTheme,
  storeThemeMode,
  themeStorageKey,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme";

export interface ThemeController {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

export function useTheme(): ThemeController {
  const [mode, setMode] = useState<ThemeMode>(readStoredThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredThemeMode()),
  );

  useEffect(() => {
    const resolved = resolveTheme(mode);
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
    storeThemeMode(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== "system") {
      return;
    }

    return watchSystemTheme((systemTheme) => {
      setResolvedTheme(systemTheme);
      applyResolvedTheme(systemTheme);
    });
  }, [mode]);

  // Another window switched the theme: follow it.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === themeStorageKey) {
        setMode(readStoredThemeMode());
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setMode((current) => (resolveTheme(current) === "dark" ? "light" : "dark"));
  }, []);

  return {
    mode,
    resolvedTheme,
    setMode,
    toggleTheme,
  };
}
