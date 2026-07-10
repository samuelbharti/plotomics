// htmlwidgets binding for the volcano component. The bundled JS dependency
// (loaded first, see volcano.yaml) defines window.plotomics and registers the
// "volcano" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("volcano"));
