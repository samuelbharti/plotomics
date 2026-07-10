library(shiny)

# page_react() and render_json() helpers (vendored from wch/shiny-react, MIT).
source("shinyreact.R", local = TRUE)

# A synthetic 2-D embedding: `k` gaussian blobs on a ring, each point tagged
# with a categorical cluster label. In a real app this is your UMAP/t-SNE/PCA
# result. NOTE: this travels to the browser as JSON over Shiny's websocket, so
# for very large embeddings prefer sending fewer columns / downsampling, or a
# URL the client fetches as a binary blob — the JSON channel is the one place
# React-in-Shiny gives up plotomics's binary (anywidget) transport.
make_embedding <- function(n = 4000, k = 6) {
  cl <- sample(k, n, replace = TRUE)
  cx <- cos(2 * pi * cl / k) * 6
  cy <- sin(2 * pi * cl / k) * 6
  list(
    x = cx + rnorm(n, sd = 1.2),
    y = cy + rnorm(n, sd = 1.2),
    color = paste("cluster", cl),          # character -> categorical coloring
    label = paste0("cell ", seq_len(n))
  )
}

server <- function(input, output, session) {
  emb <- make_embedding(n = 10000, k = 7)

  # Data DOWN to React (column-major JSON -> plotomics `columns`).
  output$embedding_data <- render_json(emb)

  # Selection UP from React: input$embedding_selected is an integer vector of
  # **0-based** point indices from the lasso (JS indexing). Add 1L before using
  # it to subset R vectors. Here we just echo the count back DOWN.
  output$n_selected <- render_json({
    length(input$embedding_selected)
  })

  observeEvent(input$embedding_selected, {
    idx <- input$embedding_selected
    message(sprintf("Lasso selected %d point(s)", length(idx)))
    # e.g. selected_df <- as.data.frame(emb)[idx + 1L, ]
  })
}

# page_react() emits <head> script/style tags for r/www/main.{js,css} and the
# <div id="root"> that srcts/main.tsx mounts into. Shiny serves r/www/ as the
# app's static root.
shinyApp(ui = page_react(title = "plotomics x shiny-react"), server = server)
