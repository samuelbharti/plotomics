/**
 * Helpers for the components drawn with regl-scatterplot (volcano, embedding).
 *
 * regl-scatterplot takes point positions in its own coordinate space and
 * keeps one unit the same number of pixels on both axes: y runs from -1 at the
 * bottom of the canvas to 1 at the top, and x from -w/h to w/h. The d3 scales
 * handed to it state which data range [-1, 1] stands for. It reads their
 * domains when it receives them, and from then on rewrites them on every pan
 * and zoom. Setting a domain on the scale object alone does not reach it.
 * See "Synchronize D3 x and y scales with the scatterplot view" in the
 * regl-scatterplot README.
 */

/** Map values onto [-1, 1], where `domain[0]` is -1 and `domain[1]` is 1. */
export function toNdc(
  values: ArrayLike<number>,
  domain: readonly [number, number],
): Float32Array {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = (((values[i] as number) - lo) / span) * 2 - 1;
  }
  return out;
}

/**
 * The data ranges that [-1, 1] stands for, so that the camera's starting view
 * shows exactly `xShow` across the width and `yShow` across the height of a
 * `width` x `height` plot area.
 *
 * y fills [-1, 1] as it is. x has [-w/h, w/h] to fill, so its range is
 * divided by w/h around its centre.
 */
export function baseDomains(
  xShow: readonly [number, number],
  yShow: readonly [number, number],
  width: number,
  height: number,
): [[number, number], [number, number]] {
  const ratio = width > 0 && height > 0 ? width / height : 1;
  const centre = (xShow[0] + xShow[1]) / 2;
  const half = (xShow[1] - xShow[0]) / 2 / ratio;
  return [
    [centre - half, centre + half],
    [yShow[0], yShow[1]],
  ];
}

/** The parts of a regl-scatterplot instance these helpers use. */
export interface ScatterplotView {
  set(properties: Record<string, unknown>): Promise<void>;
  get(property: string): unknown;
  reset(): unknown;
}

/** The parts of a d3 scale these helpers use. */
interface DomainScale {
  domain(domain: [number, number]): unknown;
}

/**
 * Hand the base domains to the scatterplot and move the camera to its
 * starting view, which then shows the whole fitted range.
 *
 * Draw the points with `toNdc` over the same base domains. Receiving a scale
 * makes the scatterplot rewrite both scales' domains from the camera, so each
 * domain is set just before its own scale is handed over. The camera reset
 * waits for the size change that set() applies on the next animation frame,
 * then recomputes the scale domains and fires "view", which the component
 * uses to redraw its axes.
 *
 * reset() does all of that at once, but its promise settles only on the next
 * "draw" event, and there is none before the first points are drawn. Waiting
 * for it would hold back the very draw it waits for, so this does not.
 */
export function fitView(
  scatterplot: ScatterplotView,
  xScale: DomainScale,
  yScale: DomainScale,
  xBase: [number, number],
  yBase: [number, number],
): Promise<void> {
  xScale.domain(xBase);
  void scatterplot.set({ xScale });
  yScale.domain(yBase);
  return scatterplot.set({ yScale }).then(() => {
    void scatterplot.reset();
  });
}

/**
 * Run fits and draws one after another.
 *
 * regl-scatterplot rejects a draw() that starts before the previous one has
 * finished, and keeps the old points. A fit that went through next to a
 * rejected draw would leave the axes on the new range and the points on the
 * old one. Each step waits for the one before. A failed step is logged and
 * does not stop the steps after it.
 */
export function createDrawQueue(): (
  step: () => Promise<unknown>,
) => Promise<void> {
  let last: Promise<void> = Promise.resolve();
  return (step) => {
    last = last.then(step).then(
      () => {},
      (err) => console.error("plotomics: scatterplot draw failed", err),
    );
    return last;
  };
}

/**
 * Apply a new plot-area size and keep the current camera.
 *
 * The scatterplot does not recompute its scales after a resize, so the
 * current camera view is set again once the size has applied. That makes it
 * recompute them and fire "view".
 */
export function resizeView(
  scatterplot: ScatterplotView,
  width: number,
  height: number,
): Promise<void> {
  return scatterplot
    .set({ width, height })
    .then(() => scatterplot.set({ cameraView: scatterplot.get("cameraView") }));
}

const START_VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * True while the camera is still at its starting view, so the person has not
 * panned or zoomed since the last fit. A component fits again on resize only
 * then, and otherwise keeps the view the person chose.
 */
export function isStartView(scatterplot: ScatterplotView): boolean {
  const view = scatterplot.get("cameraView") as ArrayLike<number> | undefined;
  if (!view) return true;
  return START_VIEW.every((v, i) => Math.abs((view[i] as number) - v) < 1e-9);
}
