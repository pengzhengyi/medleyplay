// cspell:ignore searchterm
/**
 * @file A song's menu, its less frequent actions behind a "…" button, and the menu
 * of other ways to play behind a caret.
 *
 * The one module that knows Radix's dropdown menu, which handles the keyboard,
 * the focus, and keeping the menu on screen; the rest of the client hands it a
 * Track and callbacks. The menu draws in a portal, so a table row doesn't clip it.
 */

import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  DotsThreeIcon,
  ListPlusIcon,
  MicrophoneStageIcon,
  PencilSimpleIcon,
  PlaylistIcon,
  QueueIcon,
  ScissorsIcon,
  SwapIcon,
  UploadSimpleIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import type { Kind, Track } from "../api";
import { LOOKUPS, type Lookup } from "../library/lookups";
import { albumArtistOf } from "../library/views";
import { navigate } from "../routes";

/** Rate Your Music's search, which the household's own browser opens; medleyplay never reads the site. */
const RYM_SEARCH = "https://rateyourmusic.com/search";

/** A search of Rate Your Music for `track`: an album by its album artist and name, a song by its artist and title. */
function rymSearchOf(track: Track): string {
  const words =
    track.kind === "album"
      ? [albumArtistOf(track), track.album || track.title]
      : [track.artist, track.title];
  const query = new URLSearchParams({ searchterm: words.filter(Boolean).join(" ") });
  return `${RYM_SEARCH}?${query.toString()}`;
}

/** What a song's menu does besides going to its artist or album. */
export interface TrackMenuActions {
  readonly onPlayNext: (track: Track) => void;
  readonly onAdd: (track: Track) => void;
  readonly onAddToPlaylist: (track: Track) => void;
  readonly onEditDetails: (track: Track) => void;
  /** Whether `track` can be looked up with `lookup` now. */
  readonly canFind: (lookup: Lookup, track: Track) => boolean;
  /** Look `track` up online with `lookup`, for its details and cover. */
  readonly onFind: (lookup: Lookup, track: Track) => void;
  /** Edit the songs of the file `track` is, or is a song of. */
  readonly onEditSongs: (track: Track) => void;
  /** Add the audio file of a Track downloaded from a site by hand. */
  readonly onAddFile: (track: Track) => void;
  /** Make `track` a song or an album, for one whose Kind was guessed wrong. */
  readonly onSetKind: (track: Track, kind: Kind) => void;
}

/** The "…" button of `track`, and its menu; `queueing` offers Play next and Add to queue. */
export function TrackMenu({
  track,
  actions,
  queueing,
  container,
  onNavigate,
}: {
  readonly track: Track;
  readonly actions: TrackMenuActions;
  readonly queueing: boolean;
  /** Where the menu is drawn: inside a modal dialog, which leaves the page behind inert. */
  readonly container?: HTMLElement | null;
  /** Called before *Go to* opens another view. */
  readonly onNavigate?: () => void;
}) {
  const playable = track.availability === "ok";
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="icon more"
          aria-label={`More actions for ${track.title}`}
          title="More actions"
        >
          <DotsThreeIcon weight="bold" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Content className="track-menu" align="end" sideOffset={4} collisionPadding={8}>
          {queueing && (
            <>
              <Item
                icon={<QueueIcon />}
                disabled={!playable}
                onSelect={() => {
                  actions.onPlayNext(track);
                }}
              >
                Play next
              </Item>
              <Item
                icon={<ListPlusIcon />}
                disabled={!playable}
                onSelect={() => {
                  actions.onAdd(track);
                }}
              >
                Add to queue
              </Item>
              <Menu.Separator className="track-menu-line" />
            </>
          )}
          <Item
            icon={<MicrophoneStageIcon />}
            onSelect={() => {
              onNavigate?.();
              navigate({ view: "artist", name: track.artist });
            }}
          >
            Go to artist
          </Item>
          <Item
            icon={<VinylRecordIcon />}
            onSelect={() => {
              onNavigate?.();
              navigate({ view: "album", artist: albumArtistOf(track), name: track.album });
            }}
          >
            Go to album
          </Item>
          <Menu.Item className="track-menu-item" asChild>
            <a
              href={rymSearchOf(track)}
              target="_blank"
              rel="noopener noreferrer"
              title="Search Rate Your Music in a new tab"
            >
              <span className="track-menu-icon" aria-hidden>
                <ArrowSquareOutIcon />
              </span>
              Open on RYM
            </a>
          </Menu.Item>
          <Menu.Separator className="track-menu-line" />
          <Item
            icon={<PlaylistIcon />}
            onSelect={() => {
              actions.onAddToPlaylist(track);
            }}
          >
            Add to playlist…
          </Item>
          <Item
            icon={<PencilSimpleIcon />}
            onSelect={() => {
              actions.onEditDetails(track);
            }}
          >
            Edit details…
          </Item>
          {LOOKUPS.filter((lookup) => actions.canFind(lookup, track)).map((lookup) => (
            <Item
              key={lookup.enricher}
              icon={<lookup.icon />}
              onSelect={() => {
                actions.onFind(lookup, track);
              }}
            >
              {lookup.label}
            </Item>
          ))}
          {/* A split file, and each of its songs, has the Kind its split gives it. */}
          {!track.split && track.segment_of === null && (
            <Item
              icon={<SwapIcon />}
              onSelect={() => {
                actions.onSetKind(track, track.kind === "song" ? "album" : "song");
              }}
            >
              {track.kind === "song" ? "Mark as album" : "Mark as song"}
            </Item>
          )}
          <Item
            icon={<ScissorsIcon />}
            onSelect={() => {
              actions.onEditSongs(track);
            }}
          >
            {track.split || track.segment_of !== null ? "Edit songs…" : "Split into songs…"}
          </Item>
          {track.site !== null && (
            <Item
              icon={<UploadSimpleIcon />}
              onSelect={() => {
                actions.onAddFile(track);
              }}
            >
              Add the file yourself…
            </Item>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A way to play, as a menu item names it. */
export interface PlayWay {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

/** A caret beside a button, whose menu offers other ways to do what the button does. */
export function MoreWays({
  label,
  ways,
  disabled,
}: {
  /** What the caret is called, such as *More ways to play*. */
  readonly label: string;
  readonly ways: readonly PlayWay[];
  readonly disabled: boolean;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="more-ways"
          aria-label={label}
          title={label}
          disabled={disabled}
        >
          <CaretDownIcon weight="bold" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="track-menu" align="start" sideOffset={4} collisionPadding={8}>
          {ways.map((way) => (
            <Item key={way.label} icon={way.icon} onSelect={way.onSelect}>
              {way.label}
            </Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({
  icon,
  children,
  disabled = false,
  onSelect,
}: {
  readonly icon: ReactNode;
  readonly children: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <Menu.Item className="track-menu-item" disabled={disabled} onSelect={onSelect}>
      <span className="track-menu-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </Menu.Item>
  );
}
