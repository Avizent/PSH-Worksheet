import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedScheme: ResolvedScheme;
  setPreference: (pref: ThemePreference) => void;
  cyclePreference: () => void;
  isLoaded: boolean;
}

const STORAGE_KEY = "theme-preference";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val === "light" || val === "dark" || val === "system") {
          setPreferenceState(val);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
  }, []);

  const cyclePreference = useCallback(() => {
    setPreferenceState((current) => {
      const next: ThemePreference =
        current === "light" ? "dark" : current === "dark" ? "system" : "light";
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const resolvedScheme: ResolvedScheme = useMemo(() => {
    if (preference === "system") {
      return systemScheme === "dark" ? "dark" : "light";
    }
    return preference;
  }, [preference, systemScheme]);

  const value = useMemo(
    () => ({ preference, resolvedScheme, setPreference, cyclePreference, isLoaded }),
    [preference, resolvedScheme, setPreference, cyclePreference, isLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Provides a theme context that always tracks the device's system color
 * scheme and ignores any stored user preference. Used for screens like
 * the public board-view, which must respect the viewer's OS appearance
 * rather than the budget-tracker app owner's stored preference.
 */
export function SystemThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const resolvedScheme: ResolvedScheme = systemScheme === "dark" ? "dark" : "light";
  const value = useMemo<ThemeContextValue>(
    () => ({
      preference: "system",
      resolvedScheme,
      setPreference: () => {},
      cyclePreference: () => {},
      isLoaded: true,
    }),
    [resolvedScheme]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside a ThemeProvider");
  }
  return ctx;
}
