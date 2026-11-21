/**
 * @file Mounts the app into the page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@picocss/pico/css/pico.jade.min.css";

import { applyAccent, savedAccent } from "./accent";
import { App } from "./App";
import "./index.css";
import { applyTheme, savedTheme } from "./theme";
import { LazyPart } from "./views/LazyPart";

// Before the first render, so a chosen theme or accent never flashes the defaults.
applyTheme(savedTheme());
applyAccent(savedAccent());

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html must contain an element with id 'root'.");
}

// Anything the parts' own boundaries don't catch says so here, rather than emptying the page.
createRoot(root).render(
  <StrictMode>
    <LazyPart doing="medleyplay">
      <App />
    </LazyPart>
  </StrictMode>,
);
