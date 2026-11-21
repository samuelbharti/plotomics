import { createEmbedding } from "../../pkg-js/src/components/embedding.js";
import { pbmcCells } from "./data.js";
import type { DemoMount } from "./demo-types.js";
import { CELL_TYPES } from "./genes.js";

/** 100,000 synthetic PBMCs, coloured by cell type. */
export const mount: DemoMount = (el, ctx) =>
  createEmbedding(el, {
    data: pbmcCells(100_000),
    options: {
      colorMode: "categorical",
      categories: CELL_TYPES,
      theme: ctx.theme,
      onSelect: (rows) =>
        ctx.say(
          rows.length > 0
            ? `${rows.length.toLocaleString("en-US")} cells selected.`
            : null,
        ),
    },
  });
