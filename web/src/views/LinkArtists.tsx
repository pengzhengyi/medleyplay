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
 *
 * Each row's actions line up at its right, so a list is worked down in one column. A
 * name's recommended artist, the one going by it exactly, is marked, and *Link all*
 * links every name that has one. Linking a name moves to the next name's *Link*, so
 * Enter links it in turn.
 */

import { KeyReturnIcon, LinkSimpleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

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
  // Only a choice made here is kept; until one is, a name's recommendation is chosen.
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const [linkingAll, setLinkingAll] = useState(false);
  const linkButtons = useRef(new Map<string, HTMLButtonElement>());
  const shown = names.names.filter((each) => each.look_up !== "never");
  const artists = new Map(names.artists.map((artist) => [artist.id, artist]));
  const toLookUp = shown
    .filter(
      (each) => each.look_up === "yes" && !each.linked && each.looked_at === null && !each.finding,
    )
    .map((each) => each.name);
  const rows = shown.map((named) => {
    const offered = offeredOf(named, artists);
    const choice = picked.get(named.key);
    const chosen = choice ?? named.suggested ?? offered[0]?.id ?? "";
    const linkable = !named.linked && !named.finding && offered.length > 0;
    const recommended = linkable && (choice ?? named.suggested) !== null && chosen !== "";
    return { named, offered, chosen, linkable, recommended };
  });
  const toLink = rows.filter((row) => row.recommended);

  const lookUp = (wanted: readonly string[]) => {
    setError("");
    api.lookUpArtists(wanted).then(onChanged, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure));
    });
  };
  /** Move to the Link of the next name that can be linked after `key`. */
  const focusAfter = (key: string) => {
    const at = rows.findIndex((row) => row.named.key === key);
    const next = rows.slice(at + 1).find((row) => row.linkable);
    if (next !== undefined) {
      linkButtons.current.get(next.named.key)?.focus();
    }
  };
  const linkAll = async () => {
    setError("");
    setLinkingAll(true);
    try {
      for (const row of toLink) {
        await api.linkArtist(row.named.name, row.chosen);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLinkingAll(false);
      onChanged();
    }
  };
  return (
    <section className="clean-up-section" aria-labelledby="link-artists-title">
      <header className="clean-up-head">
        <h3 id="link-artists-title">
          <LinkSimpleIcon className="clean-up-icon" weight="bold" aria-hidden />
          Link artist names
          <span className="clean-up-count">{unlinkedOf(names)}</span>
        </h3>
        <span className="clean-up-head-actions">
          {toLookUp.length > 0 && (
            <button
              type="button"
              className="secondary outline dialog-button"
              onClick={() => {
                lookUp(toLookUp);
              }}
            >
              {`Look up ${String(toLookUp.length)} ${toLookUp.length === 1 ? "name" : "names"}`}
            </button>
          )}
          {toLink.length > 0 && (
            <button
              type="button"
              className="dialog-button"
              disabled={linkingAll}
              aria-busy={linkingAll}
              onClick={() => void linkAll()}
            >
              {`Link ${String(toLink.length)} recommended`}
            </button>
          )}
        </span>
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
          {rows.map(({ named, offered, chosen, recommended }) => (
            <NameRow
              key={named.key}
              named={named}
              offered={offered}
              artists={artists}
              chosen={chosen}
              recommended={recommended}
              linkRef={(button) => {
                if (button === null) {
                  linkButtons.current.delete(named.key);
                } else {
                  linkButtons.current.set(named.key, button);
                }
              }}
              onPick={(id) => {
                setPicked((now) => new Map(now).set(named.key, id));
              }}
              onLookUp={() => {
                lookUp([named.name]);
              }}
              onLinked={() => {
                focusAfter(named.key);
              }}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The artists a name is offered, best first, among those known. */
function offeredOf(named: ArtistName, artists: ReadonlyMap<string, KnownArtist>): KnownArtist[] {
  return named.candidates
    .map((candidate) => artists.get(candidate.artist_id))
    .filter((artist) => artist !== undefined)
    .slice(0, OFFERED);
}

function NameRow({
  named,
  offered,
  artists,
  chosen,
  recommended,
  linkRef,
  onPick,
  onLookUp,
  onLinked,
  onChanged,
}: {
  readonly named: ArtistName;
  readonly offered: readonly KnownArtist[];
  readonly artists: ReadonlyMap<string, KnownArtist>;
  /** The artist chosen to link, `""` for none. */
  readonly chosen: string;
  /** Whether the choice is a recommendation, so it and Link are marked. */
  readonly recommended: boolean;
  readonly linkRef: (button: HTMLButtonElement | null) => void;
  readonly onPick: (id: string) => void;
  readonly onLookUp: () => void;
  /** Called once the name is linked to an artist, to move on to the next. */
  readonly onLinked: () => void;
  readonly onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const act = (change: Promise<unknown>, then: () => void = () => undefined) => {
    setError("");
    change.then(
      () => {
        then();
        onChanged();
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  const songs = `${String(named.tracks)} ${named.tracks === 1 ? "song" : "songs"}`;
  const choosing = !named.linked && !named.finding && named.look_up !== "tidy_first";
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
          </>
        ) : named.finding ? (
          <span className="link-to">
            <SpinnerGapIcon className="spin" aria-hidden /> Looking it up on MusicBrainz…
          </span>
        ) : named.look_up === "tidy_first" ? (
          <span className="link-to">Tidy the name first, then look it up</span>
        ) : named.looked_at === null && offered.length === 0 ? (
          <span className="link-to">Not looked up yet</span>
        ) : offered.length === 0 ? (
          <span className="link-to">MusicBrainz knows no artist by this name</span>
        ) : (
          <fieldset className="link-choices">
            <legend className="visually-hidden">{`Artists for ${named.name}`}</legend>
            {offered.map((artist) => {
              const marked = recommended && chosen === artist.id;
              return (
                <label
                  key={artist.id}
                  className={marked ? "link-choice recommended" : "link-choice"}
                >
                  <input
                    type="radio"
                    className="link-choice-box"
                    name={`artist-${named.key}`}
                    checked={chosen === artist.id}
                    onChange={() => {
                      onPick(artist.id);
                    }}
                  />
                  <span>{describe(artist)}</span>
                  {marked && artist.id === named.suggested && (
                    <span className="link-tag">Goes by this name</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        )}
      </div>
      <span className="link-actions">
        {named.linked ? (
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
        ) : (
          choosing && (
            <>
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
              {(named.looked_at !== null || offered.length > 0) && (
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
              )}
              {offered.length > 0 && (
                <span className="link-go">
                  <button
                    ref={linkRef}
                    type="button"
                    className={recommended ? "dialog-button recommended" : "dialog-button"}
                    aria-label={`Link ${named.name}`}
                    disabled={chosen === ""}
                    onClick={() => {
                      act(api.linkArtist(named.name, chosen), onLinked);
                    }}
                  >
                    Link
                  </button>
                  <span className="link-hint" aria-hidden>
                    <KeyReturnIcon /> to link
                  </span>
                </span>
              )}
            </>
          )
        )}
      </span>
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
