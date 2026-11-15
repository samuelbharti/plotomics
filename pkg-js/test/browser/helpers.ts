/** A sized element in the page for a component to mount into. */
export function mountPoint(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "width:800px;height:300px;";
  document.body.appendChild(el);
  return el;
}

/**
 * Record the URLs that the page requests through fetch and XMLHttpRequest.
 *
 * `external()` returns the ones that leave the test server. A smoke test that
 * depends on a public host fails when that host is down, so each test asserts
 * that this list is empty. Call `restore()` when the test ends.
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
