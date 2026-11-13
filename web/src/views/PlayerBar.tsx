/**
 * @file The player: what is playing, its controls and play modes, and how far it has got.
 *
 * It floats over the bottom of the page; the position runs along its top edge, across
 * the whole album while an album of songs plays, with the album's songs over the
 * pointer while it hovers. Its cover opens Now Playing.
 */

import { QueueIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { Track } from "../api";
import { formatTime } from "../format";
import { albumTimeline, playingOf } from "../player/albumNow";
import type { Player } from "../player/usePlayer";
import { canSetVolume } from "../player/volume";
import { hintOf, useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { AlbumCard, PlayingKind } from "./PlayingKind";
import { SeekBar } from "./SeekBar";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { FavoriteButton, Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

/** The current Track and its controls. */
export function PlayerBar({
  player,
  track,
  tracks,
  onFavorite,
  menuActions,
  queueOpen,
  onToggleQueue,
  onOpenNowPlaying,
  playOn,
}: {
  readonly player: Player;
  readonly track: Track | undefined;
  readonly tracks: ReadonlyMap<number, Track>;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  readonly menuActions: TrackMenuActions;
  /** Whether the queue is open over the page, as it can be on a narrow screen. */
  readonly queueOpen: boolean;
  readonly onToggleQueue: () => void;
  readonly onOpenNowPlaying: () => void;
  /** Where the music plays, chosen beside the queue, on a page that isn't on the computer. */
  readonly playOn?: ReactNode;
}) {
  const { status, position, duration } = player;
  const keys = useBindings();
  const nowPlaying = playingOf(player.queue, tracks);
  const timeline = albumTimeline(nowPlaying, position, (song, within) => {
    player.playAt(song.entry.key, within);
  });
  const shownPosition = timeline?.position ?? position;
  const shownDuration = timeline === undefined ? duration : timeline.length;
  return (
    <section className="player" aria-label="Player">
      <SeekBar
        position={shownPosition}
        duration={shownDuration}
        onSeek={timeline?.seek ?? player.seek}
        marks={timeline?.marks}
        preview={
          timeline !== undefined && nowPlaying.kind === "album" && track !== undefined
            ? (seconds) => (
                <AlbumCard
                  playing={nowPlaying}
                  track={track}
                  position={position}
                  pointedAt={seconds}
                />
              )
            : undefined
        }
      />
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
        {track !== undefined && (
          <PlayingKind
            playing={nowPlaying}
            track={track}
            position={position}
            moving={status.kind === "playing"}
            opens="above"
            onPlaySong={(song) => {
              player.playAt(song.entry.key, 0);
            }}
            onEditSongs={menuActions.onEditSongs}
          />
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
        {playOn}
        {status.kind === "preparing" && <span className="note">Preparing…</span>}
        {status.kind === "blocked" && <span className="note">{status.message}</span>}
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
          {formatTime(shownPosition)} <span aria-hidden>/</span> {formatTime(shownDuration)}
        </span>
      </div>
    </section>
  );
}
