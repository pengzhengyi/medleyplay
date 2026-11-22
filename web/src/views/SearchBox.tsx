/**
 * @file The search box: what to look for, and where, the Library or a music site.
 *
 * With the Library chosen, it searches as you type, and a field named as `artist:`
 * becomes a tag the words after it fill. Under it, a panel completes the tag or site a
 * word being typed begins, as `bi` begins `bilibili:` (Tab takes the first), and
 * suggests the artists the search names, each to show, its songs, or its albums; in
 * an empty box, resting the
 * pointer or pressing ↓ lists the tags instead. A site a plugin provides is a choice
 * too: there the box takes a link or a bare video code, and Enter looks it up.
 */

import {
  MagnifyingGlassIcon,
  MusicNotesIcon,
  MusicNotesSimpleIcon,
  UsersThreeIcon,
  VinylRecordIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { Track } from "../api";
import { initialOf } from "../format";
import { type ArtistLinks, NO_LINKS } from "../library/artistLinks";
import {
  FIELDS,
  FIELD_LABELS,
  type Field,
  fieldTyped,
  siteTyped,
  parseQuery,
  tagText,
} from "../library/query";
import { type Completion, completionsOf, suggestedArtists } from "../library/suggestions";

import { type Route, navigate } from "../routes";
import { useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { type PanelOption, SearchPanel } from "./SearchPanel";
import { SiteMark } from "./SiteMark";
import { Hint } from "./Hint";

/** How long after typing stops the search runs. */
const SETTLE_MS = 150;

/** How long the pointer rests on an empty box before the tags are listed. */
const HELP_AFTER_MS = 700;

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

const songCount = (count: number) => (count === 1 ? "1 song" : `${String(count)} songs`);

/**
 * Search the Library as you type, showing what it found and suggesting the artists of
 * `tracks` it names, by any name `links` know; with a site chosen, `onLookUp` hears the
 * link or code typed when Enter is pressed.
 */
export function SearchBox({
  route,
  providers,
  onLookUp,
  tracks = [],
  links,
}: {
  readonly route: Route;
  readonly providers: readonly string[];
  readonly onLookUp: (link: string) => void;
  readonly tracks?: readonly Track[];
  readonly links?: ArtistLinks | undefined;
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
  const panelId = useId();
  // Whether the suggestions show, as typing opens them; whether the tags are listed instead.
  const [suggesting, setSuggesting] = useState(false);
  const [helping, setHelping] = useState(false);
  // The option the box points at, moved by the arrow keys; -1 for none.
  const [active, setActive] = useState(-1);
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);

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
      clearTimeout(resting.current);
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
    setSuggesting(true);
    setHelping(false);
    setActive(-1);
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
  const empty = tagging && !tagged && query === "";
  const text = textOf(tokens, field, query);
  const artists = useMemo(
    () => (tagging ? suggestedArtists(tracks, text, links) : []),
    [tagging, tracks, text, links],
  );

  /** The cover holding the photo of the artist whose songs write `name`, if it has one. */
  const photoOf = (name: string) => {
    const known = links ?? NO_LINKS;
    return known.photoOf(known.groupOf(name));
  };

  /** Close the panel. */
  const close = () => {
    setSuggesting(false);
    setHelping(false);
    setActive(-1);
  };

  /** Leave the search for `to`, emptying the box. */
  const leaveFor = (to: Route) => {
    clearTimeout(settling.current);
    close();
    // The search shown stays the one seen, so the box doesn't fill again before it goes.
    setTokens([]);
    setField(undefined);
    setQuery("");
    setPicked(false);
    setSaid("");
    navigate(to);
  };

  /** Search `place`, the Library or a site, with `typed` in the box and no tags. */
  const searchIn = (place: string, typed = "") => {
    setChosen(place);
    change({ tokens: [], field: undefined, query: typed });
    close();
    setSaid(
      place === LIBRARY ? "Searching the Library." : `Searching ${SITE_NAMES[place] ?? place}.`,
    );
  };

  /** The option starting `tag`, after the words `before` it. */
  const tagOption = (tag: Field, before?: string): PanelOption => ({
    key: tag,
    className: "suggest-tag",
    content: (
      <>
        <code>{tag}:</code>
        <span className="suggest-meta">{VALUE_HINTS[tag]}</span>
      </>
    ),
    does: before === undefined ? { tag } : { tag, before },
  });

  /** The option searching `site` for `rest`. */
  const siteOption = (site: string, rest?: string): PanelOption => ({
    key: `site-${site}`,
    className: "suggest-tag",
    content: (
      <>
        <code>{site}:</code>
        <span className="suggest-meta">{`search ${SITE_NAMES[site] ?? site}`}</span>
      </>
    ),
    does: rest === undefined ? { site } : { site, rest },
  });

  // The tags and sites the word being typed begins, offered first; Tab takes the first.
  const completing = tagging && field === undefined ? completionsOf(query, providers) : undefined;
  const completed: readonly PanelOption[] = (completing?.completions ?? []).map(
    (each: Completion, at) => ({
      ...("tag" in each
        ? tagOption(each.tag, completing?.before)
        : siteOption(each.site, completing?.before)),
      ...(at === 0 && { shortcut: "Tab" }),
    }),
  );

  // Each artist the search names, to show, its songs, or its albums; then grouping by artist.
  const suggested: readonly PanelOption[] =
    artists.length === 0
      ? []
      : [
          ...artists.flatMap((artist): PanelOption[] => [
            {
              key: `${artist.link}-page`,
              row: artist.link,
              className: "suggest-artist",
              title: `Go to ${artist.name || "the songs with no artist"}`,
              content: (
                <>
                  <Cover size="small" cover={photoOf(artist.link)} className="suggest-initial">
                    {initialOf(artist.name)}
                  </Cover>
                  <span className="suggest-name">{artist.name || "No artist"}</span>{" "}
                  <span className="suggest-meta">{songCount(artist.count)}</span>
                </>
              ),
              does: {
                go: {
                  view: "artist",
                  name: artist.link,
                  ...(artist.id !== undefined && { id: artist.id }),
                },
              },
            },
            {
              key: `${artist.link}-songs`,
              row: artist.link,
              className: "suggest-chip",
              title: `Only ${artist.name}'s songs in the Library`,
              content: (
                <>
                  <MusicNotesIcon aria-hidden />
                  <span className="suggest-chip-label">Songs</span>
                </>
              ),
              does: { go: { view: "library", artist: artist.link } },
            },
            {
              key: `${artist.link}-albums`,
              row: artist.link,
              className: "suggest-chip",
              title: `Only the albums ${artist.name} sings on`,
              content: (
                <>
                  <VinylRecordIcon aria-hidden />
                  <span className="suggest-chip-label">Albums</span>
                </>
              ),
              does: { go: { view: "albums", artist: artist.link } },
            },
          ]),
          {
            key: "group",
            className: "suggest-action",
            content: (
              <>
                <UsersThreeIcon aria-hidden />
                Group the Library by artist
              </>
            ),
            does: { go: { view: "library", group: "artist" } },
          },
        ];

  const options: readonly PanelOption[] =
    helping && empty
      ? [...FIELDS.map((each) => tagOption(each)), ...providers.map((each) => siteOption(each))]
      : suggesting
        ? [...completed, ...suggested]
        : [];
  const open = options.length > 0;
  // The option pointed at, while the options still hold it.
  const pointed = active < options.length ? active : -1;

  /** Do what `option` does: leave for a view, or start its tag and type on. */
  const choose = (option: PanelOption) => {
    if ("go" in option.does) {
      leaveFor(option.does.go);
    } else if ("site" in option.does) {
      searchIn(option.does.site, option.does.rest);
      box.current?.focus();
    } else {
      const before = option.does.before ?? "";
      change({
        tokens: before === "" ? tokens : [...tokens, { value: before }],
        field: option.does.tag,
        query: "",
      });
      setSuggesting(false);
      box.current?.focus();
    }
  };
  const rows = new Map(artists.map((artist) => [artist.link, artist.name || "No artist"]));
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
    <search
      className="search"
      onPointerLeave={() => {
        clearTimeout(resting.current);
        if (document.activeElement !== box.current) {
          setHelping(false);
        }
      }}
    >
      <label
        className="search-field"
        onPointerEnter={() => {
          clearTimeout(resting.current);
          if (empty) {
            resting.current = setTimeout(() => {
              setHelping(true);
            }, HELP_AFTER_MS);
          }
        }}
      >
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
        <Hint name="Search" keys={keys.search} showOnFocus={false}>
          <input
            ref={box}
            id="search"
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              open && pointed >= 0 ? `${panelId}-${String(pointed)}` : undefined
            }
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
              const named = siteTyped(text, providers);
              if (named !== undefined) {
                // A site's name and a colon searches that site, as its button does.
                searchIn(named.site, named.rest);
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
                  : [
                      field === undefined
                        ? { value: typed.before }
                        : { field, value: typed.before },
                    ];
              change({ tokens: [...tokens, ...before], field: typed.field, query: "" });
            }}
            onBlur={close}
            onKeyDown={(event) => {
              const at = event.currentTarget;
              if (tagging && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                if (!open) {
                  if (empty) {
                    setHelping(true);
                    setActive(0);
                  } else {
                    setSuggesting(true);
                    setActive(event.key === "ArrowDown" ? 0 : -1);
                  }
                  return;
                }
                const step = event.key === "ArrowDown" ? 1 : -1;
                // From none to the first and on to the last, then back to none.
                setActive((was) => {
                  const next = was + step;
                  return next >= options.length ? -1 : next < -1 ? options.length - 1 : next;
                });
                return;
              }
              if (open && event.key === "Enter" && pointed >= 0) {
                event.preventDefault();
                const chosen = options[pointed];
                if (chosen !== undefined) {
                  choose(chosen);
                }
                return;
              }
              if (open && event.key === "Tab" && !event.shiftKey && completed.length > 0) {
                // Tab takes the completion pointed at, or else the first.
                event.preventDefault();
                const taken = pointed >= 0 && pointed < completed.length ? pointed : 0;
                const chosen = options[taken];
                if (chosen !== undefined) {
                  choose(chosen);
                }
                return;
              }
              if (open && event.key === "Escape") {
                event.preventDefault();
                close();
                return;
              }
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
              if (!tagging && event.key === "Backspace" && at.value === "") {
                // Backspace in an empty box leaves the site, as it removes a tag.
                event.preventDefault();
                searchIn(LIBRARY);
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
        </Hint>
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
      {open && (
        <SearchPanel
          id={panelId}
          label={helping && empty ? "Search by" : "Suggestions"}
          options={options}
          active={pointed}
          rows={rows}
          onChoose={choose}
        />
      )}
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
