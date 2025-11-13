import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { SSEProvider } from "./providers/SSEProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SSEProvider>
      <App />
    </SSEProvider>
  </StrictMode>
);
