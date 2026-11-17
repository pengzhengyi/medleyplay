/**
 * @file The player: what is playing, its controls and play modes, and how far it has got.
 *
 * It floats over the bottom of the page; the position runs along its top edge, across
 * the whole album while an album of songs plays, with the album's songs over the
 * pointer while it hovers. Its cover opens Now Playing.
 */

import { QueueIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { Lyrics, Track } from "../api";
import { type FavoriteGroups, canFavorite, isFavoriteAlbum } from "../library/favoriteGroups";
import { albumArtistOf } from "../library/views";
import { songTimeOf, useLyricsHidden } from "../lyrics";
import { albumSteps, albumTimeline, playingOf, songPlaying } from "../player/albumNow";
import type { Player } from "../player/usePlayer";
import { canSetVolume } from "../player/volume";
import { hintOf, useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { FavoriteHeart } from "./FavoriteHeart";
import { LyricNow } from "./LyricsPanel";
import { AlbumCard, PlayingKind } from "./PlayingKind";
import { PlayTime } from "./PlayTime";
import { SeekBar } from "./SeekBar";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { FavoriteButton, Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";

/** The current Track and its controls, with the line of its `lyrics` sung now unless hidden. */
export function PlayerBar({
  player,
  track,
  tracks,
  onFavorite,
  favorites,
  onFavoriteAlbum,
  menuActions,
  lyrics,
  queueOpen,
  onToggleQueue,
  onOpenNowPlaying,
  playOn,
}: {
  readonly player: Player;
  readonly track: Track | undefined;
  readonly tracks: ReadonlyMap<number, Track>;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  /** The artists and albums the Account favorited, for the heart of a whole album playing. */
  readonly favorites: FavoriteGroups;
  readonly onFavoriteAlbum: (artist: string, name: string, favorite: boolean) => void;
  readonly menuActions: TrackMenuActions;
  /** The lyrics of the song playing: `null` for none, `undefined` while they are read. */
  readonly lyrics: Lyrics | null | undefined;
  /** Whether the queue is open over the page, as it can be on a narrow screen. */
  readonly queueOpen: boolean;
  readonly onToggleQueue: () => void;
  readonly onOpenNowPlaying: () => void;
  /** Where the music plays, chosen beside the queue, on a page that isn't on the computer. */
  readonly playOn?: ReactNode;
}) {
  const { status, position, duration } = player;
  const keys = useBindings();
  const lyricsHidden = useLyricsHidden();
  const nowPlaying = playingOf(player.queue, tracks, position);
  const timeline = albumTimeline(nowPlaying, position, (song, seconds) => {
    player.playAt(song.entry.key, seconds);
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
                  onPlaySong={(song) => {
                    player.playAt(song.entry.key, song.from);
                  }}
                  onFavorite={onFavorite}
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
              player.playAt(song.entry.key, song.from);
            }}
            onEditSongs={menuActions.onEditSongs}
            onFavorite={onFavorite}
          />
        )}
        <div className="names">
          <strong>{track?.title ?? "Nothing playing"}</strong>
          <span>{track?.artist ?? "Choose a Track to play it"}</span>
          {track !== undefined && !lyricsHidden && (
            <LyricNow lyrics={lyrics} seconds={songTimeOf(track, nowPlaying, position).seconds} />
          )}
        </div>
        {track !== undefined && (
          <PlayingHeart
            track={track}
            song={songPlaying(track, nowPlaying)}
            favorites={favorites}
            onFavorite={onFavorite}
            onFavoriteAlbum={onFavoriteAlbum}
          />
        )}
        {track !== undefined && <TrackMenu track={track} actions={menuActions} queueing={false} />}
      </div>
      <Transport
        player={player}
        track={track}
        steps={albumSteps(player.queue, tracks, nowPlaying, position)}
      />
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
          <PlayTime at={shownPosition} length={shownDuration} />
        </span>
      </div>
    </section>
  );
}

/**
 * The heart of what plays, the one Now Playing shows: the song playing, or, for a whole
 * album in one file, which has no song, the album.
 */
function PlayingHeart({
  track,
  song,
  favorites,
  onFavorite,
  onFavoriteAlbum,
}: {
  readonly track: Track;
  readonly song: Track | undefined;
  readonly favorites: FavoriteGroups;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  readonly onFavoriteAlbum: (artist: string, name: string, favorite: boolean) => void;
}) {
  if (song !== undefined) {
    return <FavoriteButton track={song} onFavorite={onFavorite} />;
  }
  const artist = albumArtistOf(track);
  if (track.album === "" || !canFavorite(track.album)) {
    return <FavoriteButton track={track} onFavorite={onFavorite} />;
  }
  return (
    <FavoriteHeart
      kind="album"
      name={track.album}
      favorite={isFavoriteAlbum(favorites, artist, track.album)}
      onChange={(favorite) => {
        onFavoriteAlbum(artist, track.album, favorite);
      }}
      loved={0}
      suggestionKey=""
    />
  );
}
