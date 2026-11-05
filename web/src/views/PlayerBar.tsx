/**
 * @file The player: what is playing, its controls and play modes, and how far it has got.
 *
 * It floats over the bottom of the page; the position runs along its top edge. Its
 * cover opens Now Playing.
 */

import { QueueIcon, WarningCircleIcon } from "@phosphor-icons/react";

import type { Track } from "../api";
import { formatTime } from "../format";
import type { Player } from "../player/usePlayer";
import { canSetVolume } from "../player/volume";
import { hintOf, useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { SeekBar } from "./SeekBar";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { FavoriteButton, Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

/** The current Track and its controls. */
export function PlayerBar({
  player,
  track,
  onFavorite,
  menuActions,
  queueOpen,
  onToggleQueue,
  onOpenNowPlaying,
}: {
  readonly player: Player;
  readonly track: Track | undefined;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  readonly menuActions: TrackMenuActions;
  /** Whether the queue is open over the page, as it can be on a narrow screen. */
  readonly queueOpen: boolean;
  readonly onToggleQueue: () => void;
  readonly onOpenNowPlaying: () => void;
}) {
  const { status, position, duration } = player;
  const keys = useBindings();
  return (
    <section className="player" aria-label="Player">
      <SeekBar position={position} duration={duration} onSeek={player.seek} />
      <div className="now">
        {track === undefined ? (
          <Cover cover={null} />
        ) : (
          <button
            type="button"
            className="open-now-playing"
            aria-label="Open Now Playing"
            {...hintOf("Now Playing", keys.nowPlaying)}
            onClick={onOpenNowPlaying}
          >
            <Cover cover={track.cover} />
          </button>
        )}
        <div className="names">
          <strong>{track?.title ?? "Nothing playing"}</strong>
          <span>{track?.artist ?? "Choose a Track to play it"}</span>
        </div>
        {track !== undefined && <FavoriteButton track={track} onFavorite={onFavorite} />}
        {track !== undefined && <TrackMenu track={track} actions={menuActions} queueing={false} />}
      </div>
      <Transport player={player} track={track} />
      <div className="status">
        <button
          type="button"
          className={queueOpen ? "icon queue-toggle on" : "icon queue-toggle"}
          aria-label="Up next"
          aria-expanded={queueOpen}
          aria-controls="queue"
          {...hintOf("Up next", keys.queue)}
          onClick={onToggleQueue}
        >
          <QueueIcon weight={queueOpen ? "bold" : "regular"} aria-hidden />
        </button>
        {status.kind === "preparing" && <span className="note">Preparing…</span>}
        {status.kind === "failed" && (
          <span className="note failed" role="alert">
            <WarningCircleIcon weight="fill" aria-hidden />
            {status.message}
          </span>
        )}
        {canSetVolume() && (
          <VolumeControl volume={player.volume} muted={player.muted} onVolume={player.setVolume} />
        )}
        <span className="time">
          {formatTime(position)} <span aria-hidden>/</span> {formatTime(duration)}
        </span>
      </div>
    </section>
  );
}
