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
  type TextSizes,
  textSizes,
  PALETTE_20,
  type PlotPadding,
  DEFAULT_PADDING,
  themePadding,
} from "./theme.js";

export {
  type RGB,
  type RampName,
  viridis,
  rdbu,
  ramp,
  RAMPS,
  isDivergingRamp,
  matrixRamp,
  rgbToHex,
  categoricalColors,
  categoricalScale,
  sampleRamp,
} from "./color.js";

export {
  type Blocks,
  evenBlocks,
  alignedBlocks,
  poolBlocks,
  poolMean,
} from "./pool.js";

export {
  type Dtype,
  type ColumnSpec,
  type BufferSchema,
  type TypedArray,
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
  padSVG,
} from "./export.js";

export {
  type Tooltip,
  type PlotBox,
  clearElement,
  createTooltip,
  createPlotBox,
  measure,
  autoResize,
  releaseContainer,
  textWidth,
  fitText,
  dpr,
} from "./dom.js";

export {
  type LegendFit,
  fitLegend,
  legendCandidates,
  legendLabelsFit,
} from "./legend.js";

export {
  type ScatterplotView,
  type DomainScale,
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
  domainTicks,
  fitDomainTicks,
  isFlatRange,
  spaceTicks,
  formatTick,
  formatTicks,
  tickUnit,
  type TickUnit,
  snapRatio,
  rangeTicks,
} from "./ticks.js";
