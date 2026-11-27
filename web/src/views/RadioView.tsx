/**
 * @file The Radio tab: the Account's own station, its favorites station, and shelves of
 * albums to play.
 */

import { HeartIcon, PlayIcon, RadioIcon } from "@phosphor-icons/react";
import { useMemo } from "react";

import type { Track } from "../api";
import { type FavoriteGroups, NO_FAVORITES } from "../library/favoriteGroups";
import { type AlbumCard, albumShelves, favoriteSongsOf, seedOf, seeded } from "../library/radio";
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
  favorites = NO_FAVORITES,
  now = new Date(),
}: {
  readonly tracks: readonly Track[];
  readonly station: Station;
  readonly onPlayAll: (tracks: readonly Track[], shuffled: boolean) => void;
  readonly accountId: number;
  /** The artists and albums the Account favorited, which it likes a little more. */
  readonly favorites?: FavoriteGroups;
  /** The time the shelves are for; the clock's by default. */
  readonly now?: Date;
}) {
  const day = dayOf(now);
  const shelves = useMemo(
    () => albumShelves(tracks, now, seeded(seedOf(`${String(accountId)}:${day}`)), favorites),
    // The shelves change with the Tracks and the day, not with every moment of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, accountId, day, favorites],
  );
  const favoriteCount = useMemo(
    () => favoriteSongsOf(tracks, favorites).length,
    [tracks, favorites],
  );
  const { seed } = station;
  return (
    <>
      <header className="view-heading">
        <h2 className="section" data-rail-named>
          Radio
        </h2>
      </header>
      <div className="stations">
        <section className="station" aria-label="My station">
          <span className="station-icon" aria-hidden>
            <RadioIcon weight="duotone" />
          </span>
          <div className="station-text">
            <h3>My station</h3>
            <p>
              {station.playing === "mine" && seed !== undefined
                ? `Playing from ${seed.title} by ${seed.artist}`
                : "Songs you like, and more like them, for as long as you listen."}
            </p>
          </div>
          <button
            type="button"
            className="station-play"
            onClick={() => {
              station.start();
            }}
          >
            <PlayIcon weight="fill" aria-hidden />
            Play my station
          </button>
        </section>
        <section className="station favorites" aria-label="Favorites">
          <span className="station-icon" aria-hidden>
            <HeartIcon weight="duotone" />
          </span>
          <div className="station-text">
            <h3>Favorites</h3>
            <p>
              {station.playing === "favorites"
                ? "Playing now"
                : favoriteCount === 0
                  ? "Heart a song, or favorite an artist or album, to fill it."
                  : `Your ${favoriteCount === 1 ? "1 favorite song" : `${String(favoriteCount)} favorite songs`}, every one before any again.`}
            </p>
          </div>
          <button
            type="button"
            className="station-play"
            disabled={favoriteCount === 0}
            onClick={() => {
              station.startFavorites();
            }}
          >
            <PlayIcon weight="fill" aria-hidden />
            Play favorites
          </button>
        </section>
      </div>
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
              const fileId = album.tracks[0]?.segment_of;
              const lyrics =
                fileId == null ? { artist: album.artist, album: album.album } : { file: fileId };
              return (
                <li key={album.key} className="shelf-album">
                  {album.album === "" ? (
                    <div className="shelf-link">
                      <Cover
                        size="medium"
                        cover={album.cover}
                        className="cover-tile"
                        lyrics={lyrics}
                      />
                      <span className="group-name">{album.name}</span>
                      <span className="group-meta">{album.artist || "Unknown artist"}</span>
                    </div>
                  ) : (
                    <a
                      className="shelf-link"
                      href={hrefOf({ view: "album", artist: album.artist, name: album.album })}
                    >
                      <Cover
                        size="medium"
                        cover={album.cover}
                        className="cover-tile"
                        lyrics={lyrics}
                      />
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
