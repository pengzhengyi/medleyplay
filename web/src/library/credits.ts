/**
 * @file A song's artists chosen one by one, each a chip: main, or featured.
 *
 * The chips keep the order they are shown in; the server lists the main artists
 * first when it keeps them. A song always has a main artist, so removing the last
 * one makes the first left main, and one main artist left is just the artist.
 */

import type { Credit } from "../api";

/** Return the artist name folded as the server folds it, to find one named twice. */
function keyOf(written: string): string {
  return written.normalize("NFKC").trim().toLowerCase();
}

/** Return `credits` with the artist `written` added after them, unless it is there or blank. */
export function withCredit(credits: readonly Credit[], written: string): readonly Credit[] {
  const name = written.trim();
  if (name === "" || credits.some((credit) => keyOf(credit.written) === keyOf(name))) {
    return credits;
  }
  return [...credits, { written: name, role: "main" }];
}

/** Return `credits` with the artist at `index` credited the other way, in its place. */
export function toggled(credits: readonly Credit[], index: number): readonly Credit[] {
  return credits.map((credit, at) =>
    at === index ? { ...credit, role: credit.role === "main" ? "featured" : "main" } : credit,
  );
}

/** Return `credits` without the artist at `index`, the first left made main if none is. */
export function withoutCredit(credits: readonly Credit[], index: number): readonly Credit[] {
  const left = credits.filter((_, at) => at !== index);
  if (left.length === 0 || left.some((credit) => credit.role === "main")) {
    return left;
  }
  return left.map((credit, at) => (at === 0 ? { ...credit, role: "main" } : credit));
}

/** Return the artist `credits` are when they are one main artist, else `undefined`. */
export function onlyArtist(credits: readonly Credit[]): string | undefined {
  const [first, ...rest] = credits;
  return first !== undefined && rest.length === 0 && first.role === "main"
    ? first.written
    : undefined;
}

/** Return whether `credits` are the artists `shows`, the main ones first as the server keeps them. */
export function sameCredits(credits: readonly Credit[], shows: readonly Credit[]): boolean {
  const ordered = (each: readonly Credit[]) => [
    ...each.filter((credit) => credit.role === "main"),
    ...each.filter((credit) => credit.role === "featured"),
  ];
  const mine = ordered(credits);
  const theirs = ordered(shows);
  return (
    mine.length === theirs.length &&
    mine.every(
      (credit, at) =>
        credit.role === theirs[at]?.role && credit.written.trim() === theirs[at].written.trim(),
    )
  );
}
