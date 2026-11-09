/**
 * @file Editing a song's details: what each says now and where it came from, and the household's own.
 *
 * A box typed in, or a value chosen from another origin, becomes the household's
 * value, which wins; every other box shows what would show with them. Typing or
 * choosing what would show anyway drops the household's value. Saving sends only
 * what changed. Escape, Cancel, or a click outside it close it without saving, except
 * while a save is under way.
 *
 * A video's title and description, pasted, are read by the server at once as the
 * `video` origin, as a file beside the audio would be; the boxes then show what it
 * found, keeping the household's own. A lookup asked from beside the cover runs as
 * from the song's menu; once it is done, the details are read again, keeping what
 * was typed.
 *
 * The songs a long file is split into are edited in the same dialog, in place of
 * the details, with a way back that keeps what was typed in them.
 */

import {
  CaretRightIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  MusicNoteSimpleIcon,
  MusicNotesIcon,
  ScissorsIcon,
  TrashIcon,
  UploadSimpleIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  type SubmitEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type Detail,
  type Details,
  type Kind,
  type KindReason,
  type Origin,
  type Track,
  type VideoRead,
  type VideoText,
  coverUrl,
} from "../api";
import {
  DETAIL_FIELDS,
  type DetailField,
  ORIGIN_LABELS,
  type Own,
  alternativesOf,
  boxText,
  changesOf,
  foundOf,
  ownOf,
  previewOf,
  settle,
  shownOf,
  suggestionOf,
} from "../library/details";
import { LOOKUPS, type Lookup, coverStatusOf } from "../library/lookups";
import type { TrackLookup } from "../library/useLibrary";
import { Modal } from "./Modal";
import { OriginTag } from "./OriginTag";
import { ORIGIN_TAGS } from "./originTags";
import { type SongsControls, SongsControlsContext } from "./songsControls";
import { STATUS_ICONS } from "./statusIcons";

/** How long text may be, as the server keeps it. */
const MAX_TEXT = 512;

/** The ranges the server keeps a number in. */
const RANGES: Partial<Record<Detail, readonly [number, number]>> = {
  track_number: [1, 999],
  disc_number: [1, 999],
  year: [1000, 2999],
};

/** How long a video's title and description may be, as the server takes them. */
const MAX_VIDEO_TITLE = 1_000;
const MAX_DESCRIPTION = 20_000;

/** The largest cover the server takes, checked before an image is sent. */
const MAX_COVER_BYTES = 10 * 1024 * 1024;

const SONGS_TITLE = "edit-songs-title";

/**
 * Edit `track`'s details, read with `load`; `onSave` sends the household's values
 * changed, `null` dropping one, and `onReadVideo` a video's pasted text. `onFind`
 * asks one of the lookups `findable`, and `lookup` is how the last one asked goes.
 * `songs` opens the songs of its file in place of the details, first when
 * `startOnSongs`.
 */
export function EditDetails({
  track,
  load,
  onSave,
  onReadVideo,
  onSetCover,
  onRemoveCover,
  findable,
  lookup,
  online,
  onFind,
  songs,
  startOnSongs = false,
  onClose,
}: {
  readonly track: Track;
  readonly load: (trackId: number) => Promise<Details>;
  readonly onSave: (changes: Partial<Record<Detail, string | number | null>>) => Promise<void>;
  readonly onReadVideo: (text: VideoText) => Promise<VideoRead>;
  readonly onSetCover: (image: Blob) => Promise<Details>;
  readonly onRemoveCover: () => Promise<Details>;
  readonly findable: readonly Lookup[];
  readonly lookup: TrackLookup | undefined;
  /** Whether medleyplay is Online, so a lookup asked runs now. */
  readonly online: boolean;
  readonly onFind: (lookup: Lookup) => void;
  /** The way to its file's songs: what it is called, and the editor, which the dialog controls. */
  readonly songs?: { readonly label: string; readonly editor: ReactNode } | undefined;
  readonly startOnSongs?: boolean;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => {
    dialog.current?.close();
  };
  const [details, setDetails] = useState<Details | undefined>(undefined);
  const [own, setOwn] = useState<Own>({});
  // The kind chosen, `null` to guess it again, or `undefined` while unchanged.
  const [kind, setKind] = useState<Kind | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState("");
  const [readError, setReadError] = useState("");
  const [covering, setCovering] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"details" | "songs">(
    startOnSongs && songs !== undefined ? "songs" : "details",
  );
  const [songsLocked, setSongsLocked] = useState(false);
  const songsEntry = useRef<HTMLButtonElement>(null);
  // Focus follows the swap: to the songs' heading, and back to the way to them.
  const swapped = useRef(false);
  useEffect(() => {
    if (!swapped.current) {
      swapped.current = true;
      return;
    }
    if (panel === "songs") {
      document.getElementById(SONGS_TITLE)?.focus();
    } else {
      songsEntry.current?.focus();
    }
  }, [panel]);
  const leaveSongs = useCallback(() => {
    if (startOnSongs) {
      dialog.current?.close();
    } else {
      setSongsLocked(false);
      setPanel("details");
    }
  }, [startOnSongs]);
  const controls = useMemo<SongsControls>(
    () => ({
      headingId: SONGS_TITLE,
      onBack: leaveSongs,
      onLock: setSongsLocked,
      onDone: leaveSongs,
    }),
    [leaveSongs],
  );

  useEffect(() => {
    let open = true;
    load(track.id).then(
      (loaded) => {
        if (open) {
          setDetails(loaded);
          setOwn(ownOf(loaded));
        }
      },
      (failure: unknown) => {
        if (open) {
          setError(messageOf(failure));
        }
      },
    );
    return () => {
      open = false;
    };
  }, [track.id, load]);

  // A lookup done has new details: read them again, keeping what was typed.
  const done = lookup?.state === "succeeded";
  useEffect(() => {
    if (!done) {
      return;
    }
    let open = true;
    load(track.id).then(
      (loaded) => {
        if (open) {
          setDetails(loaded);
        }
      },
      () => {
        // The details shown stay; the next opening reads them again.
      },
    );
    return () => {
      open = false;
    };
  }, [done, track.id, load]);

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (details === undefined) {
      return;
    }
    const changes = { ...changesOf(details, own), ...kindChange(details, kind) };
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(changes);
      setSaving(false);
      close();
    } catch (failure) {
      setSaving(false);
      setError(messageOf(failure));
    }
  };
  const readVideo = async (text: VideoText) => {
    setReading(true);
    setReadError("");
    setReadNote("");
    try {
      const read = await onReadVideo(text);
      setDetails(read.details);
      setReadNote(noteOf(read));
    } catch (failure) {
      setReadError(messageOf(failure));
    } finally {
      setReading(false);
    }
  };
  /** Save the cover change `change` makes at once, and show the details it answers. */
  const changeCover = async (change: () => Promise<Details>) => {
    setCovering(true);
    setCoverError("");
    try {
      setDetails(await change());
    } catch (failure) {
      setCoverError(messageOf(failure));
    } finally {
      setCovering(false);
    }
  };
  const boxes = (group: DetailField["group"]) =>
    details !== undefined &&
    DETAIL_FIELDS.filter((field) => field.group === group).map((field) => (
      <DetailBox key={field.name} field={field} details={details} own={own} onChange={setOwn} />
    ));

  return (
    <Modal
      ref={dialog}
      className="edit-details"
      labelledBy={panel === "songs" ? SONGS_TITLE : "edit-details-title"}
      describedBy="edit-details-song"
      locked={saving || reading || covering || songsLocked}
      onClose={onClose}
    >
      {panel === "songs" && songs !== undefined && (
        <div className="card songs-card">
          <SongsControlsContext value={controls}>{songs.editor}</SongsControlsContext>
        </div>
      )}
      <form className="card" hidden={panel === "songs"} onSubmit={(event) => void save(event)}>
        <h2 id="edit-details-title">Edit details</h2>
        <p id="edit-details-song" className="edit-details-song">
          {track.title}
        </p>
        {details === undefined && error === "" && (
          <p className="empty" role="status">
            Reading the details…
          </p>
        )}
        {details !== undefined && (
          <div className="edit-details-body">
            <div className="edit-details-side">
              <CoverBox
                title={track.title}
                details={details}
                busy={saving || reading || covering}
                covering={covering}
                error={coverError}
                onChoose={(image) => {
                  if (image.size > MAX_COVER_BYTES) {
                    setCoverError("A cover is at most 10 MiB.");
                  } else {
                    void changeCover(() => onSetCover(image));
                  }
                }}
                onRemove={() => void changeCover(onRemoveCover)}
              />
              <LookupBar findable={findable} lookup={lookup} online={online} onFind={onFind} />
              {songs !== undefined && (
                <button
                  ref={songsEntry}
                  type="button"
                  className="songs-entry"
                  disabled={saving || reading || covering}
                  onClick={() => {
                    setPanel("songs");
                  }}
                >
                  <ScissorsIcon aria-hidden />
                  <span className="songs-entry-label">{songs.label}</span>
                  <CaretRightIcon aria-hidden />
                </button>
              )}
              <PasteVideo
                read={details.video_text}
                busy={saving || reading || covering}
                reading={reading}
                note={readNote}
                error={readError}
                onEdit={() => {
                  setReadNote("");
                  setReadError("");
                }}
                onRead={(text) => void readVideo(text)}
              />
            </div>
            <div className="edit-details-fields">
              <KindChoice details={details} chosen={kind} onChoose={setKind} />
              <fieldset className="detail-group">
                <legend>Song</legend>
                {boxes("song")}
              </fieldset>
              <fieldset className="detail-group">
                <legend>Album</legend>
                {boxes("album")}
              </fieldset>
            </div>
          </div>
        )}
        {error !== "" && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-buttons">
          <button
            type="button"
            className="secondary outline dialog-button"
            disabled={saving || reading || covering}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button"
            disabled={details === undefined || saving || reading || covering}
            aria-busy={saving}
          >
            Save
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** What choosing `chosen` changes of the household's kind, if anything. */
function kindChange(details: Details, chosen: Kind | null | undefined): { kind?: Kind | null } {
  const had = details.origins.household?.kind ?? null;
  return chosen === undefined || chosen === had ? {} : { kind: chosen };
}

const KIND_WHY: Readonly<Record<KindReason, string>> = {
  named: "",
  split: "Split into songs, so an album",
  segment: "A song of an album file",
  length: "Guessed from its length",
  default: "No one named it, so a song",
};

/**
 * Whether the Track is a song or an album in one file, and why. A split file is an
 * album and each of its songs a song, so neither can be changed.
 */
function KindChoice({
  details,
  chosen,
  onChoose,
}: {
  readonly details: Details;
  readonly chosen: Kind | null | undefined;
  readonly onChoose: (kind: Kind | null) => void;
}) {
  const fixed = details.kind.reason === "split" || details.kind.reason === "segment";
  const shown = chosen ?? details.kind.value;
  // Whether the household's word will be kept, so it can be dropped for the guess again.
  const named =
    chosen === undefined ? details.origins.household?.kind !== undefined : chosen !== null;
  return (
    <fieldset className="kind-choice" role="radiogroup" aria-label="Kind" disabled={fixed}>
      {(["song", "album"] as const).map((each) => (
        <label key={each} className={shown === each ? "kind-option on" : "kind-option"}>
          <input
            className="kind-input"
            type="radio"
            name="kind"
            value={each}
            checked={shown === each}
            onChange={() => {
              onChoose(each);
            }}
          />
          {each === "song" ? (
            <MusicNoteSimpleIcon aria-hidden />
          ) : (
            <VinylRecordIcon weight="fill" aria-hidden />
          )}
          {each === "song" ? "Song" : "Album"}
        </label>
      ))}
      {named && !fixed ? (
        <button
          type="button"
          className="text"
          onClick={() => {
            onChoose(null);
          }}
        >
          Guess again
        </button>
      ) : (
        <span className="hint">
          {chosen === null ? "Guessed when saved" : KIND_WHY[details.kind.reason]}
        </span>
      )}
    </fieldset>
  );
}

/**
 * The cover shown, large, and where it came from. Over it, on hover or focus, and
 * always on a touch screen: save it as an image, choose another, or remove the
 * household's own.
 */
function CoverBox({
  title,
  details,
  busy,
  covering,
  error,
  onChoose,
  onRemove,
}: {
  /** The song's title, which names a saved image. */
  readonly title: string;
  readonly details: Details;
  readonly busy: boolean;
  /** Whether the household's cover is being saved or removed. */
  readonly covering: boolean;
  readonly error: string;
  readonly onChoose: (image: File) => void;
  readonly onRemove: () => void;
}) {
  const shown = details.shown.cover;
  const yours = details.origins.household?.cover !== undefined;
  const cover = typeof shown?.value === "string" && shown.value !== "" ? shown.value : undefined;
  const choose = cover === undefined ? "Add a cover" : "Replace the cover";
  return (
    <div className="cover-box">
      <div className="cover-frame">
        <span className="cover cover-box-image">
          {cover === undefined ? (
            <MusicNotesIcon weight="duotone" aria-hidden />
          ) : (
            <img src={coverUrl(cover)} alt="Cover" />
          )}
        </span>
        <div className="cover-tools">
          {cover !== undefined && (
            <a
              className="cover-tool"
              href={coverUrl(cover)}
              download={title}
              aria-label="Save the cover image"
              title="Save image"
            >
              <DownloadSimpleIcon weight="bold" aria-hidden />
            </a>
          )}
          <label className={busy ? "cover-tool disabled" : "cover-tool"} title={choose}>
            <UploadSimpleIcon weight="bold" aria-hidden />
            <span className="visually-hidden">{choose}</span>
            <input
              type="file"
              className="visually-hidden"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) => {
                const chosen = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (chosen !== undefined) {
                  onChoose(chosen);
                }
              }}
            />
          </label>
          {yours && (
            <button
              type="button"
              className="cover-tool"
              disabled={busy}
              aria-label="Remove your cover"
              title="Remove your cover"
              onClick={onRemove}
            >
              <TrashIcon weight="bold" aria-hidden />
            </button>
          )}
        </div>
        {covering && (
          <span className="cover-saving" role="status" aria-label="Saving the cover…">
            <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          </span>
        )}
      </div>
      {shown === undefined ? (
        <small className="detail-origin">No cover</small>
      ) : yours && cover === undefined ? (
        <small className="detail-origin yours">None, as you chose</small>
      ) : (
        <OriginTag
          origin={yours ? "household" : shown.origin}
          full={yours ? "Yours" : `From ${ORIGIN_LABELS[shown.origin]}`}
        />
      )}
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The lookups the song may be asked about, each a button with the site's mark, and
 * beside them how the one asked last goes.
 */
function LookupBar({
  findable,
  lookup,
  online,
  onFind,
}: {
  readonly findable: readonly Lookup[];
  readonly lookup: TrackLookup | undefined;
  readonly online: boolean;
  readonly onFind: (lookup: Lookup) => void;
}) {
  // The one asked stays offered while it runs, though the song isn't findable meanwhile.
  const offered = LOOKUPS.filter(
    (each) => findable.includes(each) || each.enricher === lookup?.enricher,
  );
  const status = coverStatusOf(lookup, online);
  const running = status?.kind === "looking" || status?.kind === "waiting";
  if (offered.length === 0) {
    return null;
  }
  return (
    <div className="lookup-bar">
      <div className="lookup-buttons">
        {offered.map((each) => (
          <button
            key={each.enricher}
            type="button"
            className="lookup-button"
            title={each.label}
            aria-label={each.label}
            disabled={running}
            onClick={() => {
              onFind(each);
            }}
          >
            <each.icon weight="bold" aria-hidden />
            <span aria-hidden>{each.short}</span>
          </button>
        ))}
      </div>
      {status !== undefined && (
        <p className={`lookup-status ${status.kind}`} role="status" aria-label={status.label}>
          <span className="lookup-mark">{STATUS_ICONS[status.kind]}</span>
          <span aria-hidden>{status.label}</span>
        </p>
      )}
    </div>
  );
}

/**
 * A video's title and description to paste, starting from the text `read` before;
 * it can't be read while the dialog is `busy` saving or reading.
 */
function PasteVideo({
  read,
  busy,
  reading,
  note,
  error,
  onEdit,
  onRead,
}: {
  readonly read: VideoText | null;
  readonly busy: boolean;
  readonly reading: boolean;
  readonly note: string;
  readonly error: string;
  readonly onEdit: () => void;
  readonly onRead: (text: VideoText) => void;
}) {
  const [title, setTitle] = useState(read?.title ?? "");
  const [description, setDescription] = useState(read?.description ?? "");
  const empty = title.trim() === "" && description.trim() === "";
  const submit = () => {
    if (!empty && !busy) {
      onRead({ title, description });
    }
  };
  return (
    <details className="paste-video">
      <summary className="paste-video-summary">Paste the video's details</summary>
      <div className="paste-video-body">
        <label htmlFor="paste-video-title" className="detail-label">
          Video title
        </label>
        <input
          id="paste-video-title"
          className="detail-input"
          maxLength={MAX_VIDEO_TITLE}
          value={title}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            onEdit();
          }}
          onKeyDown={(event) => {
            // Enter reads the video's details here, rather than saving the dialog; an
            // Enter that ends composing a word, as in Japanese, only ends it.
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <label htmlFor="paste-video-description" className="detail-label">
          Description
        </label>
        <textarea
          id="paste-video-description"
          className="detail-input"
          rows={5}
          maxLength={MAX_DESCRIPTION}
          value={description}
          onChange={(event) => {
            setDescription(event.currentTarget.value);
            onEdit();
          }}
        />
        <small className="paste-video-hint">
          Reading replaces what the video said before; your own values stay.
        </small>
        <button
          type="button"
          className="secondary paste-video-read"
          disabled={empty || busy}
          aria-busy={reading}
          onClick={submit}
        >
          Read details
        </button>
        <p className="paste-video-note" role="status">
          {note}
        </p>
        {error !== "" && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Say what reading a video's text found: the details it gave, and how many songs it lists. */
function noteOf(read: VideoRead): string {
  const video = read.details.origins.video ?? {};
  const found = DETAIL_FIELDS.filter(({ name }) => video[name] !== undefined).map(({ label }) =>
    label.toLowerCase(),
  );
  const songs = read.songs.length > 0 ? ` It lists ${String(read.songs.length)} songs.` : "";
  return found.length > 0
    ? `Read the video's details: ${LIST.format(found)}.${songs}`
    : `Read the video's details, but found no details in them.${songs}`;
}

/** One detail's box, where its value comes from, and what other origins say. */
function DetailBox({
  field,
  details,
  own,
  onChange,
}: {
  readonly field: DetailField;
  readonly details: Details;
  readonly own: Own;
  readonly onChange: (own: Own) => void;
}) {
  const { name, label, kind } = field;
  const id = `detail-${name}`;
  const typed = boxText(details, own, name);
  const yours = name in settle(details, own);
  const origin = originOf(details, own, field);
  const described = origin === undefined ? undefined : `${id}-origin`;
  const range = RANGES[name];
  const suggestion = suggestionOf(details, name);
  return (
    <div className={`detail detail-${kind} detail-${name}`}>
      <label htmlFor={id} className="detail-label">
        {label}
      </label>
      <input
        id={id}
        className="detail-input"
        type={kind === "number" ? "number" : "text"}
        inputMode={kind === "number" ? "numeric" : undefined}
        min={range?.[0]}
        max={range?.[1]}
        maxLength={kind === "text" ? MAX_TEXT : undefined}
        value={typed}
        aria-describedby={described}
        onChange={(event) => {
          onChange({ ...own, [name]: event.currentTarget.value });
        }}
      />
      {origin !== undefined &&
        (origin.from === undefined ? (
          <small id={described} className={yours ? "detail-origin yours" : "detail-origin"}>
            {origin.text}
          </small>
        ) : (
          <OriginTag id={described} origin={origin.from} full={origin.text} />
        ))}
      <div className="detail-alternatives" role="group" aria-label={`Other values for ${label}`}>
        {alternativesOf(details, name, typed).map(({ value, origin: from }) => {
          const Mark = ORIGIN_TAGS[from].icon;
          return (
            <button
              key={from}
              type="button"
              className="detail-alternative"
              aria-label={`Use “${value}”, from ${ORIGIN_LABELS[from]}`}
              title={`From ${ORIGIN_LABELS[from]}`}
              onClick={() => {
                onChange({ ...own, [name]: value });
              }}
            >
              <Mark weight="bold" aria-hidden />
              {value}
            </button>
          );
        })}
      </div>
      {suggestion !== undefined && suggestion !== typed.trim() && (
        <div
          className="detail-suggestion"
          role="group"
          aria-label={`The AI's suggestion for ${label}`}
        >
          <small className="detail-origin">The AI suggests “{suggestion}”</small>
          <button
            type="button"
            className="detail-alternative"
            aria-label={`Use “${suggestion}”, suggested by the AI`}
            onClick={() => {
              onChange({ ...own, [name]: suggestion });
            }}
          >
            Use
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Return where `field`'s box gets its value, as the dialog says it, with the origin
 * its tag shows; nothing when no origin gives it.
 */
function originOf(
  details: Details,
  own: Own,
  field: DetailField,
): { readonly text: string; readonly from?: Origin } | undefined {
  const { name, kind } = field;
  const shows = previewOf(details, own)[name];
  if (name in settle(details, own)) {
    if (kind === "number" && own[name]?.trim() === "") {
      return {
        text:
          shows === undefined
            ? "Left empty"
            : `Left empty, so ${String(shows.value)} from ${ORIGIN_LABELS[shows.origin]} shows`,
      };
    }
    return { text: "Yours", from: "household" };
  }
  if (shows !== undefined) {
    return { text: `From ${ORIGIN_LABELS[shows.origin]}`, from: shows.origin };
  }
  // An album field another origin gives, hidden because the household's album differs.
  return shownOf(foundOf(details))[name] === undefined
    ? undefined
    : { text: "Hidden, as your album differs" };
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
