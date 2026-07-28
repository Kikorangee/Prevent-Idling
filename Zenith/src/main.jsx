import { createRoot } from "react-dom/client";
import "@geotab/zenith/dist/index.css";
import App from "./App.jsx";

window.geotab = window.geotab || {};
window.geotab.addin = window.geotab.addin || {};

window.geotab.addin.idlingmonitor = function () {
  let root = null;
  let focusListener = null;

  return {
    initialize: function (api, state, callback) {
      const host = document.getElementById("idm-root");
      root = createRoot(host);
      root.render(<App api={api} registerFocus={(fn) => { focusListener = fn; }} />);
      callback();
    },
    focus: function (api) {
      if (focusListener) focusListener(api);
    },
    blur: function () {}
  };
};
