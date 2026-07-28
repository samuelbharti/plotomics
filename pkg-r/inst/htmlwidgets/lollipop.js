// htmlwidgets binding for the lollipop component. The bundled JS dependency
// (loaded first, see lollipop.yaml) defines window.plotomics and registers the
// "lollipop" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("lollipop"));
