/**
 * @file Finding photos of artists with none, a section of Clean up.
 *
 * Each artist linked to MusicBrainz with no photo for which Deezer has a picture that
 * fits shows it, ringed and tagged as a suggestion, to use in one click; *Use all* uses
 * every one. The rest are counted: those Deezer has nothing for, and those not looked up
 * yet, which are looked up as their songs come up next, or all at once on opening Clean
 * up, as Settings → Deezer says. While Deezer is asked, it reads again every few seconds.
 */

import { CircleNotchIcon, SparkleIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useState } from "react";

import { type MissingPhoto, api } from "../api";
import { photosToUseOf } from "../library/cleanUp";
import { hrefOf } from "../routes";
import { Cover } from "./Cover";

const READ_EVERY_MS = 3000;

/** The artists with no photo, each with the one suggested, to use. */
export function FindPhotos({
  artists,
  onChanged,
}: {
  readonly artists: readonly MissingPhoto[];
  /** Called after a change, or to read the artists again. */
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const readAgain = useEffectEvent(onChanged);
  // Opened, every artist with no photo is looked up, while the household has every one be.
  useEffect(() => {
    api.findPhotos(null).then(
      ({ asked }) => {
        if (asked > 0) {
          readAgain();
        }
      },
      () => {
        // Nothing waits on it: the artists are looked up as their songs come up next.
      },
    );
  }, []);
  const finding = artists.filter((each) => each.finding).length;
  useEffect(() => {
    if (finding === 0) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [artists, finding]);

  const suggested = artists.filter(
    (each): each is MissingPhoto & { readonly suggested: string } => each.suggested !== null,
  );
  const unfit = artists.filter((each) => each.suggested === null && each.found).length;
  const unasked = artists.filter((each) => !each.found).length;
  const use = async (
    chosen: readonly { readonly artist_id: string; readonly suggested: string }[],
  ) => {
    setBusy(true);
    setError("");
    try {
      for (const each of chosen) {
        await api.useArtistPhotoCover(each.artist_id, each.suggested);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <section className="clean-up-section" aria-labelledby="find-photos-title">
      <header className="clean-up-head">
        <h3 id="find-photos-title">
          <UserCircleIcon className="clean-up-icon" weight="bold" aria-hidden />
          Find artist photos
          <span className="clean-up-count">{photosToUseOf(artists)}</span>
        </h3>
        {suggested.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void use(suggested)}
          >
            {`Use all ${String(suggested.length)}`}
          </button>
        )}
      </header>
      <p className="tidy-lead">
        A photo found on Deezer for each artist with none. Using one makes it the artist's photo.
      </p>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {finding > 0 && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {`Looking on Deezer for ${String(finding)} ${finding === 1 ? "artist" : "artists"}…`}
        </p>
      )}
      {suggested.length > 0 && (
        <ul className="photo-suggestions" aria-label="Photos suggested">
          {suggested.map((each) => (
            <li key={each.artist_id} className="photo-suggestion-item">
              <div className="photo-suggestion-frame">
                <Cover cover={each.suggested} className="photo-suggestion-picture" />
                <span className="photo-suggestion-tag" aria-hidden>
                  {each.picked ? (
                    <>
                      <SparkleIcon weight="fill" /> AI pick
                    </>
                  ) : (
                    "Suggested"
                  )}
                </span>
              </div>
              <a
                className="photo-suggestion-name"
                href={hrefOf({ view: "artist", name: each.name })}
              >
                {each.name}
              </a>
              <span className="tidy-meta">
                {each.songs === 1 ? "1 song" : `${String(each.songs)} songs`}
              </span>
              <button
                type="button"
                className="secondary outline dialog-button"
                aria-label={`Use the photo suggested for ${each.name}`}
                disabled={busy}
                onClick={() => void use([each])}
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      )}
      {unfit + unasked > 0 && (
        <p className="tidy-lead">
          {[
            unfit > 0 &&
              `${String(unfit)} ${unfit === 1 ? "artist has" : "artists have"} no picture on Deezer that fits`,
            unasked > 0 &&
              `${String(unasked)} ${unasked === 1 ? "artist isn't" : "artists aren't"} looked up yet`,
          ]
            .filter(Boolean)
            .join("; ")}
          .{" "}
          {unasked > 0 && (
            <>
              They are looked up as{" "}
              <a href={hrefOf({ view: "settings", section: "deezer" })}>Settings → Deezer</a> says.
            </>
          )}
        </p>
      )}
    </section>
  );
}
