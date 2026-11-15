/**
 * @file Each view of the Library, worked out from the Tracks the page already holds.
 */

import {
  CaretLeftIcon,
  HeartIcon,
  PlayIcon,
  PlaylistIcon,
  ShuffleIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode, useMemo } from "react";

import type { ArtistNames, Mode, NameToTidy, Playlist, Track, WaitingDevice } from "../api";
import { type ArtistLinks, NO_LINKS } from "../library/artistLinks";
import { formatLength, formatLibraryLength, initialOf } from "../format";
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
  albumFileOf,
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
import { ArtistAbout } from "./ArtistAbout";
import { Cover } from "./Cover";
import { FavoriteHeart } from "./FavoriteHeart";
import type { Station } from "../library/useStation";
import { InsightsView } from "./InsightsView";
import { RadioView } from "./RadioView";
import { SettingsView } from "./SettingsView";
import { CleanUpView } from "./CleanUpView";
import { EditArtistButton } from "./EditArtist";
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
  /** The names to tidy, and a way to read them again; none, unless given. */
  readonly namesToTidy?: { readonly names: readonly NameToTidy[]; readonly reload: () => void };
  /** How many names wait to be cleaned up. */
  readonly toDo?: number;
}

/** The view `route` names; each route is a view of its own, opening with no filters on. */
export function CurrentView(given: ViewProps) {
  // Search stays one view while its words change, so typing keeps what it has found.
  const key = given.route.view === "search" ? "search" : JSON.stringify(given.route);
  return <Fragment key={key}>{viewOf(given)}</Fragment>;
}

/** The artist name most of `songs` write, or `undefined` for no songs. */
function mostWritten(songs: readonly Track[]): string | undefined {
  const counts = new Map<string, number>();
  for (const song of songs) {
    counts.set(song.artist, (counts.get(song.artist) ?? 0) + 1);
  }
  return [...counts].reduce<[string, number] | undefined>(
    (best, next) => (best === undefined || next[1] > best[1] ? next : best),
    undefined,
  )?.[0];
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
      return (
        <InsightsView tracks={given.tracks} onPlay={props.actions.onPlay} toDo={props.toDo ?? 0} />
      );
    case "artists":
      return <Artists tracks={props.tracks} favorites={props.favorites} links={props.links} />;
    case "artist": {
      const songs = tracksOfArtist(props.tracks, route.name, props.links);
      const known = props.artistNames?.names;
      const group = (props.links ?? NO_LINKS).groupOf(route.name);
      const artist = group.startsWith("artist:")
        ? known?.artists.find((each) => `artist:${each.id}` === group)
        : undefined;
      const named = known?.names.find((each) => fold(each.name.trim()) === fold(route.name.trim()));
      const shown = artist?.shown_as ?? route.name;
      const reload = props.artistNames?.reload;
      return (
        <Songs
          title={shown || UNKNOWN_ARTIST}
          about={
            route.name !== "" && (
              <ArtistAbout
                name={shown}
                songs={songs}
                artist={artist}
                toLink={named !== undefined && !named.linked && named.look_up === "yes"}
              />
            )
          }
          edit={
            artist !== undefined &&
            reload !== undefined && (
              <EditArtistButton
                artist={artist}
                written={mostWritten(songs) ?? route.name}
                onChanged={reload}
              />
            )
          }
          back={{ view: "artists" }}
          backLabel="Artists"
          heart={
            canFavorite(route.name) && (
              <FavoriteHeart
                kind="artist"
                name={shown}
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
      const file = albumFileOf(songs, new Map(given.tracks.map((track) => [track.id, track])));
      const { onEditAlbum } = props.actions;
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
          edit={
            songs.length > 0 &&
            (file !== undefined || onEditAlbum !== undefined) && (
              <button
                type="button"
                className="secondary outline edit-heading"
                onClick={() => {
                  if (file === undefined) {
                    onEditAlbum?.(songs);
                  } else {
                    props.actions.onEditDetails(file);
                  }
                }}
              >
                <PencilSimpleIcon aria-hidden />
                Edit details
              </button>
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
    case "clean-up":
      return (
        <CleanUpView
          tidy={props.namesToTidy ?? { names: [], reload: () => undefined }}
          artistNames={props.artistNames}
          tracks={props.tracks}
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
      <ViewHeading title="Library">
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
  edit,
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
  /** A way to edit what the page is of, beside the title. */
  readonly edit?: ReactNode;
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
        edit={edit}
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
  edit,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly back?: Route | undefined;
  readonly backLabel?: string | undefined;
  readonly heart?: ReactNode;
  readonly edit?: ReactNode;
  readonly children?: ReactNode;
}) {
  const beside = [heart, edit].some((each) => each !== undefined && each !== false);
  return (
    <header className="view-heading">
      {back !== undefined && (
        <a className="back" href={hrefOf(back)}>
          <CaretLeftIcon weight="bold" aria-hidden />
          {backLabel}
        </a>
      )}
      {beside ? (
        <div className="view-title">
          <h2 className="section">{title}</h2>
          {heart}
          {edit}
        </div>
      ) : (
        <h2 className="section">{title}</h2>
      )}
      {subtitle !== undefined && <p className="subtitle">{subtitle}</p>}
      {children !== undefined && children !== false && <p className="meta">{children}</p>}
    </header>
  );
}

function Artists({
  tracks,
  favorites,
  links,
}: {
  readonly tracks: readonly Track[];
  readonly favorites: FavoriteGroups;
  readonly links: ArtistLinks | undefined;
}) {
  const artists = useMemo(() => artistsOf(tracks, links), [tracks, links]);
  return (
    <>
      <ViewHeading title="Artists">
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
          key={artist.link}
          className={isFavoriteArtist(favorites, artist.link) ? "favorite" : ""}
        >
          <a href={hrefOf({ view: "artist", name: artist.link })}>
            <span className="tile-frame">
              <span className="avatar" aria-hidden>
                {initialOf(artist.name)}
              </span>
              {isFavoriteArtist(favorites, artist.link) && <FavoriteBadge />}
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
