// htmlwidgets binding for the dotplot component. The bundled JS dependency
// (loaded first, see dotplot.yaml) defines window.plotomics and registers the
// "dotplot" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("dotplot"));
