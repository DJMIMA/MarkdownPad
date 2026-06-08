import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const isPrintRoute = new URLSearchParams(window.location.search).has("print");

// Split the editor and the print preview into separate chunks so each window
// only downloads and parses the code it actually needs. The editor window
// never loads the markdown-it/DOMPurify print renderer, and the print window
// never loads CodeMirror.
if (isPrintRoute) {
  void import("./PrintPage").then(({ PrintPage }) => {
    root.render(<PrintPage />);
  });
} else {
  void import("./App").then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
