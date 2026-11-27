/**
 * @file The views to move between: a rail, tabs, or a tab bar, as the width allows.
 *
 * *Clean up* sits under Insights, with how many names and files wait. A phone's tab bar has no
 * room for it, so there Insights carries the count, and opens with a way to it.
 * *Downloaded* says how many songs download now.
 *
 * The rail can collapse to its icons, to leave the page more room; each then names its
 * view on hover, as its accessible name always does. Or it minimizes to the view
 * shown, whose menu goes to the others. Its two controls sit at its top; who is signed
 * in sits at its foot, with Sign out in a menu.
 */

import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  CaretDownIcon,
  CornersInIcon,
  CornersOutIcon,
  MusicNotesSimpleIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { type RailView, setRailOrder, useRailOrder } from "../railOrder";
import { type RailEntry, type Top, railAnnouncements, railEntriesIn } from "./railViews";
import { type Route, hrefOf } from "../routes";
import { useWords } from "../locale";

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
  downloading = 0,
}: {
  readonly route: Route;
  readonly toDo?: number;
  /** How many songs download now. */
  readonly downloading?: number;
  readonly collapsed?: boolean;
  readonly minimized?: boolean;
  readonly onToggle?: () => void;
  readonly onMinimize?: () => void;
  readonly account?: NavAccount;
}) {
  const t = useWords();
  const top = topOf(route);
  const waiting = t("{{count}} to clean up", { count: toDo });
  const countOf = (view: Top) =>
    view === "downloaded" ? downloading : view === "clean-up" || view === "insights" ? toDo : 0;
  const saying = (view: Top) =>
    view === "downloaded" ? t("downloading", { count: downloading }) : waiting;
  const order = useRailOrder();
  const entries = railEntriesIn(order);
  const sensors = useSensors(
    // A mouse moves a little first, so a click still opens the view; a finger holds a
    // moment first, so a tap opens it and a swipe scrolls the tab bar.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  const drop = ({ active, over }: DragEndEvent) => {
    swallowNextClick();
    const from = order.indexOf(active.id as RailView);
    const to = over === null ? -1 : order.indexOf(over.id as RailView);
    if (from >= 0 && to >= 0 && from !== to) {
      setRailOrder(arrayMove([...order], from, to));
    }
  };
  const linkOf = ({ view, label: english, icon: ViewIcon }: RailEntry, describedBy?: string) => {
    const label = t(english);
    const current = view === top;
    const count = countOf(view);
    const counted = count > 0;
    const named = counted ? `${label}, ${saying(view)}` : label;
    return (
      <a
        className="view-link"
        href={hrefOf({ view })}
        aria-current={current ? "page" : undefined}
        aria-label={counted ? named : undefined}
        aria-describedby={describedBy}
        title={collapsed ? named : undefined}
      >
        <ViewIcon weight={current ? "fill" : "regular"} aria-hidden />
        <span>{label}</span>
        {counted && (
          <span className={view === "insights" ? "view-count on-phone" : "view-count"} aria-hidden>
            {count}
          </span>
        )}
      </a>
    );
  };
  const className = ["views", collapsed && "collapsed", minimized && "minimized"]
    .filter(Boolean)
    .join(" ");
  return (
    <nav className={className} aria-label={t("Views")} id="views">
      {(onToggle !== undefined || onMinimize !== undefined) && (
        <div className="views-bar">
          {minimized && (
            <ViewMenu top={top} toDo={toDo} downloading={downloading} account={account} />
          )}
          {onToggle !== undefined && !minimized && (
            <button
              type="button"
              className="views-control"
              aria-label={t("Show the views' names")}
              aria-expanded={!collapsed}
              aria-controls="views"
              title={t(collapsed ? "Show the views' names" : "Show only the icons")}
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
              aria-label={t(minimized ? "Show the whole rail" : "Minimize the rail")}
              title={t(minimized ? "Show the whole rail" : "Minimize the rail")}
              onClick={onMinimize}
            >
              {minimized ? <CornersOutIcon aria-hidden /> : <CornersInIcon aria-hidden />}
            </button>
          )}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={drop}
        onDragCancel={swallowNextClick}
        accessibility={{
          announcements: railAnnouncements(order, t),
          screenReaderInstructions: {
            draggable: t(
              "Use Rail order in Settings → Appearance to reorder views with the keyboard.",
            ),
          },
        }}
      >
        <SortableContext items={[...order]} strategy={rectSortingStrategy}>
          <ul className="views-list">
            {entries.map((entry) =>
              isMovable(entry.view) ? (
                <MovableView key={entry.view} view={entry.view}>
                  {(describedBy) => linkOf(entry, describedBy)}
                </MovableView>
              ) : (
                <li key={entry.view} className={entry.under === true ? "under" : undefined}>
                  {linkOf(entry)}
                </li>
              ),
            )}
          </ul>
        </SortableContext>
      </DndContext>
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
  downloading,
  account,
}: {
  readonly top: Top | undefined;
  readonly toDo: number;
  readonly downloading: number;
  readonly account: NavAccount | undefined;
}) {
  const t = useWords();
  const entries = railEntriesIn(useRailOrder());
  const shown = entries.find(({ view }) => view === top);
  const ShownIcon = shown?.icon ?? MusicNotesSimpleIcon;
  const label = t(shown?.label ?? "Search");
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="views-shown"
          aria-label={t("{{view}}: choose a view", { view: label })}
        >
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
          {entries.map(({ view, label: name, icon: ViewIcon }) => (
            <Menu.Item key={view} className="track-menu-item" asChild>
              <a href={hrefOf({ view })} aria-current={view === top ? "page" : undefined}>
                <ViewIcon className="track-menu-icon" aria-hidden />
                {t(name)}
                {view === "clean-up" && toDo > 0 && (
                  <span className="menu-count" aria-hidden>
                    {toDo}
                  </span>
                )}
                {view === "downloaded" && downloading > 0 && (
                  <span className="menu-count" aria-hidden>
                    {downloading}
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
                {t("Sign out")}
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
  const t = useWords();
  const first = account.name.trim().codePointAt(0);
  const initial = first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="views-account"
          aria-label={t("{{name}}: account", { name: account.name })}
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
            {t("Sign out")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Whether a browser may move `view` in the rail: not Clean up, under Insights, nor Settings. */
function isMovable(view: Top): view is RailView {
  return view !== "clean-up" && view !== "settings";
}

/** A view the rail lets a mouse or a finger drag to another place. */
function MovableView({
  view,
  children,
}: {
  readonly view: RailView;
  readonly children: (describedBy: string) => ReactNode;
}) {
  // Only the pointer's listeners: the link keeps its own role, and Enter still opens it.
  // Settings › Appearance moves views by keyboard.
  const { attributes, setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: view,
  });
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? "dragging" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
    >
      {children(attributes["aria-describedby"])}
    </li>
  );
}

/** How long after a drop its click may come, in milliseconds. */
const CLICK_AFTER_DROP_MS = 300;

/** Keep the click that follows letting go of a dragged link from opening its view. */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => {
    window.removeEventListener("click", swallow, { capture: true });
  }, CLICK_AFTER_DROP_MS);
}
