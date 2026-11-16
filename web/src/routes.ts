/**
 * @file The views as hash routes, so Back, Forward, a bookmark, and a reload keep the view.
 *
 * Names travel as query parameters, such as `#/album?artist=AC%2FDC&name=…`, so a
 * name holding `/` or `&` is safe.
 */

import { useEffect, useState } from "react";

/** What the Library can be grouped by. */
export const LIBRARY_GROUPS = ["album", "artist", "album_artist", "year", "genre"] as const;

export type LibraryGroup = (typeof LIBRARY_GROUPS)[number];

/** A view and what it shows. */
export type Route =
  /**
   * The Library; with `focus`, scrolled to that Track, which is lit for a moment; with
   * `artist`, filtered to the songs of the artist its Tracks write so; with `group`, grouped.
   */
  | {
      readonly view: "library";
      readonly focus?: number;
      readonly artist?: string;
      readonly group?: LibraryGroup;
    }
  | { readonly view: "radio" }
  | { readonly view: "artists" }
  | { readonly view: "artist"; readonly name: string }
  /** The albums; with `artist`, only those the artist sings on. */
  | { readonly view: "albums"; readonly artist?: string }
  | { readonly view: "album"; readonly artist: string; readonly name: string }
  | { readonly view: "downloaded" }
  | { readonly view: "playlists" }
  | { readonly view: "playlist"; readonly id: string }
  | { readonly view: "search"; readonly query: string }
  | { readonly view: "insights" }
  /** Settings; with `section`, opened at the section of that id, such as `ai`. */
  | { readonly view: "settings"; readonly section?: string }
  | { readonly view: "clean-up" };

const LIBRARY: Route = { view: "library" };

/**
 * Return the route `hash` names, or the Library for one it doesn't, such as `#/songs`,
 * as the Library was once called.
 */
export function routeOf(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  const params = new URLSearchParams(query);
  const name = params.get("name");
  switch (path) {
    case "library": {
      const focus = params.get("focus") ?? "";
      const artist = params.get("artist");
      const group = LIBRARY_GROUPS.find((each) => each === params.get("group"));
      return {
        view: "library",
        ...(/^\d+$/u.test(focus) && { focus: Number(focus) }),
        ...(artist !== null && { artist }),
        ...(group !== undefined && { group }),
      };
    }
    case "albums": {
      const artist = params.get("artist");
      return artist === null ? { view: "albums" } : { view: "albums", artist };
    }
    case "radio":
    case "artists":
    case "downloaded":
    case "playlists":
    case "insights":
    case "clean-up":
      return { view: path };
    case "settings": {
      const section = params.get("section");
      return section === null ? { view: "settings" } : { view: "settings", section };
    }
    case "artist":
      return name === null ? LIBRARY : { view: "artist", name };
    case "album": {
      const artist = params.get("artist");
      return name === null || artist === null ? LIBRARY : { view: "album", artist, name };
    }
    case "playlist": {
      const id = params.get("id");
      return id === null ? LIBRARY : { view: "playlist", id };
    }
    case "search":
      return { view: "search", query: params.get("q") ?? "" };
    default:
      return LIBRARY;
  }
}

/** Return the hash that opens `route`. */
export function hrefOf(route: Route): string {
  switch (route.view) {
    case "artist":
      return `#/artist?${new URLSearchParams({ name: route.name }).toString()}`;
    case "album":
      return `#/album?${new URLSearchParams({ artist: route.artist, name: route.name }).toString()}`;
    case "playlist":
      return `#/playlist?${new URLSearchParams({ id: route.id }).toString()}`;
    case "search":
      return `#/search?${new URLSearchParams({ q: route.query }).toString()}`;
    case "settings":
      return route.section === undefined
        ? "#/settings"
        : `#/settings?${new URLSearchParams({ section: route.section }).toString()}`;
    case "library": {
      const params = new URLSearchParams({
        ...(route.focus !== undefined && { focus: String(route.focus) }),
        ...(route.artist !== undefined && { artist: route.artist }),
        ...(route.group !== undefined && { group: route.group }),
      }).toString();
      return params === "" ? "#/library" : `#/library?${params}`;
    }
    case "albums":
      return route.artist === undefined
        ? "#/albums"
        : `#/albums?${new URLSearchParams({ artist: route.artist }).toString()}`;
    default:
      return `#/${route.view}`;
  }
}

/** Return the route the page shows now, following Back, Forward, and links. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(routeOf(location.hash));
    };
    window.addEventListener("hashchange", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
    };
  }, []);
  return route;
}

/**
 * Show `route`; with `replace`, in place of the view now, so typing a search
 * doesn't leave a Back step for every letter.
 */
export function navigate(route: Route, { replace = false } = {}): void {
  const href = hrefOf(route);
  if (replace) {
    history.replaceState(null, "", href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = href;
  }
}
