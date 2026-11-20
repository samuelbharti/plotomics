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
  type PlotPadding,
  type PlotomicsData,
  type PlotomicsFactory,
  type PlotomicsInstance,
  clearElement,
  defaultTheme,
  padSVG,
  serializeSVG,
  themePadding,
} from "../core/index.js";
import { guardDestroy } from "../core/dom.js";
// Import the runtime value from the ESM build explicitly: the package's `main`
// field points at a UMD bundle (`module.exports = factory()`) with no `default`
// export, which esbuild cannot import as `default`. The `module`/ESM build does
// expose a proper default export. Types still come from the package root.
import igv from "igv/dist/igv.esm.js";
import type { Browser, CreateOpt } from "igv";
import {
  type IgvOptions,
  assembleConfig,
  copyForIgv,
  defaultIgvOptions,
  mergeOptions,
  stableJSON,
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

/**
 * An SVG of igv.js with `pad` around it, on the default theme background.
 * Text that is not an SVG of a known size comes back as it is.
 */
function padIgvSVG(svgText: string, pad: PlotPadding): string {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  // A view box other than the plain one of its size would need scaling.
  const box = (svg.getAttribute("viewBox") ?? `0 0 ${width} ${height}`)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    svg.localName !== "svg" ||
    !(width > 0) ||
    !(height > 0) ||
    doc.querySelector("parsererror") ||
    box.join(" ") !== `0 0 ${width} ${height}`
  ) {
    return svgText;
  }
  return serializeSVG(
    padSVG(
      svg as unknown as SVGSVGElement,
      width,
      height,
      pad,
      defaultTheme.background,
    ),
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createIgv: PlotomicsFactory<IgvOptions> = (el, initial) => {
  let opts: IgvOptions = mergeOptions(defaultIgvOptions, initial.options);

  el.style.position = el.style.position || "relative";
  const host = document.createElement("div");
  // igv.js draws to the edges of its container, so the host keeps the
  // padding of the default theme inside its own box.
  const pad = themePadding({});
  host.style.cssText =
    "box-sizing:border-box;width:100%;height:100%;" +
    `padding:${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px;`;
  el.appendChild(host);

  let browser: Browser | null = null;
  // True once destroy() has run: prevents a late-resolving createBrowser from
  // attaching a browser we then leak.
  let destroyed = false;
  // Each new browser gets a number; a browser that resolves after a newer one
  // was asked for is removed at once.
  let generation = 0;
  // The locus and the tracks the live browser shows. Tracks are compared by
  // their content, because anywidget hands over freshly decoded objects on
  // every change. igv.js gets copies of the configs, since it writes into
  // them, and the stored options stay as they came.
  let currentLocus: string | null = null;
  let loadedTracks = new Set<string>();
  // The relayout igv.js runs after resize() goes on after the call returns.
  // A browser is removed only once it is done: removed first, igv.js threw
  // from the relayout, as it read the tracks it had let go.
  let relayout: Promise<unknown> = Promise.resolve();

  /** Remove `b` once a relayout in progress is done. */
  function removeLater(b: Browser) {
    void relayout.then(() => igv.removeBrowser(b));
  }

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
      .createBrowser(host, copyForIgv(config) as unknown as CreateOpt)
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
        void browser.loadTrack(copyForIgv(track) as never).catch((err) => {
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
      stableJSON(opts.config ?? null) !== stableJSON(prev.config ?? null);
    if (rebuild) {
      if (browser) {
        removeLater(browser);
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
      // resize; a relayout of this browser covers tab/accordion reveals, as
      // igv.visibilityChange() does for every browser on the page. If the
      // browser isn't ready there is nothing to nudge.
      if (!browser) return;
      const live = browser as unknown as { layoutChange?: () => unknown };
      const done = live.layoutChange
        ? live.layoutChange.call(browser)
        : igv.visibilityChange();
      relayout = Promise.resolve(done).catch(() => undefined);
    },
    exportSVG() {
      // igv.js can serialize the current view to SVG once the browser is
      // live. It draws it at the size of its own view, so the padding the
      // host keeps goes around it, as in the other plots' exports.
      if (!browser) return null;
      return padIgvSVG(browser.toSVG(), pad);
    },
    destroy() {
      destroyed = true;
      if (browser) {
        removeLater(browser);
        browser = null;
      }
      // If a browser is still loading, its resolution handler sees
      // `destroyed` and removes it.
      clearElement(el);
    },
  };

  return guardDestroy(instance);
};
