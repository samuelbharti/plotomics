import { useEffect, useRef } from "react";
import {
  createEmbedding,
  type EmbeddingOptions,
} from "@plotomics/components/embedding";
import type { PlotomicsData } from "@plotomics/core";

type Instance = ReturnType<typeof createEmbedding>;

export interface EmbeddingProps {
  data: PlotomicsData;
  options?: Partial<EmbeddingOptions>;
  onSelect?: (indices: number[]) => void;
  /** CSS height. Defaults to "100%" so it fills a sized flex parent. */
  height?: number | string;
}

/**
 * Thin React wrapper around the headless `@plotomics/components` embedding factory.
 *
 * The factory owns the GPU canvas (regl-scatterplot) + the SVG legend overlay;
 * React only manages the container lifecycle and forwards prop changes through
 * the imperative `setData` / `setOptions` API — no re-mount, no GPU realloc.
 * This is the entire plotomics integration surface; nothing here is Shiny-aware,
 * which is why the same wrapper works in any React app.
 */
export default function Embedding({
  data,
  options,
  onSelect,
  height = "100%",
}: EmbeddingProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<Instance | null>(null);

  // Read onSelect through a ref so a changing callback identity does not tear
  // down and recreate the GPU instance.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!elRef.current) return;
    instRef.current = createEmbedding(elRef.current, {
      data,
      options: { ...options, onSelect: (idx) => onSelectRef.current?.(idx) },
    });
    return () => {
      instRef.current?.destroy();
      instRef.current = null;
    };
    // Create once; subsequent data/option changes are pushed imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    instRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    if (options) instRef.current?.setOptions(options);
  }, [options]);

  return <div ref={elRef} style={{ width: "100%", height }} />;
}
