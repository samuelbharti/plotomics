/**
 * Gosling: declarative genomics figures.
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
 * own. The component renders Gosling's own React component into a React root
 * that it owns. A new spec re-renders that root, which Gosling updates in
 * place; a new padding or theme mounts a new Gosling component, since Gosling
 * keeps its view for those. destroy() unmounts the root. Unmounting is what
 * lets HiGlass free its WebGL context and its window listeners; Gosling's
 * `embed()` mounts a root it never unmounts, so each update leaked one.
 *
 * The pure option/spec helpers live in `./gosling-spec.ts` so they can be
 * unit-tested without importing `gosling.js` (which is browser-only).
 */
import type {
  PlotomicsData,
  PlotomicsFactory,
  PlotomicsInstance,
} from "../core/index.js";
import { canvasToPNG } from "../core/index.js";
import { GoslingComponent } from "gosling.js";
import { createElement, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
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

/** The API Gosling's component exposes through its ref. Kept structural so we
 * don't have to import Gosling's internal `GoslingApi`/`HiGlassApi` types. */
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

export const createGosling: PlotomicsFactory<GoslingOptions> = (
  el,
  initial,
) => {
  let opts: GoslingOptions = mergeGoslingOptions(
    defaultGoslingOptions,
    initial.options,
  );

  el.style.position = el.style.position || "relative";
  const host = document.createElement("div");
  host.style.cssText = "position:relative;width:100%;height:100%;";
  el.appendChild(host);

  let root: Root | null = null;
  let destroyed = false;
  // Gosling's component hands its API out through this ref once mounted.
  const ref = createRef<{ api: GoslingApiLike }>();

  /** Render the current spec into the root, or clear it for no valid spec. */
  function render() {
    if (destroyed) return;
    const spec = opts.spec;
    if (!isValidSpec(spec)) {
      root?.unmount();
      root = null;
      return;
    }
    if (!root) root = createRoot(host);
    root.render(
      createElement(GoslingComponent, {
        // Gosling keeps its view when only the padding changes, and skips a
        // new theme for a spec with ids, so either change mounts a new
        // component (which frees the old one's WebGL context).
        key: JSON.stringify([opts.padding ?? null, opts.theme ?? null]),
        ref,
        spec,
        // A reactive component applies a new spec 300 ms later on a timer,
        // which throws if the view is unmounted first. Without it the new
        // spec applies at once, as each embed() call did.
        reactive: false,
        ...embedOptions(opts),
      }),
    );
  }

  render();

  const instance: PlotomicsInstance<GoslingOptions> = {
    // Gosling is spec-driven; columnar data is not used. The host adapters
    // always call it, so it stays as a no-op.
    setData(_next: PlotomicsData) {
      /* no-op: data flows through options.spec */
    },
    setOptions(next) {
      const prev = opts;
      opts = mergeGoslingOptions(opts, next);
      if (
        opts.spec !== prev.spec ||
        opts.padding !== prev.padding ||
        opts.theme !== prev.theme
      ) {
        render();
      }
    },
    resize(_w, _h) {
      // Gosling/HiGlass track their size from the container via a
      // ResizeObserver, and `host` fills `el`, so there is nothing to push
      // down.
    },
    async exportPNG(scale = 2) {
      if (destroyed || !root) return null;
      const api = ref.current?.api;
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
      // Unmounting runs HiGlass's own teardown, which frees its WebGL context
      // and its window and document listeners.
      root?.unmount();
      root = null;
      host.remove();
    },
  };

  return instance;
};
