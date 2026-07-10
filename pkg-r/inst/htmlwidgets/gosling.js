// htmlwidgets binding for the gosling component. The bundled JS dependency
// (loaded first, see gosling.yaml) defines window.plotomics and registers the
// "gosling" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("gosling"));
