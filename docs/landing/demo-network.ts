import { createNetwork } from "../../pkg-js/src/components/network.js";
import { geneNetwork } from "./data.js";
import type { DemoMount } from "./demo-types.js";

/** Real genes of four modules, joined by synthetic edges. */
export const mount: DemoMount = (el, ctx) =>
  createNetwork(el, {
    data: geneNetwork(),
    options: {
      iterations: 400,
      theme: ctx.theme,
      onSelect: (node) => ctx.say(node === null ? null : `${node} selected.`),
    },
  });
