import "./styles/globals.css"; // Tailwind + shadcn tokens — must load first.
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPersistedTimeout } from "./lib/requestTimeout";

// Re-apply the persisted request timeout to the backend, which resets to its
// default each launch. Fire-and-forget: it resolves well before the user picks
// a context and triggers the first capability call.
void applyPersistedTimeout();

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");
createRoot(container).render(<App />);
