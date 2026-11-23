/** @file Find covers and photos on the web with Google Images or Tavily. */

import { useEffect, useState } from "react";

import { api, type ImageSearchResults, type Pictured } from "../api";

export function GoogleImagesLink({
  artist,
  album,
}: {
  readonly artist: string;
  readonly album?: string;
}) {
  const q = album === undefined ? `${artist} artist photo` : `${artist} ${album} album cover`;
  const query = new URLSearchParams({ udm: "2", q: q.trim() });
  return (
    <a href={`https://www.google.com/search?${query.toString()}`} target="_blank" rel="noreferrer">
      Search Google Images
    </a>
  );
}

export function TavilySearch(pictured: Pictured) {
  const { album, artist } = pictured.kind === "album" ? pictured : { album: "", artist: "" };
  const artistId = pictured.kind === "artist" ? pictured.artistId : undefined;
  const [result, setResult] = useState<ImageSearchResults>();
  const [error, setError] = useState("");
  const [requested, setRequested] = useState(0);
  useEffect(() => {
    const subject: Pictured =
      artistId === undefined ? { kind: "album", album, artist } : { kind: "artist", artistId };
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (start: boolean) => {
      try {
        const answer = await api.imageSearchResults(subject);
        if (!isCurrent()) return;
        if (start && !answer.searching && !answer.waiting) {
          await api.searchImages(subject);
          if (isCurrent()) void read(false);
        } else {
          setResult(answer);
          if (answer.searching || answer.waiting) timer = setTimeout(() => void read(false), 2000);
        }
      } catch (failure) {
        if (isCurrent())
          setError(failure instanceof Error ? failure.message : "Could not search. Try again.");
      }
    };
    function isCurrent() {
      return active;
    }
    void read(true);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [album, artist, artistId, requested]);

  const busy = !error && (!result || result.searching || result.waiting);
  const failure = error || result?.failure;
  return (
    <div className="cover-finder">
      {!busy && (
        <button
          type="button"
          className="secondary outline dialog-button"
          onClick={() => {
            setResult(undefined);
            setError("");
            setRequested((count) => count + 1);
          }}
        >
          Search again
        </button>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <p className="cover-finder-note" role="status">
        {result?.waiting
          ? "Waiting to search."
          : busy
            ? "Searching for pictures…"
            : result && result.images.length > 0
              ? "Check the source and its license before uploading a picture."
              : result && !failure
                ? "No pictures found."
                : ""}
      </p>
      {result && result.images.length > 0 && (
        <ul className="cover-finder-grid" aria-label="Image search results">
          {result.images.map((image) => (
            <li key={image.url}>
              <a className="cover-choice" href={image.page} target="_blank" rel="noreferrer">
                <img src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                {image.title || new URL(image.page).hostname}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
