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
import { useWords } from "../locale";
import { playbackMessage } from "./unplayable";
import { type FavoriteGroups, playingFavorite } from "../library/favoriteGroups";
import { songTimeOf, useLyricsHidden } from "../lyrics";
import { albumSteps, albumTimeline, playingOf, songPlaying } from "../player/albumNow";
import type { Player } from "../player/usePlayer";
import { canSetVolume } from "../player/volume";
import { useBindings } from "../shortcuts";
import { Cover } from "./Cover";
import { FavoriteHeart } from "./FavoriteHeart";
import { LyricNow } from "./LyricsPanel";
import { AlbumCard, PlayingKind } from "./PlayingKind";
import { PlayTime } from "./PlayTime";
import { SeekBar } from "./SeekBar";
import { SongCredits } from "./SongCredits";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { FavoriteButton, Transport } from "./Transport";
import { VolumeControl } from "./VolumeControl";
import { Hint } from "./Hint";

/**
 * The current Track and its controls, with the line of its `lyrics` sung now unless hidden,
 * on a row of its own along the bar's bottom edge.
 */
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
  const t = useWords();
  const { status, position, duration } = player;
  const keys = useBindings();
  const lyricsHidden = useLyricsHidden();
  const nowPlaying = playingOf(player.queue, tracks, position);
  const timeline = albumTimeline(nowPlaying, position, (song, seconds) => {
    player.playAt(song.entry.key, seconds);
  });
  // A split file playing whole is named by the song it has reached.
  const named = track === undefined ? undefined : (songPlaying(track, nowPlaying) ?? track);
  const shownPosition = timeline?.position ?? position;
  const shownDuration = timeline === undefined ? duration : timeline.length;
  return (
    <section className="player" aria-label={t("Player")}>
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
          <Cover size="small" cover={null} />
        ) : (
          <Hint name={t("Now Playing")} keys={keys.nowPlaying}>
            <button
              type="button"
              className="open-now-playing"
              aria-label={t("Open Now Playing")}
              onClick={onOpenNowPlaying}
            >
              <Cover size="small" cover={track.cover} />
            </button>
          </Hint>
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
          <strong>{named?.title ?? t("Nothing playing")}</strong>
          {named === undefined ? (
            <span>{t("Choose a Track to play it")}</span>
          ) : (
            <SongCredits track={named} />
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
        <Hint name={t("Up next")} keys={keys.queue}>
          <button
            type="button"
            className={queueOpen ? "icon queue-toggle on" : "icon queue-toggle"}
            aria-label={t("Up next")}
            aria-expanded={queueOpen}
            aria-controls="queue"
            onClick={onToggleQueue}
          >
            <QueueIcon weight={queueOpen ? "bold" : "regular"} aria-hidden />
          </button>
        </Hint>
        {playOn}
        {status.kind === "preparing" && <span className="note">{t("Preparing…")}</span>}
        {status.kind === "blocked" && (
          <span className="note">{playbackMessage(status.message, t)}</span>
        )}
        {status.kind === "failed" && (
          <span className="note failed" role="alert">
            <WarningCircleIcon weight="fill" aria-hidden />
            {playbackMessage(status.message, t)}
          </span>
        )}
        {canSetVolume() && (
          <VolumeControl volume={player.volume} muted={player.muted} onVolume={player.setVolume} />
        )}
        <span className="time">
          <PlayTime at={shownPosition} length={shownDuration} />
        </span>
      </div>
      {track !== undefined && !lyricsHidden && (
        <LyricNow lyrics={lyrics} seconds={songTimeOf(track, nowPlaying, position).seconds} />
      )}
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
  const target = playingFavorite(track, song, favorites);
  if (target.kind === "track") {
    return <FavoriteButton track={target.track} onFavorite={onFavorite} />;
  }
  return (
    <FavoriteHeart
      kind="album"
      name={target.name}
      favorite={target.favorite}
      onChange={(favorite) => {
        onFavoriteAlbum(target.artist, target.name, favorite);
      }}
      loved={0}
      suggestionKey=""
    />
  );
}
