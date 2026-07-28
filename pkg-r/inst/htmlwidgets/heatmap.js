// htmlwidgets binding for the heatmap component. The bundled JS dependency
// (loaded first, see heatmap.yaml) defines window.plotomics and registers the
// "heatmap" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("heatmap"));
