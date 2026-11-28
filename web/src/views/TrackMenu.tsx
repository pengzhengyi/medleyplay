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
  FileTextIcon,
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
  XIcon,
} from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { type ReactNode, useRef, useState } from "react";

import {
  ApiError,
  type Kind,
  type MissingDetailReview,
  type Track,
  type TrackDownload,
  api,
} from "../api";
import { diagnosticReason, downloadFailureOf } from "../library/downloading";
import { LOOKUPS, type Lookup } from "../library/lookups";
import { siteNameOf } from "../library/videos";
import { albumArtistOf, artistNamesOf, artistRouteOf } from "../library/views";
import { type Words, useWords } from "../locale";
import { navigate } from "../routes";
import { DownloadDetails, type DownloadDetailsTarget } from "./DownloadDetails";

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
  readonly onEditDetails: (track: Track, review?: MissingDetailReview) => void;
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
  const t = useWords();
  const playable = track.availability === "ok";
  const [details, setDetails] = useState<DownloadDetailsTarget>();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="icon more"
          aria-label={t("More actions for {{title}}", { title: track.title })}
          title={t("More actions")}
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
                {t("Play next")}
              </Item>
              <Item
                icon={<ListPlusIcon />}
                disabled={!playable}
                onSelect={() => {
                  actions.onAdd(track);
                }}
              >
                {t("Add to queue")}
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
            {t("Show in Library")}
          </Item>
          {artistNamesOf(track).length > 1 ? (
            artistNamesOf(track).map((name, place) => (
              <Item
                key={name}
                icon={<MicrophoneStageIcon />}
                onSelect={() => {
                  onNavigate?.();
                  navigate(artistRouteOf(track, place));
                }}
              >
                {t("Go to {{artist}}", { artist: name })}
              </Item>
            ))
          ) : (
            <Item
              icon={<MicrophoneStageIcon />}
              onSelect={() => {
                onNavigate?.();
                navigate(artistRouteOf(track, 0));
              }}
            >
              {t("Go to artist")}
            </Item>
          )}
          <Item
            icon={<VinylRecordIcon />}
            onSelect={() => {
              onNavigate?.();
              navigate({ view: "album", artist: albumArtistOf(track), name: track.album });
            }}
          >
            {t("Go to album")}
          </Item>
          <Menu.Item className="track-menu-item" asChild>
            <a
              href={rymSearchOf(track)}
              target="_blank"
              rel="noopener noreferrer"
              title={t("Search Rate Your Music in a new tab")}
            >
              <span className="track-menu-icon" aria-hidden>
                <ArrowSquareOutIcon />
              </span>
              {t("Open on RYM")}
            </a>
          </Menu.Item>
          {track.video !== null && <OpenTrackSource video={track.video} t={t} />}
          {track.site !== null && (
            <Item
              icon={<FileTextIcon />}
              onSelect={() => {
                setDetails({ track: track.id });
              }}
            >
              {t("Download details")}
            </Item>
          )}
          <Menu.Separator className="track-menu-line" />
          <RateMenu track={track} container={container} onRate={actions.onRate} />
          <Item
            icon={<PlaylistIcon />}
            onSelect={() => {
              actions.onAddToPlaylist(track);
            }}
          >
            {t("Add to playlist…")}
          </Item>
          <Item
            icon={<PencilSimpleIcon />}
            onSelect={() => {
              actions.onEditDetails(track);
            }}
          >
            {t("Edit details…")}
          </Item>
          {LOOKUPS.filter((lookup) => actions.canFind(lookup, track)).map((lookup) => (
            <Item
              key={lookup.enricher}
              icon={<lookup.icon />}
              onSelect={() => {
                actions.onFind(lookup, track);
              }}
            >
              {t(lookup.label)}
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
              {t(track.kind === "song" ? "Mark as album" : "Mark as song")}
            </Item>
          )}
          <Item
            icon={<ScissorsIcon />}
            onSelect={() => {
              actions.onEditSongs(track);
            }}
          >
            {t(track.split || track.segment_of !== null ? "Edit songs…" : "Split into songs…")}
          </Item>
          {track.site !== null && !track.joined && (
            <Item
              icon={<UploadSimpleIcon />}
              onSelect={() => {
                actions.onAddFile(track);
              }}
            >
              {t("Add the file yourself…")}
            </Item>
          )}
        </Menu.Content>
      </Menu.Portal>
      {details !== undefined && (
        <DownloadDetails
          target={details}
          close={() => {
            setDetails(undefined);
          }}
        />
      )}
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
  const t = useWords();
  const rating = track.rating;
  return (
    <Menu.Sub>
      <Menu.SubTrigger
        className="track-menu-item"
        aria-label={
          rating === null
            ? t("Rate")
            : t("Rate, {{rating}}", { rating: t("star_count", { count: rating }) })
        }
      >
        <span className="track-menu-icon" aria-hidden>
          <StarIcon weight={rating === null ? "regular" : "fill"} />
        </span>
        {t("Rate")}
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
                aria-label={t("star_count", { count: stars })}
              >
                {Array.from({ length: 5 }, (_, at) => (
                  <StarIcon key={at} weight={at < stars ? "fill" : "regular"} aria-hidden />
                ))}
                <Chosen />
              </Menu.RadioItem>
            ))}
            <Menu.RadioItem className="track-menu-item" value="none" aria-label={t("No rating")}>
              {t("No rating")}
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
  busy = false,
  onSelect,
}: {
  readonly icon: ReactNode;
  readonly children: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onSelect: (event: Event) => void;
}) {
  return (
    <Menu.Item
      className="track-menu-item"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onSelect={onSelect}
    >
      <span className="track-menu-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </Menu.Item>
  );
}

function OpenTrackSource({ video, t }: { readonly video: string; readonly t: Words }) {
  const site = siteNameOf(video);
  return (
    <Menu.Item className="track-menu-item" asChild>
      <a
        href={video}
        target="_blank"
        rel="noopener noreferrer"
        title={t("Open the video it came from on {{site}}, in a new tab", { site })}
      >
        <span className="track-menu-icon" aria-hidden>
          <ArrowSquareOutIcon />
        </span>
        {t("Open on {{site}}", { site })}
      </a>
    </Menu.Item>
  );
}

/** Actions for a download that is queued, waiting, or running. */
export function DownloadMenu({
  track,
  openDetails,
  cancel,
}: {
  readonly track: Track;
  readonly openDetails: () => void;
  readonly cancel: (() => Promise<void>) | undefined;
}) {
  const t = useWords();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const stop = (event: Event) => {
    event.preventDefault();
    if (busy || cancel === undefined) return;
    setBusy(true);
    setFailure("");
    cancel().then(
      () => {
        setBusy(false);
        setOpen(false);
      },
      (cause: unknown) => {
        setBusy(false);
        setFailure(cause instanceof Error ? cause.message : "Could not cancel the download.");
      },
    );
  };

  return (
    <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="icon downloading-menu"
          aria-label={t("Download actions for {{title}}", { title: track.title })}
          title={t("Download actions")}
        >
          <DotsThreeIcon weight="bold" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="track-menu download-job-menu"
          align="end"
          sideOffset={4}
          collisionPadding={8}
        >
          {failure !== "" && (
            <p className="download-job-error" role="alert">
              {t(failure)}
            </p>
          )}
          <Item
            icon={<CrosshairIcon />}
            onSelect={() => {
              navigate({ view: "library", focus: track.id });
            }}
          >
            {t("Show in Library")}
          </Item>
          {track.video !== null && <OpenTrackSource video={track.video} t={t} />}
          {cancel !== undefined && (
            <>
              <Item icon={<FileTextIcon />} onSelect={openDetails}>
                {t("Download details")}
              </Item>
              <Menu.Separator className="track-menu-line" />
              <Item
                icon={busy ? <ArrowClockwiseIcon className="spin" /> : <XIcon />}
                busy={busy}
                onSelect={stop}
              >
                {t("Cancel download")}
              </Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

type DownloadRead =
  | { readonly state: "loading" }
  | {
      readonly state: "loaded";
      readonly status: TrackDownload["status"];
      readonly text: string;
      readonly job: number | null;
      readonly held: boolean;
      readonly reason: string | undefined;
      readonly httpStatus: number | undefined;
    }
  | { readonly state: "failed"; readonly cause: unknown };

function downloadRequestError(
  failure: unknown,
  action: "read" | "retry" | "dismiss",
  t: Words,
): string {
  const text = failure instanceof Error ? failure.message : String(failure);
  if (action !== "retry" || !(failure instanceof ApiError)) return text;
  if (
    failure.status === 403 &&
    text === "Only the Account that asked for a Job, or an admin, can change it."
  )
    return t(text);
  if (failure.status === 409 && text === "Only a failed or cancelled Job can be retried.") {
    return t(text);
  }
  const id = failure.status === 404 ? /^There is no Job (\d+)\.$/u.exec(text)?.[1] : undefined;
  return id === undefined ? text : t("There is no Job {{id}}.", { id });
}

/**
 * *Download failed* on a song's row, opening why it failed, read when opened, with
 * *Retry download*, *Add the file…*, and a way to dismiss the failure in Downloaded.
 */
export function DownloadFailed({
  track,
  onAddFile,
  dismiss,
}: {
  readonly track: Track;
  readonly onAddFile: (track: Track) => void;
  readonly dismiss: ((ids: readonly number[]) => Promise<void>) | undefined;
}) {
  const words = useWords();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<DownloadRead>({ state: "loading" });
  const [details, setDetails] = useState<DownloadDetailsTarget>();
  const [busy, setBusy] = useState<"retry" | "dismiss">();
  const [failure, setFailure] = useState<{
    readonly action: "retry" | "dismiss";
    readonly cause: unknown;
  }>();
  const generation = useRef(0);
  const failedJob = track.download_failure_job_id;
  const job = read.state === "loaded" && read.status === "failed" && !read.held ? read.job : null;
  const openRead = () => {
    const request = ++generation.current;
    setFailure(undefined);
    setRead({ state: "loading" });
    api.download(track.id).then(
      (download) => {
        if (request === generation.current) {
          setRead({
            state: "loaded",
            status: download.status,
            text: download.message,
            job: download.job_id,
            held: download.hold !== undefined,
            reason: download.hold ?? download.reason,
            httpStatus:
              download.hold === undefined || download.hold === download.reason
                ? download.http_status
                : undefined,
          });
        }
      },
      (cause: unknown) => {
        if (request === generation.current) setRead({ state: "failed", cause });
      },
    );
  };
  const act = (action: "retry" | "dismiss", request: Promise<unknown>) => {
    setBusy(action);
    setFailure(undefined);
    request.then(
      () => {
        setBusy(undefined);
        setOpen(false);
      },
      (cause: unknown) => {
        setBusy(undefined);
        setFailure({ action, cause });
      },
    );
  };
  const error =
    failure !== undefined
      ? downloadRequestError(failure.cause, failure.action, words)
      : read.state === "failed"
        ? downloadRequestError(read.cause, "read", words)
        : "";
  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(opening) => {
        setOpen(opening);
        if (opening) {
          openRead();
        } else {
          ++generation.current;
        }
      }}
    >
      <Menu.Trigger asChild>
        <button
          type="button"
          className="why failed"
          aria-label={words("Download failed: why, and what to do, for {{title}}", {
            title: track.title,
          })}
          title={words("Download failed: why, and what to do")}
        >
          <WarningCircleIcon weight="bold" aria-hidden />
          <CaretDownIcon weight="bold" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="track-menu download-job-menu"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          {read.state !== "failed" && (
            <Menu.Label className="download-failed-why">
              {read.state === "loading"
                ? words("Reading why it failed…")
                : read.status === "downloading"
                  ? words("This download is already in progress.")
                  : read.reason === undefined
                    ? downloadFailureOf(read.text, words)
                    : diagnosticReason(read.reason, read.httpStatus ?? null, words)}
            </Menu.Label>
          )}
          {error !== "" && (
            <p className="download-job-error" role="alert">
              {error}
            </p>
          )}
          {!(read.state === "loaded" && read.held) && (
            <Item
              icon={<ArrowClockwiseIcon className={busy === "retry" ? "spin" : undefined} />}
              disabled={job === null || busy !== undefined}
              onSelect={(event) => {
                // Open until the server answers, so a refusal shows here.
                event.preventDefault();
                if (job !== null) {
                  act("retry", api.retryJob(job));
                }
              }}
            >
              {words(busy === "retry" ? "Retrying…" : "Retry download")}
            </Item>
          )}
          {read.state === "loaded" && read.job !== null && (
            <Item
              icon={<FileTextIcon />}
              onSelect={() => {
                if (read.job !== null) setDetails({ job: read.job });
              }}
            >
              {words("Download details")}
            </Item>
          )}
          {!track.joined && (
            <Item
              icon={<UploadSimpleIcon />}
              disabled={busy !== undefined}
              onSelect={() => {
                onAddFile(track);
              }}
            >
              {words("Add the file…")}
            </Item>
          )}
          {dismiss !== undefined && failedJob !== null && (
            <Item
              icon={<XIcon className={busy === "dismiss" ? "spin" : undefined} />}
              disabled={busy !== undefined}
              onSelect={(event) => {
                event.preventDefault();
                act("dismiss", dismiss([failedJob]));
              }}
            >
              {busy === "dismiss" ? words("Dismissing…") : words("Dismiss failed download")}
            </Item>
          )}
        </Menu.Content>
      </Menu.Portal>
      {details !== undefined && (
        <DownloadDetails
          target={details}
          close={() => {
            setDetails(undefined);
          }}
        />
      )}
    </Menu.Root>
  );
}
