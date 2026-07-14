import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

export type LanguagePreference = "system" | "en-US" | "zh-CN";

const LANGUAGE_STORAGE_KEY = "lyrico.language";

const resources = {
  "en-US": { translation: enUS },
  "zh-CN": { translation: zhCN },
} as const;

export function getLanguagePreference(): LanguagePreference {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === "en-US" || stored === "zh-CN" || stored === "system" ? stored : "system";
}

export function resolveLanguage(preference: LanguagePreference) {
  const language = preference === "system" ? navigator.language : preference;
  return language.toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export async function setLanguagePreference(preference: LanguagePreference) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  await i18n.changeLanguage(resolveLanguage(preference));
}

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(getLanguagePreference()),
  fallbackLng: "en-US",
  interpolation: { escapeValue: false },
});

export default i18n;
