/**
 * @file Adding a site Track's audio file by hand, when medleyplay can't download it.
 *
 * It says why the Download failed, lists other ways to get the file, and uploads the
 * file chosen, showing how far it has got. Escape, Cancel, or a click outside close it;
 * while the file is going up, Cancel stops the upload.
 */

import { UploadSimpleIcon } from "@phosphor-icons/react";
import { type SubmitEvent, useEffect, useEffectEvent, useRef, useState } from "react";

import type { Track, TrackDownload } from "../api";
import { formatBytes } from "../format";
import { Modal } from "./Modal";
import { OtherWays } from "./OtherWays";

/** The types of file the server takes, for the file picker. */
const ACCEPTED = ".m4a,.mp4,.mp3,.flac,.ogg,.oga,.opus,.wav,.aif,.aifc,.aiff";

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
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<TrackDownload | undefined>(undefined);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [progress, setProgress] = useState<Sent | undefined>(undefined);
  const [error, setError] = useState("");
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
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [track.id]);

  const close = () => {
    stopping.current?.abort();
    dialog.current?.close();
  };
  const send = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (file === undefined) {
      return;
    }
    const controller = new AbortController();
    stopping.current = controller;
    setError("");
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
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      setProgress(undefined);
    }
  };
  const percent = progress === undefined ? 0 : Math.floor((progress.sent / progress.total) * 100);

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
        <h2 id="add-file-title">Add the file for “{track.title}”</h2>
        {state?.status === "failed" && (
          <p className="add-file-why" role="status">
            The download failed: {state.message}
          </p>
        )}
        {state?.status === "unavailable" && (
          <p className="add-file-why" role="status">
            {state.message}
          </p>
        )}
        {state?.status === "downloaded" && state.backend === "manual" && (
          <p className="add-file-why" role="status">
            This Track has a file you added. Adding another replaces it.
          </p>
        )}
        <p className="add-file-explain">
          Choose an audio file for this Track. It replaces any file it has, and stops its download.
        </p>
        <label className="file-picker">
          File
          <input
            type="file"
            className="file-input"
            accept={ACCEPTED}
            disabled={uploading}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0]);
              setError("");
            }}
          />
        </label>
        {progress !== undefined && (
          <div className="upload-progress">
            <progress max={progress.total} value={progress.sent} aria-label="Upload progress" />
            <span>
              {percent}% of {formatBytes(progress.total)}
            </span>
          </div>
        )}
        {state !== undefined && <OtherWays kind={state.kind} link={state.link} open />}
        {error !== "" && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-buttons">
          <button type="button" className="secondary outline dialog-button" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button"
            disabled={file === undefined || uploading}
            aria-busy={uploading}
          >
            <UploadSimpleIcon weight="bold" aria-hidden />
            Add
          </button>
        </footer>
      </form>
    </Modal>
  );
}
