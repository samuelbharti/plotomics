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
  createVolcano,
  defaultVolcanoOptions,
  type VolcanoOptions,
} from "../components/volcano.js";
