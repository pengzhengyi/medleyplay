/** @file Settings section links, in the order their headings appear. */

export const SETTINGS_SECTIONS = [
  { id: "appearance", title: "Appearance" },
  { id: "keyboard-shortcuts", title: "Keyboard shortcuts" },
  { id: "network", title: "Network" },
  { id: "devices", title: "Other devices", adminOnly: true },
  { id: "kinds", title: "Songs and albums" },
  { id: "ratings", title: "Your ratings" },
  { id: "storage", title: "Downloads and storage" },
  { id: "bilibili", title: "Bilibili", adminOnly: true },
  { id: "musicbrainz", title: "MusicBrainz", adminOnly: true },
  { id: "deezer", title: "Deezer", adminOnly: true },
  { id: "image-search", title: "Image search", adminOnly: true },
  { id: "lyrics", title: "Lyrics" },
  { id: "ai", title: "AI", adminOnly: true },
] as const;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export function visibleSettingsSections(admin: boolean) {
  return SETTINGS_SECTIONS.filter((section) => admin || !("adminOnly" in section));
}
