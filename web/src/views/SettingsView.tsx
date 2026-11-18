/**
 * @file Settings: how the page looks, its keyboard shortcuts, the network, and the room
 * Downloads may take.
 *
 * Each section saves on its own, and folds away under its heading; a bar of the
 * sections' names goes to one, opening it, as a link naming a section does. Which are folded is this browser's
 * own. The storage limit is the household's, so only an admin changes it; a
 * member sees it and what it holds.
 */

import { CaretDownIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  type Mode,
  type Preview,
  type Settings,
  type Storage,
  type WaitingDevice,
  api,
  newestOf,
} from "../api";
import { useAutoSave } from "../useAutoSave";
import { classOf } from "../useNote";
import { formatBytes } from "../format";
import { hrefOf } from "../routes";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";
import { AccentPicker } from "./AccentPicker";
import { DynamicsSwitch } from "./DynamicsSwitch";
import { AiSettings } from "./AiSettings";
import { BilibiliSettings } from "./BilibiliSettings";
import { DeviceSettings } from "./DeviceSettings";
import { KindSettings } from "./KindSettings";
import { LyricsSettings } from "./LyricsSettings";
import { LyricsSites } from "./LyricsSites";
import { PictureSites } from "./PictureSites";
import { MusicBrainzSettings } from "./MusicBrainzSettings";
import { NetworkSettings } from "./NetworkSettings";
import { RatingsSettings } from "./RatingsSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { SplitSettings } from "./SplitSettings";
import { ThemeSwitch } from "./ThemeSwitch";
import { VideoDetailsSettings } from "./VideoDetailsSettings";

const GB = 1_000_000_000;

/** The sections, in the order the page shows them. */
const SECTIONS = [
  { id: "appearance", title: "Appearance" },
  { id: "keyboard-shortcuts", title: "Keyboard shortcuts" },
  { id: "network", title: "Network" },
  { id: "devices", title: "Other devices" },
  { id: "kinds", title: "Songs and albums" },
  { id: "ratings", title: "Your ratings" },
  { id: "storage", title: "Downloads and storage" },
  { id: "bilibili", title: "Bilibili" },
  { id: "musicbrainz", title: "MusicBrainz" },
  { id: "deezer", title: "Deezer" },
  { id: "lyrics", title: "Lyrics" },
  { id: "ai", title: "AI" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** The sections only an admin sees: they run lookups for every Track, or let devices in. */
const ADMIN_ONLY: ReadonlySet<SectionId> = new Set([
  "devices",
  "bilibili",
  "musicbrainz",
  "deezer",
  "ai",
]);

const FOLDED = "medleyplay.settings.folded.v1";

/** Return the sections this browser last kept folded. */
function loadFolded(): ReadonlySet<SectionId> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FOLDED) ?? "[]");
    return new Set(
      SECTIONS.map(({ id }) => id).filter((id) => Array.isArray(saved) && saved.includes(id)),
    );
  } catch {
    return new Set();
  }
}

function keepFolded(folded: ReadonlySet<SectionId>): void {
  try {
    localStorage.setItem(FOLDED, JSON.stringify([...folded]));
  } catch {
    // A browser that keeps nothing opens every section next time.
  }
}

/** Return `folded` with the section `id` names open, when it names one. */
function openedAt(folded: ReadonlySet<SectionId>, id: string | undefined): ReadonlySet<SectionId> {
  return new Set([...folded].filter((each) => each !== id));
}

/** Scroll to the section `id` names, if it is shown, and focus its heading. */
function scrollTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: "start" });
  document.getElementById(`${id}-toggle`)?.focus({ preventScroll: true });
}

/** How long a linked section is kept in view while the sections above it load. */
const SETTLING_MS = 2000;

/**
 * Scroll to the section `id` names again each time the page's size changes, as the
 * sections above it load, for a moment or until the listener scrolls; return a stop.
 */
function keepInView(id: string): () => void {
  if (typeof ResizeObserver === "undefined") {
    return () => undefined;
  }
  const observer = new ResizeObserver(() => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  });
  const handOver = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const event of handOver) {
      window.removeEventListener(event, stop);
    }
  };
  const timer = window.setTimeout(stop, SETTLING_MS);
  for (const event of handOver) {
    window.addEventListener(event, stop, { passive: true });
  }
  observer.observe(document.body);
  return stop;
}

/** The Settings view; `admin` may change what the household shares. */
export function SettingsView({
  admin,
  section,
  mode,
  onModeChecked,
  onEnrichersChanged,
  onKindsChanged,
  onRatingsChanged = () => undefined,
  waitingDevices = [],
}: {
  readonly admin: boolean;
  /** The id of the section to open and go to, as a link names it; the page shows them all. */
  readonly section?: string | undefined;
  readonly mode: Mode | null;
  /** Show the Mode a check of the network came to. */
  readonly onModeChecked: (mode: Mode) => void;
  /** Called after a setting changes which Tracks an enricher may be asked about. */
  readonly onEnrichersChanged: () => void;
  /** Called after a setting changes how a Track's kind is guessed. */
  readonly onKindsChanged: () => void;
  /** Called after your album ratings are imported or forgotten. */
  readonly onRatingsChanged?: (() => void) | undefined;
  /** The devices waiting for an answer, as the event stream last said. */
  readonly waitingDevices?: readonly WaitingDevice[];
}) {
  const [folded, setFolded] = useState(() => openedAt(loadFolded(), section));
  // The section a link last named, so naming another opens that one too.
  const [named, setNamed] = useState(section);
  if (named !== section) {
    setNamed(section);
    setFolded((held) => openedAt(held, section));
  }
  // One copy for the sections that save the settings, so each saves at the latest revision.
  const [household, setHousehold] = useState<Settings | undefined>(undefined);
  const keepNewest = (read: Settings) => {
    setHousehold((held) => newestOf(held, read));
  };
  const fold = (next: ReadonlySet<SectionId>) => {
    setFolded(next);
    keepFolded(next);
  };
  const toggle = (id: SectionId) => {
    const next = new Set(folded);
    if (!next.delete(id)) {
      next.add(id);
    }
    fold(next);
  };
  const go = (id: SectionId) => {
    if (folded.has(id)) {
      fold(new Set([...folded].filter((each) => each !== id)));
    }
    scrollTo(id);
  };
  const sections = SECTIONS.filter(({ id }) => admin || !ADMIN_ONLY.has(id));
  useEffect(() => {
    if (section === undefined) {
      return undefined;
    }
    scrollTo(section);
    return keepInView(section);
  }, [section]);
  const allFolded = sections.every(({ id }) => folded.has(id));
  const contents: Record<SectionId, ReactNode> = {
    appearance: (
      <>
        <p className="hint">Follow this device's light or dark setting, or keep one.</p>
        <ThemeSwitch />
        <p className="hint">The color of buttons, links, and what's playing.</p>
        <AccentPicker />
        <p className="hint">
          What moves behind Now Playing. Still when this device asks for less motion.
        </p>
        <DynamicsSwitch />
      </>
    ),
    "keyboard-shortcuts": <ShortcutSettings />,
    network: <NetworkSettings admin={admin} mode={mode} onModeChecked={onModeChecked} />,
    devices: <DeviceSettings waiting={waitingDevices} />,
    kinds: (
      <>
        <KindSettings
          admin={admin}
          settings={household}
          onSettings={keepNewest}
          onChanged={onKindsChanged}
        />
        <SplitSettings admin={admin} settings={household} onSettings={keepNewest} />
      </>
    ),
    ratings: <RatingsSettings onChanged={onRatingsChanged} />,
    storage: <StorageSettings admin={admin} settings={household} onSettings={keepNewest} />,
    bilibili: (
      <>
        <BilibiliSettings />
        <VideoDetailsSettings onChanged={onEnrichersChanged} />
      </>
    ),
    musicbrainz: <MusicBrainzSettings onChanged={onEnrichersChanged} />,
    deezer: <PictureSites settings={household} onSettings={keepNewest} />,
    lyrics: (
      <>
        <LyricsSettings onChanged={onEnrichersChanged} />
        <LyricsSites settings={household} onSettings={keepNewest} />
      </>
    ),
    ai: <AiSettings onChanged={onEnrichersChanged} />,
  };
  return (
    <>
      <header className="view-heading">
        <h2 className="section" data-rail-named>
          Settings
        </h2>
      </header>
      <nav className="settings-toc" aria-label="Settings sections">
        <ul>
          {sections.map(({ id, title }) => (
            <li key={id}>
              <button
                type="button"
                className="secondary outline"
                aria-label={`Go to ${title}`}
                onClick={() => {
                  go(id);
                }}
              >
                {title}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="fold-all"
          onClick={() => {
            fold(allFolded ? new Set() : new Set(sections.map(({ id }) => id)));
          }}
        >
          {allFolded ? "Open all" : "Fold all"}
        </button>
      </nav>
      {sections.map(({ id, title }) => (
        <SettingsSection
          key={id}
          id={id}
          title={title}
          folded={folded.has(id)}
          onToggle={() => {
            toggle(id);
          }}
        >
          {contents[id]}
        </SettingsSection>
      ))}
    </>
  );
}

/** A section whose heading opens and folds it; folded, it keeps what it holds, hidden. */
function SettingsSection({
  id,
  title,
  folded,
  onToggle,
  children,
}: {
  readonly id: SectionId;
  readonly title: string;
  readonly folded: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} className="settings-section" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>
        <button
          id={`${id}-toggle`}
          type="button"
          className="section-toggle"
          aria-expanded={!folded}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          {title}
          <CaretDownIcon className="caret" weight="bold" aria-hidden />
        </button>
      </h3>
      <div id={`${id}-body`} className="section-body" hidden={folded}>
        {children}
      </div>
    </section>
  );
}

/** A limit as the form holds it: none, or a number of GB as typed. */
interface Draft {
  readonly unlimited: boolean;
  readonly gb: string;
}

const draftOf = (settings: Settings): Draft =>
  settings.storage_limit === null
    ? { unlimited: true, gb: "" }
    : { unlimited: false, gb: String(Math.round((settings.storage_limit / GB) * 10) / 10) };

/** The bytes `draft` asks for, `null` for no limit, or `undefined` while it isn't a size. */
function bytesOf(draft: Draft): number | null | undefined {
  if (draft.unlimited) {
    return null;
  }
  const gb = Number(draft.gb);
  return draft.gb.trim() === "" || !Number.isFinite(gb) || gb < 0 ? undefined : Math.round(gb * GB);
}

/** A limit to save, and what the person confirmed it removes, if they did. */
interface Limit {
  readonly bytes: number | null;
  readonly confirmed?: Preview | null;
}

/** A limit waiting for a confirmation, and what it removes: `null` when that is unknown. */
interface Removing {
  readonly bytes: number;
  readonly preview: Preview | null;
}

const NOTHING_REMOVED: Preview = { removals: [] };

/** Return how many bytes a preview removes; an unknown one, as many as there could be. */
const sizeOf = (preview: Preview | null): number =>
  preview === null
    ? Number.POSITIVE_INFINITY
    : preview.removals.reduce((total, each) => total + each.size, 0);

/** What the Downloads hold, and the storage limit. */
function StorageSettings({
  admin,
  settings,
  onSettings,
}: {
  readonly admin: boolean;
  /** The household's settings as last read, shared with the other sections that save them. */
  readonly settings: Settings | undefined;
  readonly onSettings: (settings: Settings) => void;
}) {
  const [storage, setStorage] = useState<Storage | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({ unlimited: true, gb: "" });
  /** A lower limit waiting to be confirmed: what saving it removes, `null` if unknown. */
  const [removing, setRemoving] = useState<Removing>();
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const focusing = useRef(false);
  const latest = useRef(settings);
  useEffect(() => {
    if (settings !== undefined) {
      latest.current = newestOf(latest.current, settings);
    }
  }, [settings]);
  useEffect(() => {
    if (focusing.current) {
      focusing.current = false;
      field.current?.focus();
    }
  });

  const reload = () => {
    Promise.all([api.settings(), api.storage()]).then(
      ([read, now]) => {
        const newest = newestOf(latest.current, read);
        latest.current = newest;
        onSettings(newest);
        setStorage(now);
        setDraft(draftOf(newest));
        setRemoving(undefined);
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  const loadOnOpen = useEffectEvent(() => {
    reload();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  // A limit that would remove Downloads waits for a confirmation of what it removes; one
  // confirmed is asked about again if, by the time it saves, it would remove more.
  const saving = useAutoSave(async ({ bytes, confirmed }: Limit, notes) => {
    const base = latest.current;
    if (base === undefined || bytes === base.storage_limit) {
      setRemoving(undefined);
      notes.tell("");
      return "unchanged";
    }
    try {
      if (bytes !== null) {
        const preview = await api.storage(bytes).then(
          (planned) => planned.preview ?? NOTHING_REMOVED,
          () => null,
        );
        const removes = preview === null || preview.removals.length > 0;
        if (removes && (confirmed === undefined || sizeOf(preview) > sizeOf(confirmed))) {
          setRemoving({ bytes, preview });
          notes.tell("");
          return "held";
        }
      }
      const { outcome, settings: now } = await saveChange(base, { storage_limit: bytes });
      latest.current = now;
      onSettings(now);
      setRemoving(undefined);
      if (outcome === "conflict") {
        setDraft(draftOf(now));
        notes.tell(CHANGED_ELSEWHERE);
        return "conflict";
      }
      api.storage().then(setStorage, () => {
        // The usage shown is a moment old; the next visit reads it again.
      });
      return "saved";
    } catch (failure) {
      notes.refuse(notSaved(failure));
      return "failed";
    }
  });

  const change = (next: Draft, typed: boolean) => {
    setDraft(next);
    setRemoving(undefined);
    const bytes = bytesOf(next);
    if (bytes === undefined) {
      saving.cancel();
    } else if (!saving.busy() && bytes === latest.current?.storage_limit) {
      saving.tell("");
    } else if (typed) {
      saving.later({ bytes });
    } else {
      saving.now({ bytes });
    }
  };
  /** Save what the field holds as it is left, or put back what is saved if it isn't a size. */
  const leave = () => {
    const bytes = bytesOf(draft);
    const saved = latest.current;
    if (bytes === undefined) {
      saving.cancel();
      if (saved !== undefined) {
        setDraft(draftOf(saved));
      }
      saving.refuse("Not saved: type a size in GB, such as 20.");
    } else if (removing === undefined && (saving.busy() || bytes !== saved?.storage_limit)) {
      saving.now({ bytes });
    }
  };

  return (
    <>
      {error !== "" && <p role="alert">{error}</p>}
      {storage === undefined || settings === undefined ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            Reading what the Downloads hold…
          </p>
        )
      ) : (
        <>
          <Usage storage={storage} />
          {admin ? (
            <form
              className="limit"
              onSubmit={(event) => {
                event.preventDefault();
                leave();
              }}
            >
              <fieldset>
                <legend>Storage limit</legend>
                <label className="limit-choice">
                  <input
                    type="radio"
                    name="limit"
                    checked={draft.unlimited}
                    onChange={() => {
                      change({ ...draft, unlimited: true }, false);
                    }}
                  />
                  No limit
                </label>
                <label className="limit-choice">
                  <input
                    type="radio"
                    name="limit"
                    checked={!draft.unlimited}
                    onChange={() => {
                      // Choosing a limit opens its size to type; the size is saved, not the choice.
                      setDraft({ unlimited: false, gb: draft.gb === "" ? "20" : draft.gb });
                      focusing.current = true;
                    }}
                  />
                  Up to
                  <input
                    ref={field}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    aria-label="Limit in GB"
                    value={draft.gb}
                    disabled={draft.unlimited}
                    onChange={(event) => {
                      change({ unlimited: false, gb: event.currentTarget.value }, true);
                    }}
                    onBlur={leave}
                  />
                  GB
                </label>
              </fieldset>
              {removing !== undefined && (
                <div className="limit-confirm">
                  <p>{removalText(removing.preview)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      saving.now({ bytes: removing.bytes, confirmed: removing.preview });
                    }}
                  >
                    Remove and save
                  </button>
                  <button
                    type="button"
                    className="secondary outline"
                    onClick={() => {
                      const kept = latest.current;
                      setRemoving(undefined);
                      if (kept !== undefined) {
                        setDraft(draftOf(kept));
                      }
                    }}
                  >
                    Keep the limit
                  </button>
                </div>
              )}
              <p className={classOf(saving.note, "hint saved")} role="status">
                {saving.note.text}
              </p>
            </form>
          ) : (
            <p className="hint">
              {settings.storage_limit === null
                ? "There is no storage limit. An admin can set one."
                : `The storage limit is ${formatBytes(settings.storage_limit)}, set by an admin.`}
            </p>
          )}
          <p className="hint">
            When room is needed, the Downloads of the least favorite songs go first; a song a kept
            Playlist holds is never removed to make room.
          </p>
        </>
      )}
    </>
  );
}

/** What the Downloads and cache use, against the limit or the disk. */
function Usage({ storage }: { readonly storage: Storage }) {
  if (storage.error !== null) {
    return <p role="alert">{storage.error}</p>;
  }
  const downloads = storage.downloads ?? 0;
  const cache = storage.cache ?? 0;
  const reserved = storage.reserved ?? 0;
  const used = downloads + cache + reserved;
  const room = storage.limit ?? used + (storage.free ?? 0);
  const share = (bytes: number) => `${String(room > 0 ? Math.min((bytes / room) * 100, 100) : 0)}%`;
  const last = storage.last_evaluation;
  return (
    <div className="usage">
      <p className="usage-total">
        <strong>{formatBytes(used)}</strong>{" "}
        {storage.limit === null
          ? `used, ${formatBytes(storage.free ?? 0)} free on this disk`
          : `of ${formatBytes(storage.limit)} used`}
      </p>
      <div className="meter" aria-hidden>
        <span className="downloads" style={{ width: share(downloads) }} />
        <span className="cache" style={{ width: share(cache) }} />
        <span className="reserved" style={{ width: share(reserved) }} />
      </div>
      <dl className="legend">
        <div>
          <dt>
            <span className="swatch downloads" aria-hidden />
            <a href={hrefOf({ view: "downloaded" })} title="Show the songs downloaded">
              Downloads
            </a>
          </dt>
          <dd>{formatBytes(downloads)}</dd>
        </div>
        <div>
          <dt>
            <span className="swatch cache" aria-hidden />
            Prepared copies
          </dt>
          <dd>{formatBytes(cache)}</dd>
        </div>
        {reserved > 0 && (
          <div>
            <dt>
              <span className="swatch reserved" aria-hidden />
              <a href={hrefOf({ view: "downloaded" })} title="Show the songs downloading">
                Downloading
              </a>
            </dt>
            <dd>{formatBytes(reserved)}</dd>
          </div>
        )}
        {storage.wanted !== null && (
          <div>
            <dt>Kept Playlists want</dt>
            <dd>{formatBytes(storage.wanted)}</dd>
          </div>
        )}
      </dl>
      {last !== null && (
        <p className="hint">
          Last checked {new Date(last.at).toLocaleString()}: {countOf(last.removed, "removed")},{" "}
          {countOf(last.started, "started")}.{last.error === null ? "" : ` ${last.error}`}
        </p>
      )}
    </div>
  );
}

const countOf = (count: number, done: string) =>
  `${String(count)} ${count === 1 ? "download" : "downloads"} ${done}`;

/** Say what saving a lower limit would remove, from its preview. */
function removalText(preview: Preview | null): string {
  if (preview === null) {
    return "This limit may remove Downloads to fit, but what it removes couldn't be worked out.";
  }
  const downloads = preview.removals.filter((each) => each.kind === "download");
  const copies = preview.removals.filter((each) => each.kind === "cache");
  const sized = (items: typeof downloads, one: string, many: string) =>
    `${String(items.length)} ${items.length === 1 ? one : many} (${formatBytes(
      items.reduce((total, each) => total + each.size, 0),
    )})`;
  const parts = [
    downloads.length > 0 ? sized(downloads, "download", "downloads") : "",
    copies.length > 0 ? sized(copies, "prepared copy", "prepared copies") : "",
  ].filter(Boolean);
  return `Saving removes ${parts.join(" and ")} to fit.`;
}
