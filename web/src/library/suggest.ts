/**
 * @file The title and artist suggested for the parts of a video the household adds.
 */

import type { LinkLookup, LinkPart } from "../api";

const TAG = String.raw`(?:【[^】]*】|\[[^\]]*\])`;
const LEADING = new RegExp(String.raw`^(?:\s*${TAG})+`);
const TRAILING = new RegExp(String.raw`(?:${TAG}\s*)+$`);

/** Return `text` without the bracketed tags at either end: `【MV】Melt [HD]` is `Melt`. */
export function withoutTags(text: string): string {
  const stripped = text.replace(LEADING, "").replace(TRAILING, "").trim();
  // A title that is nothing but tags keeps them, rather than suggesting nothing.
  return stripped === "" ? text.trim() : stripped;
}

/**
 * Return the title suggested for `part`: its own title for a video with several parts,
 * otherwise the video's, with the bracketed tags at either end removed.
 */
export function suggestedTitle(lookup: LinkLookup, part: LinkPart): string {
  return withoutTags(lookup.parts.length > 1 ? part.title : lookup.title);
}

/** Return the artist suggested for a video's parts: the uploader. */
export function suggestedArtist(lookup: LinkLookup): string {
  return lookup.uploader;
}
