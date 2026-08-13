/**
 * Gosling — declarative genomics figures.
 *
 * A config-driven wrapper around Gosling.js (grammar of scalable, linked,
 * interactive nucleotide graphics). Unlike the other components, which consume
 * a columnar `PlotomicsData`, Gosling is entirely spec-driven: `options.spec` is a
 * Gosling JSON specification and *data flows through the spec's own `data`
 * blocks* (tileset URLs, indexed BAM/BED/VCF/BigWig, CSV/JSON URLs or inline
 * values). The `data` argument of the factory is therefore unused.
 *
 * Gosling internally pulls in HiGlass + PixiJS + React and streams/tiles large
 * genomic datasets on the GPU, so this component adds no SVG overlay of its
 * own. `embed()` is asynchronous (it mounts a React tree), so the factory
 * returns a `PlotomicsInstance` synchronously and defers work until the embed
 * promise resolves. Because Gosling's API exposes no in-place spec update,
 * replacing the spec re-embeds from scratch.
 *
 * The pure option/spec helpers live in `./gosling-spec.ts` so they can be
 * unit-tested without importing `gosling.js` (which is browser-only).
 */
import type {
  PlotomicsData,
  PlotomicsFactory,
  PlotomicsInstance,
} from "@plotomics/core";
import { canvasToPNG } from "@plotomics/core";
import { embed } from "gosling.js";
import type { GoslingSpec } from "gosling.js";
import {
  type GoslingOptions,
  defaultGoslingOptions,
  embedOptions,
  isValidSpec,
  mergeGoslingOptions,
} from "./gosling-spec.js";

export {
  type GoslingOptions,
  defaultGoslingOptions,
  embedOptions,
  isValidSpec,
  mergeGoslingOptions,
} from "./gosling-spec.js";

/** The awaited return of Gosling's `embed()`. Kept structural so we don't have
 * to import Gosling's internal `GoslingApi`/`HiGlassApi` types. */
export interface GoslingApiLike {
  getCanvas(options?: {
    resolution?: number;
    transparentBackground?: boolean;
  }): { canvas: HTMLCanvasElement };
  exportPng?(transparentBackground?: boolean): void;
  exportPdf?(transparentBackground?: boolean): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createGosling: PlotomicsFactory<GoslingOptions> = (el, initial) => {
  let opts: GoslingOptions = mergeGoslingOptions(
    defaultGoslingOptions,
    initial.options,
  );

  el.style.position = el.style.position || "relative";
  const host = document.createElement("div");
  host.style.cssText = "position:relative;width:100%;height:100%;";
  el.appendChild(host);

  // Async embed state.
  let api: GoslingApiLike | null = null;
  let destroyed = false;
  // A monotonically increasing token guards against races: only the newest
  // embed may install its API. It is bumped on every re-embed and on destroy,
  // so any in-flight embed that resolves late is ignored.
  let embedToken = 0;

  function teardownView() {
    api = null;
    // Gosling's embed() has no destroy(); unmounting the React tree it created
    // is done by clearing the host element.
    while (host.firstChild) host.removeChild(host.firstChild);
  }

  function doEmbed() {
    teardownView();
    const spec = opts.spec;
    if (!isValidSpec(spec)) return; // nothing valid to render yet
    const token = ++embedToken;
    // embed() mounts a React tree into `host` and resolves once ready.
    embed(host, spec as unknown as GoslingSpec, embedOptions(opts))
      .then((resolved) => {
        if (destroyed || token !== embedToken) return; // superseded / gone
        api = resolved as unknown as GoslingApiLike;
      })
      .catch((err) => {
        if (destroyed || token !== embedToken) return;
        // Surface embed failures without throwing across the async boundary.
        // eslint-disable-next-line no-console
        console.error("plotomics/gosling: embed failed", err);
      });
  }

  // Initial render.
  doEmbed();

  const instance: PlotomicsInstance<GoslingOptions> = {
    // Gosling is spec-driven; columnar data is not used. Kept for contract
    // parity (the host adapters always call it).
    setData(_next: PlotomicsData) {
      /* no-op: data flows through options.spec */
    },
    setOptions(next) {
      const prevSpec = opts.spec;
      opts = mergeGoslingOptions(opts, next);
      // Gosling exposes no in-place spec update, so any change to the spec or
      // embed options means tearing down and mounting afresh.
      const specChanged = next.spec !== undefined && opts.spec !== prevSpec;
      const embedChanged =
        next.padding !== undefined || next.theme !== undefined;
      if (specChanged || embedChanged) doEmbed();
    },
    resize(_w, _h) {
      // Gosling/HiGlass track their size from the container via a
      // ResizeObserver, and `host` fills `el`, so there is nothing to push
      // down. Any resize arriving before the embed resolves is absorbed once
      // HiGlass observes the container — no buffering needed.
    },
    async exportPNG(scale = 2) {
      if (!api) return null;
      try {
        const { canvas } = api.getCanvas({ resolution: scale });
        return canvasToPNG(canvas, 1);
      } catch {
        return null;
      }
    },
    destroy() {
      destroyed = true;
      embedToken += 1; // invalidate any in-flight embed
      teardownView();
      host.remove();
    },
  };

  return instance;
};
