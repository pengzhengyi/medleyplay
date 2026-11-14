/**
 * @file Linking the Library's artist names to the artists MusicBrainz knows.
 *
 * A section of Clean up: each name with its songs, and what is known of it. A name not
 * looked up yet can be, one by one or all at once; a name looked up offers the artists
 * MusicBrainz knows by it, the one going by it exactly chosen already, to link, or
 * none of them. A name an artist already linked goes by offers that artist at once,
 * still to look up if it isn't the one. A linked name says what it is linked to, and
 * can be unlinked; while Wikidata is asked the artist's other names, the row says so.
 * Names linked to one artist count as one artist across the Library.
 */

import { LinkSimpleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { type ArtistName, type ArtistNames, type KnownArtist, api } from "../api";
import { unlinkedOf } from "../library/cleanUp";

/** The most artists offered for one name. */
const OFFERED = 3;

/** The names to link, each with what is known of it, and all to look up at once. */
export function LinkArtists({
  names,
  onChanged,
}: {
  readonly names: ArtistNames;
  /** Called after a change, so the names are read again. */
  readonly onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const shown = names.names.filter((each) => each.look_up !== "never");
  const artists = new Map(names.artists.map((artist) => [artist.id, artist]));
  const toLookUp = shown
    .filter(
      (each) => each.look_up === "yes" && !each.linked && each.looked_at === null && !each.finding,
    )
    .map((each) => each.name);
  const lookUp = (wanted: readonly string[]) => {
    setError("");
    api.lookUpArtists(wanted).then(onChanged, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure));
    });
  };
  return (
    <section className="clean-up-section" aria-labelledby="link-artists-title">
      <header className="clean-up-head">
        <h3 id="link-artists-title">
          <LinkSimpleIcon className="clean-up-icon" weight="bold" aria-hidden />
          Link artist names
          <span className="clean-up-count">{unlinkedOf(names)}</span>
        </h3>
        {toLookUp.length > 0 && (
          <button
            type="button"
            className="dialog-button"
            onClick={() => {
              lookUp(toLookUp);
            }}
          >
            {`Look up ${String(toLookUp.length)} ${toLookUp.length === 1 ? "name" : "names"}`}
          </button>
        )}
      </header>
      <p className="tidy-lead">
        Names linked to one artist count as one artist, each song keeping its name as written.
        MusicBrainz is asked about each name, a second apart.
      </p>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="empty">No artist name to link yet.</p>
      ) : (
        <ul className="tidy-list" aria-label="Artist names">
          {shown.map((each) => (
            <NameRow
              key={each.key}
              named={each}
              artists={artists}
              onLookUp={() => {
                lookUp([each.name]);
              }}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NameRow({
  named,
  artists,
  onLookUp,
  onChanged,
}: {
  readonly named: ArtistName;
  readonly artists: ReadonlyMap<string, KnownArtist>;
  readonly onLookUp: () => void;
  readonly onChanged: () => void;
}) {
  const offered = named.candidates
    .map((candidate) => artists.get(candidate.artist_id))
    .filter((artist) => artist !== undefined)
    .slice(0, OFFERED);
  // Only a choice made here is kept; until one is, the suggestion is chosen, as it
  // comes once the name has been looked up.
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const chosen = picked ?? named.suggested ?? offered[0]?.id ?? "";
  const [error, setError] = useState("");
  const act = (change: Promise<unknown>) => {
    setError("");
    change.then(onChanged, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure));
    });
  };
  const songs = `${String(named.tracks)} ${named.tracks === 1 ? "song" : "songs"}`;
  return (
    <li className="tidy-row link-row">
      <div className="tidy-names-pair">
        <strong className="tidy-name">{named.name}</strong>
        <span className="tidy-meta">{songs}</span>
      </div>
      <div className="link-state">
        {named.linked ? (
          <>
            <span className="link-to">
              {named.artist_id === null
                ? "Not on MusicBrainz"
                : `Linked to ${describe(artists.get(named.artist_id))}`}
            </span>
            {named.finding && (
              <span className="link-to">
                <SpinnerGapIcon className="spin" aria-hidden /> Finding its other names on Wikidata…
              </span>
            )}
            <button
              type="button"
              className="secondary outline dialog-button"
              aria-label={`Unlink ${named.name}`}
              onClick={() => {
                act(api.unlinkArtist(named.name));
              }}
            >
              Unlink
            </button>
          </>
        ) : named.finding ? (
          <span className="link-to">
            <SpinnerGapIcon className="spin" aria-hidden /> Looking it up on MusicBrainz…
          </span>
        ) : named.look_up === "tidy_first" ? (
          <span className="link-to">Tidy the name first, then look it up</span>
        ) : named.looked_at === null && offered.length === 0 ? (
          <button
            type="button"
            className="secondary outline dialog-button"
            aria-label={`Look up ${named.name}`}
            onClick={onLookUp}
          >
            Look up
          </button>
        ) : (
          <>
            {offered.length === 0 ? (
              <span className="link-to">MusicBrainz knows no artist by this name</span>
            ) : (
              <fieldset className="link-choices">
                <legend className="visually-hidden">{`Artists for ${named.name}`}</legend>
                {offered.map((artist) => (
                  <label key={artist.id} className="link-choice">
                    <input
                      type="radio"
                      className="link-choice-box"
                      name={`artist-${named.key}`}
                      checked={chosen === artist.id}
                      onChange={() => {
                        setPicked(artist.id);
                      }}
                    />
                    <span>{describe(artist)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <span className="tidy-actions">
              {named.looked_at === null && (
                <button
                  type="button"
                  className="secondary outline dialog-button"
                  aria-label={`Look up ${named.name}`}
                  onClick={onLookUp}
                >
                  Look up
                </button>
              )}
              <button
                type="button"
                className="secondary outline dialog-button"
                aria-label={`None of these for ${named.name}`}
                onClick={() => {
                  act(api.linkArtist(named.name, null));
                }}
              >
                {offered.length === 0 ? "Keep apart" : "None of these"}
              </button>
              {offered.length > 0 && (
                <button
                  type="button"
                  className="dialog-button"
                  aria-label={`Link ${named.name}`}
                  disabled={chosen === ""}
                  onClick={() => {
                    act(api.linkArtist(named.name, chosen));
                  }}
                >
                  Link
                </button>
              )}
            </span>
          </>
        )}
      </div>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** Name an artist as the list shows it: its name, what tells it apart, and its country. */
function describe(artist: KnownArtist | undefined): string {
  if (artist === undefined) {
    return "an artist no longer known";
  }
  const about = [artist.disambiguation, artist.country].filter(Boolean).join(", ");
  return about === "" ? artist.name : `${artist.name} (${about})`;
}
