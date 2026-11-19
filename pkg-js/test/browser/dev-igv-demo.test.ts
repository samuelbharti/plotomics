import { afterEach, describe, expect, it } from "vitest";
import { igvDemoOptions } from "../../dev/demo-data.js";
import { createIgv } from "../../src/components/igv.js";
import { mountPoint, trackRequests } from "./helpers.js";

describe("dev harness igv demo", () => {
  let requests: ReturnType<typeof trackRequests> | undefined;
  let destroy: (() => void) | undefined;

  afterEach(() => {
    destroy?.();
    requests?.restore();
    document.body.replaceChildren();
  });

  it("shows its reference and both tracks without the network", async () => {
    requests = trackRequests();
    const el = mountPoint();
    const instance = createIgv(el, { options: igvDemoOptions });
    destroy = () => instance.destroy();
    const svg = () => instance.exportSVG?.() ?? "";

    // A track name appears in the export once igv.js has added the track.
    for (const name of ["genes (synthetic)", "signal (synthetic)"]) {
      await expect
        .poll(() => svg().includes(name), { timeout: 30_000, interval: 250 })
        .toBe(true);
    }
    expect(requests.external()).toEqual([]);
  });
});
