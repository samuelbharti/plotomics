# plotomics · classic R Shiny gallery
#
# Demonstrates the plotomics htmlwidgets in a plain Shiny app. Each tab wires a
# component's `<name>Output()` / `render<Name>()` bindings to reactive controls
# on the server. This is the *classic* htmlwidgets path — distinct from the
# React-frontend example in ../shiny-react-embedding.
#
# Run (from the repo root, after building the JS once):
#   pnpm dist                    # or: build plotomics + node scripts/sync-assets.mjs
#   Rscript -e "shiny::runApp('examples/r-shiny', port = 8001)"

library(shiny)

# Prefer an installed plotomics; otherwise load the source package in this repo.
if (requireNamespace("plotomics", quietly = TRUE)) {
  library(plotomics)
} else {
  pkgload::load_all(file.path("..", "..", "pkg-r"), quiet = TRUE)
}

set.seed(1)

# ---- fixed synthetic datasets (built once; the controls only tweak options) --

# Volcano: effect size (x = log2FC) vs significance (y = -log10 p).
.n <- 20000
.fc <- rnorm(.n, sd = 2.2)
volcano_df <- data.frame(
  x = .fc,
  y = pmax(0, abs(.fc) * 0.9 + rnorm(.n, sd = 1.2)),
  label = paste0("GENE", seq_len(.n))
)

# Embedding: 6 gaussian blobs on a ring, with a categorical cluster label and a
# continuous value so both coloring modes can be shown.
.ne <- 8000
.k <- 6
.cl <- sample(.k, .ne, replace = TRUE)
embedding_df <- data.frame(
  x = cos(2 * pi * .cl / .k) * 6 + rnorm(.ne, sd = 1.2),
  y = sin(2 * pi * .cl / .k) * 6 + rnorm(.ne, sd = 1.2),
  cluster = paste("cluster", .cl),
  value = .cl + rnorm(.ne, sd = 0.4),
  label = paste0("cell", seq_len(.ne))
)

# Heatmap: genes x samples with a raised block diagonal + noise.
.nr <- 200
.nc <- 80
.blk <- 5
.rb <- floor((seq_len(.nr) - 1) / .nr * .blk)
.cb <- floor((seq_len(.nc) - 1) / .nc * .blk)
heatmap_mat <- outer(.rb, .cb, function(a, b) ifelse(a == b, 2.5, 0)) +
  matrix(rnorm(.nr * .nc), .nr, .nc)
rownames(heatmap_mat) <- paste0("gene", seq_len(.nr))
colnames(heatmap_mat) <- paste0("S", seq_len(.nc))

# Network: communities with dense intra- / sparse inter-community edges.
.nn <- 1500
.comm <- 6
.grp <- sample(.comm, .nn, replace = TRUE)
.ids <- paste0("N", seq_len(.nn))
net_nodes <- data.frame(
  id = .ids, size = runif(.nn, 2, 8), group = paste("module", .grp)
)
.by <- split(seq_len(.nn), .grp)
.ei <- rep(seq_len(.nn), each = 3)
.ej <- vapply(.ei, function(i) {
  if (runif(1) < 0.05) {
    sample.int(.nn, 1)
  } else {
    peers <- .by[[as.character(.grp[i])]]
    peers[sample.int(length(peers), 1)]
  }
}, integer(1))
net_edges <- data.frame(source = .ids[.ei], target = .ids[.ej])
net_edges <- net_edges[net_edges$source != net_edges$target, ]

# Treemap: pathways -> genes hierarchy (flat id / parent / value / label).
.id <- "root"; .parent <- ""; .value <- 0; .lab <- "All pathways"
for (p in seq_len(10)) {
  pid <- paste0("P", p)
  .id <- c(.id, pid); .parent <- c(.parent, "root")
  .value <- c(.value, 0); .lab <- c(.lab, paste("Pathway", p))
  cnt <- max(1L, as.integer(round(300 * runif(1, 0.4, 1.6))))
  gid <- paste0("g", p, "_", seq_len(cnt))
  .id <- c(.id, gid); .parent <- c(.parent, rep(pid, cnt))
  .value <- c(.value, round(1 + runif(cnt)^3 * 400)); .lab <- c(.lab, gid)
}
tree_df <- data.frame(id = .id, parent = .parent, value = .value, label = .lab)

# ---- UI ----
side <- function(...) sidebarPanel(width = 3, ...)
main <- function(out) mainPanel(width = 9, out)

ui <- navbarPage(
  "plotomics · R Shiny gallery",
  tabPanel(
    "Volcano",
    sidebarLayout(
      side(
        sliderInput("v_fc", "|log2FC| threshold", 0, 4, 1, 0.1),
        sliderInput("v_p", "p-value threshold", 0.001, 0.1, 0.05, 0.001),
        sliderInput("v_top", "Label top N", 0, 30, 8, 1)
      ),
      main(volcanoOutput("volcano", height = "640px"))
    )
  ),
  tabPanel(
    "Embedding",
    sidebarLayout(
      side(
        radioButtons("e_by", "Color by",
          c("Cluster (categorical)" = "cluster", "Value (continuous)" = "value")),
        radioButtons("e_mode", "Drag mode",
          c("Pan / zoom" = "panZoom", "Lasso select" = "lasso")),
        sliderInput("e_ps", "Point size", 1, 8, 3, 0.5),
        checkboxInput("e_leg", "Show legend", TRUE),
        hr(),
        strong("Lasso selection (server-side)"),
        textOutput("emb_sel")
      ),
      main(embeddingOutput("embedding", height = "600px"))
    )
  ),
  tabPanel(
    "Heatmap",
    sidebarLayout(
      side(
        selectInput("h_cm", "Colormap", c("viridis", "rdbu")),
        checkboxInput("h_z", "Row z-score", FALSE)
      ),
      main(bioheatmapOutput("heatmap", height = "640px"))
    )
  ),
  tabPanel(
    "Network",
    sidebarLayout(
      side(
        sliderInput("n_it", "Layout iterations", 0, 400, 200, 20),
        sliderInput("n_lbl", "Label threshold", 0, 20, 8, 1)
      ),
      main(networkOutput("network", height = "640px"))
    )
  ),
  tabPanel(
    "Treemap",
    sidebarLayout(
      side(
        selectInput("t_tile", "Tiling", c("squarify", "binary")),
        selectInput("t_by", "Color by", c("parent", "value"))
      ),
      main(treemapOutput("treemap", height = "640px"))
    )
  )
)

# ---- server: each render regenerates its widget when a control changes ----
server <- function(input, output, session) {
  output$volcano <- renderVolcano(
    volcano(volcano_df,
      fc_threshold = input$v_fc, p_threshold = input$v_p,
      label_top_n = input$v_top)
  )

  output$embedding <- renderEmbedding({
    df <- embedding_df
    df$color <- if (input$e_by == "value") embedding_df$value else embedding_df$cluster
    embedding(df,
      point_size = input$e_ps, show_legend = input$e_leg,
      mouse_mode = input$e_mode)
  })

  # Lasso selection travels back from the widget as input$<outputId>_selected.
  output$emb_sel <- renderText({
    idx <- input$embedding_selected
    if (is.null(idx) || length(idx) == 0) {
      "none yet - switch Drag mode to Lasso and drag across points"
    } else {
      sprintf("%d point(s) selected", length(idx))
    }
  })

  output$heatmap <- renderBioheatmap(
    bioheatmap(heatmap_mat, colormap = input$h_cm, z_score = input$h_z)
  )

  output$network <- renderNetwork(
    network(net_nodes, net_edges,
      iterations = input$n_it, label_threshold = input$n_lbl)
  )

  output$treemap <- renderTreemap(
    treemap(tree_df, tile = input$t_tile, color_by = input$t_by)
  )
}

shinyApp(ui, server)
