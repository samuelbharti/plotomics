import { createKm } from "../../pkg-js/src/components/km.js";
import { survival } from "./data.js";
import type { DemoMount } from "./demo-types.js";

/** Three synthetic arms, followed for 100 months, with a risk table. */
export const mount: DemoMount = (el, ctx) =>
  createKm(el, {
    data: survival(),
    options: { xLabel: "months", theme: ctx.theme },
  });
