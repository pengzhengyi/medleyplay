/**
 * @file The search box: what to look for, and where, the Library or a music site.
 *
 * With the Library chosen, it searches as you type, and a field named as `artist:`
 * becomes a tag the words after it fill. A site a plugin provides is a choice too: there
 * the box takes a link or a bare video code, and Enter looks it up.
 */

import { MagnifyingGlassIcon, MusicNotesSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import { FIELD_LABELS, type Field, fieldTyped, parseQuery, tagText } from "../library/query";

import { type Route, navigate } from "../routes";
import { hintOf, useBindings } from "../shortcuts";
import { SiteMark } from "./SiteMark";

/** How long after typing stops the search runs. */
const SETTLE_MS = 150;

const SITE_NAMES: Record<string, string> = { bilibili: "Bilibili" };
const LIBRARY = "library";

/** What a tag's value is, said in the box while it is empty. */
const VALUE_HINTS: Readonly<Record<Field, string>> = {
  artist: "an artist's name",
  album: "an album's name",
  song: "a song's title",
  kind: "songs, albums, or artists",
  rating: "at least so many stars, 1 to 5",
  favorite: "yes or no",
};

/** A tag in the box, or plain words typed before one. */
interface Token {
  readonly field?: Field;
  readonly value: string;
}

/** Return what the box asks, as a search's text: its tokens, then the tag or words typed. */
function textOf(tokens: readonly Token[], field: Field | undefined, typed: string): string {
  const last =
    field === undefined
      ? typed.trim()
      : typed.trim() === ""
        ? ""
        : tagText({ field, value: typed });
  return [
    ...tokens.map((token) =>
      token.field === undefined ? token.value : tagText({ field: token.field, value: token.value }),
    ),
    last,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Return the tokens a search's text holds: its tags, its words left to type on. */
function tokensOf(text: string): { readonly tokens: readonly Token[]; readonly words: string } {
  const { tags, words } = parseQuery(text);
  return { tokens: tags.filter((tag) => tag.value !== ""), words };
}

/**
 * Search the Library as you type, showing what it found; with a site chosen, `onLookUp`
 * hears the link or code typed when Enter is pressed.
 */
export function SearchBox({
  route,
  providers,
  onLookUp,
}: {
  readonly route: Route;
  readonly providers: readonly string[];
  readonly onLookUp: (link: string) => void;
}) {
  const shown = route.view === "search" ? route.query : "";
  const [tokens, setTokens] = useState(() => tokensOf(shown).tokens);
  const [field, setField] = useState<Field>();
  const [query, setQuery] = useState(() => tokensOf(shown).words);
  // The tag the first Backspace chose, which a second removes.
  const [picked, setPicked] = useState(false);
  // What the box last said to a screen reader: a tag removed, or the search cleared.
  const [said, setSaid] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const [seen, setSeen] = useState(shown);
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keys = useBindings();
  const [chosen, setChosen] = useState(LIBRARY);
  const scope = providers.includes(chosen) ? chosen : LIBRARY;
  const site = scope === LIBRARY ? undefined : (SITE_NAMES[scope] ?? scope);
  const tagsId = useId();
  const nameId = useId();

  // Back, Forward, or a link changes the search shown; the box follows.
  if (shown !== seen) {
    const found = tokensOf(shown);
    setSeen(shown);
    setTokens(found.tokens);
    setField(undefined);
    setQuery(found.words);
    setPicked(false);
  }
  useEffect(
    () => () => {
      clearTimeout(settling.current);
    },
    [],
  );

  const searchFor = (text: string) => {
    clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      // The search shown is the one asked, so the box keeps the tag being typed.
      setSeen(text);
      // The first letter opens the results; the rest change them in place.
      navigate({ view: "search", query: text }, { replace: route.view === "search" });
    }, SETTLE_MS);
  };

  /** Show `next` in the box, and search for what it asks. */
  const change = (next: {
    readonly tokens: readonly Token[];
    readonly field: Field | undefined;
    readonly query: string;
  }) => {
    setTokens(next.tokens);
    setField(next.field);
    setQuery(next.query);
    setPicked(false);
    setSaid("");
    searchFor(textOf(next.tokens, next.field, next.query));
  };

  /** Keep the tag being typed as a tag of its own, leaving the box for words. */
  const keepTag = () => {
    if (field !== undefined) {
      change({
        tokens: query.trim() === "" ? tokens : [...tokens, { field, value: query.trim() }],
        field: undefined,
        query: "",
      });
    }
  };

  /** Remove the token at `at`, saying so. */
  const remove = (at: number) => {
    const token = tokens[at];
    change({ tokens: tokens.filter((_, each) => each !== at), field, query });
    if (token?.field !== undefined) {
      setSaid(`${FIELD_LABELS[token.field]}: ${token.value} removed.`);
    }
  };

  /** Empty the box, tags and all. */
  const clear = () => {
    change({ tokens: [], field: undefined, query: "" });
    setSaid("Search cleared.");
  };

  /** Backspace at the start: choose the tag before the caret, then remove it. */
  const backspace = () => {
    if (field !== undefined) {
      if (picked) {
        change({ tokens, field: undefined, query });
        setSaid(`${FIELD_LABELS[field]} removed.`);
      } else {
        setPicked(true);
      }
      return;
    }
    const last = tokens.at(-1);
    if (last === undefined) {
      return;
    }
    if (last.field === undefined) {
      change({
        tokens: tokens.slice(0, -1),
        field: undefined,
        query: `${last.value} ${query}`.trimEnd(),
      });
    } else if (picked) {
      remove(tokens.length - 1);
    } else {
      setPicked(true);
    }
  };

  const tagging = site === undefined;
  const tagged = tagging && (tokens.length > 0 || field !== undefined);
  const pickedTag =
    !picked || !tagging ? undefined : field !== undefined ? "typing" : tokens.length - 1;
  const placeholder =
    site !== undefined
      ? `Paste a ${site} link or a BV or av code`
      : field !== undefined
        ? VALUE_HINTS[field]
        : tokens.length > 0
          ? "More words, or a tag"
          : "Search songs, artists, albums";

  return (
    <search className="search">
      <label className="search-field">
        <MagnifyingGlassIcon className="search-glass" weight="regular" aria-hidden />
        <span className="visually-hidden" id={nameId}>
          Search
        </span>
        {tagged && (
          <span className="search-tags">
            {tokens.map((token, at) =>
              token.field === undefined ? (
                <span key={at} className="search-words">
                  {token.value}
                </span>
              ) : (
                <span
                  key={at}
                  className="search-tag"
                  data-picked={pickedTag === at ? "true" : undefined}
                  title={pickedTag === at ? "Press Backspace again to remove" : undefined}
                >
                  <span className="search-tag-field">{FIELD_LABELS[token.field]}:</span>{" "}
                  {token.value}
                  <button
                    type="button"
                    className="search-tag-remove"
                    aria-label={`Remove ${FIELD_LABELS[token.field]}: ${token.value}`}
                    title="Remove"
                    onClick={(event) => {
                      event.preventDefault();
                      remove(at);
                      box.current?.focus();
                    }}
                  >
                    <XIcon weight="bold" aria-hidden />
                  </button>
                </span>
              ),
            )}
            {field !== undefined && (
              <span
                className="search-tag typing"
                data-picked={pickedTag === "typing" ? "true" : undefined}
                title={pickedTag === "typing" ? "Press Backspace again to remove" : undefined}
              >
                <span className="search-tag-field">{FIELD_LABELS[field]}:</span>
              </span>
            )}
          </span>
        )}
        {tagged && (
          // The tags as words, describing the box without their remove buttons.
          <span className="visually-hidden" id={tagsId}>
            {[
              ...tokens.map((token) =>
                token.field === undefined
                  ? token.value
                  : `${FIELD_LABELS[token.field]}: ${token.value}`,
              ),
              ...(field === undefined ? [] : [`${FIELD_LABELS[field]}:`]),
            ].join(" ")}
          </span>
        )}
        <input
          ref={box}
          id="search"
          type="search"
          {...hintOf("Search", keys.search)}
          // The tags sit in the label too; they describe the box, and don't name it.
          aria-labelledby={nameId}
          aria-describedby={tagged ? tagsId : undefined}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            const text = event.currentTarget.value;
            if (!tagging) {
              setQuery(text);
              return;
            }
            const pasted = (event.nativeEvent as InputEvent).inputType === "insertFromPaste";
            const found = tokensOf(text);
            if (pasted && field === undefined && found.tokens.length > 0) {
              // Tags pasted in become tags, as if typed.
              change({
                tokens: [...tokens, ...found.tokens],
                field: undefined,
                query: found.words,
              });
              return;
            }
            const typed = fieldTyped(text);
            if (typed === undefined) {
              change({ tokens, field, query: text });
              return;
            }
            const before: readonly Token[] =
              typed.before === ""
                ? []
                : [field === undefined ? { value: typed.before } : { field, value: typed.before }];
            change({ tokens: [...tokens, ...before], field: typed.field, query: "" });
          }}
          onKeyDown={(event) => {
            const at = event.currentTarget;
            if (
              tagging &&
              event.key === "Backspace" &&
              at.selectionStart === 0 &&
              at.selectionEnd === 0
            ) {
              if (field !== undefined || tokens.length > 0) {
                event.preventDefault();
                // A held key repeats; only a second press removes the tag chosen.
                if (!event.repeat) {
                  backspace();
                }
              }
              return;
            }
            if (tagging && event.key === "Escape" && (tagged || query !== "")) {
              event.preventDefault();
              clear();
              return;
            }
            if (event.key !== "Shift") {
              setPicked(false);
            }
            if (tagging && event.key === "Enter" && field !== undefined) {
              event.preventDefault();
              keepTag();
            }
            if (site !== undefined && event.key === "Enter" && query.trim() !== "") {
              event.preventDefault();
              onLookUp(query.trim());
              setQuery("");
            }
          }}
        />
        {tagging && (tagged || query !== "") && (
          <button
            type="button"
            className="icon search-clear"
            aria-label="Clear search"
            title="Clear search (Esc)"
            onClick={(event) => {
              event.preventDefault();
              clear();
              box.current?.focus();
            }}
          >
            <XIcon aria-hidden />
          </button>
        )}
        <span className="visually-hidden" aria-live="polite">
          {pickedTag === undefined ? said : "Tag chosen. Press Backspace again to remove it."}
        </span>
      </label>
      {providers.length > 0 && (
        <div className="scope" role="radiogroup" aria-label="Search in">
          <label title="Library">
            <input
              type="radio"
              name="scope"
              checked={scope === LIBRARY}
              onChange={() => {
                setChosen(LIBRARY);
              }}
            />
            <MusicNotesSimpleIcon className="site-mark" weight="bold" aria-hidden />
            <span className="visually-hidden">Library</span>
          </label>
          {providers.map((provider) => (
            <label key={provider} title={SITE_NAMES[provider] ?? provider}>
              <input
                type="radio"
                name="scope"
                checked={scope === provider}
                onChange={() => {
                  setChosen(provider);
                }}
              />
              <SiteMark name={SITE_NAMES[provider] ?? provider} />
            </label>
          ))}
        </div>
      )}
    </search>
  );
}
