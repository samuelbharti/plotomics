import { createOncoplot } from "../../pkg-js/src/components/oncoplot.js";
import { cohort } from "./data.js";
import type { DemoMount } from "./demo-types.js";

/**
 * A synthetic cohort of 20 genes by 400 samples: at the desktop size of the
 * demo, the oncoplot names every gene up to 24 genes and thins the names
 * past that.
 */
export const mount: DemoMount = (el, ctx) =>
  createOncoplot(el, {
    data: cohort(20, 400),
    options: { theme: ctx.theme },
  });
