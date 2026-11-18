/**
 * The shared core: the component types, themes, color ramps, the binary
 * column transport, and the export and DOM helpers.
 *
 * @module plotomics/core
 */

export type {
  Column,
  PlotomicsData,
  PlotomicsInstance,
  PlotomicsFactory,
} from "./types.js";

export {
  type PlotomicsTheme,
  defaultTheme,
  darkTheme,
  resolveTheme,
  OKABE_ITO,
} from "./theme.js";

export {
  type RGB,
  type RampName,
  viridis,
  rdbu,
  ramp,
  RAMPS,
  rgbToHex,
  categoricalScale,
  sampleRamp,
} from "./color.js";

export {
  type Dtype,
  type ColumnSpec,
  type BufferSchema,
  decodeColumns,
} from "./transport.js";

export {
  type CompositeOptions,
  type PNGLayer,
  serializeSVG,
  canvasToPNG,
  canvasToSVGImage,
  compositePNG,
  downloadBlob,
} from "./export.js";

export {
  type Tooltip,
  clearElement,
  createTooltip,
  measure,
  dpr,
} from "./dom.js";

export {
  type ScatterplotView,
  toNdc,
  baseDomains,
  fitView,
  resizeView,
  isStartView,
  type RenderLoop,
  createRenderLoop,
  afterQuiet,
} from "./scatter.js";

export {
  stepDecimals,
  zeroTicks,
  fitZeroTicks,
  spaceTicks,
  formatTick,
  rangeTicks,
} from "./ticks.js";
