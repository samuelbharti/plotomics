import {
  type PlotomicsFactory,
  autoResize,
  downloadBlob,
} from "../core/index.js";
import { decodeModelData } from "./decode-model.js";
import { dropsOptionKeys } from "./rerender.js";

/**
 * Wraps a headless component {@link PlotomicsFactory} into the object anywidget
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
export function makeAnywidget<O>(factory: PlotomicsFactory<O>) {
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
        ({
          ...((model.get("options") as Partial<O>) ?? {}),
          onSelect,
        }) as Partial<O>;

      let inst = factory(host, { data: readData(), options: readOptions() });
      let lastOptions: unknown = model.get("options");

      // `buffer` and `schema` describe one dataset together, and `data`
      // carries its text columns. Python can send them in one message or
      // one at a time, so a change to any of the three draws the data
      // again: once per message, after all of its changes have landed, and
      // again when a schema arrives after its buffer.
      let pending = false;
      let closed = false;
      const onData = () => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => {
          pending = false;
          if (!closed) inst.setData(readData());
        });
      };
      const onOptions = () => {
        const sent = model.get("options");
        // A key removed from the Python `options` dict would keep its old
        // value under a merge, so build the component again instead.
        if (dropsOptionKeys(lastOptions, sent)) {
          inst.destroy();
          inst = factory(host, { data: readData(), options: readOptions() });
          // The new instance starts with nothing selected; say so in Python:
          // [] after a lasso selection, None after a clicked node.
          const selected = model.get("selected");
          if (
            Array.isArray(selected) ? selected.length > 0 : selected != null
          ) {
            model.set("selected", Array.isArray(selected) ? [] : null);
            model.save_changes();
          }
        } else {
          inst.setOptions(readOptions());
        }
        lastOptions = sent;
      };
      model.on("change:data", onData);
      model.on("change:buffer", onData);
      model.on("change:schema", onData);
      model.on("change:options", onOptions);

      // Python -> JS: `widget.export("svg"|"png")` posts a custom message; we
      // render the current view and trigger a browser download (reusing the
      // PlotomicsInstance export methods). Nothing returns to Python — the figure
      // is produced client-side.
      const onMsg = (msg: unknown) => {
        const m = msg as { plotomics?: string; format?: string } | null;
        if (!m || m.plotomics !== "export") return;
        // One model can drive several views (e.g. the widget shown in two
        // notebook cells) and the custom message reaches every view. A shared
        // per-tick lock keeps exactly one view from firing N duplicate
        // downloads; the microtask clears it after this synchronous dispatch.
        const lock = model as unknown as { __plotomicsExporting?: boolean };
        if (lock.__plotomicsExporting) return;
        lock.__plotomicsExporting = true;
        queueMicrotask(() => {
          lock.__plotomicsExporting = false;
        });
        if (m.format === "svg") {
          const svg = inst.exportSVG?.();
          if (svg)
            downloadBlob(
              new Blob([svg], { type: "image/svg+xml" }),
              "plotomics.svg",
            );
          else
            console.warn(
              "plotomics: this component does not support SVG export",
            );
        } else {
          const png = inst.exportPNG?.(2);
          if (png)
            png
              .then((blob) => blob && downloadBlob(blob, "plotomics.png"))
              .catch(() => {});
          else
            console.warn(
              "plotomics: this component does not support PNG export",
            );
        }
      };
      model.on("msg:custom", onMsg);

      // `inst` changes when the component is built again, so resize
      // whichever instance is current.
      const stopResize = autoResize(host, {
        resize: (w, h) => inst.resize(w, h),
      });

      // anywidget calls the returned function on teardown / re-render.
      return () => {
        closed = true;
        stopResize();
        model.off("change:data", onData);
        model.off("change:buffer", onData);
        model.off("change:schema", onData);
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
