import type { BiovizFactory } from "@bioviz/core";
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

      const inst = factory(host, {
        data: readData(),
        options: (model.get("options") as Partial<O>) ?? {},
      });

      const onData = () => inst.setData(readData());
      const onBuffer = () => inst.setData(readData());
      const onOptions = () => inst.setOptions((model.get("options") as Partial<O>) ?? {});
      model.on("change:data", onData);
      model.on("change:buffer", onBuffer);
      model.on("change:options", onOptions);

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
  on(event: string, cb: () => void): void;
  off(event: string, cb: () => void): void;
}
