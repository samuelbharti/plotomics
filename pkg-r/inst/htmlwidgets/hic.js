// htmlwidgets binding for the hic component. The bundled JS dependency
// (loaded first, see hic.yaml) defines window.plotomics and registers the "hic"
// factory; this binding just hands htmlwidgets the standard renderValue/resize
// object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("hic"));
