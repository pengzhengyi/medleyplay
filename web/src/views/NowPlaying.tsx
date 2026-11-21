/**
 * @file Now Playing: the song playing over the whole screen, its cover large over a
 * blur of itself, with the player's controls and, beside them, its lyrics. What plays
 * next opens, when asked, in a window over them, from its button.
 *
 * It opens from the player's cover and closes with Escape, its close button, or by
 * going to another view. The keyboard shortcuts work while it is open, and the song's
 * menu and the queue's announcements are drawn inside it, since the page behind is inert.
 */

import { CaretDownIcon, QueueIcon, QuotesIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { type Lyrics, type Track, coverUrl } from "../api";
import { formatTime } from "../format";
import type { FavoriteGroups } from "../library/favoriteGroups";
import { setLyricsHidden, songTimeOf, useLyricsHidden } from "../lyrics";
import { albumSteps, albumTimeline, playingOf } from "../player/albumNow";
import type { Player } from "../player/usePlayer";
import type { SleepTimer } from "../player/useSleepTimer";
import { canSetVolume } from "../player/volume";
import { hintOf, useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { NowPlayingNames } from "./NowPlayingNames";
import { AlbumCard } from "./PlayingKind";
import { Dynamics } from "./Dynamics";
import { LyricsPanel } from "./LyricsPanel";
import { QueuePanel } from "./QueuePanel";
import { SeekBar } from "./SeekBar";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

/**
 * `track`, playing in `player`, over the whole screen, with the song's `lyrics` beside
 * it unless this browser hides them; `queueOpen` shows Up next over them.
 */
export function NowPlaying({
  player,
  sleep,
  track,
  tracks,
  onFavorite,
  favorites,
  onFavoriteArtist,
  onFavoriteAlbum,
  menuActions,
  lyrics,
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
  /** The artists and albums the Account favorited. */
  readonly favorites: FavoriteGroups;
  readonly onFavoriteArtist: (name: string, favorite: boolean, id?: string) => void;
  readonly onFavoriteAlbum: (artist: string, name: string, favorite: boolean) => void;
  readonly menuActions: TrackMenuActions;
  /** The lyrics of the song playing: `null` for none, `undefined` while they are read. */
  readonly lyrics: Lyrics | null | undefined;
  readonly queueOpen: boolean;
  readonly onToggleQueue: () => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const upNext = useRef<HTMLDivElement>(null);
  const upNextButton = useRef<HTMLButtonElement>(null);
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
  const nowPlaying = playingOf(player.queue, tracks, position);
  const timeline = albumTimeline(nowPlaying, position, (song, seconds) => {
    player.playAt(song.entry.key, seconds);
  });
  const shownPosition = timeline?.position ?? position;
  const shownDuration = timeline === undefined ? duration : timeline.length;
  const remaining =
    shownDuration === undefined ? undefined : Math.max(0, shownDuration - shownPosition);
  const lyricsHidden = useLyricsHidden();
  const lyricsOpen = !lyricsHidden;
  // Closing Up next from inside it gives focus back to its button, not to the page.
  const closeUpNext = () => {
    if (upNext.current?.contains(document.activeElement) === true) {
      upNextButton.current?.focus();
    }
    onToggleQueue();
  };
  const song = songTimeOf(track, nowPlaying, position);
  return (
    <dialog
      ref={ref}
      className="now-playing"
      aria-label="Now Playing"
      data-shortcuts
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Escape in a menu closes the menu only; then Up next closes, then Now Playing.
          event.preventDefault();
          if (event.target instanceof Element && event.target.closest("[role=menu]")) {
            return;
          }
          if (queueOpen) {
            closeUpNext();
          } else {
            event.currentTarget.close();
          }
        }
      }}
      onPointerDown={(event) => {
        // Up next closes when anything else is pressed; its button closes it itself.
        const target = event.target;
        if (
          queueOpen &&
          target instanceof Node &&
          upNext.current?.contains(target) !== true &&
          upNextButton.current?.contains(target) !== true
        ) {
          onToggleQueue();
        }
      }}
    >
      <div className="np-backdrop" aria-hidden>
        {track.cover !== null && track.cover !== "" && (
          <img src={coverUrl(track.cover, "medium")} alt="" />
        )}
        <Dynamics
          cover={
            track.cover !== null && track.cover !== "" ? coverUrl(track.cover, "medium") : null
          }
        />
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
            <TrackMenu
              track={track}
              actions={menuActions}
              queueing={false}
              container={inside}
              onNavigate={close}
            />
          </span>
        </header>
        <div
          className={["np-stage", lyricsOpen && "lyrics-open", queueOpen && "up-next-open"]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="np-main">
            <div className={status.kind === "playing" ? "np-art" : "np-art resting"}>
              <Cover size="original" cover={track.cover} />
            </div>
            <NowPlayingNames
              track={track}
              playing={nowPlaying}
              position={position}
              moving={status.kind === "playing"}
              favorites={favorites}
              onFavorite={onFavorite}
              onFavoriteArtist={onFavoriteArtist}
              onFavoriteAlbum={onFavoriteAlbum}
              onPlaySong={(song) => {
                player.playAt(song.entry.key, song.from);
              }}
              onEditSongs={menuActions.onEditSongs}
              onNavigate={close}
            />
            <div className="np-seek">
              <SeekBar
                position={shownPosition}
                duration={shownDuration}
                onSeek={timeline?.seek ?? player.seek}
                marks={timeline?.marks}
                preview={
                  timeline !== undefined && nowPlaying.kind === "album"
                    ? (seconds) => (
                        <AlbumCard
                          playing={nowPlaying}
                          track={track}
                          position={position}
                          pointedAt={seconds}
                          onPlaySong={(song) => {
                            player.playAt(song.entry.key, song.from);
                          }}
                          onFavorite={onFavorite}
                        />
                      )
                    : undefined
                }
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
            <Transport
              player={player}
              track={track}
              steps={albumSteps(player.queue, tracks, nowPlaying, position)}
            />
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
                className={lyricsOpen ? "icon np-lyrics-toggle on" : "icon np-lyrics-toggle"}
                aria-label="Lyrics"
                aria-pressed={lyricsOpen}
                title={lyricsOpen ? "Hide the lyrics" : "Show the lyrics"}
                onClick={() => {
                  setLyricsHidden(lyricsOpen);
                }}
              >
                <QuotesIcon weight={lyricsOpen ? "fill" : "regular"} aria-hidden />
              </button>
              <button
                ref={upNextButton}
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
              {queueOpen && (
                <div ref={upNext} className="np-up-next">
                  <QueuePanel
                    id="now-playing-queue"
                    player={player}
                    sleep={sleep}
                    tracks={tracks}
                    announceIn={inside}
                  />
                </div>
              )}
            </div>
            {status.kind === "failed" && (
              <p className="note failed" role="alert">
                <WarningCircleIcon weight="fill" aria-hidden />
                {status.message}
              </p>
            )}
          </div>
          {lyricsOpen && (
            <LyricsPanel
              lyrics={song.song === undefined ? null : lyrics}
              seconds={song.seconds}
              onSeek={(seconds) => {
                player.seek(song.from + seconds);
              }}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
