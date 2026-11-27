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
import { type Words, useWords } from "../locale";

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
  const t = useWords();
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
          {t("Artists sharing a name")}
          <span className="clean-up-count">{toTellApartOf(names)}</span>
        </h3>
      </header>
      <p className="tidy-lead">
        {t(
          "One name can stand for different artists. Choose who each album is by; songs added later wait here to be confirmed.",
        )}
      </p>
      {waiting.length === 0 ? (
        <p className="empty">{t("Every album of a name shared by artists is confirmed.")}</p>
      ) : (
        <ul className="tidy-list" aria-label={t("Names to tell apart")}>
          {waiting.map(row)}
        </ul>
      )}
      {done.length > 0 && (
        <details className="split-names-decided">
          <summary className="split-names-decided-summary">
            {t("shared_names_done", { count: done.length })}
          </summary>
          <ul className="tidy-list" aria-label={t("Names done")}>
            {done.map(row)}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A choice of artist for an album: `a:` and one of the Library's, or `m:` and MusicBrainz's. */
type Choice = `a:${string}` | `m:${string}`;
const albumKey = ({ album, artist_id }: SharedName["albums"][number]) =>
  `${album}\u0000${artist_id}`;

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
  const t = useWords();
  const [picked, setPicked] = useState<ReadonlyMap<string, Choice>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = optionsOf(named, artists, t);
  const choiceOf = (album: SharedName["albums"][number]): Choice =>
    picked.get(albumKey(album)) ?? `a:${album.artist_id}`;
  const changed = named.albums.some((album) => choiceOf(album) !== `a:${album.artist_id}`);
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
        named.albums.map((album): SongsBy => {
          const choice = choiceOf(album);
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
        <span className="tidy-meta">{t("Kept as one artist")}</span>
        <div className="tidy-actions">
          <button
            type="button"
            className="secondary outline dialog-button"
            aria-label={t("Undo keeping {{name}} as one artist", { name: named.name })}
            disabled={busy}
            onClick={() => void run(() => api.forgetSharedNames([named.name]))}
          >
            {t("Undo")}
          </button>
        </div>
        {error !== "" && (
          <p className="error" role="alert">
            {t("Could not change this name: {{detail}}", { detail: error })}
          </p>
        )}
      </li>
    );
  }
  return (
    <li className="tidy-row shared-name-row">
      <strong className="tidy-name">{named.name}</strong>
      <span className="tidy-meta">
        {several
          ? t("Names {{count}} artists", { count: named.artists.length })
          : t("MusicBrainz knows {{count}} artists called {{name}}", {
              count: named.known.length,
              name: named.name,
            })}
      </span>
      <ul className="shared-albums" aria-label={t("Albums by {{name}}", { name: named.name })}>
        {named.albums.map((album) => {
          const albumName = album.album === "" ? t("No album") : album.album;
          const count = album.track_ids.length;
          const shown = album.track_ids.slice(0, TITLES_SHOWN).map((id) => titles.get(id) ?? "");
          const more = count - TITLES_SHOWN;
          return (
            <li key={albumKey(album)} className="shared-album">
              <span className="shared-album-name">{albumName}</span>
              <span
                className="shared-album-songs"
                title={[
                  ...shown,
                  ...(more > 0 ? [t("and {{count}} more", { count: more })] : []),
                ].join("\n")}
              >
                {t("song_count", { count })}
              </span>
              {album.confirmed && (
                <CheckIcon
                  className="shared-album-confirmed"
                  weight="bold"
                  aria-label={t("Confirmed")}
                  role="img"
                />
              )}
              <select
                className="shared-album-artist"
                aria-label={t("Who {{album}} is by", { album: albumName })}
                value={choiceOf(album)}
                disabled={busy}
                onChange={(event) => {
                  const choice = event.target.value as Choice;
                  setPicked((now) => new Map(now).set(albumKey(album), choice));
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
            aria-label={t("Keep {{name}} as one artist", { name: named.name })}
            disabled={busy}
            onClick={() => void run(() => api.keepSharedNames([named.name]))}
          >
            {t("Keep as one")}
          </button>
        )}
        <button
          type="button"
          className="dialog-button"
          aria-label={t("Confirm who each album by {{name}} is by", { name: named.name })}
          disabled={busy || (!named.waiting && !changed)}
          aria-busy={busy}
          onClick={() => void confirm()}
        >
          {t(named.waiting ? "Confirm" : "Save")}
        </button>
      </div>
      {error !== "" && (
        <p className="error" role="alert">
          {t("Could not change this name: {{detail}}", { detail: error })}
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
  t: Words,
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
              : t("{{name}}, on {{album}}", { name: named.name, album: album.album }),
      };
    }),
    ...named.known
      .filter((id) => !linked.has(id))
      .map((id) => ({ value: `m:${id}` as const, label: describeKnown(artists.get(id)) })),
  ];
}
