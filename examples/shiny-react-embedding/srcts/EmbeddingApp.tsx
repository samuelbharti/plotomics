import { useMemo, useState } from "react";
import { useShinyInput, useShinyOutput } from "@posit/shiny-react";
import { darkTheme, type BiovizData } from "@bioviz/core";
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
  // Toggle the scatterplot's primary drag gesture between pan and lasso.
  const [lasso, setLasso] = useState(false);

  const data: BiovizData = useMemo(
    () => (cols ? { columns: cols } : { columns: { x: [], y: [] } }),
    [cols],
  );

  return (
    <div className="app">
      <header className="app-head">
        <div className="titles">
          <h1>bioviz embedding · shiny-react</h1>
          <p className="hint">
            A UMAP/t-SNE viewer from <code>@bioviz/components</code>, driven
            through Shiny hooks. Selection is sent to the R server.
          </p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className={`tool ${lasso ? "on" : ""}`}
            onClick={() => setLasso((v) => !v)}
            title="Toggle between panning and lasso selection"
          >
            {lasso ? "◈ Lasso ON — drag to select" : "⬚ Lasso OFF — drag pans"}
          </button>
          <span className="status">
            <b>{nSelected}</b> selected
          </span>
        </div>
      </header>
      <div className="viz">
        <Embedding
          data={data}
          options={{
            colorMode: "categorical",
            pointSize: 4,
            opacity: 0.9,
            theme: darkTheme,
            mouseMode: lasso ? "lasso" : "panZoom",
          }}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}
