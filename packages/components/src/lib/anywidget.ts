import { type BiovizFactory, downloadBlob } from "@bioviz/core";
import { decodeModelData } from "./decode-model.js";

/**
 * Wraps a headless component {@link BiovizFactory} into the object anywidget
 * expects (`{ render }`). Every Python component ships an entry that is one
 * line: `export default makeAnywidget(createX);`
 *
 * Trait contract (Python side mirrors these names):
 *   - `data`    Dict  : { columns?: {strCol: string[]}, meta?: {...} }
 *   - `buffer`  Bytes : packed numeric columns (optional, fast path)
 *   - `schema`  Dict  : BufferSchema describing `buffer` (optional)
 *   - `options` Dict  : component options
 *   - `_height` Int   : initial height hint in CSS px
 */
export function makeAnywidget<O>(factory: BiovizFactory<O>) {
  return {
    render({ model, el }: { model: AnyModel; el: HTMLElement }) {
      const host = document.createElement("div");
      const height = (model.get("_height") as number) || 480;
      host.style.cssText = `position:relative;width:100%;height:${height}px;`;
      el.appendChild(host);

      const readData = () =>
        decodeModelData({
          buffer: model.get("buffer") as DataView | null,
          schema: model.get("schema") as never,
          data: model.get("data") as never,
        });

      // JS -> Python: report the current lasso selection into the `selected`
      // trait. Merged into options; components without onSelect ignore the key.
      const onSelect = (indices: number[]) => {
        model.set("selected", indices);
        model.save_changes();
      };
      const readOptions = () =>
        ({ ...((model.get("options") as Partial<O>) ?? {}), onSelect }) as Partial<O>;

      const inst = factory(host, { data: readData(), options: readOptions() });

      const onData = () => inst.setData(readData());
      const onBuffer = () => inst.setData(readData());
      const onOptions = () => inst.setOptions(readOptions());
      model.on("change:data", onData);
      model.on("change:buffer", onBuffer);
      model.on("change:options", onOptions);

      // Python -> JS: `widget.export("svg"|"png")` posts a custom message; we
      // render the current view and trigger a browser download (reusing the
      // BiovizInstance export methods). Nothing returns to Python — the figure
      // is produced client-side.
      const onMsg = (msg: unknown) => {
        const m = msg as { bioviz?: string; format?: string } | null;
        if (!m || m.bioviz !== "export") return;
        // One model can drive several views (e.g. the widget shown in two
        // notebook cells) and the custom message reaches every view. A shared
        // per-tick lock keeps exactly one view from firing N duplicate
        // downloads; the microtask clears it after this synchronous dispatch.
        const lock = model as unknown as { __biovizExporting?: boolean };
        if (lock.__biovizExporting) return;
        lock.__biovizExporting = true;
        queueMicrotask(() => {
          lock.__biovizExporting = false;
        });
        if (m.format === "svg") {
          const svg = inst.exportSVG?.();
          if (svg) downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "bioviz.svg");
          else console.warn("bioviz: this component does not support SVG export");
        } else {
          const png = inst.exportPNG?.(2);
          if (png) png.then((blob) => blob && downloadBlob(blob, "bioviz.png")).catch(() => {});
          else console.warn("bioviz: this component does not support PNG export");
        }
      };
      model.on("msg:custom", onMsg);

      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r && r.width > 0) inst.resize(r.width, r.height || height);
      });
      ro.observe(host);

      // anywidget calls the returned function on teardown / re-render.
      return () => {
        ro.disconnect();
        model.off("change:data", onData);
        model.off("change:buffer", onBuffer);
        model.off("change:options", onOptions);
        model.off("msg:custom", onMsg);
        inst.destroy();
      };
    },
  };
}

/** Minimal slice of the anywidget/Backbone model surface we rely on. */
export interface AnyModel {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  save_changes(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
}
