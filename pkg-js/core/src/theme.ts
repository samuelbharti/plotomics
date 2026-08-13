/** Visual theme shared across components for a consistent, publication-ready look. */
export interface PlotomicsTheme {
  background: string;
  foreground: string;
  muted: string;
  grid: string;
  axis: string;
  fontFamily: string;
  fontSize: number;
  /** Colorblind-safe categorical palette (Okabe-Ito + extensions). */
  categorical: string[];
}

/** Okabe-Ito colorblind-safe palette, extended with a few Tableau-ish hues. */
export const OKABE_ITO = [
  "#0072B2", // blue
  "#E69F00", // orange
  "#009E73", // green
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#56B4E9", // sky blue
  "#F0E442", // yellow
  "#999999", // grey
];

export const defaultTheme: PlotomicsTheme = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  muted: "#6b7280",
  grid: "#e5e7eb",
  axis: "#374151",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  fontSize: 12,
  categorical: OKABE_ITO,
};

export const darkTheme: PlotomicsTheme = {
  ...defaultTheme,
  background: "#0b0f19",
  foreground: "#e5e7eb",
  muted: "#9ca3af",
  grid: "#1f2937",
  axis: "#9ca3af",
};

/** Merge a partial theme onto a base (defaults to {@link defaultTheme}). */
export function resolveTheme(
  partial?: Partial<PlotomicsTheme>,
  base: PlotomicsTheme = defaultTheme,
): PlotomicsTheme {
  if (!partial) return { ...base };
  return { ...base, ...partial };
}
