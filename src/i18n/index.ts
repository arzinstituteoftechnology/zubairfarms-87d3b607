import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ur from "./ur.json";

export const SUPPORTED = ["en", "ur"] as const;
export type Lang = (typeof SUPPORTED)[number];

const stored = (typeof window !== "undefined" && (localStorage.getItem("lang") as Lang)) || "en";
const initial: Lang = SUPPORTED.includes(stored as Lang) ? (stored as Lang) : "en";

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ur: { translation: ur } },
  lng: initial,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export const applyLangToDocument = (lang: Lang) => {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ur" ? "rtl" : "ltr";
  document.documentElement.classList.toggle("lang-ur", lang === "ur");
};

applyLangToDocument(initial);

export const setLang = (lang: Lang) => {
  localStorage.setItem("lang", lang);
  i18n.changeLanguage(lang);
  applyLangToDocument(lang);
};

export default i18n;