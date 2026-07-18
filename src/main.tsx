import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { applyPrintSettings } from "./lib/printSettings";
import { SplashScreen } from "./components/SplashScreen";

applyPrintSettings();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <SplashScreen />
    <App />
  </HelmetProvider>
);
