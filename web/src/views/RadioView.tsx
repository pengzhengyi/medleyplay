/**
 * @file The Radio tab: the Account's own station, and shelves of albums to play.
 */

import { PlayIcon, RadioIcon } from "@phosphor-icons/react";
import { useMemo } from "react";

import type { Track } from "../api";
import { type AlbumCard, albumShelves, seedOf, seeded } from "../library/radio";
import type { Station } from "../library/useStation";
import { hrefOf } from "../routes";
import { Cover } from "./Cover";

/** The day `now` falls on here, as `2026-11-06`: the shelves keep their order for it. */
const dayOf = (now: Date) =>
  `${String(now.getFullYear())}-${String(now.getMonth() + 1)}-${String(now.getDate())}`;

/** The album's most played song, or its first: a station from the album starts there. */
const mostPlayed = (album: AlbumCard): Track | undefined =>
  [...album.tracks].sort((a, b) => b.play_count - a.play_count)[0];

export function RadioView({
  tracks,
  station,
  onPlayAll,
  accountId,
  now = new Date(),
}: {
  readonly tracks: readonly Track[];
  readonly station: Station;
  readonly onPlayAll: (tracks: readonly Track[], shuffled: boolean) => void;
  readonly accountId: number;
  /** The time the shelves are for; the clock's by default. */
  readonly now?: Date;
}) {
  const day = dayOf(now);
  const shelves = useMemo(
    () => albumShelves(tracks, now, seeded(seedOf(`${String(accountId)}:${day}`))),
    // The shelves change with the Tracks and the day, not with every moment of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, accountId, day],
  );
  const { seed } = station;
  return (
    <>
      <header className="view-heading">
        <h2 className="section">Radio</h2>
      </header>
      <section className="my-station" aria-label="My station">
        <span className="my-station-icon" aria-hidden>
          <RadioIcon weight="duotone" />
        </span>
        <div className="my-station-text">
          <h3>My station</h3>
          <p>
            {station.own && seed !== undefined
              ? `Playing from ${seed.title} by ${seed.artist}`
              : "Songs you like, and more like them, for as long as you listen."}
          </p>
        </div>
        <button
          type="button"
          className="my-station-play"
          onClick={() => {
            station.start();
          }}
        >
          <PlayIcon weight="fill" aria-hidden />
          Play my station
        </button>
      </section>
      {shelves.length === 0 && (
        <p className="empty">
          Play, rate, and add some albums, and albums for you show here. An album here has at least
          two songs that play now.
        </p>
      )}
      {shelves.map((shelf) => (
        <section key={shelf.id} className="shelf" aria-label={shelf.title}>
          <h3 className="shelf-title">{shelf.title}</h3>
          <ul className="shelf-albums">
            {shelf.albums.map((album) => {
              const first = mostPlayed(album);
              return (
                <li key={album.key} className="shelf-album">
                  {album.album === "" ? (
                    <div className="shelf-link">
                      <Cover cover={album.cover} className="cover-tile" />
                      <span className="group-name">{album.name}</span>
                      <span className="group-meta">{album.artist || "Unknown artist"}</span>
                    </div>
                  ) : (
                    <a
                      className="shelf-link"
                      href={hrefOf({ view: "album", artist: album.artist, name: album.album })}
                    >
                      <Cover cover={album.cover} className="cover-tile" />
                      <span className="group-name">{album.name}</span>
                      <span className="group-meta">{album.artist || "Unknown artist"}</span>
                    </a>
                  )}
                  <span className="shelf-reason">{album.reason}</span>
                  <span className="shelf-actions">
                    <button
                      type="button"
                      className="shelf-button"
                      aria-label={`Play ${album.name}`}
                      title="Play"
                      onClick={() => {
                        onPlayAll(album.tracks, false);
                      }}
                    >
                      <PlayIcon weight="fill" aria-hidden />
                    </button>
                    {first !== undefined && (
                      <button
                        type="button"
                        className="shelf-button"
                        aria-label={`Start a station from ${album.name}`}
                        title="Start a station"
                        onClick={() => {
                          station.start(first);
                        }}
                      >
                        <RadioIcon weight="regular" aria-hidden />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
