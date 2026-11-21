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
  SparkleIcon,
  UploadSimpleIcon,
  UserSquareIcon,
} from "@phosphor-icons/react";
import * as Tabs from "@radix-ui/react-tabs";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type FileRejection, useDropzone } from "react-dropzone";

import type { Pictured } from "../api";
import { ArtistPictureFinder } from "./ArtistPictureFinder";
import { CoverFinder } from "./CoverFinder";
import { ImageLinks } from "./ImageLinks";
import { Modal } from "./Modal";

/** The most bytes a picture uploaded may hold, as the server allows. */
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

/** The kinds of image the server keeps. */
const ACCEPTED = { "image/jpeg": [], "image/png": [], "image/webp": [] };

/** The album a cover may be looked up for: its name and its album artist, or else its artist. */
export interface CoverAlbum {
  readonly album: string;
  readonly artist: string;
}

/** What the picture is, and the ways to replace it. */
export interface PictureSources {
  /** A cover, of a song or an album, or an artist's photo, which MusicBrainz has none of. */
  readonly kind: "cover" | "photo";
  /** What it is of, as a song's title or an artist's name. */
  readonly of: string;
  /** The picture shown now, if any. */
  readonly shown: string | null | undefined;
  /** The album to look up, for a cover; none for a song on no album. */
  readonly album?: CoverAlbum | undefined;
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

/** Say why a dropped or chosen file can't be used. */
function refusalOf(rejection: FileRejection): string {
  return rejection.errors.some((error) => error.code === "file-too-large")
    ? "A picture is at most 10 MiB."
    : "Choose a JPEG, PNG, or WebP image.";
}

/**
 * The editor that replaces the picture `sources` describe, open on the tab `startOn`, closed
 * by `onClose`.
 */
export function PictureEditor({
  sources,
  startOn = "upload",
  onClose,
}: {
  readonly sources: PictureSources;
  readonly startOn?: "upload" | "musicbrainz" | "deezer" | "ai";
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [using, setUsing] = useState(false);
  const [error, setError] = useState("");
  const { kind, of, shown, album, artistId, pictured } = sources;
  const noun = kind === "cover" ? "cover" : "photo";

  /** Make the change `change` makes, and close once it is made. */
  const change = async (made: () => Promise<void>) => {
    setUsing(true);
    setError("");
    try {
      await made();
      dialog.current?.close();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setUsing(false);
    }
  };

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
      describedBy={`${id}-of`}
      locked={using}
      onClose={onClose}
    >
      <div className="card">
        <h2 id={`${id}-title`}>{shown ? `Replace the ${noun}` : `Add a ${noun}`}</h2>
        <p id={`${id}-of`} className="picture-editor-of">
          {of}
        </p>
        {/* A tab is chosen, not merely focused: opening the dialog focuses its first tab, and
            some tabs ask a site or an AI model as soon as they show. */}
        <Tabs.Root
          className="picture-editor-tabs"
          defaultValue={startOn}
          orientation="vertical"
          activationMode="manual"
        >
          <Tabs.List className="picture-editor-sources" aria-label={`Where the ${noun} comes from`}>
            {tabs.map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="picture-editor-source"
                disabled={tab.why !== undefined}
                title={tab.why}
              >
                {tab.icon} {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="upload" className="picture-editor-panel">
            <UploadPanel
              noun={noun}
              busy={using}
              onUse={(image) => void change(() => sources.upload(image))}
            />
          </Tabs.Content>
          {album !== undefined && (
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
            <CircleNotchIcon weight="bold" className="spin" aria-hidden /> Saving the {noun}…
          </p>
        )}
        {error !== "" && (
          <p className="error" role="alert">
            {error}
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
  noun,
  busy,
  onUse,
}: {
  readonly noun: string;
  readonly busy: boolean;
  readonly onUse: (image: File) => void;
}) {
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
    onDropAccepted: ([image]) => {
      setRefused("");
      show(image);
    },
    onDropRejected: ([rejection]) => {
      show(undefined);
      setRefused(rejection === undefined ? "" : refusalOf(rejection));
    },
  });
  return (
    <div {...getRootProps({ className: isDragActive ? "upload-drop dragging" : "upload-drop" })}>
      <input {...getInputProps({ "aria-label": `Choose a ${noun} file` })} />
      {chosen === undefined ? (
        <UploadSimpleIcon className="upload-drop-icon" weight="duotone" aria-hidden />
      ) : (
        <img className="upload-preview" src={chosen.url} alt={`The ${noun} chosen`} />
      )}
      <p className="upload-drop-hint">
        {chosen === undefined
          ? "Drop a picture here, or choose one: a JPEG, PNG, or WebP image of at most 10 MiB."
          : chosen.image.name}
      </p>
      {refused !== "" && (
        <p className="error" role="alert">
          {refused}
        </p>
      )}
      <div className="upload-drop-buttons">
        <button
          type="button"
          className={chosen === undefined ? "dialog-button" : "secondary outline dialog-button"}
          disabled={busy}
          onClick={open}
        >
          {chosen === undefined ? "Choose a file…" : "Choose another…"}
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
            Use this {noun}
          </button>
        )}
      </div>
    </div>
  );
}
