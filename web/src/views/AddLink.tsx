/**
 * @file Adding a video from Bilibili: its parts with a title and artist each, or, for a
 * video that couldn't be read, the household's own details for the parts.
 *
 * Escape, its ✕, or a click outside close it without adding anything.
 */

import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Trans } from "react-i18next";

import {
  type AddedPart,
  ApiError,
  type LinkLookup,
  type SavedVideoLookup,
  type VideoChoices,
} from "../api";
import { formatTime } from "../format";
import { downloadFailureOf } from "../library/downloading";
import { partLink } from "../library/otherWays";
import { suggestedArtist, suggestedTitle, withoutTags } from "../library/suggest";
import { type Words, useFormattingLocale, useWords } from "../locale";
import { type Route, hrefOf } from "../routes";
import { Modal } from "./Modal";
import { OtherWays } from "./OtherWays";

const MAX_PART_NUMBER = 9999;
const BEST = "best";
const LOOKUP_HELP = "Choose parts here or later in <downloaded>Downloaded</downloaded>.";
type AlbumDestination =
  Extract<Route, { view: "album" }> | { readonly view: "library"; readonly focus: number };
const WHY = {
  gone: "The site no longer has this video.",
  needs_login: "Only a signed-in account can see this video.",
  network: "The site couldn’t be reached.",
  refused: "The site refused to show this video.",
  fault: "Reading the video failed.",
} satisfies Record<NonNullable<LinkLookup["reason"]>, string>;
const LINK_REFUSALS = new Map<number, ReadonlySet<string>>([
  [404, new Set(["There is no such video lookup."])],
  [
    409,
    new Set([
      "medleyplay is Offline, so links wait until it is Online.",
      "No downloader is available. Enable one before downloading.",
      "All parts are already in the Library.",
    ]),
  ],
  [
    422,
    new Set([
      "The link doesn't name a video.",
      "An album needs a name and a video with several parts.",
      "An album needs a name.",
      "This video has no readable part list. Enter the parts yourself.",
      "A part number is 1 to 9999.",
      "A video that can't be read is added at the quality best.",
      "Choose one or more different parts.",
      "A title is 1 to 512 characters, and an artist at most 512.",
    ]),
  ],
]);
interface LinkFailure {
  readonly cause: unknown;
}

function linkError(cause: unknown, t: Words): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (cause instanceof ApiError) {
    if (LINK_REFUSALS.get(cause.status)?.has(detail)) return t(detail);
    if (cause.status === 422) {
      const source = /^medleyplay can't add music from (.+)\.$/u.exec(detail)?.[1];
      if (source !== undefined) return t("medleyplay can't add music from {{source}}.", { source });
      const part = /^The video has no part (\d+)\.$/u.exec(detail)?.[1];
      if (part !== undefined) return t("The video has no part {{number}}.", { number: part });
      const quality = /^The video can't be added at the quality (.+)\.$/u.exec(detail)?.[1];
      if (quality !== undefined)
        return t("The video can't be added at the quality {{quality}}.", { quality });
    }
    if (cause.status === 409) {
      const part = /^Part (\d+) is already in the Library\. Deselect it\.$/u.exec(detail)?.[1];
      if (part !== undefined)
        return t("Part {{number}} is already in the Library. Deselect it.", { number: part });
    }
  }
  return downloadFailureOf(detail, t);
}

/** Follow one selected lookup; closing the dialog leaves it in Downloads. */
export function AddLink({
  opening,
  listed,
  load,
  add,
  onAdded,
  onClose,
}: {
  readonly opening: Promise<SavedVideoLookup>;
  readonly listed: readonly SavedVideoLookup[];
  readonly load: (id: number) => Promise<SavedVideoLookup>;
  readonly add: (id: number, quality: string, parts: VideoChoices) => Promise<readonly AddedPart[]>;
  readonly onAdded: (count: number, destination?: AlbumDestination) => void;
  readonly onClose: () => void;
}) {
  const t = useWords();
  const dialog = useRef<HTMLDialogElement>(null);
  const [submitted, setSubmitted] = useState<SavedVideoLookup>();
  const [loaded, setLoaded] = useState<SavedVideoLookup>();
  const [error, setError] = useState<LinkFailure>();
  const loadResult = useEffectEvent(load);
  const readyId =
    submitted?.result === null &&
    listed.some((row) => row.id === submitted.id && row.state === "succeeded")
      ? submitted.id
      : undefined;
  useEffect(() => {
    let current = true;
    opening.then(
      (lookup) => {
        if (current) setSubmitted(lookup);
      },
      (cause: unknown) => {
        if (current) setError({ cause });
      },
    );
    return () => {
      current = false;
    };
  }, [opening]);
  useEffect(() => {
    if (readyId === undefined) return;
    let current = true;
    loadResult(readyId).then(
      (lookup) => {
        if (current) setLoaded(lookup);
      },
      (cause: unknown) => {
        if (current) setError({ cause });
      },
    );
    return () => {
      current = false;
    };
  }, [readyId]);
  const opened = loaded ?? submitted;
  const status = listed.find((row) => row.id === opened?.id) ?? opened;
  const failure =
    error !== undefined
      ? t("Could not open the video lookup: {{detail}}", { detail: linkError(error.cause, t) })
      : status?.state === "failed"
        ? status.message === ""
          ? t("The lookup failed.")
          : t("The lookup failed: {{detail}}", { detail: downloadFailureOf(status.message, t) })
        : status?.state === "cancelled"
          ? t("The lookup was cancelled.")
          : "";
  const lookup = opened?.result;
  const close = () => {
    dialog.current?.close();
  };
  const finish = (added: readonly AddedPart[], destination?: AlbumDestination) => {
    if (destination !== undefined) onAdded(added.length, destination);
    else onAdded(added.length);
    close();
  };

  return (
    <Modal ref={dialog} className="add-link" labelledBy="add-link-title" onClose={onClose}>
      <div className="card">
        <h2 id="add-link-title">{t("Add from Bilibili")}</h2>
        {failure === "" && !lookup && (
          <>
            <p className="empty" aria-busy="true">
              {t("Looking the video up…")}
            </p>
            <p>
              <Trans
                t={t}
                i18nKey={LOOKUP_HELP}
                defaults={LOOKUP_HELP}
                components={{
                  downloaded: <a href={hrefOf({ view: "downloaded" })} onClick={close} />,
                }}
              />
            </p>
          </>
        )}
        {failure !== "" && (
          <p className="error" role="alert">
            {failure}
          </p>
        )}
        {lookup &&
          (lookup.readable ? (
            <ReadVideo id={opened.id} lookup={lookup} add={add} onAdded={finish} />
          ) : (
            <UnreadableVideo id={opened.id} lookup={lookup} add={add} onAdded={finish} />
          ))}
      </div>
    </Modal>
  );
}

interface FormProps {
  readonly id: number;
  readonly lookup: LinkLookup;
  readonly add: (id: number, quality: string, parts: VideoChoices) => Promise<readonly AddedPart[]>;
  readonly onAdded: (added: readonly AddedPart[], destination?: AlbumDestination) => void;
}

/** What the household is told while a form saves, or why it didn't. */
function useSaving(onAdded: (added: readonly AddedPart[]) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LinkFailure>();
  const save = async (send: () => Promise<readonly AddedPart[]>) => {
    setSaving(true);
    setError(undefined);
    try {
      onAdded(await send());
    } catch (cause) {
      setError({ cause });
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, save };
}

interface Row {
  readonly part: number;
  readonly original: string;
  readonly duration: number | null;
  readonly title: string;
  readonly artist: string;
  readonly chosen: boolean;
  readonly taken: boolean;
}

type FileLayout = "separate" | "joined";

function ReadVideo({ id, lookup, add, onAdded }: FormProps) {
  const t = useWords();
  const number = new Intl.NumberFormat(useFormattingLocale());
  const [layout, setLayout] = useState<FileLayout>("separate");
  const [group, setGroup] = useState(false);
  const [edit, setEdit] = useState(false);
  const [album, setAlbum] = useState(withoutTags(lookup.title).slice(0, 512));
  const [artist, setArtist] = useState("");
  const [rows, setRows] = useState<readonly Row[]>(() =>
    [...lookup.parts]
      .sort((a, b) => a.part - b.part)
      .map((part) => ({
        part: part.part,
        original:
          (lookup.parts.length > 1 ? part.title : lookup.title).trim() ||
          `${lookup.video} P${String(part.part)}`,
        duration: part.duration_ms,
        title: suggestedTitle(lookup, part),
        artist: suggestedArtist(lookup),
        chosen: part.track_id === null,
        taken: part.track_id !== null,
      })),
  );
  const [quality, setQuality] = useState(BEST);
  const change = (part: number, changes: Partial<Row>) => {
    setRows((now) => now.map((row) => (row.part === part ? { ...row, ...changes } : row)));
  };
  const multiple = rows.length > 1;
  const canJoin = multiple && lookup.kind === "bilibili";
  const joined = canJoin && layout === "joined";
  const eligible = rows.filter((row) => joined || !row.taken);
  const chosen = eligible.filter((row) => row.chosen);
  const grouped = !joined && multiple && group;
  const manual = !joined && !grouped && edit;
  const albumDetails = joined || grouped;
  const { saving, error, save } = useSaving((added) => {
    const [first] = added;
    if (joined && first !== undefined) {
      onAdded(added, { view: "library", focus: first.track_id });
    } else if (grouped) {
      onAdded(added, { view: "album", name: album.trim(), artist: artist.trim() });
    } else {
      onAdded(added);
    }
  });
  const allChosen = chosen.length === eligible.length;
  const complete =
    chosen.length > 0 &&
    (!albumDetails || album.trim() !== "") &&
    (!manual || chosen.every((row) => row.title.trim() !== ""));
  const downloadLabel = joined
    ? t("Download 1 album file")
    : chosen.length === 1
      ? t("Download 1 file")
      : t("Download {{count}} files", { count: chosen.length });
  const action = manual
    ? chosen.length <= 1
      ? t("Add")
      : t("Add {{amount}} songs", { amount: number.format(chosen.length) })
    : chosen.length === 0
      ? t("Choose parts to download")
      : downloadLabel;
  const toggleAll = () => {
    setRows((now) =>
      now.map((row) => (!joined && row.taken ? row : { ...row, chosen: !allChosen })),
    );
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving) return;
    const parts = chosen.map((row) => row.part);
    const details = { album: album.trim(), artist: artist.trim() };
    void save(() =>
      add(
        id,
        quality,
        manual
          ? chosen.map(({ part, title, artist }) => ({ part, title: title.trim(), artist }))
          : albumDetails
            ? { mode: joined ? "joined" : "album", ...details, parts }
            : { mode: "download", parts },
      ),
    );
  };

  const labelled = eligible[0]?.part;
  const commandPart = chosen[0]?.part;

  return (
    <form onSubmit={submit}>
      <p className="add-link-video">
        <strong>{lookup.title}</strong>
        {lookup.uploader && (
          <span className="add-link-uploader">
            {t("Uploaded by {{name}}", { name: lookup.uploader })}
          </span>
        )}
      </p>
      {canJoin ? (
        <VideoFileLayout layout={layout} change={setLayout} saving={saving} />
      ) : (
        <p className="add-link-explain">
          {multiple
            ? t("Save one audio file per selected part.")
            : t("Keep the whole file without splitting it into songs.")}
        </p>
      )}
      <fieldset className="video-part-picker">
        <legend>{t("Parts to download")}</legend>
        <div className="video-part-picker-heading">
          <span role="status">
            {t("{{selected}} of {{available}} selected", {
              selected: number.format(chosen.length),
              available: number.format(eligible.length),
            })}
          </span>
          {eligible.length > 0 && (
            <button
              type="button"
              className="secondary outline video-part-toggle"
              disabled={saving}
              onClick={toggleAll}
            >
              {allChosen ? t("Deselect all") : t("Select all")}
            </button>
          )}
        </div>
        <ul className={manual ? "parts" : "parts video-parts-list"}>
          {rows.map((row) => (
            <li key={row.part} className="part">
              <label className={manual ? "part-choice" : "part-choice video-part-choice"}>
                <input
                  type="checkbox"
                  className="part-box"
                  checked={(joined || !row.taken) && row.chosen}
                  disabled={(!joined && row.taken) || saving}
                  aria-label={
                    manual
                      ? undefined
                      : t("Part {{number}}: {{title}}", {
                          number: number.format(row.part),
                          title: row.original,
                        })
                  }
                  onChange={(event) => {
                    change(row.part, { chosen: event.currentTarget.checked });
                  }}
                />
                <span>
                  {manual
                    ? t("Part {{number}}", { number: number.format(row.part) })
                    : t("{{number}}. {{title}}", {
                        number: number.format(row.part),
                        title: row.original,
                      })}
                  {row.taken && <span className="choice-meta"> {t("Already added")}</span>}
                </span>
                {!manual && (joined || !row.taken) && row.duration !== null && (
                  <span className="video-part-duration">{formatTime(row.duration / 1000)}</span>
                )}
              </label>
              {manual && !row.taken && (
                <div className="part-fields">
                  <PartField label="Title" shown={row.part === labelled}>
                    <input
                      type="text"
                      className="part-input"
                      aria-label={t("Title of part {{number}}", {
                        number: number.format(row.part),
                      })}
                      placeholder={t("Title")}
                      value={row.title}
                      maxLength={512}
                      disabled={!row.chosen || saving}
                      onChange={(event) => {
                        change(row.part, { title: event.currentTarget.value });
                      }}
                    />
                  </PartField>
                  <PartField label="Artist" shown={row.part === labelled}>
                    <input
                      type="text"
                      className="part-input"
                      aria-label={t("Artist of part {{number}}", {
                        number: number.format(row.part),
                      })}
                      placeholder={t("Artist")}
                      value={row.artist}
                      maxLength={512}
                      disabled={!row.chosen || saving}
                      onChange={(event) => {
                        change(row.part, { artist: event.currentTarget.value });
                      }}
                    />
                  </PartField>
                </div>
              )}
            </li>
          ))}
        </ul>
      </fieldset>
      {eligible.length === 0 && <p>{t("All parts are already in the Library.")}</p>}
      {!joined && multiple && eligible.length > 0 && (
        <label className="video-download-option">
          <input
            type="checkbox"
            checked={group}
            disabled={saving}
            onChange={(event) => {
              setGroup(event.currentTarget.checked);
            }}
          />
          {t("Group these separate files in one album")}
        </label>
      )}
      {grouped && (
        <p className="add-link-explain">
          {t(
            canJoin
              ? "Each part stays a separate song. Choose One album file to join the parts."
              : "Each part stays a separate song.",
          )}
        </p>
      )}
      {!albumDetails && eligible.length > 0 && (
        <label className="video-download-option">
          <input
            type="checkbox"
            checked={edit}
            disabled={saving}
            onChange={(event) => {
              setEdit(event.currentTarget.checked);
            }}
          />
          {t("Edit titles and artists")}
        </label>
      )}
      {albumDetails && (
        <>
          <label>
            {t("Album title")}
            <input
              value={album}
              disabled={saving}
              maxLength={512}
              onChange={(event) => {
                setAlbum(event.currentTarget.value);
              }}
            />
          </label>
          <label>
            {t("Album artist")}
            <input
              value={artist}
              disabled={saving}
              maxLength={512}
              placeholder={t("Optional")}
              onChange={(event) => {
                setArtist(event.currentTarget.value);
              }}
            />
          </label>
        </>
      )}
      <label className="quality">
        {t(joined ? "Source quality" : "Quality")}
        <select
          className="quality-select"
          value={quality}
          disabled={saving}
          onChange={(event) => {
            setQuality(event.currentTarget.value);
          }}
        >
          <option value={BEST}>{t("Best available")}</option>
          {lookup.qualities.map((each) => (
            <option key={each.id} value={each.id}>
              {each.label}
            </option>
          ))}
        </select>
      </label>
      <Footer error={error} saving={saving} disabled={!complete}>
        {action}
      </Footer>
      {joined ? (
        <p className="add-link-explain">
          {t(
            chosen.length === 1
              ? "One part keeps its original audio."
              : "Joining several parts converts them to AAC and requires FFmpeg and ffprobe on the server.",
          )}
        </p>
      ) : (
        commandPart !== undefined && (
          <OtherWays kind={lookup.kind} link={partLink(lookup.kind, lookup.video, commandPart)} />
        )
      )}
    </form>
  );
}

function VideoFileLayout({
  layout,
  change,
  saving,
}: {
  readonly layout: FileLayout;
  readonly change: (layout: FileLayout) => void;
  readonly saving: boolean;
}) {
  const t = useWords();
  const options = [
    ["joined", "One album file", "Join the selected parts into one audio file, in video order."],
    ["separate", "Separate files", "Save one audio file per selected part."],
  ] as const;
  return (
    <fieldset className="video-file-layout">
      <legend>{t("File layout")}</legend>
      {options.map(([key, title, description]) => (
        <label className="video-layout-option" key={key}>
          <input
            type="radio"
            name="video-file-layout"
            className="video-layout-radio"
            checked={layout === key}
            disabled={saving}
            aria-label={t(title)}
            aria-describedby={`video-layout-${key}`}
            onChange={() => {
              change(key);
            }}
          />
          <span>
            <strong>{t(title)}</strong>
            <small id={`video-layout-${key}`}>{t(description)}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function validPart(part: number): boolean {
  return Number.isInteger(part) && part >= 1 && part <= MAX_PART_NUMBER;
}

interface Draft {
  readonly key: number;
  readonly part: string;
  readonly title: string;
  readonly artist: string;
}

function UnreadableVideo({ id, lookup, add, onAdded }: FormProps) {
  const t = useWords();
  const number = new Intl.NumberFormat(useFormattingLocale());
  const first = lookup.parts[0]?.part ?? 1;
  const [drafts, setDrafts] = useState<readonly Draft[]>([
    { key: 0, part: String(first), title: "", artist: "" },
  ]);
  const { saving, error, save } = useSaving(onAdded);
  const change = (key: number, changes: Partial<Draft>) => {
    setDrafts((now) => now.map((draft) => (draft.key === key ? { ...draft, ...changes } : draft)));
  };
  const numbers = drafts.map((draft) => Number(draft.part));
  const commandPart = numbers.find(validPart);
  const complete =
    drafts.every((draft) => draft.title.trim() !== "") &&
    numbers.every(validPart) &&
    new Set(numbers).size === numbers.length;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || saving) return;
    void save(() =>
      add(
        id,
        BEST,
        drafts.map((draft) => ({
          part: Number(draft.part),
          title: draft.title.trim(),
          artist: draft.artist,
        })),
      ),
    );
  };
  const reason = t(WHY[lookup.reason ?? "fault"]);
  const detail = downloadFailureOf(lookup.message, t);

  return (
    <form onSubmit={submit}>
      <p className="error" role="alert">
        {detail === "" || detail === reason
          ? reason
          : t("{{reason}} {{detail}}", { reason, detail })}
      </p>
      <p className="add-link-explain">
        {t(
          "You can still add it. Give each part a title and, if known, an artist. medleyplay will try to download it at the best available quality. If it fails, you can add the file yourself.",
        )}
      </p>
      <ul className="parts">
        {drafts.map((draft, index) => {
          const part = Number(draft.part);
          const isPart = validPart(part);
          const row = number.format(index + 1);
          const fieldNumber = isPart ? number.format(part) : row;
          return (
            <li key={draft.key} className="part">
              <div className="part-fields numbered">
                <PartField label="Part" shown={index === 0}>
                  <input
                    type="number"
                    className="part-input part-number"
                    min={1}
                    max={MAX_PART_NUMBER}
                    aria-label={t("Part number for row {{number}}", { number: row })}
                    placeholder={t("Part")}
                    disabled={saving}
                    value={draft.part}
                    onChange={(event) => {
                      change(draft.key, { part: event.currentTarget.value });
                    }}
                  />
                </PartField>
                <PartField label="Title" shown={index === 0}>
                  <input
                    type="text"
                    className="part-input"
                    aria-label={t(isPart ? "Title of part {{number}}" : "Title in row {{number}}", {
                      number: fieldNumber,
                    })}
                    placeholder={t("Title")}
                    disabled={saving}
                    value={draft.title}
                    maxLength={512}
                    onChange={(event) => {
                      change(draft.key, { title: event.currentTarget.value });
                    }}
                  />
                </PartField>
                <PartField label="Artist" shown={index === 0}>
                  <input
                    type="text"
                    className="part-input"
                    aria-label={t(
                      isPart ? "Artist of part {{number}}" : "Artist in row {{number}}",
                      { number: fieldNumber },
                    )}
                    placeholder={t("Artist")}
                    disabled={saving}
                    value={draft.artist}
                    maxLength={512}
                    onChange={(event) => {
                      change(draft.key, { artist: event.currentTarget.value });
                    }}
                  />
                </PartField>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    className="icon"
                    aria-label={t(isPart ? "Remove part {{number}}" : "Remove row {{number}}", {
                      number: fieldNumber,
                    })}
                    title={t("Remove")}
                    disabled={saving}
                    onClick={() => {
                      setDrafts((now) => now.filter((each) => each.key !== draft.key));
                    }}
                  >
                    <TrashIcon weight="regular" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {drafts.length < MAX_PART_NUMBER && (
        <button
          type="button"
          className="secondary outline dialog-button add-part"
          disabled={saving}
          onClick={() => {
            setDrafts((now) => [
              ...now,
              {
                key: Math.max(...now.map((each) => each.key)) + 1,
                part: String(Math.max(...now.map((each) => Number(each.part) || 0)) + 1),
                title: "",
                artist: now.at(-1)?.artist ?? "",
              },
            ]);
          }}
        >
          <PlusIcon weight="bold" aria-hidden />
          {t("Add another part")}
        </button>
      )}
      {commandPart !== undefined && (
        <OtherWays kind={lookup.kind} link={partLink(lookup.kind, lookup.video, commandPart)} />
      )}
      <Footer error={error} saving={saving} disabled={!complete}>
        {drafts.length === 1
          ? t("Add")
          : t("Add {{amount}} songs", { amount: number.format(drafts.length) })}
      </Footer>
    </form>
  );
}

function Footer({
  error,
  saving,
  disabled,
  children,
}: {
  readonly error: LinkFailure | undefined;
  readonly saving: boolean;
  readonly disabled: boolean;
  readonly children: string;
}) {
  const t = useWords();
  return (
    <>
      {error !== undefined && (
        <p className="error" role="alert">
          {t("Could not add the selected parts: {{detail}}", {
            detail: linkError(error.cause, t),
          })}
        </p>
      )}
      <footer className="dialog-buttons">
        <button
          type="submit"
          className="dialog-button"
          disabled={disabled || saving}
          aria-busy={saving}
        >
          {children}
        </button>
      </footer>
    </>
  );
}

/**
 * A part's field, named above its box on the first part only: the boxes of the parts
 * below line up under it, as under a column's heading, and keep the name for a screen
 * reader.
 */
function PartField({
  label,
  shown,
  children,
}: {
  readonly label: string;
  readonly shown: boolean;
  readonly children: ReactNode;
}) {
  const t = useWords();
  return (
    <label className="part-field">
      <span className={shown ? "part-field-label" : "visually-hidden"}>{t(label)}</span>
      {children}
    </label>
  );
}
