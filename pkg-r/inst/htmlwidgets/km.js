// htmlwidgets binding for the km component. The bundled JS dependency (loaded
// first, see km.yaml) defines window.plotomics and registers the "km" factory;
// this binding just hands htmlwidgets the standard renderValue/resize object
// built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("km"));
