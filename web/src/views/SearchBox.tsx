/**
 * @file The search box: what to look for, and where, the Library or a music site.
 *
 * With the Library chosen, it searches as you type. A site a plugin provides is a
 * choice too: there the box takes a link or a bare video code, and Enter looks it up.
 */

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { type Route, navigate } from "../routes";
import { hintOf, useBindings } from "../shortcuts";

/** How long after typing stops the search runs. */
const SETTLE_MS = 150;

const SITE_NAMES: Record<string, string> = { bilibili: "Bilibili" };
const LIBRARY = "library";

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
  const [query, setQuery] = useState(shown);
  const [seen, setSeen] = useState(shown);
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keys = useBindings();
  const [chosen, setChosen] = useState(LIBRARY);
  const scope = providers.includes(chosen) ? chosen : LIBRARY;
  const site = scope === LIBRARY ? undefined : (SITE_NAMES[scope] ?? scope);

  // Back, Forward, or a link changes the search shown; the box follows.
  if (shown !== seen) {
    setSeen(shown);
    setQuery(shown);
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
      // The first letter opens the results; the rest change them in place.
      navigate({ view: "search", query: text }, { replace: route.view === "search" });
    }, SETTLE_MS);
  };

  return (
    <search className="search">
      <label className="search-field">
        <MagnifyingGlassIcon className="search-glass" weight="regular" aria-hidden />
        <span className="visually-hidden">Search</span>
        <input
          id="search"
          type="search"
          {...hintOf("Search", keys.search)}
          value={query}
          placeholder={
            site === undefined
              ? "Search songs, artists, albums"
              : `Paste a ${site} link or a BV or av code`
          }
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            if (site === undefined) {
              searchFor(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (site !== undefined && event.key === "Enter" && query.trim() !== "") {
              event.preventDefault();
              onLookUp(query.trim());
              setQuery("");
            }
          }}
        />
      </label>
      {providers.length > 0 && (
        <div className="scope" role="radiogroup" aria-label="Search in">
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === LIBRARY}
              onChange={() => {
                setChosen(LIBRARY);
              }}
            />
            Library
          </label>
          {providers.map((provider) => (
            <label key={provider}>
              <input
                type="radio"
                name="scope"
                checked={scope === provider}
                onChange={() => {
                  setChosen(provider);
                }}
              />
              {SITE_NAMES[provider] ?? provider}
            </label>
          ))}
        </div>
      )}
    </search>
  );
}
