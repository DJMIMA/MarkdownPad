import { useCallback, useEffect, useState } from "react";
import {
  applyResolvedTheme,
  readStoredThemeMode,
  resolveTheme,
  storeThemeMode,
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
