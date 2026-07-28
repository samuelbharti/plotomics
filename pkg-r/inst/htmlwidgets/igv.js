// htmlwidgets binding for the igv (genome viewer) component. The bundled JS
// dependency (loaded first, see igv.yaml) defines window.plotomics and registers
// the "igv" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("igv"));
