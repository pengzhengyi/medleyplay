/**
 * @file Replacing a cover or a photo: one editor, a tab for each place a picture comes from.
 *
 * *Upload* takes a picture from this device, dropped or chosen, and shows it before it is
 * used; *MusicBrainz* shows the covers of the album's releases; *Deezer* shows its
 * pictures of the artists going by an artist's name; *Ask AI* shows the pictures a model
 * suggests. Using one closes the editor; nothing changes before that. A cover has no
 * Deezer tab, an artist's photo no MusicBrainz tab, and a song on no album can't be
 * looked up.
 */

import {
  CircleNotchIcon,
  ImageSquareIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
  UploadSimpleIcon,
  UserSquareIcon,
} from "@phosphor-icons/react";
import * as Tabs from "@radix-ui/react-tabs";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type FileRejection, useDropzone } from "react-dropzone";

import { ApiError, api, type Pictured } from "../api";
import { CoverScopeError } from "../library/views";
import { type Words, useWords } from "../locale";
import { Trans } from "react-i18next";
import { ArtistPictureFinder } from "./ArtistPictureFinder";
import { GoogleImagesLink, TavilySearch } from "./AlbumImageSearch";
import { CoverFinder } from "./CoverFinder";
import { ImageLinks } from "./ImageLinks";
import { Modal } from "./Modal";

/** The most bytes a picture uploaded may hold, as the server allows. */
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

/** The kinds of image the server keeps. */
const ACCEPTED = { "image/jpeg": [], "image/png": [], "image/webp": [] };
const GOOGLE_ALBUM = "<search/> for this album.";
const GOOGLE_ARTIST = "<search/> for this artist.";

/** The album a cover may be looked up for: its name and its album artist, or else its artist. */
export interface CoverAlbum {
  readonly album: string;
  readonly artist: string;
}

/** What the picture is, and the ways to replace it. */
export interface PictureSources {
  /** A cover, of a song or an album, or an artist's photo, which MusicBrainz has none of. */
  readonly kind: "cover" | "photo";
  /** What it is of, as an album's name, a song's title, or an artist's name. */
  readonly of: string;
  /** The picture shown now, if any. */
  readonly shown: string | null | undefined;
  /** The album to look up, for a cover; none for a song on no album. */
  readonly album?: CoverAlbum | undefined;
  readonly scopeHelp?: string | undefined;
  /** The artist to find pictures of on Deezer, for a photo. */
  readonly artistId?: string | undefined;
  /** What a model is asked to picture; none when nothing can be asked. */
  readonly pictured?: Pictured | undefined;
  /** Use the picture `image`, uploaded from this device. */
  readonly upload: (image: File) => Promise<void>;
  /** Use the picture `cover`, chosen from MusicBrainz or Deezer, or approved from a model. */
  readonly use: (cover: string) => Promise<void>;
}

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function pictureSaveDetail(failure: unknown, t: Words): string {
  const detail = messageOf(failure);
  if (failure instanceof ApiError) {
    if (failure.status === 413 && /^A (cover|photo) is at most 10 MiB\.$/u.test(detail))
      return t("A picture is at most 10 MiB.");
    if (
      (failure.status === 415 || failure.status === 422) &&
      /^A (cover|photo) is a JPEG, PNG, or WebP image\.$/u.test(detail)
    )
      return t("Choose a JPEG, PNG, or WebP image.");
  }
  return detail;
}

/** Say why a dropped or chosen file can't be used. */
function refusalOf(rejection: FileRejection): string {
  if (rejection.errors.some((error) => error.code === "too-many-files"))
    return "Choose one picture at a time.";
  return rejection.errors.some((error) => error.code === "file-too-large")
    ? "A picture is at most 10 MiB."
    : "Choose a JPEG, PNG, or WebP image.";
}

/**
 * The editor that replaces the picture `sources` describe, open on the tab `startOn`, closed
 * by `onClose`.
 */
interface PictureEditorProps {
  readonly sources: PictureSources;
  readonly startOn?: "upload" | "musicbrainz" | "deezer" | "ai";
  readonly onClose: () => void;
}

export function PictureEditor(props: PictureEditorProps) {
  const { kind, of, album, artistId, pictured } = props.sources;
  const subject = JSON.stringify([kind, of, album?.album, album?.artist, artistId, pictured]);
  return <PictureEditorForSubject key={subject} {...props} />;
}

function PictureEditorForSubject({ sources, startOn = "upload", onClose }: PictureEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const changing = useRef(false);
  const [using, setUsing] = useState(false);
  const [error, setError] = useState<{ readonly cause: unknown }>();
  const t = useWords();
  const { kind, of, shown, album, artistId, pictured, scopeHelp } = sources;
  const hasAlbum = kind === "cover" && album !== undefined;
  const heading =
    kind === "photo"
      ? shown
        ? "Replace the photo"
        : "Add a photo"
      : hasAlbum
        ? shown
          ? "Replace album cover"
          : "Add album cover"
        : shown
          ? "Replace the cover"
          : "Add a cover";
  const photoId = kind === "photo" ? artistId : undefined;
  const [searchSettings, setSearchSettings] = useState<{
    readonly photoId: string | undefined;
    readonly configured: boolean;
    readonly name?: string;
  }>();
  useEffect(() => {
    if (!hasAlbum && photoId === undefined) return;
    let active = true;
    const read = photoId === undefined ? api.imageSearch() : api.artistImageSearch(photoId);
    read.then(
      (settings) => {
        if (active) setSearchSettings({ ...settings, photoId });
      },
      () => {
        if (active) setSearchSettings(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, [hasAlbum, photoId]);
  const settings = searchSettings?.photoId === photoId ? searchSettings : undefined;
  const photoName = settings?.name?.trim();
  const searchSubject: Pictured | undefined = hasAlbum
    ? { kind: "album", ...album }
    : photoId !== undefined && photoName
      ? { kind: "artist", artistId: photoId }
      : undefined;
  const canSearchTavily = searchSubject !== undefined && settings?.configured === true;
  const googleQuery = hasAlbum ? album : photoName ? { artist: photoName } : undefined;

  /** Make the change `change` makes, and close once it is made. */
  const change = async (made: () => Promise<void>) => {
    if (changing.current) return;
    changing.current = true;
    setUsing(true);
    setError(undefined);
    try {
      await made();
      dialog.current?.close();
    } catch (failure) {
      setError({ cause: failure });
    } finally {
      changing.current = false;
      setUsing(false);
    }
  };

  const upload = (
    <UploadPanel
      kind={kind}
      busy={using}
      onUse={(image) => void change(() => sources.upload(image))}
    />
  );

  const tabs: readonly {
    readonly value: string;
    readonly label: string;
    readonly icon: ReactNode;
    readonly why?: string | undefined;
  }[] = [
    { value: "upload", label: "Upload", icon: <UploadSimpleIcon weight="bold" aria-hidden /> },
    ...(kind === "cover"
      ? [
          {
            value: "musicbrainz",
            label: "MusicBrainz",
            icon: <ImageSquareIcon weight="bold" aria-hidden />,
            why: album === undefined ? "Fill in the album to find its covers." : undefined,
          },
        ]
      : []),
    ...(artistId !== undefined
      ? [{ value: "deezer", label: "Deezer", icon: <UserSquareIcon weight="bold" aria-hidden /> }]
      : []),
    ...(canSearchTavily
      ? [
          {
            value: "tavily",
            label: "Tavily",
            icon: <MagnifyingGlassIcon weight="bold" aria-hidden />,
          },
        ]
      : []),
    ...(kind === "cover" || googleQuery !== undefined
      ? [
          {
            value: "search",
            label: "Google",
            icon: <MagnifyingGlassIcon weight="bold" aria-hidden />,
            why:
              googleQuery === undefined ? "Fill in the album to search for its cover." : undefined,
          },
        ]
      : []),
    {
      value: "ai",
      label: "Ask AI",
      icon: <SparkleIcon weight="bold" aria-hidden />,
      why: pictured === undefined ? "Fill in the album to ask the AI for its cover." : undefined,
    },
  ];
  return (
    <Modal
      ref={dialog}
      className="picture-editor"
      labelledBy={`${id}-title`}
      describedBy={scopeHelp === undefined ? `${id}-of` : `${id}-of ${id}-scope`}
      locked={using}
      onClose={onClose}
    >
      <div className="card">
        <h2 id={`${id}-title`}>{t(heading)}</h2>
        <p id={`${id}-of`} className="picture-editor-of">
          {of}
        </p>
        {scopeHelp !== undefined && (
          <p id={`${id}-scope`} className="hint">
            {scopeHelp}
          </p>
        )}
        {(hasAlbum || photoId !== undefined || pictured !== undefined) && (
          <p id={`${id}-sources-help`} className="hint">
            {t(
              "Opening MusicBrainz, Deezer, Tavily, or Ask AI may send album or artist details to those services. AI may choose a picture automatically and your provider may charge. Previews may load from other sites; artwork changes only when you choose to use a picture.",
            )}
          </p>
        )}
        {/* A tab is chosen, not merely focused: opening the dialog focuses its first tab, and
            some tabs ask a site or an AI model as soon as they show. */}
        <Tabs.Root
          className="picture-editor-tabs"
          defaultValue={startOn}
          orientation="vertical"
          activationMode="manual"
        >
          <Tabs.List
            className="picture-editor-sources"
            aria-describedby={
              hasAlbum || photoId !== undefined || pictured !== undefined
                ? `${id}-sources-help`
                : undefined
            }
            aria-label={t(
              kind === "cover" ? "Where the cover comes from" : "Where the photo comes from",
            )}
          >
            {tabs.map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="picture-editor-source"
                disabled={using || tab.why !== undefined}
                title={tab.why === undefined ? undefined : t(tab.why)}
              >
                {tab.icon} {t(tab.label)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="upload" className="picture-editor-panel">
            {upload}
          </Tabs.Content>
          {googleQuery !== undefined && (
            <Tabs.Content value="search" className="picture-editor-panel">
              <ol className="picture-editor-google-steps">
                <li>
                  <Trans
                    t={t}
                    i18nKey={hasAlbum ? GOOGLE_ALBUM : GOOGLE_ARTIST}
                    defaults={hasAlbum ? GOOGLE_ALBUM : GOOGLE_ARTIST}
                    components={{ search: <GoogleImagesLink {...googleQuery} /> }}
                  />
                </li>
                <li>{t("Open the source page and save a picture you have permission to use.")}</li>
                <li>
                  {t(kind === "cover" ? "Replace the cover below." : "Replace the photo below.")}
                </li>
              </ol>
              {upload}
            </Tabs.Content>
          )}
          {canSearchTavily && (
            <Tabs.Content value="tavily" className="picture-editor-panel">
              <TavilySearch key={JSON.stringify(searchSubject)} {...searchSubject} />
            </Tabs.Content>
          )}
          {hasAlbum && (
            <Tabs.Content value="musicbrainz" className="picture-editor-panel">
              <CoverFinder
                album={album.album}
                artist={album.artist}
                shown={shown ?? undefined}
                busy={using}
                onUse={(cover) => void change(() => sources.use(cover))}
              />
            </Tabs.Content>
          )}
          {artistId !== undefined && (
            <Tabs.Content value="deezer" className="picture-editor-panel">
              <ArtistPictureFinder
                artistId={artistId}
                shown={shown}
                busy={using}
                onUse={(cover) => void change(() => sources.use(cover))}
              />
            </Tabs.Content>
          )}
          {pictured !== undefined && (
            <Tabs.Content value="ai" className="picture-editor-panel">
              <ImageLinks
                pictured={pictured}
                shown={shown}
                busy={using}
                onUse={(cover) => void change(() => sources.use(cover))}
              />
            </Tabs.Content>
          )}
        </Tabs.Root>
        {using && (
          <p className="picture-editor-note" role="status">
            <CircleNotchIcon weight="bold" className="spin" aria-hidden />{" "}
            {t(kind === "cover" ? "Saving the cover…" : "Saving the photo…")}
          </p>
        )}
        {error !== undefined && (
          <p className="error" role="alert">
            {error.cause instanceof CoverScopeError
              ? t(error.cause.reason)
              : t("Could not save the picture: {{detail}}", {
                  detail: pictureSaveDetail(error.cause, t),
                })}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * A picture from this device, dropped on the panel or chosen, shown before `onUse` uses
 * it; a file that isn't a JPEG, PNG, or WebP image of at most 10 MiB says why.
 */
function UploadPanel({
  kind,
  busy,
  onUse,
}: {
  readonly kind: PictureSources["kind"];
  readonly busy: boolean;
  readonly onUse: (image: File) => void;
}) {
  const t = useWords();
  // The picture chosen, shown from memory until another is chosen or the panel closes.
  const [chosen, setChosen] = useState<{ readonly image: File; readonly url: string }>();
  const shownUrl = useRef<string | undefined>(undefined);
  const show = (image: File | undefined) => {
    if (shownUrl.current !== undefined) {
      URL.revokeObjectURL(shownUrl.current);
    }
    const url = image === undefined ? undefined : URL.createObjectURL(image);
    shownUrl.current = url;
    setChosen(image === undefined || url === undefined ? undefined : { image, url });
  };
  useEffect(
    () => () => {
      if (shownUrl.current !== undefined) {
        URL.revokeObjectURL(shownUrl.current);
      }
    },
    [],
  );
  const [refused, setRefused] = useState("");
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: ACCEPTED,
    maxSize: MAX_PICTURE_BYTES,
    multiple: false,
    disabled: busy,
    // The button below chooses a file, so the panel itself takes no click or key.
    noClick: true,
    noKeyboard: true,
    onDrop: ([image], [rejection]) => {
      setRefused(rejection === undefined ? "" : refusalOf(rejection));
      show(rejection === undefined ? image : undefined);
    },
  });
  return (
    <div {...getRootProps({ className: isDragActive ? "upload-drop dragging" : "upload-drop" })}>
      <input
        {...getInputProps({
          "aria-label": t(kind === "cover" ? "Choose a cover file" : "Choose a photo file"),
        })}
      />
      {chosen === undefined ? (
        <UploadSimpleIcon className="upload-drop-icon" weight="duotone" aria-hidden />
      ) : (
        <img
          className="upload-preview"
          src={chosen.url}
          alt={t(kind === "cover" ? "The cover chosen" : "The photo chosen")}
        />
      )}
      <p className="upload-drop-hint">
        {chosen === undefined
          ? t("Drop a picture here, or choose one: a JPEG, PNG, or WebP image of at most 10 MiB.")
          : chosen.image.name}
      </p>
      {refused !== "" && (
        <p className="error" role="alert">
          {t(refused)}
        </p>
      )}
      <div className="upload-drop-buttons">
        <button
          type="button"
          className={chosen === undefined ? "dialog-button" : "secondary outline dialog-button"}
          disabled={busy}
          onClick={open}
        >
          {t(chosen === undefined ? "Choose a file…" : "Choose another…")}
        </button>
        {chosen !== undefined && (
          <button
            type="button"
            className="dialog-button"
            disabled={busy}
            onClick={() => {
              onUse(chosen.image);
            }}
          >
            {t(kind === "cover" ? "Use this cover" : "Use this photo")}
          </button>
        )}
      </div>
    </div>
  );
}
