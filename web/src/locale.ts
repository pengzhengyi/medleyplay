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
        songs_filled_video_one: "{{count}} song from the video",
        songs_filled_video_other: "{{count}} songs from the video",
        songs_filled_list_one: "{{count}} song from the list",
        songs_filled_list_other: "{{count}} songs from the list",
        songs_filled_ai_one: "{{count}} song from {{model}}, starts estimated",
        songs_filled_ai_other: "{{count}} songs from {{model}}, starts estimated",
        songs_ai_answered_one: "{{model}} answered with {{count}} song: press AI to use it.",
        songs_ai_answered_other: "{{model}} answered with {{count}} songs: press AI to use them.",
        song_fill_artist_one: "Tab fills “{{artist}}” into the song with no artist",
        song_fill_artist_other: "Tab fills “{{artist}}” into the {{count}} songs with no artist",
        lyrics_unstamped_one: "{{count}} line isn't stamped yet.",
        lyrics_unstamped_other: "{{count}} lines aren't stamped yet.",
        album_edit_scope_one: "{{count}} song of its own. What you type here is set on it.",
        album_edit_scope_other:
          "{{count}} songs of their own. What you type here is set on each of them.",
        album_edit_saves_one: "Saves to the {{count}} song",
        album_edit_saves_other: "Saves to each of the {{count}} songs",
        video_songs_one: "It lists {{count}} song.",
        video_songs_other: "It lists {{count}} songs.",
        cleanup_tidy_one: "{{count}} name to tidy",
        cleanup_tidy_other: "{{count}} names to tidy",
        cleanup_split_artist_one: "{{count}} artist name to split",
        cleanup_split_artist_other: "{{count}} artist names to split",
        cleanup_shared_one: "{{count}} shared name to tell apart",
        cleanup_shared_other: "{{count}} shared names to tell apart",
        cleanup_photos_one: "{{count}} artist photo to use",
        cleanup_photos_other: "{{count}} artist photos to use",
        cleanup_covers_one: "{{count}} album cover to use",
        cleanup_covers_other: "{{count}} album covers to use",
        cleanup_files_one: "{{count}} file to split",
        cleanup_files_other: "{{count}} files to split",
        tidy_keep_year_one: "{{count}} keeps its own year",
        tidy_keep_year_other: "{{count}} keep their own year",
        insights_plays_one: "{{count}} play",
        insights_plays_other: "{{count}} plays",
        insights_cleanup_one: "Clean up {{count}} item",
        insights_cleanup_other: "Clean up {{count}} items",
        artist_lookup_one: "Look up {{count}} name",
        artist_lookup_other: "Look up {{count}} names",
        shared_names_done_one: "{{count}} name done",
        shared_names_done_other: "{{count}} names done",
        split_names_decided_one: "{{count}} name decided",
        split_names_decided_other: "{{count}} names decided",
        album_art_search_one: "Looking on MusicBrainz for {{count}} album…",
        album_art_search_other: "Looking on MusicBrainz for {{count}} albums…",
        album_art_no_match_one: "{{count}} album has no current cover suggestion",
        album_art_no_match_other: "{{count}} albums have no current cover suggestion",
        album_art_not_searched_one: "{{count}} album isn't searched yet",
        album_art_not_searched_other: "{{count}} albums aren't searched yet",
        artist_photo_search_one: "Looking on Deezer for {{count}} artist…",
        artist_photo_search_other: "Looking on Deezer for {{count}} artists…",
        artist_photo_no_match_one: "{{count}} artist has no current photo suggestion",
        artist_photo_no_match_other: "{{count}} artists have no current photo suggestion",
        artist_photo_not_searched_one: "{{count}} artist isn't looked up yet",
        artist_photo_not_searched_other: "{{count}} artists aren't looked up yet",
        ratings_replaces_one: "It replaces your earlier import of {{amount}} album.",
        ratings_replaces_other: "It replaces your earlier import of {{amount}} albums.",
        ratings_previously_imported_one:
          "The incoming entries replace {{amount}} previously imported album entry.",
        ratings_previously_imported_other:
          "The incoming entries replace {{amount}} previously imported album entries.",
        ratings_total_after_import_one: "Your import will have {{amount}} album.",
        ratings_total_after_import_other: "Your import will have {{amount}} albums.",
        ratings_discard_one:
          "Discard the {{amount}} album you imported? Songs you rated yourself keep their ratings.",
        ratings_discard_other:
          "Discard the {{amount}} albums you imported? Songs you rated yourself keep their ratings.",
        ratings_earlier_import_one: "Your earlier import of {{amount}} album",
        ratings_earlier_import_other: "Your earlier import of {{amount}} albums",
        ratings_preview_albums_one:
          "{{amount}} album rated or reviewed; your Library has {{matched}} of them.",
        ratings_preview_albums_other:
          "{{amount}} albums rated or reviewed; your Library has {{matched}} of them.",
        ratings_changed_songs_one: "{{amount}} song takes a new rating.",
        ratings_changed_songs_other: "{{amount}} songs take a new rating.",
        ratings_joining_one: "{{amount}} song joins",
        ratings_joining_other: "{{amount}} songs join",
        ratings_leaving_one: "{{amount}} song leaves",
        ratings_leaving_other: "{{amount}} songs leave",
        ratings_unmatched_one: "{{amount}} album isn't in your Library",
        ratings_unmatched_other: "{{amount}} albums aren't in your Library",
        ratings_imported_one: "Imported {{amount}} album.",
        ratings_imported_other: "Imported {{amount}} albums.",
        ratings_imported_heading_one: "Your imported ratings ({{amount}} album)",
        ratings_imported_heading_other: "Your imported ratings ({{amount}} albums)",
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
