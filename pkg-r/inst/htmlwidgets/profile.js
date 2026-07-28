// htmlwidgets binding for the profile component. The bundled JS dependency
// (loaded first, see profile.yaml) defines window.plotomics and registers the
// "profile" factory; this binding just hands htmlwidgets the standard
// renderValue/resize object built by the shared runtime.
HTMLWidgets.widget(window.plotomics.htmlwidget("profile"));
