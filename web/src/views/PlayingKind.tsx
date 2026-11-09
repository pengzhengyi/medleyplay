/**
 * @file What plays now, as a mark: a record spinning for an album, a note swaying for a song.
 *
 * Each moves only while the music plays, and not at all for a viewer who asked
 * for less motion. An album's mark opens its songs, in the order they play, when
 * pointed at, focused, or pressed: those played, the one playing and how far it
 * has got, and those to come. A song in it plays when chosen.
 */

import { CheckIcon, MusicNoteSimpleIcon, VinylRecordIcon } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";

import type { Track } from "../api";
import { formatTime } from "../format";
import type { AlbumSong, Playing } from "../player/albumNow";

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
}: {
  readonly playing: Extract<Playing, { kind: "album" }>;
  readonly track: Track;
  readonly position: number;
  readonly motion: string;
  readonly opens: "above" | "below";
  readonly onPlaySong: (song: AlbumSong) => void;
  readonly onEditSongs: (track: Track) => void;
}) {
  // Pointing opens the songs until the pointer leaves; a press keeps them open until pressed again.
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
      setShown((was) => (was === "pointed" ? "closed" : was));
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
          />
        </section>
      )}
    </span>
  );
}

function AlbumSongs({
  playing,
  track,
  name,
  position,
  onPlaySong,
  onEditSongs,
}: {
  readonly playing: Extract<Playing, { kind: "album" }>;
  readonly track: Track;
  readonly name: string;
  readonly position: number;
  readonly onPlaySong: (song: AlbumSong) => void;
  readonly onEditSongs: (track: Track) => void;
}) {
  const { songs, current, length } = playing;
  if (songs.length === 0) {
    return (
      <>
        <header className="album-songs-head">
          <strong className="album-songs-name">{name}</strong>
        </header>
        <p className="muted">This album is one file, not yet split into its songs.</p>
        <button
          type="button"
          onClick={() => {
            onEditSongs(track);
          }}
        >
          Split into songs
        </button>
      </>
    );
  }
  const now = songs[current];
  const played = (now?.start ?? 0) + position;
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
          return (
            <li key={song.entry.key} className="album-songs-row">
              <button
                type="button"
                className={`album-song ${state}`}
                aria-current={state === "playing" ? "true" : undefined}
                aria-label={`${title}, ${STATE_WORDS[state]}`}
                onClick={() => {
                  onPlaySong(song);
                }}
              >
                <span className="album-song-place" aria-hidden>
                  {state === "played" ? <CheckIcon weight="bold" /> : index + 1}
                </span>
                <span className="album-song-title">{title}</span>
                <span className="album-song-length">
                  {state === "playing"
                    ? `${formatTime(position)} / ${formatTime(song.length)}`
                    : formatTime(song.length)}
                </span>
                {state === "playing" && song.length !== undefined && (
                  <span
                    className="album-song-bar"
                    aria-hidden
                    style={{ "--played": String(position / song.length) } as CSSProperties}
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

const STATE_WORDS = { played: "played", playing: "playing now", pending: "to come" } as const;
