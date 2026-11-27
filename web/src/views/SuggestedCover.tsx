/**
 * @file A cover suggested for an album that has none, from the releases MusicBrainz has.
 *
 * It stands where the cover would, framed and tagged as a suggestion, and is its own
 * controls: use it in one click, dismiss it, or choose another in the cover editor. The
 * suggestion is the one an AI model picked, else the best-ranked release whose title and
 * artist are the album's; one dismissed is never suggested again. An album never looked
 * up, or looked up in vain long ago, is looked up once when shown. With no suggestion,
 * `fallback` shows in its place.
 */

import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { type AlbumCovers, api } from "../api";
import { type Words, useWords } from "../locale";
import { Cover } from "./Cover";
import { SuggestedFrame } from "./SuggestedFrame";

const READ_EVERY_MS = 2000;

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Say what tells the release apart: `1965, GB, 12" Vinyl`. */
function releaseOf(release: AlbumCovers["covers"][number]["release"], t: Words): string {
  return [release.date.slice(0, 4), release.country, release.format].filter(Boolean).join(t(", "));
}

/**
 * The cover suggested for the album `album` by `artist`, or `fallback` while none is.
 * `onUse` uses a cover, `onChange` opens the cover editor.
 */
export function SuggestedCover({
  album,
  artist,
  fallback,
  onUse,
  onChange,
}: {
  readonly album: string;
  readonly artist: string;
  readonly fallback: ReactNode;
  readonly onUse: (cover: string) => Promise<void>;
  readonly onChange: () => void;
}) {
  const t = useWords();
  const [state, setState] = useState<AlbumCovers>();
  const [reads, setReads] = useState(0);
  const [using, setUsing] = useState(false);
  const [error, setError] = useState("");
  // MusicBrainz is asked once on its own; then only from the cover editor.
  const asked = useRef(false);
  const readAgain = () => {
    setReads((count) => count + 1);
  };
  const onRead = useEffectEvent((known: AlbumCovers) => {
    setState(known);
    if (known.due && known.may_find && !known.finding && !asked.current) {
      asked.current = true;
      api.findAlbumCovers(album, artist).then(readAgain, readAgain);
    }
  });
  useEffect(() => {
    let live = true;
    api.albumCovers(album, artist).then(
      (known) => {
        if (live) onRead(known);
      },
      () => {
        // Without what is known, the empty cover stands as it is.
      },
    );
    return () => {
      live = false;
    };
  }, [album, artist, reads]);
  const asking = state?.finding === true;
  useEffect(() => {
    if (!asking) return undefined;
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [asking, reads]);

  const suggested = state?.suggested ?? null;
  const found = state?.covers.find((each) => each.cover === suggested);
  const problem = error !== "" && (
    <p className="error" role="alert">
      {t("Could not update the cover suggestions: {{detail}}", { detail: error })}
    </p>
  );
  if (suggested === null || found === undefined) {
    return (
      <div className="photo-suggestion">
        {fallback}
        {asking && (
          <p className="cover-looking" role="status">
            {t(
              state.waiting
                ? "Waiting for Online to look on MusicBrainz…"
                : "Looking on MusicBrainz…",
            )}
          </p>
        )}
        {problem}
      </div>
    );
  }
  const release = found.release;
  const pick = state?.pick?.release_id === release.release_id ? state.pick : null;
  const why =
    pick === null
      ? t("MusicBrainz's {{release}}", {
          release: [release.title, releaseOf(release, t)].filter(Boolean).join(t(", ")),
        })
      : t("{{model}} picked this: {{reason}}", { model: pick.model, reason: pick.why });
  const use = async () => {
    setUsing(true);
    setError("");
    try {
      await onUse(suggested);
    } catch (failed) {
      setError(messageOf(failed));
    } finally {
      setUsing(false);
    }
  };
  const dismiss = () => {
    setError("");
    setState((was) => (was === undefined ? was : { ...was, suggested: null }));
    api.dismissAlbumCover(album, artist, suggested).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  };
  return (
    <div className="photo-suggestion">
      <SuggestedFrame
        of={album}
        noun="cover"
        why={why}
        picked={pick !== null}
        className="album-art"
        busy={using}
        onUse={() => void use()}
        onDismiss={dismiss}
        onChange={onChange}
      >
        <Cover size="medium" cover={suggested} />
      </SuggestedFrame>
      {problem}
    </div>
  );
}
