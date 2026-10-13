import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApi } from "./api/client.js";
import { App } from "./App.js";
import "./styles.css";

// Punkt wejscia: prawdziwy fetch i EventSource. Logika i widoki maja testy z atrapami.
const root = document.getElementById("root");
if (root === null) throw new Error("Brak elementu #root");

const api = createApi((input, init) => fetch(input, init));
const sources = (url: string) => new EventSource(url);

createRoot(root).render(
  <StrictMode>
    <App api={api} sources={sources} />
  </StrictMode>,
);
