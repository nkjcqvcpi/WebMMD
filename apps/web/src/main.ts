// SPDX-License-Identifier: AGPL-3.0-or-later
import "./app/shell.js";

console.log("[WebMMD] Lit UI Application Initialized.");

if ("serviceWorker" in navigator && !navigator.webdriver) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log(
          "[WebMMD] ServiceWorker registration successful:",
          reg.scope,
        );
      })
      .catch((err) => {
        console.warn("[WebMMD] ServiceWorker registration failed:", err);
      });
  });
}
