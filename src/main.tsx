import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { PrintPage } from "./PrintPage";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const isPrintRoute = new URLSearchParams(window.location.search).has("print");

root.render(
  isPrintRoute ? (
    <PrintPage />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ),
);
