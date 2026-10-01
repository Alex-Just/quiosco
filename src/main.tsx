import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { shouldReloadOnControllerChange } from "./lib/pwa";
import { isTranslationRunning } from "./lib/translateArticle";
import "./styles.css";

if (navigator.storage?.persist) {
  void navigator.storage.persist();
}

// Pick up new deploys without a manual relaunch: the new worker claims the
// page (skipWaiting + clientsClaim) and we reload onto the fresh build once.
const hadController = Boolean(navigator.serviceWorker?.controller);
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (shouldReloadOnControllerChange(hadController, isTranslationRunning())) {
    window.location.reload();
  }
});

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
