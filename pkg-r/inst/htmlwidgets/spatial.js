// htmlwidgets binding for the spatial component. The bundled JS dependency
// (loaded first, see spatial.yaml) defines window.plotomics and registers the
// "spatial" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("spatial"));
