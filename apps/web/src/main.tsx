import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Punkt wejscia; widoki dojda w kolejnych krokach.
const root = document.getElementById("root");
if (root === null) throw new Error("Brak elementu #root");

createRoot(root).render(
  <StrictMode>
    <h1>Trybunał CV</h1>
  </StrictMode>,
);
