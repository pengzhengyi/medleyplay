/**
 * @file Now Playing: the song playing over the whole screen, its cover large over a
 * blur of itself, with the player's controls and, when asked, what plays next.
 *
 * It opens from the player's cover and closes with Escape, its close button, or by
 * going to another view. The keyboard shortcuts work while it is open.
 */

import { CaretDownIcon, QueueIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { type Track, coverUrl } from "../api";
import { formatTime } from "../format";
import { albumArtistOf } from "../library/views";
import type { Player } from "../player/usePlayer";
import { canSetVolume } from "../player/volume";
import { hrefOf } from "../routes";
import { hintOf, useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { QueuePanel } from "./QueuePanel";
import { SeekBar } from "./SeekBar";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { FavoriteButton, Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

/** `track`, playing in `player`, over the whole screen; `queueOpen` shows Up next beside it. */
export function NowPlaying({
  player,
  track,
  tracks,
  onFavorite,
  menuActions,
  queueOpen,
  onToggleQueue,
  onClose,
}: {
  readonly player: Player;
  readonly track: Track;
  readonly tracks: ReadonlyMap<number, Track>;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  readonly menuActions: TrackMenuActions;
  readonly queueOpen: boolean;
  readonly onToggleQueue: () => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const keys = useBindings();
  const { status, position, duration } = player;
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);
  const remaining = duration === undefined ? undefined : Math.max(0, duration - position);
  return (
    <dialog
      ref={ref}
      className="now-playing"
      aria-label="Now Playing"
      data-shortcuts
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.close();
        }
      }}
    >
      <div className="np-backdrop" aria-hidden>
        {track.cover !== null && track.cover !== "" && <img src={coverUrl(track.cover)} alt="" />}
      </div>
      <div className="np-body">
        <header className="np-top">
          <button
            type="button"
            className="icon"
            aria-label="Close Now Playing"
            {...hintOf("Close Now Playing", keys.nowPlaying)}
            onClick={() => ref.current?.close()}
          >
            <CaretDownIcon weight="bold" aria-hidden />
          </button>
          <span className="np-actions">
            <FavoriteButton track={track} onFavorite={onFavorite} />
            <TrackMenu track={track} actions={menuActions} queueing={false} />
          </span>
        </header>
        <div className={queueOpen ? "np-stage queue-open" : "np-stage"}>
          <div className="np-main">
            <div className={status.kind === "playing" ? "np-art" : "np-art resting"}>
              <Cover cover={track.cover} />
            </div>
            <div className="np-names">
              <h2>{track.title}</h2>
              {track.artist !== "" && (
                <a className="np-artist" href={hrefOf({ view: "artist", name: track.artist })}>
                  {track.artist}
                </a>
              )}
              {track.album !== "" && (
                <a
                  className="np-album"
                  href={hrefOf({ view: "album", artist: albumArtistOf(track), name: track.album })}
                >
                  {track.album}
                </a>
              )}
            </div>
            <div className="np-seek">
              <SeekBar position={position} duration={duration} onSeek={player.seek} />
              <div className="np-times">
                <span>{formatTime(position)}</span>
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
          {queueOpen && <QueuePanel id="now-playing-queue" player={player} tracks={tracks} />}
        </div>
      </div>
    </dialog>
  );
}
