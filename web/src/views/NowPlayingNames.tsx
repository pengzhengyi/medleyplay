/**
 * @file What Now Playing names: the album and the song in it on one line, then who sings it.
 *
 * ```text
 * (disc) Jay  /  (note) 可爱女人  ♡
 * (mic)  周杰伦  ♡                 Bilibili ↗
 * ```
 *
 * Each name has its own heart, beside it, so it is plain which one a heart favorites.
 * The mark that moves is the one playing as a whole: the record while an album plays,
 * the note while a song does; the record opens the album's songs. A whole album in one
 * file names only the album, or, once it is split, also the song the position is in.
 */

import {
  ArrowSquareOutIcon,
  MicrophoneStageIcon,
  MusicNoteSimpleIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";

import type { Track } from "../api";
import {
  type FavoriteGroups,
  canFavorite,
  isFavoriteAlbum,
  isFavoriteArtist,
} from "../library/favoriteGroups";
import { siteNameOf } from "../library/videos";
import { albumArtistOf } from "../library/views";
import type { AlbumSong, Playing } from "../player/albumNow";
import { hrefOf } from "../routes";
import { FavoriteHeart } from "./FavoriteHeart";
import { PlayingKind } from "./PlayingKind";
import { SiteMark } from "./SiteMark";
import { FavoriteButton } from "./Transport";

/** The song `track` names in what plays now: itself, the song the position is in, or none. */
function songOf(track: Track, playing: Playing): Track | undefined {
  if (track.kind !== "album") {
    return track;
  }
  return playing.kind === "album" ? playing.songs[playing.current]?.track : undefined;
}

export function NowPlayingNames({
  track,
  playing,
  position,
  moving,
  favorites,
  onFavorite,
  onFavoriteArtist,
  onFavoriteAlbum,
  onPlaySong,
  onEditSongs,
  onNavigate,
}: {
  /** The Track playing. */
  readonly track: Track;
  readonly playing: Playing;
  /** How far into the Track playing, in seconds. */
  readonly position: number;
  /** Whether the music plays, so the mark moves. */
  readonly moving: boolean;
  readonly favorites: FavoriteGroups;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  readonly onFavoriteArtist: (name: string, favorite: boolean) => void;
  readonly onFavoriteAlbum: (artist: string, name: string, favorite: boolean) => void;
  readonly onPlaySong: (song: AlbumSong) => void;
  readonly onEditSongs: (track: Track) => void;
  /** Called as a name's link leaves for its page. */
  readonly onNavigate: () => void;
}) {
  const song = songOf(track, playing);
  const album = track.album !== "" ? track.album : track.kind === "album" ? track.title : "";
  const albumArtist = albumArtistOf(track);
  const mark = (
    <PlayingKind
      playing={playing}
      track={track}
      position={position}
      moving={moving}
      opens="below"
      onPlaySong={onPlaySong}
      onEditSongs={onEditSongs}
      onFavorite={onFavorite}
    />
  );
  return (
    <div className="np-names">
      <div className="np-line np-where">
        {album !== "" && (
          <span className="np-album">
            {playing.kind === "album" ? (
              mark
            ) : (
              <span className="np-mark" title="Album">
                <VinylRecordIcon weight="fill" aria-hidden />
              </span>
            )}
            {song === undefined ? (
              <h2>{album}</h2>
            ) : track.album !== "" ? (
              <a
                className="np-album-name"
                href={hrefOf({ view: "album", artist: albumArtist, name: track.album })}
                onClick={onNavigate}
              >
                {album}
              </a>
            ) : (
              <span className="np-album-name">{album}</span>
            )}
            {track.album !== "" && canFavorite(track.album) && (
              <FavoriteHeart
                kind="album"
                name={track.album}
                favorite={isFavoriteAlbum(favorites, albumArtist, track.album)}
                onChange={(favorite) => {
                  onFavoriteAlbum(albumArtist, track.album, favorite);
                }}
                loved={0}
                suggestionKey=""
              />
            )}
          </span>
        )}
        {album !== "" && song !== undefined && (
          <span className="np-sep" aria-hidden>
            /
          </span>
        )}
        {song !== undefined && (
          <span className="np-song">
            {playing.kind === "song" ? (
              mark
            ) : (
              <span className="np-mark" title="Song">
                <MusicNoteSimpleIcon weight="fill" aria-hidden />
              </span>
            )}
            <h2>{song.title}</h2>
            <FavoriteButton track={song} onFavorite={onFavorite} />
          </span>
        )}
      </div>
      {(track.artist !== "" || track.video !== null) && (
        <div className="np-line np-by">
          {track.artist !== "" && (
            <span className="np-artist">
              <span className="np-mark" title="Artist">
                <MicrophoneStageIcon weight="fill" aria-hidden />
              </span>
              <a
                className="np-artist-name"
                href={hrefOf({ view: "artist", name: track.artist })}
                onClick={onNavigate}
              >
                {track.artist}
              </a>
              {canFavorite(track.artist) && (
                <FavoriteHeart
                  kind="artist"
                  name={track.artist}
                  favorite={isFavoriteArtist(favorites, track.artist)}
                  onChange={(favorite) => {
                    onFavoriteArtist(track.artist, favorite);
                  }}
                  loved={0}
                  suggestionKey=""
                />
              )}
            </span>
          )}
          {track.video !== null && (
            <a
              className="np-video"
              href={track.video}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open the video it came from on ${siteNameOf(track.video)}, in a new tab`}
            >
              <SiteMark name={siteNameOf(track.video)} />
              <ArrowSquareOutIcon aria-hidden />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
