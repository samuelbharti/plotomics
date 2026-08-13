import { registerComponent } from "../../lib/umd.js";
import { createNetwork } from "../../components/network.js";

registerComponent("network", createNetwork);
