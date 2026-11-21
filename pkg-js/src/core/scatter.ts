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

import { MIN_VIEW_SHARE } from "./view.js";

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
export interface DomainScale {
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
 * Call `fn` once, `ms` after the last of a run of calls. A dragged window
 * edge sends a resize on every frame; the refit waits until it stops.
 */
export function afterQuiet(
  fn: () => void,
  ms: number,
): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
  call.cancel = () => clearTimeout(timer);
  return call;
}

/** Requests renders from a render loop, and stops it. */
export interface RenderLoop {
  /** Ask for a render. `fit` asks it to frame all the data again. */
  request(fit: boolean): void;
  /** Drop any pending render. For destroy(). */
  stop(): void;
}

/**
 * Run renders one at a time, and merge the requests that arrive while one
 * runs into a single next render.
 *
 * regl-scatterplot rejects a draw() that starts before the previous one has
 * finished, and keeps the old points, which would leave them under axes for
 * new data. A dragged window edge sends a resize on every frame, and each
 * render maps every point again; merged, a burst of requests costs one more
 * render, not one per request. A render starts in a microtask, so requests
 * made together, such as the setData() and setOptions() that the Shiny
 * binding sends on every update, also become one render. The merged render
 * fits if any request asked for a fit. It reads the component's state when
 * it starts, so it always draws the latest data and options. A failed render
 * is logged and does not stop the next one.
 */
export function createRenderLoop(
  render: (fit: boolean) => Promise<void>,
): RenderLoop {
  let running = false;
  let stopped = false;
  // null: nothing pending. Otherwise whether the pending render fits.
  let pending: boolean | null = null;

  async function run() {
    while (pending !== null && !stopped) {
      const fit = pending;
      pending = null;
      try {
        await render(fit);
      } catch (err) {
        console.error("plotomics: scatterplot render failed", err);
      }
    }
    running = false;
  }

  return {
    request(fit) {
      if (stopped) return;
      pending = (pending ?? false) || fit;
      if (!running) {
        running = true;
        queueMicrotask(() => void run());
      }
    },
    stop() {
      stopped = true;
      pending = null;
    },
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

/** A 4 x 4 matrix in column order, as regl-scatterplot keeps its camera. */
export interface ViewMatrix {
  [index: number]: number;
  readonly length: number;
}

/**
 * Keep `view`, a camera view of regl-scatterplot, inside the home view, and
 * change it in place. Returns whether it changed.
 *
 * The view scales the points by s and moves them by (tx, ty): its entries
 * 0 and 5, and 12 and 13. The home view is the start view, s = 1 with no
 * move, which shows x from -homeAspect to homeAspect and y from -1 to 1:
 * all the data, as {@link fitView} fitted it to a plot area homeAspect
 * times as wide as it is high. A plot area `aspect` times as wide as it is
 * high shows x from (-aspect - tx) / s to (aspect - tx) / s, and y from
 * (-1 - ty) / s to (1 - ty) / s.
 *
 * s stays from 1, the home view, to 1 / MIN_VIEW_SHARE, and on each axis
 * the view stays inside the home view. An axis that shows more than the
 * home view, as after a resize to a wider plot area, is centred on it. A
 * turn of the view is taken out, as a turned view does not fit the home
 * view. A scale within a millionth of 1 is the home view itself, written
 * exactly, so a zoom back out ends at the start view.
 */
export function boundView(
  view: ViewMatrix,
  aspect: number,
  homeAspect: number,
): boolean {
  const scale = Math.hypot(view[0] as number, view[1] as number);
  if (!(scale > 0) || !(aspect > 0) || !(homeAspect > 0)) return false;
  let s = Math.min(1 / MIN_VIEW_SHARE, Math.max(1, scale));
  if (s - 1 < 1e-6) s = 1;
  // The centre of the view in point coordinates, kept where the view,
  // `half` across from it, stays inside the home view, `edge` across. An
  // axis that shows the home view whole is centred.
  const keep = (centre: number, half: number, edge: number) =>
    half >= edge * (1 - 1e-9)
      ? 0
      : Math.min(edge - half, Math.max(half - edge, centre));
  const cx = keep(-(view[12] as number) / scale, aspect / s, homeAspect);
  const cy = keep(-(view[13] as number) / scale, 1 / s, 1);
  const tx = cx === 0 ? 0 : -cx * s;
  const ty = cy === 0 ? 0 : -cy * s;
  // The home view and a centred axis are written exactly; other values
  // keep the float32 rounding of the camera.
  const close = (a: number, b: number) =>
    b === 0 || b === 1 ? a === b : Math.abs(a - b) <= 1e-6 * s;
  const turned = view[1] !== 0 || view[4] !== 0;
  if (
    !turned &&
    close(view[0] as number, s) &&
    close(view[5] as number, s) &&
    close(view[12] as number, tx) &&
    close(view[13] as number, ty)
  ) {
    return false;
  }
  for (let i = 0; i < 16; i += 1) view[i] = i % 5 === 0 ? 1 : 0;
  view[0] = s;
  view[5] = s;
  view[12] = tx;
  view[13] = ty;
  return true;
}

/** The camera of regl-scatterplot, a dom-2d-camera, as the bounds use it. */
interface ScatterCamera {
  /** The view, which the camera changes in place on each pan and zoom. */
  readonly view: ViewMatrix;
  /** Apply the pan and zoom of the last frame; whether the view moved. */
  tick(): boolean;
  setScaleBounds(bounds: [[number, number], [number, number]]): void;
  config(settings: { isRotate?: boolean }): void;
}

/** What {@link boundCamera} reads from the plot, each time it is needed. */
export interface CameraBounds {
  /** Whether the view is bounded now: the plot's `boundedView` option. */
  bounded(): boolean;
  /** The width of the plot area over its height, now. */
  aspect(): number;
  /** The width of the plot area over its height at the last fit. */
  homeAspect(): number;
}

/**
 * Keep the camera of `scatterplot` inside its home view while
 * `bounds.bounded()` is true (see {@link boundView}): zooming out stops at
 * the home view, a pan stops at its edges, and zooming in stops at
 * MIN_VIEW_SHARE of its range.
 *
 * The camera's scale bounds stop the zoom at the wheel, about the pointer.
 * Its translation bounds are kept but not applied by dom-2d-camera, and
 * the room a pan has depends on the zoom, so each frame's view is bounded
 * as the camera applies its pan and zoom, before the frame is drawn: the
 * view never leaves the bounds, so it does not jump back, and no view
 * event fires for a view the plot did not draw. Turning the view (alt and
 * a drag) is off while bounded.
 *
 * Call `update()` once the scatterplot is made and again when `bounded()`
 * changes. A scatterplot with no camera to read is left as it is.
 */
export function boundCamera(
  scatterplot: ScatterplotView,
  bounds: CameraBounds,
): { update(): void } {
  const camera = scatterplot.get("camera") as ScatterCamera | undefined;
  if (!camera || typeof camera.tick !== "function") return { update() {} };
  const tick = camera.tick;
  camera.tick = () => {
    const moved = tick();
    if (moved && bounds.bounded()) {
      boundView(camera.view, bounds.aspect(), bounds.homeAspect());
    }
    return moved;
  };
  return {
    update() {
      const on = bounds.bounded();
      const most = 1 / MIN_VIEW_SHARE;
      camera.setScaleBounds(
        on
          ? [
              [1, most],
              [1, most],
            ]
          : [
              [0, Number.POSITIVE_INFINITY],
              [0, Number.POSITIVE_INFINITY],
            ],
      );
      camera.config({ isRotate: !on });
      if (on && boundView(camera.view, bounds.aspect(), bounds.homeAspect())) {
        void scatterplot.set({ cameraView: camera.view });
      }
    },
  };
}

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
