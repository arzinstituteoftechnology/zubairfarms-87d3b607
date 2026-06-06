import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { applyPrintSettings } from "./lib/printSettings";

applyPrintSettings();

createRoot(document.getElementById("root")!).render(<App />);
