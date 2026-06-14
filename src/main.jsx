import React from "react";
import ReactDOM from "react-dom/client";
import App, { OverlayBubble } from "./App.jsx";
import "./index.css";

// The Tauri overlay window loads index.html#overlay and renders only the bubble.
const isOverlay = window.location.hash === "#overlay";
if (isOverlay) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}

ReactDOM.createRoot(document.getElementById("root")).render(
  isOverlay ? (
    <OverlayBubble />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
);
