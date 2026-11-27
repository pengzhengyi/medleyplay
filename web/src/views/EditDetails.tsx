/**
 * @file Editing a song's details: what each says now and where it came from, and the household's own.
 *
 * A box typed in, or a value chosen from another origin, becomes the household's
 * value, which wins; every other box shows what would show with them. Typing or
 * choosing what would show anyway drops the household's value. Saving sends only
 * what changed, and the dialog stays open on the details as saved, saying so: closing
 * is the household's to choose. Escape, Cancel (Close once nothing is left to save), or
 * a click outside it close it without saving, except while a save is under way.
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
  CaretDownIcon,
  CaretRightIcon,
  MusicNoteSimpleIcon,
  PlusIcon,
  QuotesIcon,
  ScissorsIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AI_ENRICHER,
  ApiError,
  type Credit,
  type Detail,
  type Details,
  type Kind,
  type KindReason,
  type MissingDetailReview,
  type Origin,
  type Pictured,
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
  canPrefillMissingDetail,
  changesOf,
  foundOf,
  ownOf,
  previewOf,
  settle,
  shownOf,
  suggestionOf,
} from "../library/details";
import { LOOKUPS, type Lookup, coverStatusOf } from "../library/lookups";
import { type Words, useFormattingLocale, useWords } from "../locale";
import { composing } from "../ime";
import { CoverScopeError } from "../library/views";
import { AiNotePanel } from "./AiNotePanel";
import type { TrackLookup } from "../library/useLibrary";
import { answeredOf } from "../library/aiAnswer";
import { onlyArtist, sameCredits, toggled, withCredit, withoutCredit } from "../library/credits";
import { ArtistChips } from "./ArtistChips";
import { DetailReviewNote } from "./DetailReviewNote";
import { Modal } from "./Modal";
import { OriginTag } from "./OriginTag";
import { type CoverAlbum, PictureEditor } from "./PictureEditor";
import { PictureFrame } from "./PictureFrame";
import { Cover } from "./Cover";
import { KindMark } from "./KindMark";
import { ORIGIN_TAGS } from "./originTags";
import { type SongsControls, SongsControlsContext } from "./songsControls";
import { STATUS_ICONS } from "./statusIcons";
import { WhichArtist } from "./WhichArtist";

/** How long *Saved* shows beside the heading once the details are saved. */
const SAVED_MS = 2500;

/** How long text may be, as the server keeps it. */
const MAX_TEXT = 512;

/** The ranges the server keeps a number in. */
const RANGES: Partial<Record<Detail, readonly [number, number]>> = {
  track_number: [1, 9999],
  disc_number: [1, 999],
  year: [1000, 2999],
};

/** How long a video's title and description may be, as the server takes them. */
const MAX_VIDEO_TITLE = 1_000;
const MAX_DESCRIPTION = 20_000;

const SONGS_TITLE = "edit-songs-title";
const LYRICS_TITLE = "edit-lyrics-title";

/**
 * Edit `track`'s details, read with `load`; `onSave` sends the household's values
 * changed, `null` dropping one, and `onReadVideo` a video's pasted text. `onFind`
 * asks one of the lookups `findable`, and `lookup` is how the last one asked goes;
 * `onAskAi` asks the AI with a note.
 * `songs` opens the songs of its file in place of the details, first when
 * `startOnSongs`.
 */
export function EditDetails({
  track,
  review,
  load,
  onSave,
  onReadVideo,
  coverHelp,
  onSetCover,
  onRemoveCover,
  onUseCover,
  onChooseArtist,
  findable,
  lookup,
  online,
  onFind,
  onAskAi,
  songs,
  lyrics,
  startOnSongs = false,
  onClose,
}: {
  readonly track: Track;
  readonly review?: MissingDetailReview | undefined;
  readonly load: (trackId: number) => Promise<Details>;
  /** Save the household's values changed, and the song's artists if chosen one by one. */
  readonly onSave: (
    changes: Partial<Record<Detail, string | number | null>>,
    artists?: readonly Credit[],
  ) => Promise<void>;
  readonly onReadVideo: (text: VideoText) => Promise<VideoRead>;
  readonly coverHelp?: string | undefined;
  readonly onSetCover: (image: Blob) => Promise<Details>;
  readonly onRemoveCover: () => Promise<Details>;
  /** Make the cover `cover`, one found for the song's album, the household's own. */
  readonly onUseCover: (cover: string) => Promise<Details>;
  /** Bind the song's artist `written` to the artist `id` going by it, or to another for `null`. */
  readonly onChooseArtist?: (written: string, id: string | null) => Promise<Details>;
  readonly findable: readonly Lookup[];
  readonly lookup: TrackLookup | undefined;
  /** Whether medleyplay is Online, so a lookup asked runs now. */
  readonly online: boolean;
  readonly onFind: (lookup: Lookup) => void;
  /** Ask the AI about the song with a note from the household's, or typed. */
  readonly onAskAi?: ((note: string) => void) | undefined;
  /** The way to its file's songs: what it is called, and the editor, which the dialog controls. */
  readonly songs?: { readonly label: string; readonly editor: ReactNode } | undefined;
  /** The way to the song's lyrics: what it is called, and the editor, which the dialog controls. */
  readonly lyrics?: { readonly label: string; readonly editor: ReactNode } | undefined;
  readonly startOnSongs?: boolean;
  readonly onClose: () => void;
}) {
  const t = useWords();
  const dialog = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState<Details | undefined>(undefined);
  const [edits, setEdits] = useState<Partial<Record<Detail, string | null | undefined>>>({});
  const held = details === undefined ? {} : ownOf(details);
  const merged = new Map<string, string>(Object.entries(held));
  for (const [field, value] of Object.entries(edits)) {
    if (value === null) merged.delete(field);
    else if (value !== undefined) merged.set(field, value);
  }
  const own: Own = Object.fromEntries(merged);
  const setOwn = (next: Own) => {
    setEdits((before) => {
      const after = { ...before };
      for (const { name } of DETAIL_FIELDS) {
        if (own[name] === next[name]) continue;
        after[name] = held[name] === next[name] ? undefined : (next[name] ?? null);
      }
      return after;
    });
  };
  // The song's artists as chips, or `undefined` while it has one artist in a box.
  const [creditEdit, setCreditEdit] = useState<readonly Credit[] | null>();
  const credits =
    creditEdit === undefined
      ? details === undefined
        ? undefined
        : chipsOf(details)
      : (creditEdit ?? undefined);
  const setCredits = (value: readonly Credit[] | undefined) => {
    setCreditEdit(value ?? null);
  };
  // An artist typed among the chips, not added yet.
  const [draft, setDraft] = useState("");
  const [removedArtist, setRemovedArtist] = useState<string>();
  const artistBox = useRef<HTMLInputElement>(null);
  // The kind chosen, `null` to guess it again, or `undefined` while unchanged.
  const [kind, setKind] = useState<Kind | null | undefined>(undefined);
  // A song's album, folded until opened: many songs are singles, on no album.
  const [albumOpen, setAlbumOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<VideoRead>();
  const [readError, setReadError] = useState("");
  const [covering, setCovering] = useState(false);
  const [coverError, setCoverError] = useState<{ readonly cause: unknown }>();
  const [choosingArtist, setChoosingArtist] = useState(false);
  const [replacingCover, setReplacingCover] = useState(false);
  const [error, setError] = useState("");
  const [readFailure, setReadFailure] = useState<{ readonly cause: unknown }>();
  const [reviewState, setReviewState] = useState<"prefilled" | "stale">();
  const [saved, setSaved] = useState(false);
  // Saying it saved is enough for a moment; the details shown are what was kept.
  useEffect(() => {
    if (!saved) {
      return undefined;
    }
    const hide = setTimeout(() => {
      setSaved(false);
    }, SAVED_MS);
    return () => {
      clearTimeout(hide);
    };
  }, [saved]);
  const [panel, setPanel] = useState<"details" | "songs" | "lyrics">(
    startOnSongs && songs !== undefined ? "songs" : "details",
  );
  const [songsLocked, setSongsLocked] = useState(false);
  const songsEntry = useRef<HTMLButtonElement>(null);
  const lyricsEntry = useRef<HTMLButtonElement>(null);
  // The panel left last, whose way back focus returns to.
  const left = useRef<"songs" | "lyrics">("songs");
  // Focus follows the swap: to the panel's heading, and back to the way to it.
  const swapped = useRef(false);
  useEffect(() => {
    if (!swapped.current) {
      swapped.current = true;
      return;
    }
    if (panel === "details") {
      (left.current === "lyrics" ? lyricsEntry : songsEntry).current?.focus();
    } else {
      left.current = panel;
      document.getElementById(panel === "songs" ? SONGS_TITLE : LYRICS_TITLE)?.focus();
    }
  }, [panel]);
  const backFromSongs = useCallback(() => {
    setSongsLocked(false);
    setPanel("details");
  }, [setPanel]);
  // Songs saved return to the details, or close a dialog opened on them.
  const songsSaved = useCallback(() => {
    if (startOnSongs) {
      dialog.current?.close();
    } else {
      backFromSongs();
    }
  }, [startOnSongs, backFromSongs]);
  const controls = useMemo<SongsControls>(
    () => ({
      headingId: SONGS_TITLE,
      onBack: backFromSongs,
      onLock: setSongsLocked,
      onDone: songsSaved,
    }),
    [backFromSongs, songsSaved],
  );
  const leaveLyrics = useCallback(() => {
    setSongsLocked(false);
    setPanel("details");
  }, [setPanel]);
  const lyricsControls = useMemo<SongsControls>(
    () => ({
      headingId: LYRICS_TITLE,
      onBack: leaveLyrics,
      onLock: setSongsLocked,
      onDone: leaveLyrics,
    }),
    [leaveLyrics],
  );

  useEffect(() => {
    let open = true;
    load(track.id).then(
      (loaded) => {
        if (open) {
          setDetails(loaded);
          const canPrefill = review !== undefined && canPrefillMissingDetail(loaded, review.field);
          setEdits(canPrefill ? { [review.field]: review.value } : {});
          setCreditEdit(undefined);
          setReadFailure(undefined);
          setReviewState(review === undefined ? undefined : canPrefill ? "prefilled" : "stale");
          if (canPrefill && review.field !== "artist") setAlbumOpen(true);
        }
      },
      (failure: unknown) => {
        if (open) {
          setReadFailure({ cause: failure });
        }
      },
    );
    return () => {
      open = false;
    };
  }, [track.id, load, review]);

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

  const chosen = credits === undefined ? undefined : withCredit(credits, draft);
  // Chips name the artists in place of the box: unchanged, the artist is left as it is.
  const artists =
    chosen === undefined || details === undefined || sameCredits(chosen, details.artists)
      ? undefined
      : chosen;
  const changes =
    details === undefined
      ? {}
      : {
          ...withoutArtist(changesOf(details, own), chosen !== undefined),
          ...kindChange(details, kind),
        };
  const changed = Object.keys(changes).length > 0 || artists !== undefined;
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changed || saving || reading || covering) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await (artists === undefined ? onSave(changes) : onSave(changes, artists));
      // The details as saved, so what is shown is what is kept.
      const fresh = await load(track.id).catch(() => undefined);
      if (fresh !== undefined) {
        setDetails(fresh);
        setEdits({});
        setCreditEdit(undefined);
        setDraft("");
        setKind(undefined);
      }
      setSaving(false);
      setReviewState(undefined);
      setSaved(true);
    } catch (failure) {
      setSaving(false);
      setError(messageOf(failure));
    }
  };
  const readVideo = async (text: VideoText) => {
    setReading(true);
    setReadError("");
    setReadNote(undefined);
    try {
      const read = await onReadVideo(text);
      setDetails(read.details);
      setReadNote(read);
    } catch (failure) {
      setReadError(messageOf(failure));
    } finally {
      setReading(false);
    }
  };
  /** Bind the song's artist `written` to another artist going by its name at once. */
  const chooseArtist = async (written: string, id: string | null) => {
    if (onChooseArtist === undefined) {
      return;
    }
    setChoosingArtist(true);
    setError("");
    try {
      setDetails(await onChooseArtist(written, id));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setChoosingArtist(false);
    }
  };
  /** Save the cover change `change` makes at once, and show the details it answers. */
  const changeCover = async (change: () => Promise<Details>) => {
    setCovering(true);
    setCoverError(undefined);
    try {
      setDetails(await change());
    } catch (failure) {
      setCoverError({ cause: failure });
    } finally {
      setCovering(false);
    }
  };
  const focusArtistBox = useCallback(() => {
    artistBox.current?.focus();
  }, []);
  /** Show `next` as the chips, as the one artist in the box once one main artist is left. */
  const showCredits = (next: readonly Credit[]) => {
    const only = onlyArtist(next);
    if (only === undefined) {
      setCredits(next);
    } else {
      setCredits(undefined);
      setOwn({ ...own, artist: only });
      setTimeout(focusArtistBox);
    }
  };
  const artistChips: ArtistChipsProps | undefined =
    details === undefined || details.kind.reason === "split"
      ? undefined
      : {
          credits,
          draft,
          said: removedArtist === undefined ? "" : t("Removed {{name}}", { name: removedArtist }),
          box: artistBox,
          disabled: saving || choosingArtist,
          ...(onChooseArtist !== undefined && {
            onChoose: (written: string, id: string | null) => {
              void chooseArtist(written, id);
            },
          }),
          onAdd: () => {
            const typed = credits === undefined ? boxText(details, own, "artist") : draft;
            setCredits(withCredit(credits ?? [], typed));
            setDraft("");
            focusArtistBox();
          },
          onDraft: setDraft,
          onToggle: (index) => {
            if (credits !== undefined) {
              setCredits(toggled(credits, index));
            }
          },
          onRemove: (index) => {
            if (credits !== undefined) {
              const gone = credits[index];
              setRemovedArtist(gone?.written);
              showCredits(withoutCredit(credits, index));
            }
          },
          onFocusAdd: focusArtistBox,
          onUse: (next) => {
            setCredits(undefined);
            setDraft("");
            setOwn(next);
          },
        };
  const boxes = (group: DetailField["group"]) =>
    details !== undefined &&
    DETAIL_FIELDS.filter((field) => field.group === group).map((field) => (
      <DetailBox
        key={field.name}
        field={field}
        details={details}
        own={own}
        onChange={setOwn}
        disabled={saving || reading || covering}
        chips={field.name === "artist" ? artistChips : undefined}
        chipsChanged={field.name === "artist" && artists !== undefined}
      />
    ));

  return (
    <Modal
      ref={dialog}
      className="edit-details"
      labelledBy={
        panel === "songs" ? SONGS_TITLE : panel === "lyrics" ? LYRICS_TITLE : "edit-details-title"
      }
      describedBy="edit-details-song"
      locked={saving || reading || covering || songsLocked}
      onClose={onClose}
    >
      {panel === "songs" && songs !== undefined && (
        <div className="card songs-card">
          <SongsControlsContext value={controls}>{songs.editor}</SongsControlsContext>
        </div>
      )}
      {panel === "lyrics" && lyrics !== undefined && (
        <div className="card lyrics-card">
          <SongsControlsContext value={lyricsControls}>{lyrics.editor}</SongsControlsContext>
        </div>
      )}
      <form className="card" hidden={panel !== "details"} onSubmit={(event) => void save(event)}>
        <div className="edit-details-head">
          <h2 id="edit-details-title">{t("Edit details")}</h2>
          {saved && !changed && !saving && (
            <span className="edit-details-saved" role="status">
              {t("Saved")}
            </span>
          )}
        </div>
        <p id="edit-details-song" className="edit-details-song">
          <KindMark kind={track.kind} reason={track.kind_reason} lyrics={track} besideTitle />
          {track.title}
        </p>
        {reviewState === "stale" && (
          <p className="error" role="alert">
            {t("The field changed before Edit details opened. The suggestion was not used.")}
          </p>
        )}
        {reviewState === "prefilled" && review !== undefined && details !== undefined && (
          <DetailReviewNote
            review={review}
            details={details}
            own={own}
            changes={changes}
            artistsChanged={artists !== undefined}
          />
        )}
        {details === undefined && readFailure === undefined && (
          <p className="empty" role="status">
            {t("Reading the details…")}
          </p>
        )}
        {readFailure !== undefined && (
          <p className="error" role="alert">
            {readDetailsError(readFailure.cause, t)}
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
                help={coverHelp}
                error={coverError}
                onReplace={() => {
                  setReplacingCover(true);
                }}
                onRemove={() => void changeCover(onRemoveCover)}
              />
              {replacingCover && (
                <PictureEditor
                  sources={{
                    kind: "cover",
                    of: track.title,
                    shown: shownCoverOf(details),
                    album: albumOf(details),
                    pictured: picturedOf(albumOf(details)),
                    upload: async (image) => {
                      setDetails(await onSetCover(image));
                    },
                    use: async (cover) => {
                      setDetails(await onUseCover(cover));
                    },
                  }}
                  onClose={() => {
                    setReplacingCover(false);
                  }}
                />
              )}
              <LookupBar
                findable={findable}
                lookup={lookup}
                online={online}
                onFind={onFind}
                onAskAi={onAskAi}
              />
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
                  <span className="songs-entry-label">{t(songs.label)}</span>
                  <CaretRightIcon aria-hidden />
                </button>
              )}
              {lyrics !== undefined && (
                <button
                  ref={lyricsEntry}
                  type="button"
                  className="songs-entry"
                  disabled={saving || reading || covering}
                  onClick={() => {
                    setPanel("lyrics");
                  }}
                >
                  <QuotesIcon aria-hidden />
                  <span className="songs-entry-label">{t(lyrics.label)}</span>
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
                  setReadNote(undefined);
                  setReadError("");
                }}
                onRead={(text) => void readVideo(text)}
              />
            </div>
            <div className="edit-details-fields">
              <KindChoice
                details={details}
                chosen={kind}
                onChoose={setKind}
                disabled={saving || reading || covering}
              />
              <fieldset className="detail-group">
                <legend>{t("Song")}</legend>
                {boxes("song")}
              </fieldset>
              {(kind ?? details.kind.value) === "album" ? (
                <fieldset className="detail-group">
                  <legend>{t("Album")}</legend>
                  {boxes("album")}
                </fieldset>
              ) : (
                <details
                  className="detail-fold"
                  open={albumOpen}
                  onToggle={(event) => {
                    setAlbumOpen(event.currentTarget.open);
                  }}
                >
                  <summary className="detail-fold-summary">
                    <span className="detail-fold-title">{t("Album")}</span>
                    <span className="detail-fold-value">
                      {boxText(details, own, "album").trim() === ""
                        ? t("None, a single")
                        : boxText(details, own, "album")}
                    </span>
                  </summary>
                  <fieldset className="detail-group">
                    <legend className="visually-hidden">{t("Album")}</legend>
                    {boxes("album")}
                  </fieldset>
                </details>
              )}
            </div>
          </div>
        )}
        {error !== "" && (
          <p className="error" role="alert">
            {t("Could not update the track details: {{detail}}", { detail: error })}
          </p>
        )}
        <footer className="dialog-buttons">
          <button
            type="submit"
            className="dialog-button"
            disabled={!changed || saving || reading || covering}
            aria-busy={saving}
          >
            {t("Save")}
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
  disabled,
}: {
  readonly details: Details;
  readonly chosen: Kind | null | undefined;
  readonly onChoose: (kind: Kind | null) => void;
  readonly disabled: boolean;
}) {
  const t = useWords();
  const fixed = details.kind.reason === "split" || details.kind.reason === "segment";
  const shown = chosen ?? details.kind.value;
  // Whether the household's word will be kept, so it can be dropped for the guess again.
  const named =
    chosen === undefined ? details.origins.household?.kind !== undefined : chosen !== null;
  return (
    <fieldset
      className="kind-choice"
      role="radiogroup"
      aria-label={t("Kind")}
      disabled={fixed || disabled}
    >
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
          {t(each === "song" ? "Song" : "Album")}
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
          {t("Guess again")}
        </button>
      ) : (
        <span className="hint">
          {t(chosen === null ? "Guessed when saved" : KIND_WHY[details.kind.reason])}
        </span>
      )}
    </fieldset>
  );
}

/** Return the cover the song shows, if any. */
function shownCoverOf(details: Details): string | undefined {
  const shown = details.shown.cover?.value;
  return typeof shown === "string" && shown !== "" ? shown : undefined;
}

/**
 * Return the album to find covers of, and its album artist or else artist: the song's
 * album, or the title of an album file naming none; nothing for a song on no album.
 */
function albumOf(details: Details): CoverAlbum | undefined {
  const text = (detail: Detail) => {
    const value = details.shown[detail]?.value;
    return typeof value === "string" ? value.trim() : "";
  };
  // A whole album in one file is often named only by its title.
  const album = text("album") || (details.kind.value === "album" ? text("title") : "");
  return album === "" ? undefined : { album, artist: text("album_artist") || text("artist") };
}

/** What a model is asked to picture for the song's cover: its album, when it has one. */
function picturedOf(album: CoverAlbum | undefined): Pictured | undefined {
  return album === undefined ? undefined : { kind: "album", ...album };
}

/**
 * The cover shown, large, and where it came from. Over it, on hover or focus, and
 * always on a touch screen: save it as an image, replace it in the picture editor, or
 * remove the household's own.
 */
function CoverBox({
  title,
  details,
  busy,
  covering,
  error,
  onReplace,
  onRemove,
  help,
}: {
  /** The song's title, which names a saved image. */
  readonly title: string;
  readonly details: Details;
  readonly busy: boolean;
  /** Whether the household's cover is being removed. */
  readonly covering: boolean;
  readonly error: { readonly cause: unknown } | undefined;
  readonly onReplace: () => void;
  readonly onRemove: () => void;
  readonly help: string | undefined;
}) {
  const t = useWords();
  const shown = details.shown.cover;
  const yours = details.origins.household?.cover !== undefined;
  const cover = shownCoverOf(details);
  return (
    <div className="cover-box">
      <PictureFrame
        replaceLabel={cover === undefined ? "Add a cover" : "Replace the cover"}
        save={cover === undefined ? undefined : { href: coverUrl(cover, "original"), name: title }}
        removeLabel="Remove your cover"
        busy={busy}
        saving={covering ? "Saving the cover…" : undefined}
        onReplace={onReplace}
        onRemove={yours ? onRemove : undefined}
      >
        <Cover cover={cover ?? null} size="original" className="cover-box-image" alt={t("Cover")} />
      </PictureFrame>
      {help !== undefined && <p className="hint">{help}</p>}
      {shown === undefined ? (
        <small className="detail-origin">{t("No cover")}</small>
      ) : yours && cover === undefined ? (
        <small className="detail-origin yours">{t("None, as you chose")}</small>
      ) : (
        <OriginTag
          origin={yours ? "household" : shown.origin}
          full={
            yours ? t("Yours") : t("From {{source}}", { source: t(ORIGIN_LABELS[shown.origin]) })
          }
        />
      )}
      {error !== undefined && (
        <p className="error" role="alert">
          {t("Could not change the cover: {{detail}}", {
            detail:
              error.cause instanceof CoverScopeError
                ? t(error.cause.reason)
                : messageOf(error.cause),
          })}
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
  onAskAi,
}: {
  readonly findable: readonly Lookup[];
  readonly lookup: TrackLookup | undefined;
  readonly online: boolean;
  readonly onFind: (lookup: Lookup) => void;
  readonly onAskAi: ((note: string) => void) | undefined;
}) {
  const t = useWords();
  // The note to ask the AI with: opened by ▾ beside its button, or a right-click on it.
  const [noting, setNoting] = useState(false);
  const noteToggle = useRef<HTMLButtonElement>(null);
  const notePanel = useId();
  // The one asked stays offered while it runs, though the song isn't findable meanwhile.
  const offered = LOOKUPS.filter(
    (each) => findable.includes(each) || each.enricher === lookup?.enricher,
  );
  const status = coverStatusOf(lookup, online, t);
  const running = status?.kind === "looking" || status?.kind === "waiting";
  if (offered.length === 0) {
    return null;
  }
  const noted = (each: Lookup) => each.enricher === AI_ENRICHER && onAskAi !== undefined;
  return (
    <div className="lookup-bar">
      <div className="lookup-buttons">
        {offered.map((each) => (
          <span key={each.enricher} className={noted(each) ? "ai-split" : undefined}>
            <button
              type="button"
              className="lookup-button"
              title={t(each.label)}
              aria-label={t(each.label)}
              aria-busy={running && each.enricher === lookup?.enricher}
              disabled={running}
              onClick={() => {
                onFind(each);
              }}
              onContextMenu={(event) => {
                if (noted(each) && !running) {
                  event.preventDefault();
                  setNoting(true);
                }
              }}
            >
              <each.icon weight="bold" aria-hidden />
              <span aria-hidden>{t(each.short)}</span>
            </button>
            {noted(each) && (
              <button
                ref={noteToggle}
                type="button"
                className="lookup-button ai-note-toggle"
                aria-label={t("Ask AI with a note")}
                title={t("Ask AI with a note")}
                aria-expanded={noting}
                aria-controls={notePanel}
                disabled={running}
                onClick={() => {
                  setNoting((open) => !open);
                }}
              >
                <CaretDownIcon weight="bold" aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>
      {status !== undefined && (
        <p className={`lookup-status ${status.kind}`} role="status" aria-label={status.label}>
          <span className="lookup-mark">{STATUS_ICONS[status.kind]}</span>
          <span aria-hidden>{status.label}</span>
        </p>
      )}
      {noting && onAskAi !== undefined && (
        <div id={notePanel} className="lookup-note">
          <AiNotePanel
            ask="details"
            onAsk={(note) => {
              setNoting(false);
              if (note === "") {
                const ai = offered.find((each) => each.enricher === AI_ENRICHER);
                if (ai !== undefined) {
                  onFind(ai);
                }
              } else {
                onAskAi(note);
              }
            }}
            onClose={() => {
              setNoting(false);
              noteToggle.current?.focus();
            }}
          />
        </div>
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
  readonly note: VideoRead | undefined;
  readonly error: string;
  readonly onEdit: () => void;
  readonly onRead: (text: VideoText) => void;
}) {
  const t = useWords();
  const locale = useFormattingLocale();
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
      <summary className="paste-video-summary">{t("Paste the video's details")}</summary>
      <div className="paste-video-body">
        <label htmlFor="paste-video-title" className="detail-label">
          {t("Video title")}
        </label>
        <input
          id="paste-video-title"
          className="detail-input"
          maxLength={MAX_VIDEO_TITLE}
          disabled={busy}
          value={title}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            onEdit();
          }}
          onKeyDown={(event) => {
            // Enter reads the video's details here, rather than saving the dialog; an
            // Enter that ends composing a word, as in Japanese, only ends it.
            if (event.key === "Enter" && !composing(event.nativeEvent)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <label htmlFor="paste-video-description" className="detail-label">
          {t("Description")}
        </label>
        <textarea
          id="paste-video-description"
          className="detail-input"
          rows={5}
          maxLength={MAX_DESCRIPTION}
          disabled={busy}
          value={description}
          onChange={(event) => {
            setDescription(event.currentTarget.value);
            onEdit();
          }}
        />
        <small className="paste-video-hint">
          {t("Reading replaces what the video said before; your own values stay.")}
        </small>
        <button
          type="button"
          className="secondary paste-video-read"
          disabled={empty || busy}
          aria-busy={reading}
          onClick={submit}
        >
          {t("Read details")}
        </button>
        <p className="paste-video-note" role="status">
          {note === undefined ? "" : noteOf(note, t, locale)}
        </p>
        {error !== "" && (
          <p className="error" role="alert">
            {t("Could not read the video details: {{detail}}", { detail: error })}
          </p>
        )}
      </div>
    </details>
  );
}

/** Say what reading a video's text found: the details it gave, and how many songs it lists. */
function noteOf(read: VideoRead, t: Words, locale: string): string {
  const video = read.details.origins.video ?? {};
  const found = DETAIL_FIELDS.filter(({ name }) => video[name] !== undefined).map(({ label }) =>
    t(label).toLocaleLowerCase(locale),
  );
  const detail =
    found.length > 0
      ? t("Read the video's details: {{fields}}.", {
          fields: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(found),
        })
      : t("Read the video's details, but found no details in them.");
  return read.songs.length === 0
    ? detail
    : [detail, t("video_songs", { count: read.songs.length })].join(
        t("Sentence separator", { defaultValue: " " }),
      );
}

/** The song's artists as chips in its Artist box, and what changes them. */
interface ArtistChipsProps {
  /** The chips, or `undefined` while the box holds one artist. */
  readonly credits: readonly Credit[] | undefined;
  /** The artist typed among the chips, not added yet. */
  readonly draft: string;
  /** What the last change to the chips was, said to screen readers. */
  readonly said: string;
  readonly box: React.RefObject<HTMLInputElement | null>;
  readonly disabled: boolean;
  /** Bind the song's artist `written` to the artist `id` going by it, or to another for `null`. */
  readonly onChoose?: (written: string, id: string | null) => void;
  /** Add what is typed as a chip, the box's artist first when there are no chips yet. */
  readonly onAdd: () => void;
  readonly onDraft: (draft: string) => void;
  readonly onToggle: (index: number) => void;
  readonly onRemove: (index: number) => void;
  readonly onFocusAdd: () => void;
  /** Use another origin's artist in place of the chips. */
  readonly onUse: (own: Own) => void;
}

/** One detail's box, where its value comes from, and what other origins say. */
function DetailBox({
  field,
  details,
  own,
  onChange,
  chips,
  chipsChanged = false,
  disabled,
}: {
  readonly field: DetailField;
  readonly details: Details;
  readonly own: Own;
  readonly onChange: (own: Own) => void;
  /** For the artist: its chips, which take the box's place once there are several. */
  readonly chips?: ArtistChipsProps | undefined;
  readonly chipsChanged?: boolean;
  readonly disabled: boolean;
}) {
  const t = useWords();
  const { name, label, kind } = field;
  const id = `detail-${name}`;
  const typed = boxText(details, own, name);
  const yours = name in settle(details, own);
  const origin = chipsChanged
    ? ({ text: t("Yours"), from: "household" } as const)
    : originOf(details, own, field, t);
  const described = origin === undefined ? undefined : `${id}-origin`;
  const range = RANGES[name];
  const suggestion = suggestionOf(details, name);
  const credits = chips?.credits;
  const use = chips === undefined ? onChange : chips.onUse;
  const canRemoveBlank =
    (name === "artist" || name === "album" || name === "album_artist") &&
    details.origins.household?.[name] === "" &&
    own[name] === "";
  // The one artist saved, shown as a tag until clicked to edit; typed, it is a box again.
  const [editing, setEditing] = useState(false);
  const tagged =
    chips !== undefined &&
    credits === undefined &&
    !editing &&
    typed.trim() !== "" &&
    typed === boxText(details, {}, name);
  const which = chips?.onChoose !== undefined && (tagged || credits !== undefined) && (
    <WhichArtist artists={details.artists} disabled={chips.disabled} onChoose={chips.onChoose} />
  );
  const face = details.artists[0]?.linked;
  return (
    <div className={`detail detail-${kind} detail-${name}`}>
      <div className="detail-label-row">
        <label id={`${id}-label`} htmlFor={id} className="detail-label">
          {t(credits === undefined ? label : "Artists")}
        </label>
      </div>
      {chips !== undefined && credits !== undefined && (
        <ArtistChips
          credits={credits}
          shown={details.artists}
          disabled={chips.disabled}
          onToggle={chips.onToggle}
          onRemove={chips.onRemove}
          onFocusAdd={chips.onFocusAdd}
        />
      )}
      {chips !== undefined && (
        <span className="visually-hidden" aria-live="polite">
          {chips.said}
        </span>
      )}
      <div className={chips === undefined ? "detail-field" : "detail-field with-add"}>
        {tagged ? (
          <div className="artist-tag">
            <button
              type="button"
              className="artist-tag-name"
              aria-label={t("Edit the artist {{name}}", { name: typed })}
              title={t("Edit the artist")}
              aria-describedby={described}
              disabled={chips.disabled}
              onClick={() => {
                setEditing(true);
              }}
            >
              <span className="artist-chip-face" aria-hidden title={face?.name}>
                {face?.photo ? (
                  <img src={coverUrl(face.photo, "small")} alt="" />
                ) : (
                  typed.charAt(0).toUpperCase()
                )}
              </span>
              <span className="artist-tag-text">{typed}</span>
            </button>
            {which}
          </div>
        ) : (
          <input
            id={id}
            ref={chips?.box}
            className="detail-input"
            type={kind === "number" ? "number" : "text"}
            inputMode={kind === "number" ? "numeric" : undefined}
            min={range?.[0]}
            max={range?.[1]}
            maxLength={kind === "text" ? MAX_TEXT : undefined}
            disabled={disabled}
            placeholder={credits === undefined ? undefined : t("Add an artist")}
            value={credits === undefined || chips === undefined ? typed : chips.draft}
            aria-describedby={described}
            onChange={(event) => {
              if (credits !== undefined && chips !== undefined) {
                chips.onDraft(event.currentTarget.value);
              } else {
                onChange({ ...own, [name]: event.currentTarget.value });
              }
            }}
            onKeyDown={(event) => {
              // Enter adds what is typed as a chip; with nothing typed, it saves, as in any box.
              if (
                chips !== undefined &&
                credits !== undefined &&
                event.key === "Enter" &&
                !composing(event.nativeEvent) &&
                chips.draft.trim() !== ""
              ) {
                event.preventDefault();
                chips.onAdd();
              }
            }}
            // Clicking the artist's tag opens it to edit, to type at once.
            autoFocus={editing}
            onBlur={() => {
              setEditing(false);
            }}
          />
        )}
        {credits !== undefined && which}
        {chips !== undefined && (
          <button
            type="button"
            className="detail-add-icon"
            aria-label={t("More artists")}
            disabled={chips.disabled}
            title={t("This song is by more than one artist: add each one")}
            onClick={chips.onAdd}
          >
            <PlusIcon weight="bold" aria-hidden />
          </button>
        )}
      </div>
      {origin !== undefined &&
        (origin.from === undefined ? (
          <small id={described} className={yours ? "detail-origin yours" : "detail-origin"}>
            {origin.text}
          </small>
        ) : (
          <OriginTag id={described} origin={origin.from} full={origin.text} />
        ))}
      <div
        className="detail-alternatives"
        role="group"
        aria-label={t("Other values for {{field}}", { field: t(label) })}
      >
        {canRemoveBlank && (
          <button
            type="button"
            className="detail-alternative"
            disabled={disabled}
            onClick={() => {
              use(Object.fromEntries(Object.entries(own).filter(([field]) => field !== name)));
            }}
          >
            {t("Remove blank override")}
          </button>
        )}
        {alternativesOf(details, name, typed).map(({ value, origin: from }) => {
          const Mark = ORIGIN_TAGS[from].icon;
          return (
            <button
              key={from}
              type="button"
              className="detail-alternative"
              disabled={disabled}
              aria-label={t("Use “{{value}}”, from {{source}}", {
                value,
                source: t(ORIGIN_LABELS[from]),
              })}
              title={t("From {{source}}", { source: t(ORIGIN_LABELS[from]) })}
              onClick={() => {
                use({ ...own, [name]: value });
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
          aria-label={t("{{model}}'s suggestion for {{field}}", {
            model: details.ai_answered_by?.model ?? t("The AI"),
            field: t(label),
          })}
        >
          <small className="detail-origin" title={answeredOf(details.ai_answered_by, t)}>
            {t("{{model}} suggests “{{value}}”", {
              model: details.ai_answered_by?.model ?? t("The AI"),
              value: suggestion,
            })}
          </small>
          <button
            type="button"
            className="detail-alternative"
            disabled={disabled}
            aria-label={t("Use “{{value}}”, suggested by {{model}}", {
              value: suggestion,
              model: details.ai_answered_by?.model ?? t("the AI"),
            })}
            onClick={() => {
              use({ ...own, [name]: suggestion });
            }}
          >
            {t("Use")}
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
  t: Words,
): { readonly text: string; readonly from?: Origin } | undefined {
  const { name, kind } = field;
  const shows = previewOf(details, own)[name];
  if (name in settle(details, own)) {
    if (kind === "number" && own[name]?.trim() === "") {
      return {
        text:
          shows === undefined
            ? t("Left empty")
            : t("Left empty, so {{value}} from {{source}} shows", {
                value: shows.value,
                source: t(ORIGIN_LABELS[shows.origin]),
              }),
      };
    }
    return { text: t("Yours"), from: "household" };
  }
  if (shows !== undefined) {
    return {
      text: t("From {{source}}", { source: t(ORIGIN_LABELS[shows.origin]) }),
      from: shows.origin,
    };
  }
  // An album field another origin gives, hidden because the household's album differs.
  return shownOf(foundOf(details))[name] === undefined
    ? undefined
    : { text: t("Hidden, as your album differs") };
}

/** Return the song's artists as chips when it shows several, else `undefined` for one box. */
function chipsOf(details: Details): readonly Credit[] | undefined {
  return details.artists.length > 1
    ? details.artists.map(({ written, role }) => ({ written, role }))
    : undefined;
}

/** Return `changes` without the artist's when `chipped`: the chips say the artists then. */
function withoutArtist(
  changes: Partial<Record<Detail, string | number | null>>,
  chipped: boolean,
): Partial<Record<Detail, string | number | null>> {
  if (!chipped) {
    return changes;
  }
  return Object.fromEntries(Object.entries(changes).filter(([field]) => field !== "artist"));
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function readDetailsError(failure: unknown, t: Words): string {
  const detail = messageOf(failure);
  const id =
    failure instanceof ApiError && failure.status === 404
      ? /^There is no Track (\d+)\.$/u.exec(detail)?.[1]
      : undefined;
  return t("Could not read the track details: {{detail}}", {
    detail: id === undefined ? detail : t("There is no Track {{id}}.", { id }),
  });
}
