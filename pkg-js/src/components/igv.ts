/**
 * Genome viewer: an embeddable IGV browser via igv.js.
 *
 * Unlike the columnar components (volcano, heatmap, ...), this one is
 * *config-driven*: igv.js streams and tiles remote indexed files (BAM/CRAM,
 * bigWig, VCF, BED, ...) itself, so there is no binary transport here; the
 * data flows entirely through the browser config as URLs.
 *
 * igv.createBrowser is asynchronous (returns a Promise<Browser>), but the
 * plotomics factory interface returns a PlotomicsInstance *synchronously*.
 * The browser is started at once, and option changes that arrive before it
 * is ready only update the stored options; once it is live, the stored
 * options are applied in full (locus and tracks). A change to `genome` or
 * `config` builds a new browser. On destroy the browser is removed and the
 * element cleared, also when destroy() races a pending browser.
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
  trackKey,
} from "./igv-config.js";

// Re-export the pure config surface so consumers import from one place while
// the helpers stay unit-testable without loading the igv bundle (which touches
// `document` at import time and cannot run headless). See igv-config.ts.
export {
  type IgvOptions,
  assembleConfig,
  defaultIgvOptions,
  trackKey,
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
  // Each new browser gets a number; a browser that resolves after a newer one
  // was asked for is removed at once.
  let generation = 0;
  // The locus and the tracks the live browser shows. Tracks are compared by
  // a stable key (name, URL and type), because anywidget hands over freshly
  // decoded objects on every change.
  let currentLocus: string | null = null;
  let loadedTracks = new Set<string>();

  function startBrowser() {
    const gen = ++generation;
    const config = assembleConfig(opts);
    currentLocus = (config.locus as string | undefined) ?? null;
    loadedTracks = new Set(
      ((config.tracks as Record<string, unknown>[] | undefined) ?? []).map(
        trackKey,
      ),
    );
    igv
      .createBrowser(host, config as unknown as CreateOpt)
      .then((b) => {
        if (destroyed || gen !== generation) {
          // destroy() ran, or a newer browser was asked for, while this one
          // loaded: tear it down at once.
          igv.removeBrowser(b);
          return;
        }
        browser = b;
        // Options that changed while the browser loaded apply now.
        syncBrowser();
      })
      .catch((err) => {
        // Surface the failure without breaking the host page.
        console.error("plotomics igv: failed to create browser", err);
      });
  }

  /** Bring the live browser to the stored locus and tracks. */
  function syncBrowser() {
    if (!browser) return;
    if (opts.locus && opts.locus !== currentLocus) {
      currentLocus = opts.locus;
      browser.search(opts.locus);
    }
    // `tracks` is additive: entries the browser does not show yet are loaded.
    if (Array.isArray(opts.tracks)) {
      for (const track of opts.tracks) {
        const key = trackKey(track);
        if (loadedTracks.has(key)) continue;
        loadedTracks.add(key);
        void browser.loadTrack(track as never).catch((err) => {
          console.error("plotomics igv: failed to load track", err);
        });
      }
    }
  }

  function applyOptions(next: Partial<IgvOptions>) {
    const prev = opts;
    opts = mergeOptions(opts, next);
    // The genome or a full config cannot change in place: build a new
    // browser for it.
    const rebuild =
      opts.genome !== prev.genome ||
      JSON.stringify(opts.config ?? null) !==
        JSON.stringify(prev.config ?? null);
    if (rebuild) {
      if (browser) {
        igv.removeBrowser(browser);
        browser = null;
      }
      clearElement(host);
      startBrowser();
      return;
    }
    // Not ready yet: the stored options apply when the browser is live.
    syncBrowser();
  }

  startBrowser();

  const instance: PlotomicsInstance<IgvOptions> = {
    // Columnar data is unused: igv.js streams via config URLs.
    setData(_next: PlotomicsData) {
      /* no-op; data flows through options.config (URLs). */
    },
    setOptions(next) {
      applyOptions(next);
    },
    resize() {
      // igv.js tracks its container size internally and re-lays out on window
      // resize; a visibilityChange nudge covers tab/accordion reveals. If the
      // browser isn't ready there is nothing to nudge.
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
      // If a browser is still loading, its resolution handler sees
      // `destroyed` and removes it.
      clearElement(el);
    },
  };

  return instance;
};
