/** Visual theme shared across components for a consistent, publication-ready look. */
export interface PlotomicsTheme {
  /**
   * The colour behind the plot, the padding included, on screen and in the
   * PNG and SVG exports. A CSS custom property such as "var(--bg)", as any
   * theme colour, takes the value it has on the plot's element when the
   * plot draws. After the page changes the property, what the plot drew on
   * a canvas keeps the old colour until it draws again, as on `resize()` or
   * `setOptions()`.
   */
  background: string;
  foreground: string;
  muted: string;
  grid: string;
  axis: string;
  fontFamily: string;
  fontSize: number;
  /**
   * Categorical palette. The default is Okabe-Ito (colour-blind safe, 8
   * colours); past 8 categories the components switch to {@link PALETTE_20}.
   * A palette set here is used as given, its colours repeating past its end.
   * It is an ordered list: the first colour goes to the first group, category
   * or class in the plot's order, the second to the second, and so on. Colours
   * are never matched to groups by name.
   */
  categorical: string[];
  /**
   * Space in px between the edge of the plot's element and everything the
   * plot draws: axes, tick labels, titles, legends and colour bars. A number
   * sets all four sides, and an object `{ top, right, bottom, left }` sets
   * each side, a side left out taking the default of
   * {@link DEFAULT_PADDING} px. The space takes the theme background, and
   * the PNG and SVG exports keep it. A value that is not a finite number of
   * 0 or more counts as the default. See {@link themePadding}.
   */
  padding?: number | Partial<PlotPadding>;
}

/** Space in px on each side of a plot. */
export interface PlotPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The padding of the default theme, in px on each side. */
export const DEFAULT_PADDING = 10;

/** Okabe-Ito colour-blind safe palette, 8 colours. */
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

/**
 * scanpy's default palette for 9 to 20 clusters (`default_20`): matplotlib's
 * tab20 reordered, with three colours replaced and two added.
 */
export const PALETTE_20 = [
  "#1f77b4",
  "#ff7f0e",
  "#279e68",
  "#d62728",
  "#aa40fc",
  "#8c564b",
  "#e377c2",
  "#b5bd61",
  "#17becf",
  "#aec7e8",
  "#ffbb78",
  "#98df8a",
  "#ff9896",
  "#c5b0d5",
  "#c49c94",
  "#f7b6d2",
  "#dbdb8d",
  "#9edae5",
  "#ad494a",
  "#8c6d31",
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
  padding: DEFAULT_PADDING,
};

export const darkTheme: PlotomicsTheme = {
  ...defaultTheme,
  background: "#0b0f19",
  foreground: "#e5e7eb",
  muted: "#9ca3af",
  grid: "#1f2937",
  axis: "#9ca3af",
};

/** Text sizes in px for each role in a chart. */
export interface TextSizes {
  /** Tick labels, category labels, legend entries and value labels. */
  label: number;
  /** Axis titles and legend titles. */
  axisTitle: number;
  /** Plot titles. */
  title: number;
  /**
   * Dense labels that must stay compact: bar labels under a profile, the
   * counts of a risk table, labels inside cells.
   */
  small: number;
}

/**
 * The text size of each role, scaled from `theme.fontSize`. With the default
 * of 12 they are 11 px for labels, 13 px for axis and legend titles, 14 px
 * for plot titles and 9 px for dense labels. A size that is not a positive
 * number counts as 12.
 */
export function textSizes(theme: Pick<PlotomicsTheme, "fontSize">): TextSizes {
  const base =
    Number.isFinite(theme.fontSize) && theme.fontSize > 0 ? theme.fontSize : 12;
  const k = base / 12;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    label: round(11 * k),
    axisTitle: round(13 * k),
    title: round(14 * k),
    small: round(9 * k),
  };
}

/**
 * The padding of a theme as four sides in px. A number sets every side and
 * an object each side it names. A side that is missing, or not a finite
 * number of 0 or more (negative, NaN, Infinity, a string), takes
 * {@link DEFAULT_PADDING}, and so does every side for any other value.
 */
export function themePadding(
  theme: Pick<PlotomicsTheme, "padding">,
): PlotPadding {
  const d = DEFAULT_PADDING;
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  const p: unknown = theme.padding;
  if (valid(p)) return { top: p, right: p, bottom: p, left: p };
  if (p !== null && typeof p === "object" && !Array.isArray(p)) {
    const side = (key: keyof PlotPadding) => {
      const v = (p as Record<string, unknown>)[key];
      return valid(v) ? v : d;
    };
    return {
      top: side("top"),
      right: side("right"),
      bottom: side("bottom"),
      left: side("left"),
    };
  }
  return { top: d, right: d, bottom: d, left: d };
}

/** Merge a partial theme onto a base (defaults to {@link defaultTheme}). */
export function resolveTheme(
  partial?: Partial<PlotomicsTheme>,
  base: PlotomicsTheme = defaultTheme,
): PlotomicsTheme {
  if (!partial) return { ...base };
  return { ...base, ...partial };
}
