import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./diary.css";

const root = document.getElementById("diary-root");

if (!root) {
  throw new Error("Diary root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
