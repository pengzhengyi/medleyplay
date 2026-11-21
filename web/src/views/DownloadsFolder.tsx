/**
 * @file Where the Downloads are kept: the folder's path, to copy, and *Show in Finder* for an
 * admin on the Mac the server runs on, since Finder opens on that Mac's screen.
 */

import { CheckIcon, CopyIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { type StorageFolder, api } from "../api";
import { copyText } from "../clipboard";

/** The Downloads folder's path, a way to copy it, and Finder to show it where allowed. */
export function DownloadsFolder() {
  const [folder, setFolder] = useState<StorageFolder>();
  const [copied, setCopied] = useState<"yes" | "no">();
  const [showing, setShowing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api.storageFolder().then(
      (read) => {
        if (current) {
          setFolder(read);
        }
      },
      // Without its path, the line stays away; the Downloads show all the same.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  if (folder === undefined) {
    return null;
  }
  return (
    <div className="downloads-folder">
      <span className="downloads-folder-label">Kept in</span>
      <code className="downloads-folder-path">{folder.path}</code>
      <button
        type="button"
        className="icon"
        aria-label="Copy the folder's path"
        title="Copy the folder's path"
        onClick={() => {
          void copyText(folder.path).then((worked) => {
            setCopied(worked ? "yes" : "no");
          });
        }}
      >
        {copied === "yes" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      </button>
      {folder.can_show && (
        <button
          type="button"
          className="text downloads-folder-show"
          disabled={showing}
          aria-busy={showing}
          onClick={() => {
            setShowing(true);
            setError("");
            api.showStorageFolder().then(
              () => {
                setShowing(false);
              },
              (failure: unknown) => {
                setShowing(false);
                setError(failure instanceof Error ? failure.message : String(failure));
              },
            );
          }}
        >
          <FolderOpenIcon aria-hidden />
          Show in Finder
        </button>
      )}
      <span className="listen-copied" role="status">
        {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't copy" : ""}
      </span>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
