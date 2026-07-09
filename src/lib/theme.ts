/**
 * Accent themes. The whole UI is built on accent tokens (see App.css): the ember glow,
 * furnace gauges, active tab, and star fill all read off one hue, so switching a theme
 * re-colors the app from a single `data-theme` attribute on <html>. All themes share the
 * same dark "console" structure — only the accent + ground shift.
 */
export const THEMES = ["ember", "cobalt", "emerald", "plasma"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "ember";

export const THEME_LABELS: Record<Theme, string> = {
  ember: "Ember",
  cobalt: "Cobalt",
  emerald: "Emerald",
  plasma: "Plasma",
};

/** Representative accent swatch per theme, for the settings picker. */
export const THEME_SWATCH: Record<Theme, string> = {
  ember: "#ff6a1f",
  cobalt: "#3f7bff",
  emerald: "#12b47e",
  plasma: "#8b5cff",
};

export function isTheme(v: string | null | undefined): v is Theme {
  return !!v && (THEMES as readonly string[]).includes(v);
}

/** Paint a theme onto the document. Cheap DOM write; safe to call on every change. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}
