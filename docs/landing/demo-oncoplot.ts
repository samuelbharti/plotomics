import { createOncoplot } from "../../pkg-js/src/components/oncoplot.js";
import { cohort } from "./data.js";
import type { DemoMount } from "./demo-types.js";

/** A synthetic cohort of 30 genes by 400 samples. */
export const mount: DemoMount = (el, ctx) =>
  createOncoplot(el, {
    data: cohort(30, 400),
    options: { theme: ctx.theme },
  });
