import { createLollipop } from "../../pkg-js/src/components/lollipop.js";
import { protein } from "./data.js";
import type { DemoMount } from "./demo-types.js";

/** Synthetic TP53 variants over the protein's domains. */
export const mount: DemoMount = (el, ctx) =>
  createLollipop(el, {
    data: protein(400),
    options: { theme: ctx.theme },
  });
