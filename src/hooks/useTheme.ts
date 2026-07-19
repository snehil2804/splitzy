"use client";

import { useSyncExternalStore } from "react";
import { STORAGE_KEYS, type ThemePreference } from "@/lib/constants";

/**
 * Theme preference (system / light / dark). The initial stamp happens in a
 * blocking inline script in the root layout to avoid a flash; this hook
 * powers the Settings toggle.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEYS.theme);
  return stored === "light" || stored === "dark" ? stored : "system";
}

const getServerSnapshot = (): ThemePreference => "system";

function applyTheme(preference: ThemePreference) {
  const resolved =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.theme = resolved;
}

export function setThemePreference(preference: ThemePreference) {
  if (preference === "system") localStorage.removeItem(STORAGE_KEYS.theme);
  else localStorage.setItem(STORAGE_KEYS.theme, preference);
  applyTheme(preference);
  listeners.forEach((listener) => listener());
}

export function useTheme(): ThemePreference {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
