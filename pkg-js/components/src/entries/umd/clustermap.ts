import { registerComponent } from "../../lib/umd.js";
import { createClustermap } from "../../components/clustermap.js";

registerComponent("clustermap", createClustermap);
