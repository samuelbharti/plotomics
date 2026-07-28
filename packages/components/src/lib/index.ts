// Programmatic entry for direct npm/bundler consumers (e.g. custom dashboards).
// Re-export each component factory + its options type here. Keep entries sorted
// so parallel PRs append cleanly.

export { makeAnywidget } from "./anywidget.js";
export { registerComponent } from "./umd.js";
export { decodeModelData } from "./decode-model.js";

export {
  createClustermap,
  defaultClustermapOptions,
  type ClustermapOptions,
} from "../components/clustermap.js";

export {
  createEmbedding,
  defaultEmbeddingOptions,
  type EmbeddingOptions,
} from "../components/embedding.js";

export {
  createGosling,
  defaultGoslingOptions,
  type GoslingOptions,
} from "../components/gosling.js";

export {
  createHeatmap,
  defaultHeatmapOptions,
  type HeatmapOptions,
} from "../components/heatmap.js";

export {
  createHic,
  defaultHicOptions,
  type HicOptions,
  type HicColormap,
  type HicTransform,
} from "../components/hic.js";

export {
  createIgv,
  defaultIgvOptions,
  type IgvOptions,
} from "../components/igv.js";

export {
  createLollipop,
  defaultLollipopOptions,
  type LollipopOptions,
  type LollipopDomain,
  type LollipopPtm,
} from "../components/lollipop.js";

export {
  createDotplot,
  defaultDotplotOptions,
  type DotplotOptions,
  type DotplotLayout,
} from "../components/dotplot.js";

export {
  createKm,
  defaultKmOptions,
  type KmOptions,
  type KmLayout,
} from "../components/km.js";

export {
  createNetwork,
  defaultNetworkOptions,
  type NetworkOptions,
} from "../components/network.js";

export {
  createOncoplot,
  defaultOncoplotOptions,
  type OncoplotOptions,
  type OncoplotAnnotation,
} from "../components/oncoplot.js";

export {
  createProfile,
  defaultProfileOptions,
  type ProfileOptions,
  type GroupRun,
} from "../components/profile.js";

export {
  createSpatial,
  defaultSpatialOptions,
  type SpatialOptions,
  type SpatialColorMode,
  type FitTransform,
} from "../components/spatial.js";

export {
  createTreemap,
  defaultTreemapOptions,
  type TreemapOptions,
} from "../components/treemap.js";

export {
  createUpset,
  defaultUpsetOptions,
  type UpsetOptions,
  type UpsetLayout,
} from "../components/upset.js";

export {
  createVolcano,
  defaultVolcanoOptions,
  type VolcanoOptions,
} from "../components/volcano.js";
