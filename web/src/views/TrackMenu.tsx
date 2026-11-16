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
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CrosshairIcon,
  DotsThreeIcon,
  ListPlusIcon,
  MicrophoneStageIcon,
  PencilSimpleIcon,
  PlaylistIcon,
  QueueIcon,
  ScissorsIcon,
  StarIcon,
  SwapIcon,
  UploadSimpleIcon,
  VinylRecordIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { type ReactNode, useState } from "react";

import { type Kind, type Track, api } from "../api";
import { LOOKUPS, type Lookup } from "../library/lookups";
import { siteNameOf } from "../library/videos";
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
  /** Rate `track` from 1 to 5 stars, or `null` for no rating. */
  readonly onRate: (track: Track, rating: number | null) => void;
}

/** The ratings offered, the most stars first. */
const STARS = [5, 4, 3, 2, 1] as const;

const starsOf = (stars: number) => `${String(stars)} ${stars === 1 ? "star" : "stars"}`;

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
            icon={<CrosshairIcon />}
            onSelect={() => {
              onNavigate?.();
              navigate({ view: "library", focus: track.id });
            }}
          >
            Show in Library
          </Item>
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
          {track.video !== null && (
            <Menu.Item className="track-menu-item" asChild>
              <a
                href={track.video}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open the video it came from on ${siteNameOf(track.video)}, in a new tab`}
              >
                <span className="track-menu-icon" aria-hidden>
                  <ArrowSquareOutIcon />
                </span>
                Open on {siteNameOf(track.video)}
              </a>
            </Menu.Item>
          )}
          <Menu.Separator className="track-menu-line" />
          <RateMenu track={track} container={container} onRate={actions.onRate} />
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

/** *Rate*, opening the stars to choose from, the song's own rating checked. */
function RateMenu({
  track,
  container,
  onRate,
}: {
  readonly track: Track;
  readonly container: HTMLElement | null | undefined;
  readonly onRate: (track: Track, rating: number | null) => void;
}) {
  const rating = track.rating;
  return (
    <Menu.Sub>
      <Menu.SubTrigger
        className="track-menu-item"
        aria-label={rating === null ? "Rate" : `Rate, ${starsOf(rating)}`}
      >
        <span className="track-menu-icon" aria-hidden>
          <StarIcon weight={rating === null ? "regular" : "fill"} />
        </span>
        Rate
        <CaretRightIcon className="track-menu-caret" aria-hidden />
      </Menu.SubTrigger>
      <Menu.Portal container={container}>
        <Menu.SubContent className="track-menu" sideOffset={4} collisionPadding={8}>
          <Menu.RadioGroup
            className="track-menu-group"
            value={rating === null ? "none" : String(rating)}
            onValueChange={(value) => {
              onRate(track, value === "none" ? null : Number(value));
            }}
          >
            {STARS.map((stars) => (
              <Menu.RadioItem
                key={stars}
                className="track-menu-item track-menu-stars"
                value={String(stars)}
                aria-label={starsOf(stars)}
              >
                {Array.from({ length: 5 }, (_, at) => (
                  <StarIcon key={at} weight={at < stars ? "fill" : "regular"} aria-hidden />
                ))}
                <Chosen />
              </Menu.RadioItem>
            ))}
            <Menu.RadioItem className="track-menu-item" value="none" aria-label="No rating">
              No rating
              <Chosen />
            </Menu.RadioItem>
          </Menu.RadioGroup>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

/** A check at the end of the rating chosen now. */
function Chosen() {
  return (
    <Menu.ItemIndicator className="track-menu-chosen">
      <CheckIcon aria-hidden />
    </Menu.ItemIndicator>
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
  readonly onSelect: (event: Event) => void;
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

/**
 * *Download failed* on a song's row, opening why it failed, read when opened, with
 * *Retry download* and *Add the file…*. Retrying runs the failed Job again; the menu
 * stays open until the server answers, saying why if it refuses.
 */
export function DownloadFailed({
  track,
  onAddFile,
}: {
  readonly track: Track;
  readonly onAddFile: (track: Track) => void;
}) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState<{ readonly message: string; readonly job: number | null }>();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const read = () => {
    setError("");
    api.download(track.id).then(
      (download) => {
        setWhy({ message: download.message, job: download.job_id });
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  const retry = (job: number) => {
    setRetrying(true);
    setError("");
    api.retryJob(job).then(
      () => {
        setRetrying(false);
        setOpen(false);
      },
      (failure: unknown) => {
        setRetrying(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(opening) => {
        setOpen(opening);
        if (opening) {
          read();
        }
      }}
    >
      <Menu.Trigger asChild>
        <button
          type="button"
          className="why failed"
          aria-label={`Download failed: why, and what to do, for ${track.title}`}
          title="Download failed: why, and what to do"
        >
          <WarningCircleIcon weight="bold" aria-hidden />
          <CaretDownIcon weight="bold" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="track-menu download-failed"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <Menu.Label className="download-failed-why">
            {why === undefined ? "Reading why it failed…" : why.message}
          </Menu.Label>
          {error !== "" && (
            <p className="download-failed-error" role="alert">
              {error}
            </p>
          )}
          <Item
            icon={<ArrowClockwiseIcon className={retrying ? "spin" : undefined} />}
            disabled={why?.job == null || retrying}
            onSelect={(event) => {
              // Open until the server answers, so a refusal shows here.
              event.preventDefault();
              if (why?.job != null) {
                retry(why.job);
              }
            }}
          >
            {retrying ? "Retrying…" : "Retry download"}
          </Item>
          <Item
            icon={<UploadSimpleIcon />}
            onSelect={() => {
              onAddFile(track);
            }}
          >
            Add the file…
          </Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
