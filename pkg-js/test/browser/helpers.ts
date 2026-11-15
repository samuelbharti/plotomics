/** A sized element in the page for a component to mount into. */
export function mountPoint(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "width:800px;height:300px;";
  document.body.appendChild(el);
  return el;
}

/**
 * Count the pixels in a PNG that differ from its most common colour.
 *
 * The most common colour is taken as the background. A canvas that holds only
 * the background, with no marks drawn on it, returns 0.
 */
export async function drawnPixels(png: Blob): Promise<number> {
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
  for (const n of counts.values()) background = Math.max(background, n);
  return pixels.length - background;
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
