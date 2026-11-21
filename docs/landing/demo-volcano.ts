import { createVolcano } from "../../pkg-js/src/components/volcano.js";
import { monocyteVolcano } from "./data.js";
import type { DemoMount } from "./demo-types.js";

/** CD14 monocytes against CD4 T cells, the ten strongest hits labelled. */
export const mount: DemoMount = (el, ctx) =>
  createVolcano(el, {
    data: monocyteVolcano(20_000),
    options: { labelTopN: 10, theme: ctx.theme },
  });
