/**
 * @file Where files are kept: the folder's path, to copy, and *Show in Finder* for an
 * admin on the Mac the server runs on, since Finder opens on that Mac's screen.
 */

import { CheckIcon, CopyIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { type StorageFolder, type StorageFolderScope, api } from "../api";
import { copyText } from "../clipboard";

export function StorageFolderLocation({
  scope = "downloads",
}: {
  readonly scope?: StorageFolderScope;
}) {
  const [folder, setFolder] = useState<StorageFolder>();
  const [copied, setCopied] = useState<"yes" | "no">();
  const [showing, setShowing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api.storageFolder(scope).then(
      (read) => {
        if (current) {
          setFolder(read);
        }
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [scope]);
  if (folder === undefined) {
    return null;
  }
  return (
    <div className="storage-folder">
      <span>Kept in</span>
      <code className="storage-folder-path">{folder.path}</code>
      <button
        type="button"
        className="icon"
        aria-label={scope === "server" ? "Copy the server storage path" : "Copy the folder's path"}
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
          className="text storage-folder-show"
          aria-label={scope === "server" ? "Show server storage in Finder" : undefined}
          disabled={showing}
          aria-busy={showing}
          onClick={() => {
            setShowing(true);
            setError("");
            api.showStorageFolder(scope).then(
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
