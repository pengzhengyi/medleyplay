/**
 * @file Now Playing: the song playing over the whole screen, its cover large over a
 * blur of itself, with the player's controls and, when asked, what plays next.
 *
 * It opens from the player's cover and closes with Escape, its close button, or by
 * going to another view. The keyboard shortcuts work while it is open, and the song's
 * menu and the queue's announcements are drawn inside it, since the page behind is inert.
 */

import { CaretDownIcon, QueueIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { type Track, coverUrl } from "../api";
import { formatTime } from "../format";
import { albumArtistOf } from "../library/views";
import { type Playing, playingOf, songAt } from "../player/albumNow";
import type { Player } from "../player/usePlayer";
import type { SleepTimer } from "../player/useSleepTimer";
import { canSetVolume } from "../player/volume";
import { hrefOf } from "../routes";
import { hintOf, useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { PlayingKind } from "./PlayingKind";
import { QueuePanel } from "./QueuePanel";
import { type SeekMark, SeekBar } from "./SeekBar";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { FavoriteButton, Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

/** `track`, playing in `player`, over the whole screen; `queueOpen` shows Up next beside it. */
export function NowPlaying({
  player,
  sleep,
  track,
  tracks,
  onFavorite,
  menuActions,
  queueOpen,
  onToggleQueue,
  onClose,
}: {
  readonly player: Player;
  /** The sleep timer, set from Up next. */
  readonly sleep: SleepTimer;
  readonly track: Track;
  readonly tracks: ReadonlyMap<number, Track>;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  readonly menuActions: TrackMenuActions;
  readonly queueOpen: boolean;
  readonly onToggleQueue: () => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The open dialog, where the song's menu and the queue's announcements are drawn.
  const [inside, setInside] = useState<HTMLDialogElement | null>(null);
  const keys = useBindings();
  const { status, position, duration } = player;
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    setInside(element);
    // Focus on no button, so Space plays or pauses rather than pressing it.
    body.current?.focus();
    return () => {
      element?.close();
    };
  }, []);
  const close = () => ref.current?.close();
  const nowPlaying = playingOf(player.queue, tracks);
  const timeline = albumTimeline(nowPlaying, position, (song, within) => {
    player.playAt(song.entry.key, within);
  });
  const shownPosition = timeline?.position ?? position;
  const shownDuration = timeline === undefined ? duration : timeline.length;
  const remaining =
    shownDuration === undefined ? undefined : Math.max(0, shownDuration - shownPosition);
  return (
    <dialog
      ref={ref}
      className="now-playing"
      aria-label="Now Playing"
      data-shortcuts
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Escape in the song's menu closes the menu only.
          event.preventDefault();
          if (!(event.target instanceof Element && event.target.closest("[role=menu]"))) {
            event.currentTarget.close();
          }
        }
      }}
    >
      <div className="np-backdrop" aria-hidden>
        {track.cover !== null && track.cover !== "" && <img src={coverUrl(track.cover)} alt="" />}
      </div>
      <div ref={body} className="np-body" tabIndex={-1}>
        <header className="np-top">
          <button
            type="button"
            className="icon"
            aria-label="Close Now Playing"
            {...hintOf("Close Now Playing", keys.nowPlaying)}
            onClick={close}
          >
            <CaretDownIcon weight="bold" aria-hidden />
          </button>
          <span className="np-actions">
            <FavoriteButton track={track} onFavorite={onFavorite} />
            <TrackMenu
              track={track}
              actions={menuActions}
              queueing={false}
              container={inside}
              onNavigate={close}
            />
          </span>
        </header>
        <div className={queueOpen ? "np-stage queue-open" : "np-stage"}>
          <div className="np-main">
            <div className={status.kind === "playing" ? "np-art" : "np-art resting"}>
              <Cover cover={track.cover} />
            </div>
            <div className="np-names">
              <div className="np-title">
                <PlayingKind
                  playing={nowPlaying}
                  track={track}
                  position={position}
                  moving={status.kind === "playing"}
                  opens="below"
                  onPlaySong={(song) => {
                    player.playAt(song.entry.key, 0);
                  }}
                  onEditSongs={menuActions.onEditSongs}
                />
                <h2>{track.title}</h2>
              </div>
              {track.artist !== "" && (
                <a
                  className="np-artist"
                  href={hrefOf({ view: "artist", name: track.artist })}
                  onClick={close}
                >
                  {track.artist}
                </a>
              )}
              {track.album !== "" && (
                <a
                  className="np-album"
                  href={hrefOf({ view: "album", artist: albumArtistOf(track), name: track.album })}
                  onClick={close}
                >
                  {track.album}
                </a>
              )}
            </div>
            <div className="np-seek">
              <SeekBar
                position={shownPosition}
                duration={shownDuration}
                onSeek={timeline?.seek ?? player.seek}
                marks={timeline?.marks}
              />
              <div className="np-times">
                <span>{formatTime(shownPosition)}</span>
                <span>
                  <span aria-hidden>−</span>
                  <span className="visually-hidden">left: </span>
                  {formatTime(remaining)}
                </span>
              </div>
            </div>
            <Transport player={player} track={track} />
            <div className="np-extras">
              {canSetVolume() && (
                <VolumeControl
                  volume={player.volume}
                  muted={player.muted}
                  onVolume={player.setVolume}
                />
              )}
              <button
                type="button"
                className={queueOpen ? "icon np-queue-toggle on" : "icon np-queue-toggle"}
                aria-label="Up next"
                aria-expanded={queueOpen}
                aria-controls="now-playing-queue"
                {...hintOf("Up next", keys.queue)}
                onClick={onToggleQueue}
              >
                <QueueIcon weight={queueOpen ? "bold" : "regular"} aria-hidden />
              </button>
            </div>
            {status.kind === "failed" && (
              <p className="note failed" role="alert">
                <WarningCircleIcon weight="fill" aria-hidden />
                {status.message}
              </p>
            )}
          </div>
          {queueOpen && (
            <QueuePanel
              id="now-playing-queue"
              player={player}
              sleep={sleep}
              tracks={tracks}
              announceIn={inside}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}

/**
 * The album playing as one timeline: where it is, its length, each song's start,
 * and a seek that plays the song the second falls in. `undefined` unless an album
 * of songs plays and every song's length is known.
 */
function albumTimeline(
  playing: Playing,
  position: number,
  playSong: (song: AlbumSongOf, within: number) => void,
):
  | {
      readonly position: number;
      readonly length: number;
      readonly marks: readonly SeekMark[];
      readonly seek: (seconds: number) => void;
    }
  | undefined {
  if (playing.kind !== "album" || playing.length === undefined || playing.songs.length === 0) {
    return undefined;
  }
  const { songs, current, length } = playing;
  const now = songs[current];
  if (now === undefined) {
    return undefined;
  }
  // A song's real length can differ a little from its details', so it stays within its own.
  const within = Math.min(Math.max(position, 0), now.length ?? position);
  return {
    position: now.start + within,
    length,
    marks: songs.map((song) => ({ start: song.start, title: song.track?.title ?? "" })),
    seek: (seconds) => {
      const at = songAt(songs, Math.min(Math.max(seconds, 0), length));
      const song = at === undefined ? undefined : songs[at.index];
      if (at !== undefined && song !== undefined) {
        playSong(song, at.within);
      }
    },
  };
}

type AlbumSongOf = Extract<Playing, { kind: "album" }>["songs"][number];
