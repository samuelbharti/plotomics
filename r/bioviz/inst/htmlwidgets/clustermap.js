// htmlwidgets binding for the clustermap component. The bundled JS dependency
// (loaded first, see clustermap.yaml) defines window.bioviz and registers the
// "clustermap" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.bioviz.htmlwidget("clustermap"));
