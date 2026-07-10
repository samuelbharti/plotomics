// htmlwidgets binding for the network component. The bundled JS dependency
// (loaded first, see network.yaml) defines window.plotomics and registers the
// "network" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("network"));
