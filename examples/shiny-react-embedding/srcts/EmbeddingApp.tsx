import { useMemo } from "react";
import { useShinyInput, useShinyOutput } from "@posit/shiny-react";
import type { BiovizData } from "@bioviz/core";
import Embedding from "./Embedding";

/**
 * Column payload the R server sends via `render_json("embedding_data", ...)`.
 * shiny-react serializes an R data frame / named list column-major, which is
 * exactly the shape bioviz's `BiovizData.columns` expects — no reshaping beyond
 * wrapping it in `{ columns }`.
 */
type Cols = {
  x: number[];
  y: number[];
  color?: (string | number)[];
  label?: string[];
};

export default function EmbeddingApp() {
  // Data DOWN: a Shiny output → React.
  const [cols] = useShinyOutput<Cols | undefined>("embedding_data", undefined);
  // Selection UP: React → a Shiny input (0-based lasso indices, debounced).
  const [, setSelected] = useShinyInput<number[]>("embedding_selected", []);
  // Derived value DOWN: the server echoes how many points it received.
  const [nSelected] = useShinyOutput<number>("n_selected", 0);

  const data: BiovizData = useMemo(
    () => (cols ? { columns: cols } : { columns: { x: [], y: [] } }),
    [cols],
  );

  return (
    <div className="app">
      <h1>bioviz embedding · shiny-react</h1>
      <p className="hint">
        A UMAP/t-SNE-style viewer rendered by <code>@bioviz/components</code>,
        driven entirely through Shiny hooks. Drag a lasso from empty space to
        select cells — the indices are sent to the R server, which echoes the
        count back.
      </p>
      <Embedding
        data={data}
        options={{ colorMode: "categorical", pointSize: 3 }}
        onSelect={setSelected}
      />
      <div className="status">
        Server received <b>{nSelected}</b> selected point(s).
      </div>
    </div>
  );
}
