/**
 * @file What a search asks for: tags such as `artist:Jay` that narrow it to one
 * field, and plain words matched anywhere.
 *
 * ```text
 * artist:"Jay Chou" rating:4 love
 * ```
 *
 * asks for songs by Jay Chou rated four stars or more, with *love* in their title,
 * artist, or album. A value with a space is quoted. A word ending in `:` that names no
 * field, such as `re:`, is a plain word.
 */

/** The fields a tag can name, in the order the help lists them. */
export const FIELDS = ["artist", "album", "song", "kind", "rating", "favorite"] as const;

export type Field = (typeof FIELDS)[number];

/** One field and what it must hold. */
export interface Tag {
  readonly field: Field;
  readonly value: string;
}

export interface Query {
  readonly tags: readonly Tag[];
  /** The plain words, as typed, in the order typed. */
  readonly words: string;
}

/** What each field is called on its tag, and what it asks for. */
export const FIELD_LABELS: Readonly<Record<Field, string>> = {
  artist: "Artist",
  album: "Album",
  song: "Song",
  kind: "Kind",
  rating: "Rating",
  favorite: "Favorite",
};

/** A tag, a field's name and `:` (or a full-width `：`) at a word's start, or a plain word. */
const TOKEN = new RegExp(`(?<=^|\\s)(${FIELDS.join("|")})[:：](?:"([^"]*)"?|(\\S*))|\\S+`, "giu");

/** Return the field `name` is, or `undefined` for a word that isn't one. */
export function fieldOf(name: string): Field | undefined {
  const lower = name.toLowerCase();
  return FIELDS.find((field) => field === lower);
}

/** Return the tags and plain words `text` holds. */
export function parseQuery(text: string): Query {
  const tags: Tag[] = [];
  const words: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const [whole, name, quoted, bare] = match;
    const field = name === undefined ? undefined : fieldOf(name);
    if (field === undefined) {
      words.push(whole);
    } else {
      tags.push({ field, value: (quoted ?? bare ?? "").trim() });
    }
  }
  return { tags, words: words.join(" ") };
}

/** Return `query` written as text, which {@link parseQuery} reads back. */
export function queryText(query: Query): string {
  return [...query.tags.map(tagText), query.words.trim()].filter(Boolean).join(" ");
}

/** Return `tag` written as text: its value quoted when it holds a space or is empty. */
export function tagText(tag: Tag): string {
  const value = tag.value.replaceAll('"', "").trim();
  return /^\S+$/u.test(value) ? `${tag.field}:${value}` : `${tag.field}:"${value}"`;
}

/**
 * Return the field `text` ends by naming, as `artist:` typed after a space or at the
 * start, with what came before it; `undefined` when it ends otherwise.
 */
export function fieldTyped(
  text: string,
): { readonly field: Field; readonly before: string } | undefined {
  const match = /(?:^|\s)(\S+)[:：]$/u.exec(text);
  const field = match?.[1] === undefined ? undefined : fieldOf(match[1]);
  return field === undefined || match === null
    ? undefined
    : { field, before: text.slice(0, match.index).trim() };
}

/**
 * Return `query` as a heading says it: each tag as *Artist: Jay Chou*, then the words
 * quoted, as *Artist: Jay Chou, “love”*; `""` when it asks nothing.
 */
export function querySaid(text: string): string {
  const { tags, words } = parseQuery(text);
  return [
    ...tags
      .filter((tag) => tag.value !== "")
      .map((tag) => `${FIELD_LABELS[tag.field]}: ${tag.value}`),
    ...(words.trim() === "" ? [] : [`“${words.trim()}”`]),
  ].join(", ");
}
