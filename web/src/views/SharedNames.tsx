/**
 * @file Telling apart artists who share a name, a section of Clean up.
 *
 * A name is listed when MusicBrainz knows two or more artists going by it exactly, or
 * when it names several of the Library's artists already. Its songs show by album, each
 * album with the artist it is by now, to change: one of the name's artists, or an artist
 * MusicBrainz knows by the name, which the album's songs are then linked to. *Confirm*
 * keeps the artist chosen for every album; songs added later wait here until confirmed.
 * A name naming one artist may instead be kept as one. Names with nothing waiting fold
 * away at the end, still to change, or to undo keeping them as one.
 */

import { CheckIcon, UsersIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { type KnownArtist, type SharedName, type SongsBy, type Track, api } from "../api";
import { toTellApartOf } from "../library/cleanUp";
import { describeKnown } from "../library/knownArtists";

/** The most song titles an album's song count shows on hover. */
const TITLES_SHOWN = 8;

/** The names that may name several artists, each to tell apart by album or keep as one. */
export function SharedNames({
  names,
  known,
  tracks = [],
  onChanged,
}: {
  readonly names: readonly SharedName[];
  /** The artists MusicBrainz knows, to say which is meant. */
  readonly known: readonly KnownArtist[];
  /** The Library's songs, to show each album's titles. */
  readonly tracks?: readonly Track[];
  /** Called after a change, so the names are read again. */
  readonly onChanged: () => void;
}) {
  const artists = new Map(known.map((artist) => [artist.id, artist]));
  const titles = new Map(tracks.map((track) => [track.id, track.title]));
  const waiting = names.filter((each) => each.waiting);
  const done = names.filter((each) => !each.waiting);
  const row = (named: SharedName) => (
    <NameRow
      key={named.name}
      named={named}
      artists={artists}
      titles={titles}
      onChanged={onChanged}
    />
  );
  return (
    <section className="clean-up-section" aria-labelledby="shared-names-title">
      <header className="clean-up-head">
        <h3 id="shared-names-title">
          <UsersIcon className="clean-up-icon" weight="bold" aria-hidden />
          Artists sharing a name
          <span className="clean-up-count">{toTellApartOf(names)}</span>
        </h3>
      </header>
      <p className="tidy-lead">
        One name can stand for different artists. Choose who each album is by; songs added later
        wait here to be confirmed.
      </p>
      {waiting.length === 0 ? (
        <p className="empty">Every album of a name shared by artists is confirmed.</p>
      ) : (
        <ul className="tidy-list" aria-label="Names to tell apart">
          {waiting.map(row)}
        </ul>
      )}
      {done.length > 0 && (
        <details className="split-names-decided">
          <summary className="split-names-decided-summary">
            {done.length === 1 ? "1 name done" : `${String(done.length)} names done`}
          </summary>
          <ul className="tidy-list" aria-label="Names done">
            {done.map(row)}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A choice of artist for an album: `a:` and one of the Library's, or `m:` and MusicBrainz's. */
type Choice = `a:${string}` | `m:${string}`;

function NameRow({
  named,
  artists,
  titles,
  onChanged,
}: {
  readonly named: SharedName;
  readonly artists: ReadonlyMap<string, KnownArtist>;
  readonly titles: ReadonlyMap<number, string>;
  readonly onChanged: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlyMap<number, Choice>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = optionsOf(named, artists);
  const choiceOf = (at: number, artistId: string): Choice => picked.get(at) ?? `a:${artistId}`;
  const changed = named.albums.some(
    (album, at) => choiceOf(at, album.artist_id) !== `a:${album.artist_id}`,
  );
  const several = named.artists.length > 1;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setPicked(new Map());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const confirm = () =>
    run(() =>
      api.tellApart(
        named.name,
        named.albums.map((album, at): SongsBy => {
          const choice = choiceOf(at, album.artist_id);
          const id = choice.slice(2);
          return choice.startsWith("m:")
            ? { track_ids: album.track_ids, musicbrainz_id: id }
            : { track_ids: album.track_ids, artist_id: id };
        }),
      ),
    );
  if (named.kept && !several) {
    return (
      <li className="tidy-row">
        <strong className="tidy-name">{named.name}</strong>
        <span className="tidy-meta">Kept as one artist</span>
        <div className="tidy-actions">
          <button
            type="button"
            className="secondary outline dialog-button"
            aria-label={`Undo keeping ${named.name} as one artist`}
            disabled={busy}
            onClick={() => void run(() => api.forgetSharedNames([named.name]))}
          >
            Undo
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="tidy-row shared-name-row">
      <strong className="tidy-name">{named.name}</strong>
      <span className="tidy-meta">
        {several
          ? `Names ${String(named.artists.length)} artists`
          : `MusicBrainz knows ${String(named.known.length)} artists called ${named.name}`}
      </span>
      <ul className="shared-albums" aria-label={`Albums by ${named.name}`}>
        {named.albums.map((album, at) => {
          const albumName = album.album === "" ? "No album" : album.album;
          const count = album.track_ids.length;
          const shown = album.track_ids.slice(0, TITLES_SHOWN).map((id) => titles.get(id) ?? "");
          const more = count - TITLES_SHOWN;
          return (
            <li key={`${album.album}\u0000${album.artist_id}`} className="shared-album">
              <span className="shared-album-name">{albumName}</span>
              <span
                className="shared-album-songs"
                title={[...shown, ...(more > 0 ? [`and ${String(more)} more`] : [])].join("\n")}
              >
                {count === 1 ? "1 song" : `${String(count)} songs`}
              </span>
              {album.confirmed && (
                <CheckIcon
                  className="shared-album-confirmed"
                  weight="bold"
                  aria-label="Confirmed"
                  role="img"
                />
              )}
              <select
                className="shared-album-artist"
                aria-label={`Who ${albumName} is by`}
                value={choiceOf(at, album.artist_id)}
                disabled={busy}
                onChange={(event) => {
                  const choice = event.target.value as Choice;
                  setPicked((now) => new Map(now).set(at, choice));
                }}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <div className="tidy-actions">
        {!several && (
          <button
            type="button"
            className="secondary outline dialog-button"
            aria-label={`Keep ${named.name} as one artist`}
            disabled={busy}
            onClick={() => void run(() => api.keepSharedNames([named.name]))}
          >
            Keep as one
          </button>
        )}
        <button
          type="button"
          className="dialog-button"
          aria-label={`Confirm who each album by ${named.name} is by`}
          disabled={busy || (!named.waiting && !changed)}
          aria-busy={busy}
          onClick={() => void confirm()}
        >
          {named.waiting ? "Confirm" : "Save"}
        </button>
      </div>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The artists an album of the name may be by: the name's own, as the MusicBrainz artist
 * each is linked to or else by the album most of its songs are on, then the artists
 * MusicBrainz knows by the name that none of them is.
 */
function optionsOf(
  named: SharedName,
  artists: ReadonlyMap<string, KnownArtist>,
): readonly { readonly value: Choice; readonly label: string }[] {
  const linked = new Set(named.artists.map((each) => each.musicbrainz_id));
  return [
    ...named.artists.map((each) => {
      const album = named.albums.find((one) => one.artist_id === each.artist_id && one.album);
      return {
        value: `a:${each.artist_id}` as const,
        label:
          each.musicbrainz_id !== null
            ? describeKnown(artists.get(each.musicbrainz_id))
            : album === undefined
              ? named.name
              : `${named.name}, on ${album.album}`,
      };
    }),
    ...named.known
      .filter((id) => !linked.has(id))
      .map((id) => ({ value: `m:${id}` as const, label: describeKnown(artists.get(id)) })),
  ];
}
