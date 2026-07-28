// htmlwidgets binding for the upset component. The bundled JS dependency
// (loaded first, see upset.yaml) defines window.plotomics and registers the
// "upset" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("upset"));
