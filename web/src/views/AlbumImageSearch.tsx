/** @file Album cover discovery: follow a web search or ask Tavily for pictures and their source pages. */

import { useEffect, useState } from "react";

import { api, type ImageSearchResults } from "../api";
import type { CoverAlbum } from "./PictureEditor";

export function GoogleImagesLink({ album, artist }: CoverAlbum) {
  const query = new URLSearchParams({ udm: "2", q: `${artist} ${album} album cover`.trim() });
  return (
    <a href={`https://www.google.com/search?${query.toString()}`} target="_blank" rel="noreferrer">
      Search Google Images
    </a>
  );
}

export function AlbumImageSearch({ album, artist }: CoverAlbum) {
  const [configured, setConfigured] = useState<boolean>();
  const [result, setResult] = useState<ImageSearchResults>();
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [requested, setRequested] = useState(0);
  useEffect(() => {
    let active = true;
    api.imageSearch().then(
      ({ configured: enabled }) => {
        if (active) setConfigured(enabled);
      },
      () => {
        if (active) setError("Could not read the image search setting.");
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!configured) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      api.imageSearchResults(album, artist).then(
        (answer) => {
          if (!active) return;
          setResult(answer);
          if (answer.searching || answer.waiting) timer = setTimeout(read, 2000);
        },
        () => {
          if (active) setError("Could not read the search results. Try again.");
        },
      );
    };
    read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [album, artist, configured, requested]);

  const search = async () => {
    setError("");
    setSending(true);
    try {
      await api.searchImages(album, artist);
      setResult({ searching: true, waiting: false, failure: null, images: [] });
      setRequested((count) => count + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The search could not start.");
    } finally {
      setSending(false);
    }
  };
  const busy =
    sending || ((result?.searching === true || result?.waiting === true) && error === "");
  const failure = error || result?.failure;
  return (
    <div className="cover-finder">
      <GoogleImagesLink album={album} artist={artist} />
      {configured === false && (
        <p className="hint">An admin can add a Tavily key in Settings → Image search.</p>
      )}
      {configured === true && (
        <button
          type="button"
          className="secondary outline dialog-button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void search()}
        >
          Search with Tavily
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
              : requested > 0 && result && !failure
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
