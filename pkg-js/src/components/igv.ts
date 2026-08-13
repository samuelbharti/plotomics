/**
 * Genome viewer — an embeddable IGV browser via igv.js.
 *
 * Unlike the columnar components (volcano, heatmap, ...), this one is
 * *config-driven*: igv.js streams and tiles remote indexed files (BAM/CRAM,
 * bigWig, VCF, BED, ...) itself, so there is no binary transport here — the
 * data flows entirely through the browser config as URLs.
 *
 * igv.createBrowser is asynchronous (returns a Promise<Browser>), but the
 * plotomics contract requires the factory to return a PlotomicsInstance
 * *synchronously*. We therefore kick the browser off immediately and buffer any
 * setOptions()/resize() calls that arrive before the promise resolves,
 * replaying them once the browser is live. On destroy we remove the browser and
 * clear the element (guarding against a destroy() that races the pending
 * promise).
 */
import {
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  clearElement,
} from "../core/index.js";
// Import the runtime value from the ESM build explicitly: the package's `main`
// field points at a UMD bundle (`module.exports = factory()`) with no `default`
// export, which esbuild cannot import as `default`. The `module`/ESM build does
// expose a proper default export. Types still come from the package root.
import igv from "igv/dist/igv.esm.js";
import type { Browser, CreateOpt } from "igv";
import {
  type IgvOptions,
  assembleConfig,
  defaultIgvOptions,
  mergeOptions,
} from "./igv-config.js";

// Re-export the pure config surface so consumers import from one place while
// the helpers stay unit-testable without loading the igv bundle (which touches
// `document` at import time and cannot run headless). See igv-config.ts.
export {
  type IgvOptions,
  assembleConfig,
  defaultIgvOptions,
} from "./igv-config.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createIgv: PlotomicsFactory<IgvOptions> = (el, initial) => {
  let opts: IgvOptions = mergeOptions(defaultIgvOptions, initial.options);

  el.style.position = el.style.position || "relative";
  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  el.appendChild(host);

  let browser: Browser | null = null;
  // True once destroy() has run: prevents a late-resolving createBrowser from
  // attaching a browser we then leak.
  let destroyed = false;
  // The locus currently reflected in the browser; used to detect setOptions
  // navigation requests.
  let currentLocus: string | null = opts.locus;

  // igv.createBrowser is async but the factory must return synchronously.
  // Kick it off and replay the latest locus once the browser is live.
  const ready = igv
    .createBrowser(host, assembleConfig(opts) as unknown as CreateOpt)
    .then((b) => {
      if (destroyed) {
        // destroy() ran while we were loading — tear the browser down at once.
        igv.removeBrowser(b);
        return;
      }
      browser = b;
      // If a locus was requested via setOptions before the browser was ready,
      // navigate to it now.
      if (opts.locus && opts.locus !== currentLocus) {
        currentLocus = opts.locus;
        b.search(opts.locus);
      }
    })
    .catch((err) => {
      // Surface the failure without breaking the host page.
      console.error("plotomics igv: failed to create browser", err);
    });

  function applyOptions(next: Partial<IgvOptions>) {
    const prev = opts;
    opts = mergeOptions(opts, next);

    if (!browser) {
      // Not ready yet — the ready() handler replays opts.locus once live. New
      // tracks arriving before load are best expressed via the initial config.
      return;
    }
    // A new locus navigates the browser.
    if (opts.locus && opts.locus !== currentLocus) {
      currentLocus = opts.locus;
      browser.search(opts.locus);
    }
    // Treat `tracks` as additive: load any entries not present in the previous
    // list when a new tracks array is supplied.
    if (opts.tracks !== prev.tracks && Array.isArray(opts.tracks)) {
      const before = new Set(prev.tracks ?? []);
      for (const track of opts.tracks) {
        if (!before.has(track)) {
          void browser.loadTrack(track as never).catch((err) => {
            console.error("plotomics igv: failed to load track", err);
          });
        }
      }
    }
  }

  const instance: PlotomicsInstance<IgvOptions> = {
    // Columnar data is unused: igv.js streams via config URLs.
    setData(_next: PlotomicsData) {
      /* no-op — data flows through options.config (URLs). */
    },
    setOptions(next) {
      applyOptions(next);
    },
    resize() {
      // igv.js tracks its container size internally and re-lays out on window
      // resize; a visibilityChange nudge covers tab/accordion reveals. If the
      // browser isn't ready there is nothing to nudge (buffered implicitly).
      if (browser) void igv.visibilityChange();
    },
    exportSVG() {
      // igv.js can serialize the current view to SVG once the browser is live.
      return browser ? browser.toSVG() : null;
    },
    destroy() {
      destroyed = true;
      if (browser) {
        igv.removeBrowser(browser);
        browser = null;
      }
      // If the browser promise is still pending, its resolution handler sees
      // `destroyed` and removes the browser itself.
      void ready;
      clearElement(el);
    },
  };

  return instance;
};
