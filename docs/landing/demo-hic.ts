import { createHic } from "../../pkg-js/src/components/hic.js";
import { contactMap } from "./data.js";
import type { DemoMount } from "./demo-types.js";

/** A synthetic 10 Mb contact map at 10 kb bins. */
export const mount: DemoMount = (el, ctx) =>
  createHic(el, {
    data: contactMap(1024),
    options: { transform: "log", label: "chr (synthetic)", theme: ctx.theme },
  });
