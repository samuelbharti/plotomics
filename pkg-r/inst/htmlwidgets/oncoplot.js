// htmlwidgets binding for the oncoplot component. The bundled JS dependency
// (loaded first, see oncoplot.yaml) defines window.plotomics and registers the
// "oncoplot" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("oncoplot"));
