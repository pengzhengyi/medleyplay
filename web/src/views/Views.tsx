/**
 * @file Each view of the Library, worked out from the Tracks the page already holds.
 */

import {
  CaretLeftIcon,
  HeartIcon,
  PlayIcon,
  PlaylistIcon,
  ShuffleIcon,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode, useMemo } from "react";

import type { ArtistNames, Mode, Playlist, Track, WaitingDevice } from "../api";
import type { ArtistLinks } from "../library/artistLinks";
import { formatLength, formatLibraryLength } from "../format";
import {
  type FavoriteGroups,
  albumKey,
  canFavorite,
  favoriteSongsSuggesting,
  isFavoriteAlbum,
  isFavoriteArtist,
} from "../library/favoriteGroups";
import {
  type Album,
  type Artist,
  albumsOf,
  artistsOf,
  downloadedOf,
  favoritesOf,
  fold,
  search,
  songsOf,
  tracksOfAlbum,
  tracksOfArtist,
} from "../library/views";
import { albumUnit, bySong, everyAlbum, inLibraryOrder, songsByFile } from "../library/playOrder";
import { type Route, hrefOf } from "../routes";
import { AlbumRatingNote } from "./AlbumRatingNote";
import { Cover } from "./Cover";
import { FavoriteHeart } from "./FavoriteHeart";
import type { Station } from "../library/useStation";
import { InsightsView } from "./InsightsView";
import { RadioView } from "./RadioView";
import { SettingsView } from "./SettingsView";
import { LinkArtists } from "./LinkArtists";
import { TidyNames } from "./TidyNames";
import { type TrackActions, TrackTable } from "./TrackTable";

/** The route id of Favorites, the Playlist of favorites the server keeps for each Account. */
export const FAVORITES = "favorites";

const UNKNOWN_ARTIST = "Unknown artist";
const UNKNOWN_ALBUM = "Unknown album";

/** What every view may show and do. */
export interface ViewProps {
  readonly route: Route;
  readonly tracks: readonly Track[];
  readonly playlists: readonly Playlist[];
  readonly playingId: number | undefined;
  readonly actions: TrackActions;
  /** Whether the Account may change what the household shares, such as the storage limit. */
  readonly admin: boolean;
  /** Whether medleyplay may contact music sites now, once the server has said. */
  readonly mode: Mode | null;
  /** Show the Mode a check of the network came to. */
  readonly onModeChecked: (mode: Mode) => void;
  /** Called after Settings changes which Tracks an enricher may be asked about. */
  readonly onEnrichersChanged: () => void;
  /** Called after Settings changes how a Track's kind is guessed. */
  readonly onKindsChanged: () => void;
  /** Called after Settings imports or forgets your album ratings. */
  readonly onRatingsChanged?: () => void;
  /** The devices waiting for an admin's answer. */
  readonly waitingDevices: readonly WaitingDevice[];
  /** The station playing, and a way to start one. */
  readonly station: Station;
  readonly accountId: number;
  /** The artists and albums the Account favorited, and ways to change them. */
  readonly favorites: FavoriteGroups;
  readonly onFavoriteArtist: (name: string, favorite: boolean) => void;
  readonly onFavoriteAlbum: (artist: string, name: string, favorite: boolean) => void;
  /** Which artist names are one artist, as the household linked them; none, unless given. */
  readonly links?: ArtistLinks;
  /** The Library's artist names and their links, and a way to read them again. */
  readonly artistNames?: { readonly names: ArtistNames; readonly reload: () => void };
}

/** The view `route` names; each route is a view of its own, opening with no filters on. */
export function CurrentView(given: ViewProps) {
  // Search stays one view while its words change, so typing keeps what it has found.
  const key = given.route.view === "search" ? "search" : JSON.stringify(given.route);
  return <Fragment key={key}>{viewOf(given)}</Fragment>;
}

function viewOf(given: ViewProps) {
  // A Playlist names its Tracks by id among them all; every other view lists songs.
  const props = { ...given, tracks: songsOf(given.tracks) };
  const { route } = props;
  switch (route.view) {
    case "library":
      return <LibraryItems {...given} />;
    case "radio":
      return (
        <RadioView
          tracks={props.tracks}
          station={props.station}
          onPlayAll={props.actions.onPlayAll}
          accountId={props.accountId}
          favorites={props.favorites}
        />
      );
    case "insights":
      return <InsightsView tracks={given.tracks} onPlay={props.actions.onPlay} />;
    case "artists":
      return (
        <Artists
          tracks={props.tracks}
          favorites={props.favorites}
          links={props.links}
          artistNames={props.artistNames}
        />
      );
    case "artist": {
      const songs = tracksOfArtist(props.tracks, route.name, props.links);
      return (
        <Songs
          title={route.name || UNKNOWN_ARTIST}
          back={{ view: "artists" }}
          backLabel="Artists"
          heart={
            canFavorite(route.name) && (
              <FavoriteHeart
                kind="artist"
                name={route.name}
                favorite={isFavoriteArtist(props.favorites, route.name)}
                onChange={(favorite) => {
                  props.onFavoriteArtist(route.name, favorite);
                }}
                loved={favoriteSongsSuggesting(songs)}
                suggestionKey={`${String(props.accountId)}:artist:${fold(route.name.trim())}`}
              />
            )
          }
          {...props}
          empty={<p className="empty">No songs by this artist are in your Library now.</p>}
        >
          {songs}
        </Songs>
      );
    }
    case "albums":
      return <Albums tracks={props.tracks} favorites={props.favorites} actions={props.actions} />;
    case "album": {
      const songs = tracksOfAlbum(props.tracks, route.artist, route.name);
      return (
        <Songs
          title={route.name || UNKNOWN_ALBUM}
          subtitle={route.artist || UNKNOWN_ARTIST}
          back={{ view: "albums" }}
          backLabel="Albums"
          heart={
            canFavorite(route.name) && (
              <FavoriteHeart
                kind="album"
                name={route.name}
                favorite={isFavoriteAlbum(props.favorites, route.artist, route.name)}
                onChange={(favorite) => {
                  props.onFavoriteAlbum(route.artist, route.name, favorite);
                }}
                loved={favoriteSongsSuggesting(songs)}
                suggestionKey={`${String(props.accountId)}:album:${albumKey(route.artist, route.name)}`}
              />
            )
          }
          about={<AlbumRatingNote artist={route.artist} album={route.name} />}
          {...props}
          empty={<p className="empty">No songs from this album are in your Library now.</p>}
        >
          {songs}
        </Songs>
      );
    }
    case "downloaded":
      return (
        <Songs
          title="Downloaded"
          {...props}
          empty={
            <p className="empty">
              Nothing is downloaded yet. A song you add from a music site is kept here once its
              download finishes.
            </p>
          }
        >
          {downloadedOf(props.tracks)}
        </Songs>
      );
    case "playlists":
      return <Playlists tracks={given.tracks} playlists={props.playlists} />;
    case "playlist":
      return <PlaylistView {...props} tracks={given.tracks} id={route.id} />;
    case "search":
      return <SearchResults {...props} query={route.query} />;
    case "settings":
      return (
        <SettingsView
          admin={props.admin}
          mode={props.mode}
          onModeChecked={props.onModeChecked}
          onEnrichersChanged={props.onEnrichersChanged}
          onKindsChanged={props.onKindsChanged}
          onRatingsChanged={props.onRatingsChanged}
          waitingDevices={props.waitingDevices}
        />
      );
  }
}

/** Every song and album, a split file's songs folded under it. */
function LibraryItems({ tracks, playingId, actions }: ViewProps) {
  const items = useMemo(() => tracks.filter((track) => track.segment_of === null), [tracks]);
  const songsIn = useMemo(() => songsByFile(tracks), [tracks]);
  const played = inLibraryOrder(items, songsIn);
  const albums = items.filter((track) => track.kind === "album").length;
  return (
    <>
      <ViewHeading title="Library" aside={<TidyNames version={tracks} />}>
        {items.length > 0 && formatLibraryLength(albums, bySong(played).length, durationOf(played))}
      </ViewHeading>
      <TrackTable
        tracks={items}
        songsIn={songsIn}
        playingId={playingId}
        actions={actions}
        empty={<NoMusic />}
      />
    </>
  );
}

/** A heading, and Tracks in the song table. */
function Songs({
  title,
  subtitle,
  back,
  backLabel,
  heart,
  about,
  children,
  empty,
  playingId,
  actions,
}: Omit<ViewProps, "tracks" | "route" | "playlists" | "admin" | "onEnrichersChanged"> & {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly back?: Route;
  readonly backLabel?: string;
  /** A heart beside the title, for an artist or album that can be a favorite. */
  readonly heart?: ReactNode;
  /** What you said of the artist or album, shown under the heading. */
  readonly about?: ReactNode;
  readonly children: readonly Track[];
  readonly empty: ReactNode;
}) {
  return (
    <>
      <ViewHeading
        title={title}
        subtitle={subtitle}
        back={back}
        backLabel={backLabel}
        heart={heart}
      >
        {children.length > 0 && formatLength(children.length, durationOf(children))}
      </ViewHeading>
      {about}
      <TrackTable tracks={children} playingId={playingId} actions={actions} empty={empty} />
    </>
  );
}

function ViewHeading({
  title,
  subtitle,
  back,
  backLabel,
  heart,
  aside,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly back?: Route | undefined;
  readonly backLabel?: string | undefined;
  readonly heart?: ReactNode;
  /** Something to do about the whole view, after its count, such as tidying names. */
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="view-heading">
      {back !== undefined && (
        <a className="back" href={hrefOf(back)}>
          <CaretLeftIcon weight="bold" aria-hidden />
          {backLabel}
        </a>
      )}
      {heart === undefined || heart === false ? (
        <h2 className="section">{title}</h2>
      ) : (
        <div className="view-title">
          <h2 className="section">{title}</h2>
          {heart}
        </div>
      )}
      {subtitle !== undefined && <p className="subtitle">{subtitle}</p>}
      {children !== undefined && children !== false && <p className="meta">{children}</p>}
      {aside}
    </header>
  );
}

function Artists({
  tracks,
  favorites,
  links,
  artistNames,
}: {
  readonly tracks: readonly Track[];
  readonly favorites: FavoriteGroups;
  readonly links: ArtistLinks | undefined;
  readonly artistNames: ViewProps["artistNames"];
}) {
  const artists = useMemo(() => artistsOf(tracks, links), [tracks, links]);
  return (
    <>
      <ViewHeading
        title="Artists"
        aside={
          <span className="view-asides">
            <TidyNames version={tracks} />
            {artistNames !== undefined && (
              <LinkArtists names={artistNames.names} onChanged={artistNames.reload} />
            )}
          </span>
        }
      >
        {artists.length > 0 && `${String(artists.length)} artists`}
      </ViewHeading>
      {artists.length === 0 ? <NoMusic /> : <ArtistList artists={artists} favorites={favorites} />}
    </>
  );
}

function ArtistList({
  artists,
  favorites,
}: {
  readonly artists: readonly Artist[];
  readonly favorites: FavoriteGroups;
}) {
  return (
    <ul className="groups" aria-label="Artists">
      {artists.map((artist) => (
        <li
          key={artist.name}
          className={isFavoriteArtist(favorites, artist.name) ? "favorite" : ""}
        >
          <a href={hrefOf({ view: "artist", name: artist.name })}>
            <span className="tile-frame">
              <span className="avatar" aria-hidden>
                {initialOf(artist.name)}
              </span>
              {isFavoriteArtist(favorites, artist.name) && <FavoriteBadge />}
            </span>
            <span className="group-name">{artist.name || UNKNOWN_ARTIST}</span>
            <span className="group-meta">{formatLength(artist.count, artist.durationMs)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Albums({
  tracks,
  favorites,
  actions,
}: {
  readonly tracks: readonly Track[];
  readonly favorites: FavoriteGroups;
  readonly actions: TrackActions;
}) {
  const albums = useMemo(() => albumsOf(tracks), [tracks]);
  // Each album plays whole, in its track order, in the order the albums are listed.
  const playable = everyAlbum(tracks.filter((track) => track.availability === "ok"));
  return (
    <>
      <ViewHeading title="Albums">
        {albums.length > 0 && `${String(albums.length)} albums`}
      </ViewHeading>
      {albums.length > 0 && (
        <div className="play-all">
          <button
            type="button"
            aria-label="Play every album"
            disabled={playable.length === 0}
            onClick={() => {
              actions.onPlayAll(playable, false, albumUnit);
            }}
          >
            <PlayIcon weight="fill" aria-hidden />
            Play
          </button>
          <button
            type="button"
            className="secondary"
            aria-label="Shuffle the albums"
            title="Each album plays whole, in its order"
            disabled={playable.length === 0}
            onClick={() => {
              actions.onPlayAll(playable, true, albumUnit);
            }}
          >
            <ShuffleIcon weight="bold" aria-hidden />
            Shuffle
          </button>
        </div>
      )}
      {albums.length === 0 ? <NoMusic /> : <AlbumList albums={albums} favorites={favorites} />}
    </>
  );
}

function AlbumList({
  albums,
  favorites,
}: {
  readonly albums: readonly Album[];
  readonly favorites: FavoriteGroups;
}) {
  return (
    <ul className="groups" aria-label="Albums">
      {albums.map((album) => {
        const favorite = isFavoriteAlbum(favorites, album.artist, album.name);
        return (
          <li key={`${album.artist}\n${album.name}`} className={favorite ? "favorite" : ""}>
            <a href={hrefOf({ view: "album", artist: album.artist, name: album.name })}>
              <span className="tile-frame">
                <Cover cover={album.cover} className="cover-tile">
                  {initialOf(album.name)}
                </Cover>
                {favorite && <FavoriteBadge />}
              </span>
              <span className="group-name">{album.name || UNKNOWN_ALBUM}</span>
              <span className="group-meta">
                {album.artist || UNKNOWN_ARTIST}, {formatLength(album.count, album.durationMs)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** A favorite artist's or album's mark on its tile. */
function FavoriteBadge() {
  return (
    <span className="favorite-badge" title="Favorite">
      <HeartIcon weight="fill" aria-hidden />
      <span className="visually-hidden">Favorite</span>
    </span>
  );
}

function Playlists({
  tracks,
  playlists,
}: {
  readonly tracks: readonly Track[];
  readonly playlists: readonly Playlist[];
}) {
  // Favorites is worked out from the hearts here, so a heart counts at once.
  const favorites = favoritesOf(tracks);
  return (
    <>
      <ViewHeading title="Playlists" />
      <ul className="groups" aria-label="Playlists">
        {playlists.some((playlist) => playlist.builtin === FAVORITES) && (
          <li>
            <a href={hrefOf({ view: "playlist", id: FAVORITES })}>
              <span className="cover-tile favorites" aria-hidden>
                <HeartIcon weight="fill" />
              </span>
              <span className="group-name">Favorites</span>
              <span className="group-meta">
                {formatLength(favorites.length, durationOf(favorites))}
              </span>
            </a>
          </li>
        )}
        {ownPlaylists(playlists).map((playlist) => {
          const held = tracksOfPlaylist(tracks, playlist);
          return (
            <li key={playlist.id}>
              <a href={hrefOf({ view: "playlist", id: playlist.id })}>
                <span className="cover-tile" aria-hidden>
                  <PlaylistIcon weight="duotone" />
                </span>
                <span className="group-name">{playlist.name}</span>
                <span className="group-meta">
                  {playlist.rules === null ? "" : "Smart, "}
                  {formatLength(held.length, durationOf(held))}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PlaylistView({ id, ...props }: ViewProps & { readonly id: string }) {
  const playlist = props.playlists.find((each) => each.id === id);
  if (id === FAVORITES || playlist?.builtin === FAVORITES) {
    return (
      <Songs
        title="Favorites"
        back={{ view: "playlists" }}
        backLabel="Playlists"
        {...props}
        empty={<p className="empty">No favorites yet. Tap a song's heart to keep it here.</p>}
      >
        {favoritesOf(props.tracks)}
      </Songs>
    );
  }
  if (playlist === undefined) {
    return (
      <>
        <ViewHeading title="Playlist" back={{ view: "playlists" }} backLabel="Playlists" />
        <p className="empty">This Playlist isn't here any more.</p>
      </>
    );
  }
  return (
    <Songs
      title={playlist.name}
      subtitle={playlist.unreadable === "" ? undefined : playlist.unreadable}
      back={{ view: "playlists" }}
      backLabel="Playlists"
      {...props}
      empty={<p className="empty">This Playlist has no songs yet.</p>}
    >
      {tracksOfPlaylist(props.tracks, playlist)}
    </Songs>
  );
}

function SearchResults({ query, ...props }: ViewProps & { readonly query: string }) {
  const found = useMemo(
    () => search(props.tracks, query, props.links),
    [props.tracks, query, props.links],
  );
  if (query.trim() === "") {
    return (
      <>
        <ViewHeading title="Search" />
        <p className="empty">Type a song, an artist, or an album to find it in your Library.</p>
      </>
    );
  }
  const nothing =
    found.tracks.length === 0 && found.artists.length === 0 && found.albums.length === 0;
  return (
    <>
      <ViewHeading title={`Results for “${query}”`} />
      {nothing && <p className="empty">Nothing in your Library matches “{query}”.</p>}
      {found.artists.length > 0 && (
        <section aria-label="Artists found">
          <h3 className="found">Artists</h3>
          <ArtistList artists={found.artists} favorites={props.favorites} />
        </section>
      )}
      {found.albums.length > 0 && (
        <section aria-label="Albums found">
          <h3 className="found">Albums</h3>
          <AlbumList albums={found.albums} favorites={props.favorites} />
        </section>
      )}
      {found.tracks.length > 0 && (
        <section aria-label="Songs found">
          <h3 className="found">Songs</h3>
          <TrackTable
            tracks={found.tracks}
            playingId={props.playingId}
            actions={props.actions}
            empty={null}
          />
        </section>
      )}
    </>
  );
}

function NoMusic() {
  return (
    <p className="empty">
      No music yet. An admin adds a music folder of your own in <a href="/docs">the API</a>, and its
      songs appear here.
    </p>
  );
}

/** Return the Account's own Playlists, leaving out the ones the server keeps. */
function ownPlaylists(playlists: readonly Playlist[]): Playlist[] {
  return playlists.filter((playlist) => playlist.builtin === null);
}

/** Return a Playlist's Tracks the page holds, in its order, a Track as often as it appears. */
function tracksOfPlaylist(tracks: readonly Track[], playlist: Playlist): Track[] {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return playlist.track_ids.flatMap((id) => {
    const track = byId.get(id);
    return track === undefined ? [] : [track];
  });
}

function durationOf(tracks: readonly Track[]): number {
  return tracks.reduce((total, track) => total + (track.duration_ms ?? 0), 0);
}

const letters = new Intl.Segmenter();

/** Return the first letter of `name` as a person sees it, such as `初` or `É`. */
function initialOf(name: string): string {
  const [first] = letters.segment(name.trim());
  return first?.segment.toUpperCase() ?? "?";
}
