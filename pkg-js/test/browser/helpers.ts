import { page } from "vitest/browser";

/** A sized element in the page for a component to mount into. */
export function mountPoint(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "width:800px;height:300px;";
  document.body.appendChild(el);
  return el;
}

/**
 * The first canvas in an element as a PNG, without the SVG overlay that
 * `exportPNG` draws over it. Tests that measure the marks read this.
 */
export function canvasPNG(el: HTMLElement): Promise<Blob | null> {
  const canvas = el.querySelector("canvas");
  if (!canvas) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** The pixels of a PNG, and its most common colour, taken as background. */
async function readPixels(png: Blob) {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pixels = new Uint32Array(
    ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer,
  );
  const counts = new Map<number, number>();
  for (const p of pixels) counts.set(p, (counts.get(p) ?? 0) + 1);
  let background = 0;
  let backgroundCount = 0;
  for (const [colour, n] of counts) {
    if (n > backgroundCount) [background, backgroundCount] = [colour, n];
  }
  return { pixels, width: canvas.width, height: canvas.height, background };
}

/**
 * Count the pixels in a PNG that differ from its most common colour.
 *
 * The most common colour is taken as the background. A canvas that holds only
 * the background, with no marks drawn on it, returns 0.
 */
export async function drawnPixels(png: Blob): Promise<number> {
  const { pixels, background } = await readPixels(png);
  let drawn = 0;
  for (const p of pixels) if (p !== background) drawn += 1;
  return drawn;
}

/** Where the marks in a PNG sit: edges as fractions of the image, and size. */
export interface MarkBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  widthPx: number;
  heightPx: number;
}

/** The box around every pixel that is not background, or null if none. */
export async function markBox(png: Blob): Promise<MarkBox | null> {
  const { pixels, width, height, background } = await readPixels(png);
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x] === background) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return {
    left: x0 / width,
    right: (x1 + 1) / width,
    top: y0 / height,
    bottom: (y1 + 1) / height,
    widthPx: x1 + 1 - x0,
    heightPx: y1 + 1 - y0,
  };
}

/**
 * Record the URLs that the page requests through fetch and XMLHttpRequest.
 *
 * `external()` returns the ones that leave the test server. A smoke test that
 * depends on a public host fails when that host is down, so each test asserts
 * that this list is empty.
 *
 * The record covers fetch and XMLHttpRequest on the main thread, up to the
 * moment `external()` is called. It does not see requests from a Web Worker,
 * from an img, script or link element, or over a WebSocket. Call `restore()`
 * when the test ends.
 */
export function trackRequests(): {
  external(): string[];
  restore(): void;
} {
  const seen: string[] = [];
  const realFetch = window.fetch;
  const realOpen = XMLHttpRequest.prototype.open;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return realFetch.call(window, input, init);
  };
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof realOpen>
  ) {
    seen.push(String(args[1]));
    return realOpen.apply(this, args);
  } as typeof realOpen;

  const isLocal = (url: string) =>
    new URL(url, location.href).origin === location.origin ||
    url.startsWith("blob:") ||
    url.startsWith("data:");

  return {
    external: () => seen.filter((url) => !isLocal(url)),
    restore() {
      window.fetch = realFetch;
      XMLHttpRequest.prototype.open = realOpen;
    },
  };
}

/**
 * Inline backgrounds a host element can have, each set the way a page
 * script sets it. The last one gives a var() shorthand and then a colour,
 * which the browser keeps but reads back as empty text for each part.
 */
export const HOST_BACKGROUNDS: [string, (el: HTMLElement) => void][] = [
  [
    "a gradient",
    (el) => {
      el.style.background = "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))";
    },
  ],
  [
    "a var() shorthand",
    (el) => {
      el.style.setProperty("--host-bg", "linear-gradient(red, blue)");
      el.style.background = "var(--host-bg)";
    },
  ],
  [
    "a var() shorthand and a colour",
    (el) => {
      el.style.setProperty("--host-bg", "linear-gradient(red, blue)");
      el.style.background = "var(--host-bg)";
      el.style.backgroundColor = "rgb(7, 8, 9)";
    },
  ],
];

/**
 * How many pixels of the element on screen are strongly red or strongly
 * blue, as the red to blue gradients of {@link HOST_BACKGROUNDS} paint.
 */
export async function gradientPixels(el: HTMLElement): Promise<number> {
  const shot = await page.screenshot({ element: el, save: false });
  const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs((d[i] as number) - (d[i + 2] as number)) > 100) n += 1;
  }
  return n;
}
