/**
 * @file What plays now, as a mark: a record spinning for an album, a note swaying for a song.
 *
 * Each moves only while the music plays, and not at all for a viewer who asked
 * for less motion. An album's mark opens its songs, in the order they play, when
 * pointed at, focused, or pressed: those played, the one playing and how far it
 * has got, and those to come. A song in it plays when chosen, and its heart, first
 * in its row, favorites it. The songs close once the mouse leaves them, focus
 * leaves them, or Escape is pressed.
 *
 * Over an album's seek bar, a card of the same songs lights up the one under the pointer,
 * and plays one chosen on it.
 */

import {
  CheckIcon,
  HeartIcon,
  MusicNoteSimpleIcon,
  ScissorsIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";

import type { Track } from "../api";
import { formatTime } from "../format";
import { heartTitleOf } from "../heart";
import { type AlbumSong, type Playing, songAt } from "../player/albumNow";

/** How long the songs stay open after the pointer leaves, so it can cross the gap to them. */
const CLOSE_AFTER_MS = 150;

export function PlayingKind({
  playing,
  track,
  position,
  moving,
  opens,
  onPlaySong,
  onEditSongs,
  onFavorite,
}: {
  readonly playing: Playing;
  /** The Track playing. */
  readonly track: Track;
  /** How far into the Track playing, in seconds. */
  readonly position: number;
  /** Whether the music plays, so the mark moves. */
  readonly moving: boolean;
  /** Where the album's songs open, from the mark. */
  readonly opens: "above" | "below";
  readonly onPlaySong: (song: AlbumSong) => void;
  /** Split a whole album in one file into its songs. */
  readonly onEditSongs: (track: Track) => void;
  /** Favorite a song of the album, or not; without it, the songs show no hearts. */
  readonly onFavorite?: ((track: Track, favorite: boolean) => void) | undefined;
}) {
  const motion = moving ? "moving" : "still";
  if (playing.kind === "song") {
    return (
      <span className="playing-kind" role="img" aria-label="Playing a song" title="Song">
        <MusicNoteSimpleIcon
          className={`playing-kind-icon song ${motion}`}
          weight="fill"
          aria-hidden
        />
      </span>
    );
  }
  return (
    <AlbumMark
      playing={playing}
      track={track}
      position={position}
      motion={motion}
      opens={opens}
      onPlaySong={onPlaySong}
      onEditSongs={onEditSongs}
      onFavorite={onFavorite}
    />
  );
}

function AlbumMark({
  playing,
  track,
  position,
  motion,
  opens,
  onPlaySong,
  onEditSongs,
  onFavorite,
}: {
  readonly playing: Extract<Playing, { kind: "album" }>;
  readonly track: Track;
  readonly position: number;
  readonly motion: string;
  readonly opens: "above" | "below";
  readonly onPlaySong: (song: AlbumSong) => void;
  readonly onEditSongs: (track: Track) => void;
  /** Favorite a song of the album, or not; without it, the songs show no hearts. */
  readonly onFavorite?: ((track: Track, favorite: boolean) => void) | undefined;
}) {
  // Pointing opens the songs, and a press keeps them open while the pointer stays or
  // focus is in them; leaving with the mouse closes them either way.
  const [shown, setShown] = useState<"closed" | "pointed" | "kept">("closed");
  const open = shown !== "closed";
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(
    () => () => {
      clearTimeout(closing.current);
    },
    [],
  );
  const point = () => {
    clearTimeout(closing.current);
    setShown((was) => (was === "closed" ? "pointed" : was));
  };
  const leave = () => {
    clearTimeout(closing.current);
    closing.current = setTimeout(() => {
      setShown("closed");
    }, CLOSE_AFTER_MS);
  };
  const close = () => {
    clearTimeout(closing.current);
    setShown("closed");
  };
  const name = track.album === "" ? track.title : track.album;
  const { songs } = playing;
  const label =
    songs.length === 0
      ? `Album: ${name}`
      : `Album: ${name}, song ${String(playing.current + 1)} of ${String(songs.length)}`;
  return (
    <span
      className="playing-kind-frame"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          point();
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          leave();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          close();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Only the songs close, not Now Playing around them.
          event.preventDefault();
          event.stopPropagation();
          close();
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="playing-kind"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        title={label}
        onClick={() => {
          if (shown === "kept") {
            close();
          } else {
            setShown("kept");
          }
        }}
      >
        <VinylRecordIcon
          className={`playing-kind-icon album ${motion}`}
          weight="fill"
          aria-hidden
        />
      </button>
      {open && (
        <section id={id} className={`album-songs ${opens}`} aria-label={`Songs of ${name}`}>
          <AlbumSongs
            playing={playing}
            track={track}
            name={name}
            position={position}
            onPlaySong={onPlaySong}
            onEditSongs={onEditSongs}
            onFavorite={onFavorite}
          />
        </section>
      )}
    </span>
  );
}

/**
 * The songs of the album playing, for a seek bar's hover: the one under the pointer
 * lit, with how far into it the pointer is. A song chosen on it plays, by `onPlaySong`;
 * without one it only shows. It is for the pointer: the album's mark lists the same
 * songs for the keyboard, so Tab passes it by.
 */
export function AlbumCard({
  playing,
  track,
  position,
  pointedAt,
  onPlaySong,
  onFavorite,
}: {
  readonly playing: Extract<Playing, { kind: "album" }>;
  readonly track: Track;
  /** How far into the Track playing, in seconds. */
  readonly position: number;
  /** The second of the album under the pointer. */
  readonly pointedAt: number;
  readonly onPlaySong?: (song: AlbumSong) => void;
  /** Favorite a song of the album, or not; without it, the songs show no hearts. */
  readonly onFavorite?: ((track: Track, favorite: boolean) => void) | undefined;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pointed = songAt(playing.songs, pointedAt);
  useEffect(() => {
    list.current?.querySelector(".pointed")?.scrollIntoView({ block: "nearest" });
  }, [pointed?.index]);
  return (
    <div ref={list} className="album-card" inert={onPlaySong === undefined}>
      <AlbumSongs
        playing={playing}
        track={track}
        name={track.album === "" ? track.title : track.album}
        position={position}
        pointed={pointed}
        pointerOnly
        onPlaySong={onPlaySong ?? (() => undefined)}
        onEditSongs={() => undefined}
        onFavorite={onFavorite}
      />
    </div>
  );
}

function AlbumSongs({
  playing,
  track,
  name,
  position,
  pointed,
  pointerOnly = false,
  onPlaySong,
  onEditSongs,
  onFavorite,
}: {
  readonly playing: Extract<Playing, { kind: "album" }>;
  readonly track: Track;
  readonly name: string;
  readonly position: number;
  /** The song under a seek bar's pointer, and how far into it. */
  readonly pointed?: ReturnType<typeof songAt>;
  /** Whether the songs are for the pointer alone, so Tab passes them by. */
  readonly pointerOnly?: boolean;
  readonly onPlaySong: (song: AlbumSong) => void;
  readonly onEditSongs: (track: Track) => void;
  /** Favorite a song of the album, or not; without it, the songs show no hearts. */
  readonly onFavorite?: ((track: Track, favorite: boolean) => void) | undefined;
}) {
  const { songs, current, length } = playing;
  if (songs.length === 0) {
    return (
      <>
        <div className="album-songs-unsplit">
          <span className="album-songs-unsplit-mark" aria-hidden>
            <ScissorsIcon />
          </span>
          <strong className="album-songs-name">{name}</strong>
          <p>One file, not yet split into its songs.</p>
          <button
            type="button"
            className="album-songs-split"
            onClick={() => {
              onEditSongs(track);
            }}
          >
            <ScissorsIcon aria-hidden />
            Split into songs
          </button>
        </div>
      </>
    );
  }
  const now = songs[current];
  const within = (song: AlbumSong) => position - song.from;
  const played = now === undefined ? position : now.start + within(now);
  return (
    <>
      <header className="album-songs-head">
        <strong className="album-songs-name">{name}</strong>
        {length !== undefined && (
          <>
            <span className="album-songs-time">
              {`${formatTime(played)} of ${formatTime(length)}`}
            </span>
            <span
              className="album-songs-bar"
              aria-hidden
              style={{ "--played": String(played / length) } as CSSProperties}
            />
          </>
        )}
      </header>
      <ol className="album-songs-list">
        {songs.map((song, index) => {
          const state = index < current ? "played" : index === current ? "playing" : "pending";
          const title = song.track?.title ?? "A Track no longer here";
          const pointedHere = pointed?.index === index;
          return (
            <li key={`${song.entry.key}@${String(song.from)}`} className="album-songs-row">
              {onFavorite !== undefined && song.track !== undefined && (
                <SongHeart track={song.track} pointerOnly={pointerOnly} onFavorite={onFavorite} />
              )}
              <button
                type="button"
                className={pointedHere ? `album-song ${state} pointed` : `album-song ${state}`}
                aria-current={state === "playing" ? "true" : undefined}
                aria-label={`${title}, ${STATE_WORDS[state]}`}
                tabIndex={pointerOnly ? -1 : undefined}
                onClick={() => {
                  onPlaySong(song);
                }}
              >
                <span className="album-song-place" aria-hidden>
                  {state === "played" ? <CheckIcon weight="bold" /> : index + 1}
                </span>
                <span className="album-song-title">{title}</span>
                <span className="album-song-length">
                  {pointedHere
                    ? `${formatTime(pointed.within)} / ${formatTime(song.length)}`
                    : state === "playing"
                      ? `${formatTime(within(song))} / ${formatTime(song.length)}`
                      : formatTime(song.length)}
                </span>
                {state === "playing" && song.length !== undefined && (
                  <span
                    className="album-song-bar"
                    aria-hidden
                    style={{ "--played": String(within(song) / song.length) } as CSSProperties}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** A song's heart, first in its row: filled while it is a favorite, and pressed to change that. */
function SongHeart({
  track,
  pointerOnly,
  onFavorite,
}: {
  readonly track: Track;
  readonly pointerOnly: boolean;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={track.favorite ? "icon heart album-song-heart on" : "icon heart album-song-heart"}
      aria-label={`Favorite ${track.title}`}
      aria-pressed={track.favorite}
      title={heartTitleOf(track.title, track.favorite)}
      tabIndex={pointerOnly ? -1 : undefined}
      onClick={() => {
        onFavorite(track, !track.favorite);
      }}
    >
      <HeartIcon weight={track.favorite ? "fill" : "regular"} aria-hidden />
    </button>
  );
}

const STATE_WORDS = { played: "played", playing: "playing now", pending: "to come" } as const;
