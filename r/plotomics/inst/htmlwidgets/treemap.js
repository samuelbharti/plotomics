// htmlwidgets binding for the treemap component. The bundled JS dependency
// (loaded first, see treemap.yaml) defines window.plotomics and registers the
// "treemap" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("treemap"));
