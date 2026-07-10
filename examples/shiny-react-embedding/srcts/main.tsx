import { createRoot } from "react-dom/client";
import EmbeddingApp from "./EmbeddingApp";
import "./styles.css";

// page_react() (see r/shinyreact.R) renders <div id="root"> and loads this
// bundle as <script type="module">. Mount the React app into it.
const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<EmbeddingApp />);
} else {
  console.error("shiny-react: #root element not found");
}
