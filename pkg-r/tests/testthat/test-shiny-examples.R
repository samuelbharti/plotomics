# The Shiny examples in the help pages sit inside `if (interactive())`, so
# R CMD check never runs them. These tests run the code inside each one
# outside Shiny: every render function is swapped for one that returns the
# widget it is given, and the app is never started. A change to a function
# signature then fails here and not in a user's app.

skip_if_not_installed("shiny")

# The help pages of the source tree under devtools::load_all(), and those of
# the installed package under R CMD check.
help_pages <- function() {
  root <- test_path("..", "..")
  if (file.exists(file.path(root, "DESCRIPTION")) &&
      dir.exists(file.path(root, "man"))) {
    tools::Rd_db(dir = root)
  } else {
    tools::Rd_db("plotomics")
  }
}

example_code <- function(rd) {
  path <- tempfile(fileext = ".R")
  on.exit(unlink(path))
  tools::Rd2ex(rd, path)
  if (!file.exists(path)) {
    return(list())
  }
  as.list(parse(path, keep.source = FALSE))
}

is_shiny_block <- function(e) {
  is.call(e) && identical(e[[1]], as.name("if")) &&
    "interactive" %in% all.names(e[[2]])
}

is_app_start <- function(e) {
  is.call(e) && (identical(e[[1]], quote(shinyApp)) ||
                   identical(e[[1]], quote(shiny::shinyApp)))
}

render_fns <- grep("^render", getNamespaceExports("plotomics"), value = TRUE)

# Runs the body of one example: its data, `ui` and `server`, then calls
# `server()` with a plain environment as `output`. Returns the page HTML and
# the widgets the server assigned, named by output id.
build_shiny_example <- function(block) {
  env <- new.env(parent = globalenv())
  for (fn in render_fns) {
    assign(fn, function(expr, ...) expr, envir = env)
  }
  for (e in as.list(block[[3]])[-1]) {
    if (!is_app_start(e)) eval(e, env)
  }
  output <- new.env()
  env$server(input = list(), output = output)
  list(html = as.character(env$ui), widgets = as.list(output))
}

pages <- help_pages()
skip_if(length(pages) == 0L, "the package was installed without help pages")
shiny_examples <- list()
for (topic in names(pages)) {
  for (block in Filter(is_shiny_block, example_code(pages[[topic]]))) {
    shiny_examples[[length(shiny_examples) + 1L]] <-
      list(topic = topic, block = block)
  }
}

for (ex in shiny_examples) {
  test_that(sprintf("the Shiny example in %s builds its widget", ex$topic), {
    # An example that warns teaches a call that needs fixing.
    expect_no_warning(app <- build_shiny_example(ex$block))
    expect_gt(length(app$widgets), 0L)
    for (id in names(app$widgets)) {
      w <- app$widgets[[id]]
      expect_s3_class(w, "htmlwidget")
      # The page holds an output for this id, made for the same component.
      tag <- regmatches(
        app$html,
        regexpr(sprintf('<[^>]*id="%s"[^>]*>', id), app$html)
      )
      expect_length(tag, 1L)
      expect_match(tag, sprintf('class="%s html-widget', class(w)[1]),
                   fixed = TRUE)
    }
  })
}

test_that("every render function has a Shiny example", {
  used <- unique(unlist(lapply(shiny_examples, function(ex) {
    all.names(ex$block)
  })))
  expect_equal(setdiff(render_fns, used), character(0))
})
