/**
 * @file Settings: how the page looks, its keyboard shortcuts, the network, and the room
 * Downloads may take.
 *
 * Each section saves on its own, and folds away under its heading; a bar of the
 * sections' names goes to one, opening it. Which are folded is this browser's
 * own. The storage limit is the household's, so only an admin changes it; a
 * member sees it and what it holds.
 */

import { BroomIcon, CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  ApiError,
  type Mode,
  type Preview,
  type Settings,
  type Storage,
  type WaitingDevice,
  api,
} from "../api";
import { AUTO_SAVE_MS, useAutoSave } from "../useAutoSave";
import { classOf } from "../useNote";
import { formatBytes } from "../format";
import { hrefOf } from "../routes";
import { AiSettings } from "./AiSettings";
import { BilibiliSettings } from "./BilibiliSettings";
import { DeviceSettings } from "./DeviceSettings";
import { KindSettings } from "./KindSettings";
import { MusicBrainzSettings } from "./MusicBrainzSettings";
import { NetworkSettings } from "./NetworkSettings";
import { RatingsSettings } from "./RatingsSettings";
import { ShortcutSettings } from "./ShortcutSettings";
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
  { id: "ai", title: "AI" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** The sections only an admin sees: they run lookups for every Track, or let devices in. */
const ADMIN_ONLY: ReadonlySet<SectionId> = new Set(["devices", "bilibili", "musicbrainz", "ai"]);

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

/** The Settings view; `admin` may change what the household shares. */
export function SettingsView({
  admin,
  mode,
  onModeChecked,
  onEnrichersChanged,
  onKindsChanged,
  onRatingsChanged = () => undefined,
  waitingDevices = [],
  toDo = 0,
}: {
  readonly admin: boolean;
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
  /** How many names wait to be cleaned up; a phone, with no room for Clean up in its
   * tab bar, reaches it from here. */
  readonly toDo?: number;
}) {
  const [folded, setFolded] = useState(loadFolded);
  // One copy for the sections that save the settings, so each saves at the latest revision.
  const [household, setHousehold] = useState<Settings | undefined>(undefined);
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
    const section = document.getElementById(id);
    section?.scrollIntoView({ block: "start" });
    document.getElementById(`${id}-toggle`)?.focus({ preventScroll: true });
  };
  const sections = SECTIONS.filter(({ id }) => admin || !ADMIN_ONLY.has(id));
  const allFolded = sections.every(({ id }) => folded.has(id));
  const contents: Record<SectionId, ReactNode> = {
    appearance: (
      <>
        <p className="hint">Follow this device's light or dark setting, or keep one.</p>
        <ThemeSwitch />
      </>
    ),
    "keyboard-shortcuts": <ShortcutSettings />,
    network: <NetworkSettings admin={admin} mode={mode} onModeChecked={onModeChecked} />,
    devices: <DeviceSettings waiting={waitingDevices} />,
    kinds: (
      <KindSettings
        admin={admin}
        settings={household}
        onSettings={setHousehold}
        onChanged={onKindsChanged}
      />
    ),
    ratings: <RatingsSettings onChanged={onRatingsChanged} />,
    storage: <StorageSettings admin={admin} settings={household} onSettings={setHousehold} />,
    bilibili: (
      <>
        <BilibiliSettings />
        <VideoDetailsSettings onChanged={onEnrichersChanged} />
      </>
    ),
    musicbrainz: <MusicBrainzSettings onChanged={onEnrichersChanged} />,
    ai: <AiSettings onChanged={onEnrichersChanged} />,
  };
  return (
    <>
      <header className="view-heading">
        <h2 className="section">Settings</h2>
      </header>
      {toDo > 0 && (
        <a className="clean-up-link on-phone" href={hrefOf({ view: "clean-up" })}>
          <BroomIcon className="clean-up-icon" weight="bold" aria-hidden />
          {`Clean up ${String(toDo)} ${toDo === 1 ? "name" : "names"}`}
          <CaretRightIcon className="clean-up-go" aria-hidden />
        </a>
      )}
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
  const [removing, setRemoving] = useState<{ bytes: number; preview: Preview | null }>();
  const [error, setError] = useState("");
  const asking = useRef<ReturnType<typeof setTimeout>>(undefined);
  const asked = useRef<() => void>(undefined);
  const latest = useRef(settings);
  useEffect(() => {
    latest.current = settings;
  }, [settings]);

  const reload = (then = () => undefined) => {
    Promise.all([api.settings(), api.storage()]).then(
      ([read, now]) => {
        latest.current = read;
        onSettings(read);
        setStorage(now);
        setDraft(draftOf(read));
        setRemoving(undefined);
        then();
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
    return () => {
      clearTimeout(asking.current);
    };
  }, []);

  const saving = useAutoSave((limit: number | null, notes) => {
    const base = latest.current;
    if (base === undefined || limit === base.storage_limit) {
      notes.tell("");
      return Promise.resolve(false);
    }
    setError("");
    setRemoving(undefined);
    return api.saveSettings({ ...base, storage_limit: limit }).then(
      (saved) => {
        latest.current = saved;
        onSettings(saved);
        api.storage().then(setStorage, () => {
          // The usage shown is a moment old; the next visit reads it again.
        });
        return true;
      },
      (failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 409) {
          reload(() => {
            notes.tell(
              "These settings changed elsewhere, so here they are now. Change them again to save.",
            );
          });
        } else {
          notes.tell("");
          setError(failure instanceof Error ? failure.message : String(failure));
        }
        return false;
      },
    );
  });

  /** Ask what `bytes` would remove: save it if nothing, or wait for a confirmation. */
  const ask = (bytes: number) => {
    clearTimeout(asking.current);
    asked.current = undefined;
    const confirmBefore = (preview: Preview | null) => {
      if (asked.current !== settle) {
        return;
      }
      asked.current = undefined;
      if (preview !== null && preview.removals.length === 0) {
        saving.now(bytes);
      } else {
        setRemoving({ bytes, preview });
      }
    };
    const settle = () => {
      clearTimeout(asking.current);
      api.storage(bytes).then(
        (planned) => {
          confirmBefore(planned.preview ?? { removals: [] });
        },
        () => {
          confirmBefore(null);
        },
      );
    };
    asked.current = settle;
    asking.current = setTimeout(settle, AUTO_SAVE_MS);
  };
  const settleNow = () => {
    asked.current?.();
  };

  const change = (next: Draft) => {
    setDraft(next);
    setRemoving(undefined);
    clearTimeout(asking.current);
    asked.current = undefined;
    const bytes = bytesOf(next);
    if (bytes === undefined || bytes === latest.current?.storage_limit) {
      saving.cancel();
      saving.tell("");
    } else if (bytes === null) {
      saving.now(null);
    } else {
      saving.cancel();
      ask(bytes);
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
                settleNow();
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
                      change({ ...draft, unlimited: true });
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
                      change({ unlimited: false, gb: draft.gb === "" ? "20" : draft.gb });
                    }}
                  />
                  Up to
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    aria-label="Limit in GB"
                    value={draft.gb}
                    disabled={draft.unlimited}
                    onChange={(event) => {
                      change({ unlimited: false, gb: event.currentTarget.value });
                    }}
                    onBlur={settleNow}
                  />
                  GB
                </label>
              </fieldset>
              {bytesOf(draft) === undefined && (
                <p className="hint">Type a size in GB, such as 20.</p>
              )}
              {removing !== undefined && (
                <div className="limit-confirm">
                  <p>{removalText(removing.preview)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      saving.now(removing.bytes);
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
            Downloads
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
              Downloading
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
