/**
 * @file The views to move between: a rail, tabs, or a tab bar, as the width allows.
 *
 * *Clean up* sits under Insights, with how many names wait. A phone's tab bar has no
 * room for it, so there Insights carries the count, and opens with a way to it.
 *
 * The rail can collapse to its icons, to leave the page more room; each then names its
 * view on hover, as its accessible name always does. Or it minimizes to the view
 * shown, whose menu goes to the others. Its two controls sit at its top; who is signed
 * in sits at its foot, with Sign out in a menu.
 */

import {
  BroomIcon,
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  CaretDownIcon,
  CornersInIcon,
  CornersOutIcon,
  ChartBarIcon,
  DownloadSimpleIcon,
  GearSixIcon,
  type Icon,
  MicrophoneStageIcon,
  MusicNotesSimpleIcon,
  PlaylistIcon,
  RadioIcon,
  SignOutIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";

import { VIEW_LABELS } from "../rail";
import { type Route, hrefOf } from "../routes";

type Top =
  | "library"
  | "radio"
  | "artists"
  | "albums"
  | "downloaded"
  | "playlists"
  | "insights"
  | "settings"
  | "clean-up";

const TOPS: readonly {
  readonly view: Top;
  readonly label: string;
  readonly icon: Icon;
  /** Shown under the view before it, and left out of a phone's tab bar. */
  readonly under?: boolean;
}[] = [
  { view: "library", label: VIEW_LABELS.library, icon: MusicNotesSimpleIcon },
  { view: "radio", label: VIEW_LABELS.radio, icon: RadioIcon },
  { view: "artists", label: VIEW_LABELS.artists, icon: MicrophoneStageIcon },
  { view: "albums", label: VIEW_LABELS.albums, icon: VinylRecordIcon },
  { view: "playlists", label: VIEW_LABELS.playlists, icon: PlaylistIcon },
  { view: "downloaded", label: VIEW_LABELS.downloaded, icon: DownloadSimpleIcon },
  { view: "insights", label: VIEW_LABELS.insights, icon: ChartBarIcon },
  { view: "clean-up", label: VIEW_LABELS["clean-up"], icon: BroomIcon, under: true },
  { view: "settings", label: VIEW_LABELS.settings, icon: GearSixIcon },
];

/** The top view a route belongs to: an artist's Tracks belong to Artists, and so on. */
function topOf(route: Route): Top | undefined {
  switch (route.view) {
    case "artist":
      return "artists";
    case "album":
      return "albums";
    case "playlist":
      return "playlists";
    case "search":
      return undefined;
    default:
      return route.view;
  }
}

/** Who is signed in, and how to sign out. */
export interface NavAccount {
  readonly name: string;
  readonly onSignOut: () => void;
}

/**
 * Links to each view, the current one marked, and how many names wait to be cleaned up.
 * With `onToggle`, a rail that shows its names, or not while `collapsed`; with
 * `onMinimize`, one that minimizes to the view shown, as it is while `minimized`.
 */
export function Nav({
  route,
  toDo = 0,
  collapsed = false,
  minimized = false,
  onToggle,
  onMinimize,
  account,
}: {
  readonly route: Route;
  readonly toDo?: number;
  readonly collapsed?: boolean;
  readonly minimized?: boolean;
  readonly onToggle?: () => void;
  readonly onMinimize?: () => void;
  readonly account?: NavAccount;
}) {
  const top = topOf(route);
  const waiting = `${String(toDo)} ${toDo === 1 ? "name" : "names"} to clean up`;
  const countedOf = (view: Top) => toDo > 0 && (view === "clean-up" || view === "insights");
  const className = ["views", collapsed && "collapsed", minimized && "minimized"]
    .filter(Boolean)
    .join(" ");
  return (
    <nav className={className} aria-label="Views" id="views">
      {(onToggle !== undefined || onMinimize !== undefined) && (
        <div className="views-bar">
          {minimized && <ViewMenu top={top} toDo={toDo} account={account} />}
          {onToggle !== undefined && !minimized && (
            <button
              type="button"
              className="views-control"
              aria-label="Show the views' names"
              aria-expanded={!collapsed}
              aria-controls="views"
              title={collapsed ? "Show the views' names" : "Show only the icons"}
              onClick={onToggle}
            >
              {collapsed ? (
                <CaretDoubleRightIcon aria-hidden />
              ) : (
                <CaretDoubleLeftIcon aria-hidden />
              )}
            </button>
          )}
          {onMinimize !== undefined && (
            <button
              type="button"
              className="views-control"
              aria-label={minimized ? "Show the whole rail" : "Minimize the rail"}
              title={minimized ? "Show the whole rail" : "Minimize the rail"}
              onClick={onMinimize}
            >
              {minimized ? <CornersOutIcon aria-hidden /> : <CornersInIcon aria-hidden />}
            </button>
          )}
        </div>
      )}
      <ul className="views-list">
        {TOPS.map(({ view, label, icon: ViewIcon, under = false }) => {
          const current = view === top;
          const counted = countedOf(view);
          const named = counted ? `${label}, ${waiting}` : label;
          return (
            <li key={view} className={under ? "under" : undefined}>
              <a
                className="view-link"
                href={hrefOf({ view })}
                aria-current={current ? "page" : undefined}
                aria-label={counted ? named : undefined}
                title={collapsed ? named : undefined}
              >
                <ViewIcon weight={current ? "fill" : "regular"} aria-hidden />
                <span>{label}</span>
                {counted && (
                  <span
                    className={view === "insights" ? "view-count on-phone" : "view-count"}
                    aria-hidden
                  >
                    {toDo}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      {account !== undefined && (
        <div className="views-foot">
          <AccountMenu account={account} collapsed={collapsed} />
        </div>
      )}
    </nav>
  );
}

/** The view shown, opening a menu of every view, and Sign out at its foot. */
function ViewMenu({
  top,
  toDo,
  account,
}: {
  readonly top: Top | undefined;
  readonly toDo: number;
  readonly account: NavAccount | undefined;
}) {
  const shown = TOPS.find(({ view }) => view === top);
  const ShownIcon = shown?.icon ?? MusicNotesSimpleIcon;
  const label = shown?.label ?? "Search";
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className="views-shown" aria-label={`${label}: choose a view`}>
          <ShownIcon className="views-shown-icon" weight="fill" aria-hidden />
          <span>{label}</span>
          {toDo > 0 && (
            <span className="menu-count" aria-hidden>
              {toDo}
            </span>
          )}
          <CaretDownIcon className="views-shown-caret" weight="bold" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="track-menu" align="start" sideOffset={4} collisionPadding={8}>
          {TOPS.map(({ view, label: name, icon: ViewIcon }) => (
            <Menu.Item key={view} className="track-menu-item" asChild>
              <a href={hrefOf({ view })} aria-current={view === top ? "page" : undefined}>
                <ViewIcon className="track-menu-icon" aria-hidden />
                {name}
                {view === "clean-up" && toDo > 0 && (
                  <span className="menu-count" aria-hidden>
                    {toDo}
                  </span>
                )}
              </a>
            </Menu.Item>
          ))}
          {account !== undefined && (
            <>
              <Menu.Separator className="track-menu-separator" />
              <Menu.Label className="track-menu-label">{account.name}</Menu.Label>
              <Menu.Item className="track-menu-item" onSelect={account.onSignOut}>
                <SignOutIcon className="track-menu-icon" aria-hidden />
                Sign out
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Who is signed in, as a round initial and the name, opening a menu with Sign out. */
export function AccountMenu({
  account,
  collapsed = false,
}: {
  readonly account: NavAccount;
  readonly collapsed?: boolean;
}) {
  const first = account.name.trim().codePointAt(0);
  const initial = first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="views-account"
          aria-label={`${account.name}: account`}
          title={collapsed ? account.name : undefined}
        >
          <span className="views-avatar" aria-hidden>
            {initial}
          </span>
          <span className="views-account-name">{account.name}</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="track-menu"
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <Menu.Label className="track-menu-label">{account.name}</Menu.Label>
          <Menu.Item className="track-menu-item" onSelect={account.onSignOut}>
            <SignOutIcon className="track-menu-icon" aria-hidden />
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
