/**
 * @file Adding a site Track's audio file by hand, when medleyplay can't download it.
 *
 * It says why the Download failed, lists other ways to get the file, and uploads the
 * file chosen, showing how far it has got. Escape, its ✕, or a click outside close it;
 * while the file is going up, *Stop* beside its progress stops the upload.
 */

import { UploadSimpleIcon } from "@phosphor-icons/react";
import { type SubmitEvent, useEffect, useEffectEvent, useRef, useState } from "react";

import { ApiError, type Track, type TrackDownload } from "../api";
import { formatBytes } from "../format";
import { downloadFailureOf } from "../library/downloading";
import { type Words, useFormattingLocale, useWords } from "../locale";
import { Modal } from "./Modal";
import { OtherWays } from "./OtherWays";

/** The types of file the server takes, for the file picker. */
const ACCEPTED = ".m4a,.mp4,.mp3,.flac,.ogg,.oga,.opus,.wav,.aif,.aifc,.aiff";
const INVALID_UPLOAD = new Set([
  "The file is empty.",
  "medleyplay can't read this file as audio with a length.",
]);

function uploadError(failure: unknown, t: Words): string {
  const detail = failure instanceof Error ? failure.message : String(failure);
  if (failure instanceof ApiError) {
    if (
      (failure.status === 422 && INVALID_UPLOAD.has(detail)) ||
      (failure.status === 409 &&
        detail === "Retry the joined album download instead of uploading one part.")
    )
      return t(detail);
    if (failure.status === 413) {
      const maximum = /^The file is larger than the ([\d,]+) bytes medleyplay accepts\.$/u.exec(
        detail,
      )?.[1];
      if (maximum !== undefined)
        return t("The file is larger than the {{maximum}} bytes medleyplay accepts.", { maximum });
    }
  }
  return t("Could not add the audio file: {{detail}}", { detail });
}

/** How far an upload has got, in bytes. */
interface Sent {
  readonly sent: number;
  readonly total: number;
}

/**
 * Add the file of `track`: `load` says where its Download stands, and `upload` sends the
 * file, reporting progress and stopping when `signal` aborts; `onAdded` hears it is kept.
 */
export function AddFile({
  track,
  load,
  upload,
  onAdded,
  onClose,
}: {
  readonly track: Track;
  readonly load: (trackId: number) => Promise<TrackDownload>;
  readonly upload: (
    trackId: number,
    file: File,
    onProgress: (sent: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly onAdded: () => void;
  readonly onClose: () => void;
}) {
  const t = useWords();
  const locale = useFormattingLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<TrackDownload | undefined>(undefined);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [progress, setProgress] = useState<Sent | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<{ cause: unknown }>();
  const stopping = useRef<AbortController | undefined>(undefined);
  const uploading = progress !== undefined;

  const loadState = useEffectEvent(load);
  useEffect(() => {
    let current = true;
    loadState(track.id).then(
      (loaded) => {
        if (current) {
          setState(loaded);
        }
      },
      (failure: unknown) => {
        if (current) {
          setLoadError(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [track.id]);

  const send = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (file === undefined || uploading) {
      return;
    }
    const controller = new AbortController();
    stopping.current = controller;
    setFailure(undefined);
    setProgress({ sent: 0, total: file.size });
    try {
      await upload(
        track.id,
        file,
        (sent, total) => {
          setProgress({ sent, total });
        },
        controller.signal,
      );
      onAdded();
      dialog.current?.close();
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        setFailure({ cause: failure });
      }
      setProgress(undefined);
    }
  };
  const percent =
    progress === undefined || progress.total === 0
      ? 0
      : Math.floor((progress.sent / progress.total) * 100);
  const progressText =
    progress === undefined
      ? ""
      : t("{{percent}} of {{size}}", {
          percent: new Intl.NumberFormat(locale, { style: "percent" }).format(percent / 100),
          size: formatBytes(progress.total, t),
        });

  return (
    <Modal
      ref={dialog}
      className="add-file"
      labelledBy="add-file-title"
      locked={uploading}
      onClose={() => {
        stopping.current?.abort();
        onClose();
      }}
    >
      <form className="card" onSubmit={(event) => void send(event)}>
        <h2 id="add-file-title">{t("Add the file for “{{title}}”", { title: track.title })}</h2>
        {state?.status === "failed" && (
          <p className="add-file-why" role="status">
            {t("The download failed: {{detail}}", { detail: downloadFailureOf(state.message, t) })}
          </p>
        )}
        {state?.status === "unavailable" && (
          <p className="add-file-why" role="status">
            {downloadFailureOf(state.message, t)}
          </p>
        )}
        {state?.status === "downloaded" && state.backend === "manual" && (
          <p className="add-file-why" role="status">
            {t("This Track has a file you added. Adding another replaces it.")}
          </p>
        )}
        <p className="add-file-explain">
          {t(
            "Choose an audio file for this Track. It replaces any file it has, and stops its download.",
          )}
        </p>
        <label className="file-picker">
          {t("File")}
          <input
            type="file"
            className="file-input"
            accept={ACCEPTED}
            disabled={uploading}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0]);
              setFailure(undefined);
            }}
          />
        </label>
        {progress !== undefined && (
          <div className="upload-progress">
            <progress
              max={Math.max(1, progress.total)}
              value={progress.sent}
              aria-label={t("Upload progress")}
              aria-valuetext={progressText}
            />
            <span>{progressText}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                stopping.current?.abort();
              }}
            >
              {t("Stop")}
            </button>
          </div>
        )}
        {state !== undefined && <OtherWays kind={state.kind} link={state.link} open />}
        {loadError !== undefined && failure === undefined && (
          <p className="hint" role="status">
            {t("Could not read the download status. You can still add an audio file. {{detail}}", {
              detail: loadError,
            })}
          </p>
        )}
        {failure !== undefined && (
          <p className="error" role="alert">
            {uploadError(failure.cause, t)}
          </p>
        )}
        <footer className="dialog-buttons">
          <button
            type="submit"
            className="dialog-button"
            disabled={file === undefined || uploading}
            aria-busy={uploading}
          >
            <UploadSimpleIcon weight="bold" aria-hidden />
            {t("Add")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
