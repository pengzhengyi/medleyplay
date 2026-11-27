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
import { useAutoSaveOf } from "../useAutoSave";
import { classOf } from "../useNote";
import { formatBytes } from "../format";
import { type Route, hrefOf } from "../routes";
import {
  SETTINGS_SECTIONS,
  type SectionId,
  visibleSettingsSections,
} from "../library/settingsSections";
import {
  CHANGED_ELSEWHERE,
  SETTINGS_SAVE_COPY,
  saveChange,
  settingsNotice,
  settingsFailure,
  settingsKey,
} from "../library/householdSettings";
import { StorageFolderLocation } from "./StorageFolderLocation";
import { ServerStorage } from "./ServerStorage";
import { useStorageLegend } from "./useStorageLegend";
import { AccentPicker } from "./AccentPicker";
import { DynamicsSwitch } from "./DynamicsSwitch";
import { AiNotesSettings } from "./AiNotesSettings";
import { AiSettings } from "./AiSettings";
import { ImageSearchSettings } from "./ImageSearchSettings";
import { BilibiliSettings } from "./BilibiliSettings";
import { DeviceSettings } from "./DeviceSettings";
import { KindSettings } from "./KindSettings";
import { LyricsMatchSettings, LyricsSettings } from "./LyricsSettings";
import { LyricsSites } from "./LyricsSites";
import { PictureSites } from "./PictureSites";
import { CoverSearchSettings } from "./CoverSearchSettings";
import { MusicBrainzSettings } from "./MusicBrainzSettings";
import { MissingDetailsSettings } from "./MissingDetailsSettings";
import { NetworkSettings } from "./NetworkSettings";
import { RatingsSettings } from "./RatingsSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { SplitSettings } from "./SplitSettings";
import { ThemeSwitch } from "./ThemeSwitch";
import { LanguageSelect } from "./LanguageSelect";
import { type Words, useFormattingLocale, useWords } from "../locale";
import { RailOrderSettings } from "./RailOrderSettings";
import { VideoDetailsSettings } from "./VideoDetailsSettings";

const GB = 1_000_000_000;

const FOLDED = "medleyplay.settings.folded.v1";

/** Return the sections this browser last kept folded. */
function loadFolded(): ReadonlySet<SectionId> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FOLDED) ?? "[]");
    return new Set(
      SETTINGS_SECTIONS.map(({ id }) => id).filter(
        (id) => Array.isArray(saved) && saved.includes(id),
      ),
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
  route,
  mode,
  onModeChecked,
  onEnrichersChanged,
  onKindsChanged,
  onRatingsChanged = () => undefined,
  waitingDevices = [],
}: {
  readonly admin: boolean;
  readonly route?: Extract<Route, { view: "settings" }>;
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
  const t = useWords();
  const [folded, setFolded] = useState(() => openedAt(loadFolded(), route?.section));
  // A new visit opens the section even when the listener chose the same link again.
  const [visit, setVisit] = useState(route);
  if (visit !== route) {
    setVisit(route);
    setFolded((held) => openedAt(held, route?.section));
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
  const sections = visibleSettingsSections(admin);
  useEffect(() => {
    const section = route?.section;
    if (section === undefined) {
      return undefined;
    }
    scrollTo(section);
    return keepInView(section);
  }, [route]);
  const allFolded = sections.every(({ id }) => folded.has(id));
  const contents: Record<SectionId, ReactNode> = {
    appearance: (
      <>
        <LanguageSelect />
        <p className="hint">{t("Follow this device's light or dark setting, or keep one.")}</p>
        <ThemeSwitch />
        <p className="hint">{t("The color of buttons, links, and what's playing.")}</p>
        <AccentPicker />
        <p className="hint">
          {t("What moves behind Now Playing. Still when this device asks for less motion.")}
        </p>
        <DynamicsSwitch />
        <p className="hint">
          {t(
            "The order of the views in the rail on this device. Drag a view there, or move it here.",
          )}
        </p>
        <RailOrderSettings />
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
    storage: (
      <>
        {admin && !folded.has("storage") && <ServerStorage />}
        <StorageSettings admin={admin} settings={household} onSettings={keepNewest} />
      </>
    ),
    bilibili: (
      <>
        <BilibiliSettings />
        <VideoDetailsSettings onChanged={onEnrichersChanged} />
      </>
    ),
    musicbrainz: (
      <>
        <MusicBrainzSettings onChanged={onEnrichersChanged} />
        <CoverSearchSettings settings={household} onSettings={keepNewest} />
      </>
    ),
    deezer: <PictureSites settings={household} onSettings={keepNewest} />,
    "image-search": <ImageSearchSettings />,
    lyrics: (
      <>
        <LyricsMatchSettings />
        <LyricsSettings onChanged={onEnrichersChanged} />
        <LyricsSites settings={household} onSettings={keepNewest} />
      </>
    ),
    ai: (
      <>
        <AiSettings onChanged={onEnrichersChanged} />
        {admin && household !== undefined && (
          <MissingDetailsSettings settings={household} onSettings={keepNewest} />
        )}
        <AiNotesSettings settings={household} onSettings={keepNewest} />
      </>
    ),
  };
  return (
    <div className="settings-view">
      <header className="view-heading">
        <h2 className="section" data-rail-named>
          {t("Settings")}
        </h2>
      </header>
      <nav className="settings-toc" aria-label={t("Settings sections")}>
        <ul>
          {sections.map(({ id, title }) => (
            <li key={id}>
              <button
                type="button"
                className="secondary outline"
                aria-label={t("Go to {{section}}", { section: t(title) })}
                onClick={() => {
                  go(id);
                }}
              >
                {t(title)}
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
          {t(allFolded ? "Open all" : "Fold all")}
        </button>
      </nav>
      {sections.map(({ id, title }) => (
        <SettingsSection
          key={id}
          id={id}
          title={t(title)}
          folded={folded.has(id)}
          onToggle={() => {
            toggle(id);
          }}
        >
          {contents[id]}
        </SettingsSection>
      ))}
    </div>
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

function needsRemovalConfirmation(
  preview: Preview | null,
  confirmed: Preview | null | undefined,
): boolean {
  if (preview === null) return confirmed !== null;
  if (preview.removals.length === 0) return false;
  if (confirmed == null) return true;
  return (["download", "cache"] as const).some((kind) => {
    const planned = preview.removals.filter((item) => item.kind === kind);
    const allowed = confirmed.removals.filter((item) => item.kind === kind);
    const bytes = (items: typeof planned) => items.reduce((total, item) => total + item.size, 0);
    return planned.length > allowed.length || bytes(planned) > bytes(allowed);
  });
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
  const words = useWords();
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
  const saving = useAutoSaveOf(async ({ bytes, confirmed }: Limit, notes) => {
    const base = latest.current;
    if (base === undefined || bytes === base.storage_limit) {
      setRemoving(undefined);
      notes.tell(null);
      return "unchanged";
    }
    try {
      if (bytes !== null) {
        const preview = await api.storage(bytes).then(
          (planned) => planned.preview,
          () => null,
        );
        if (needsRemovalConfirmation(preview, confirmed)) {
          setRemoving({ bytes, preview });
          notes.tell(null);
          return "held";
        }
      }
      const { outcome, settings: now } = await saveChange(base, { storage_limit: bytes });
      latest.current = now;
      onSettings(now);
      setRemoving(undefined);
      if (outcome === "conflict") {
        setDraft(draftOf(now));
        notes.tell(settingsKey(CHANGED_ELSEWHERE));
        return "conflict";
      }
      api.storage().then(setStorage, () => {
        // The usage shown is a moment old; the next visit reads it again.
      });
      return "saved";
    } catch (failure) {
      notes.refuse(settingsFailure(failure));
      return "failed";
    }
  }, SETTINGS_SAVE_COPY);

  const change = (next: Draft, typed: boolean) => {
    setDraft(next);
    setRemoving(undefined);
    const bytes = bytesOf(next);
    if (bytes === undefined) {
      saving.cancel();
    } else if (!saving.busy() && bytes === latest.current?.storage_limit) {
      saving.tell(null);
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
      saving.refuse(settingsKey("Not saved: type a size in GB, such as 20."));
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
            {words("Reading what the Downloads hold…")}
          </p>
        )
      ) : (
        <>
          {admin && <h4 className="download-usage-heading">{words("Download usage")}</h4>}
          <Usage storage={storage} />
          <StorageFolderLocation />
          {admin ? (
            <form
              className="limit"
              onSubmit={(event) => {
                event.preventDefault();
                leave();
              }}
            >
              <fieldset>
                <legend>{words("Storage limit")}</legend>
                <label className="limit-choice">
                  <input
                    type="radio"
                    name="limit"
                    checked={draft.unlimited}
                    onChange={() => {
                      change({ ...draft, unlimited: true }, false);
                    }}
                  />
                  {words("No limit")}
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
                  {words("Up to")}
                  <input
                    ref={field}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    aria-label={words("Limit in GB")}
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
                  <p>{removalText(removing.preview, words)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      saving.now({ bytes: removing.bytes, confirmed: removing.preview });
                    }}
                  >
                    {words("Remove and save")}
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
                    {words("Keep the limit")}
                  </button>
                </div>
              )}
              <p className={classOf(saving.note, "hint saved")} role="status">
                {settingsNotice(saving.note.text, words)}
              </p>
            </form>
          ) : (
            <p className="hint">
              {settings.storage_limit === null
                ? words("There is no storage limit. An admin can set one.")
                : words("The storage limit is {{size}}, set by an admin.", {
                    size: formatBytes(settings.storage_limit, words),
                  })}
            </p>
          )}
          <p className="hint">
            {words(
              "When room is needed, the Downloads of the least favorite songs go first; a song in a Playlist set to Keep downloaded is never removed to make room.",
            )}
          </p>
        </>
      )}
    </>
  );
}

/** What the Downloads and cache use, against the limit or the disk. */
function Usage({ storage }: { readonly storage: Storage }) {
  const t = useWords();
  const locale = useFormattingLocale();
  const legend = useStorageLegend<"downloads" | "cache" | "reserved" | "kept">();
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
  const amounts = { downloads, cache, reserved, kept: storage.wanted ?? 0 };
  const highlighting = legend.active !== undefined && amounts[legend.active] > 0;
  return (
    <div className="usage">
      <p className="usage-total">
        <strong>{formatBytes(used, t)}</strong>{" "}
        {storage.limit === null
          ? t("used, {{free}} free on this disk", { free: formatBytes(storage.free ?? 0, t) })
          : t("of {{limit}} used", { limit: formatBytes(storage.limit, t) })}
      </p>
      <div className="meter usage-meter" data-highlighting={highlighting || undefined} aria-hidden>
        {(["downloads", "cache", "reserved"] as const).map((key) => (
          <span
            key={key}
            className={key}
            data-highlighted={legend.active === key || undefined}
            style={{ width: share(amounts[key]) }}
          />
        ))}
        {amounts.kept > 0 && (
          <span
            className="kept-estimate"
            data-highlighted={legend.active === "kept" || undefined}
            style={{ width: share(amounts.kept) }}
          />
        )}
      </div>
      <dl className="legend">
        <div {...legend.entry("downloads")}>
          <dt>
            <span className="swatch downloads" aria-hidden />
            <a href={hrefOf({ view: "downloaded" })} title={t("Show the songs downloaded")}>
              {t("Downloads")}
            </a>
          </dt>
          <dd>{formatBytes(downloads, t)}</dd>
        </div>
        <div {...legend.entry("cache")}>
          <dt>
            <span className="swatch cache" aria-hidden />
            <span tabIndex={0}>{t("Prepared copies")}</span>
          </dt>
          <dd>{formatBytes(cache, t)}</dd>
        </div>
        {reserved > 0 && (
          <div {...legend.entry("reserved")}>
            <dt>
              <span className="swatch reserved" aria-hidden />
              <a href={hrefOf({ view: "downloaded" })} title={t("Show the songs downloading")}>
                {t("Downloading")}
              </a>
            </dt>
            <dd>{formatBytes(reserved, t)}</dd>
          </div>
        )}
        {storage.wanted !== null && (
          <div {...legend.entry("kept")}>
            <dt>
              <span className="swatch kept" aria-hidden />
              <span
                tabIndex={0}
                title={t(
                  "The songs of the Playlists set to Keep downloaded: what their Downloads use, and an estimate for those not downloaded yet",
                )}
              >
                {t("Playlists kept downloaded")}
              </span>
            </dt>
            <dd>{formatBytes(storage.wanted, t)}</dd>
          </div>
        )}
      </dl>
      {last !== null && (
        <p className="hint">
          {t("Last checked {{when}}: {{removed}}, {{started}}.", {
            when: new Date(last.at).toLocaleString(locale),
            removed: t("removed_managed_files", { count: last.removed }),
            started: t("started_downloads", { count: last.started }),
          })}
          {last.error === null ? "" : ` ${last.error}`}
        </p>
      )}
    </div>
  );
}

/** Say what saving a lower limit would remove, from its preview. */
function removalText(preview: Preview | null, t: Words): string {
  if (preview === null) {
    return t("This limit may remove Downloads to fit, but what it removes couldn't be worked out.");
  }
  const downloads = preview.removals.filter((each) => each.kind === "download");
  const copies = preview.removals.filter((each) => each.kind === "cache");
  const sized = (items: typeof downloads, key: string) =>
    t(key, {
      count: items.length,
      size: formatBytes(
        items.reduce((total, each) => total + each.size, 0),
        t,
      ),
    });
  const parts = [
    downloads.length > 0 ? sized(downloads, "download_size") : "",
    copies.length > 0 ? sized(copies, "copy_size") : "",
  ].filter(Boolean);
  return t("Saving removes {{items}} to fit.", { items: parts.join(t(" and ")) });
}
