// htmlwidgets binding for the embedding component. The bundled JS dependency
// (loaded first, see embedding.yaml) defines window.bioviz and registers the
// "embedding" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.bioviz.htmlwidget("embedding"));
