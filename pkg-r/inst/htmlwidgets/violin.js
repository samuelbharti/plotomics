// htmlwidgets binding for the violin component. The bundled JS dependency
// (loaded first, see violin.yaml) defines window.plotomics and registers the
// "violin" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("violin"));
