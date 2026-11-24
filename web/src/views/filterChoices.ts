/** @file Counts and sorts the choices in each song filter. */

import type { Track } from "../api";

interface Choice {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

export type ChoiceField = "kind" | "artist" | "album" | "genre" | "year";

export type ChoiceRows = readonly { readonly original: Track }[];

/** A genre such as `alternative rock; britpop` is each of its parts. */
export const genresOf = (genre: string): string[] =>
  genre
    .split(/[;,/]/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");

const valuesOf: Record<ChoiceField, (track: Track) => readonly string[]> = {
  kind: (track) => [track.kind],
  artist: (track) => (track.artist ? [track.artist] : []),
  album: (track) => (track.album ? [track.album] : []),
  genre: (track) => genresOf(track.genre),
  year: (track) => (track.year === null ? [] : [String(track.year)]),
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Count each choice among the rows the other filters keep. */
export function choicesFor(field: ChoiceField, rows: ChoiceRows | undefined): Choice[] {
  const counts = new Map<string, number>();
  for (const { original } of rows ?? []) {
    for (const value of valuesOf[field](original)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const choices = [...counts].map(([value, count]) => ({
    value,
    label: field === "kind" ? (value === "album" ? "Albums" : "Songs") : value,
    count,
  }));
  switch (field) {
    case "kind":
      return choices.sort((a, b) => Number(a.value === "album") - Number(b.value === "album"));
    case "year":
      return choices.sort((a, b) => Number(b.value) - Number(a.value));
    default:
      return choices.sort((a, b) => collator.compare(a.label, b.label));
  }
}
