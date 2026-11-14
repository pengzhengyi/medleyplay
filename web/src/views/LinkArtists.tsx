/**
 * @file Linking the Library's artist names to the artists MusicBrainz knows.
 *
 * A capsule says how many names could be linked, and only shows while some can. It
 * opens the list: each name with its songs, and what is known of it. A name not
 * looked up yet can be, one by one or all at once; a name looked up offers the
 * artists MusicBrainz knows by it, the one going by it exactly chosen already, to
 * link, or none of them. A linked name says what it is linked to, and can be
 * unlinked. Names linked to one artist count as one artist across the Library.
 */

import { LinkSimpleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { type ArtistName, type ArtistNames, type KnownArtist, api } from "../api";
import { Modal } from "./Modal";

/** The most artists offered for one name. */
const OFFERED = 3;

/** The capsule that opens the names to link, and the list it opens. */
export function LinkArtists({
  names,
  onChanged,
}: {
  readonly names: ArtistNames;
  /** Called after a change, so the names are read again. */
  readonly onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = names.names.filter((each) => each.look_up !== "never");
  const unlinked = shown.filter((each) => each.look_up === "yes" && !each.linked).length;
  if (unlinked === 0 && !open) {
    return null;
  }
  return (
    <>
      {unlinked > 0 && (
        <button
          type="button"
          className="tidy-capsule"
          title="Count the names one artist goes by as one artist"
          onClick={() => {
            setOpen(true);
          }}
        >
          <LinkSimpleIcon weight="bold" aria-hidden />
          {`Link ${String(unlinked)} artist ${unlinked === 1 ? "name" : "names"}`}
        </button>
      )}
      {open && (
        <LinkList
          names={shown}
          artists={new Map(names.artists.map((artist) => [artist.id, artist]))}
          onChanged={onChanged}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function LinkList({
  names,
  artists,
  onChanged,
  onClose,
}: {
  readonly names: readonly ArtistName[];
  readonly artists: ReadonlyMap<string, KnownArtist>;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const toLookUp = names
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
    <Modal ref={dialog} className="link-artists" labelledBy="link-artists-title" onClose={onClose}>
      <div className="card">
        <h2 id="link-artists-title">Link names to artists</h2>
        <p className="tidy-lead">
          Names linked to one artist count as one artist, each song keeping its name as written.
          MusicBrainz is asked about each name, a second apart.
        </p>
        {toLookUp.length > 0 && (
          <p className="link-all">
            <button
              type="button"
              className="dialog-button"
              onClick={() => {
                lookUp(toLookUp);
              }}
            >
              {`Look up ${String(toLookUp.length)} ${toLookUp.length === 1 ? "name" : "names"}`}
            </button>
          </p>
        )}
        {error !== "" && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <ul className="tidy-list" aria-label="Artist names">
          {names.map((each) => (
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
        <footer className="dialog-buttons">
          <button
            type="button"
            className="secondary outline dialog-button"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </footer>
      </div>
    </Modal>
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
  const [chosen, setChosen] = useState(named.suggested ?? offered[0]?.id ?? "");
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
        ) : named.looked_at === null ? (
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
                        setChosen(artist.id);
                      }}
                    />
                    <span>{describe(artist)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <span className="tidy-actions">
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
