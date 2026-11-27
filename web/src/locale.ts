/** @file The interface language of this device; song titles and other Library data stay as written. */

import { createInstance } from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { useSyncExternalStore } from "react";

import zh from "./locales/zh-Hans.json";

export type Language = "en" | "zh-Hans";
export type LanguageChoice = Language | "auto";
const KEY = "medleyplay.language";
const valid = (value: string | null): LanguageChoice =>
  value === "zh-Hans" || value === "en" ? value : "auto";

function saved(): LanguageChoice {
  try {
    return valid(localStorage.getItem(KEY));
  } catch {
    return "auto";
  }
}

function supportedLanguage(tag: string): Language | undefined {
  try {
    const locale = new Intl.Locale(tag).maximize();
    if (locale.language === "zh" && locale.script === "Hans") return "zh-Hans";
    if (locale.language === "en") return "en";
  } catch {
    return undefined;
  }
  return undefined;
}

export function browserLanguage(languages: readonly string[]): Language {
  for (const tag of languages) {
    const language = supportedLanguage(tag);
    if (language !== undefined) return language;
  }
  return "en";
}

let choice = saved();
const listeners = new Set<() => void>();
const effective = () => (choice === "auto" ? browserLanguage(navigator.languages) : choice);
const words = createInstance();
void words.use(initReactI18next).init({
  lng: effective(),
  initAsync: false,
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  resources: {
    en: {
      translation: {
        downloading_one: "{{count}} song downloading",
        downloading_other: "{{count}} songs downloading",
        devices_waiting_one: "{{count}} device waiting",
        devices_waiting_other: "{{count}} devices waiting",
        song_count_one: "{{count}} song",
        song_count_other: "{{count}} songs",
        album_count_one: "{{count}} album",
        album_count_other: "{{count}} albums",
        star_count_one: "{{count}} star",
        star_count_other: "{{count}} stars",
        add_to_playlists_one: "Add to {{count}} playlist",
        add_to_playlists_other: "Add to {{count}} playlists",
        hour_count_one: "{{count}} hour",
        hour_count_other: "{{count}} hours",
        minute_count_one: "{{count}} minute",
        minute_count_other: "{{count}} minutes",
        radio_favorites_one: "Your {{count}} favorite song, every one before any again.",
        radio_favorites_other: "Your {{count}} favorite songs, every one before any again.",
        removed_managed_files_one: "{{count}} managed file removed",
        removed_managed_files_other: "{{count}} managed files removed",
        started_downloads_one: "{{count}} download started",
        started_downloads_other: "{{count}} downloads started",
        download_size_one: "{{count}} download ({{size}})",
        download_size_other: "{{count}} downloads ({{size}})",
        copy_size_one: "{{count}} prepared copy ({{size}})",
        copy_size_other: "{{count}} prepared copies ({{size}})",
        video_details_eligible_one: "{{count}} Track can have its details found.",
        video_details_eligible_other: "{{count}} Tracks can have their details found.",
        musicbrainz_eligible_one: "{{count}} Track can be found on MusicBrainz.",
        musicbrainz_eligible_other: "{{count}} Tracks can be found on MusicBrainz.",
        lyrics_eligible_one: "{{count}} song's lyrics can be looked up.",
        lyrics_eligible_other: "{{count}} songs' lyrics can be looked up.",
        ai_details_eligible_one: "{{count}} Track can be given suggestions.",
        ai_details_eligible_other: "{{count}} Tracks can be given suggestions.",
      },
    },
    "zh-Hans": { translation: zh },
  },
  interpolation: { escapeValue: false },
});

function apply(): void {
  const language = effective();
  document.documentElement.lang = language;
  void words.changeLanguage(language);
  for (const listener of listeners) listener();
}

export function followDeviceLanguage(): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) {
      choice = saved();
      apply();
    }
  };
  window.addEventListener("storage", storage);
  window.addEventListener("languagechange", apply);
  apply();
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("languagechange", apply);
  };
}

function choose(next: LanguageChoice) {
  choice = next;
  try {
    if (next === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // The choice still applies to this tab when storage is unavailable.
  }
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLanguageChoice() {
  return [useSyncExternalStore(subscribe, () => choice), choose] as const;
}

export function useFormattingLocale(): string {
  return useSyncExternalStore(subscribe, () => {
    const language = effective();
    return navigator.languages.find((tag) => supportedLanguage(tag) === language) ?? language;
  });
}

export function useWords() {
  return useTranslation("translation", { i18n: words }).t;
}

export const simplifiedChineseWords = words.getFixedT("zh-Hans", "translation");

export type Words = ReturnType<typeof useWords>;
