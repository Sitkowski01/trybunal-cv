import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApi } from "./api/client.js";
import { App } from "./App.js";
import { readRecording } from "./demo/recording.js";
import { createReplay, speedFromSearch } from "./demo/replay.js";
import { detectSceneSupport } from "./scene/support.js";
import "./styles.css";

// Punkt wejscia: prawdziwy fetch i EventSource albo (build --mode demo) odtwarzanie nagrania.
// Logika i widoki maja testy z atrapami.
const root = document.getElementById("root");
if (root === null) throw new Error("Brak elementu #root");

const demo = import.meta.env.MODE === "demo";
// Nagranie trafia tylko do paczki demo: w zwyklym buildzie ta galaz znika razem z importem.
const { api, sources } = demo
  ? createReplay(readRecording((await import("./demo/recording.sse?raw")).default), speedFromSearch(window.location.search))
  : { api: createApi((input, init) => fetch(input, init)), sources: (url: string) => new EventSource(url) };
const scene = detectSceneSupport(window);

createRoot(root).render(
  <StrictMode>
    <App api={api} sources={sources} scene={scene} demo={demo} />
  </StrictMode>,
);
