/**
 * @file Where files are kept: the folder's path, to copy, and *Show in Finder* for an
 * admin on the Mac the server runs on, since Finder opens on that Mac's screen.
 */

import { CheckIcon, CopyIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { ApiError, type StorageFolder, type StorageFolderScope, api } from "../api";
import { copyText } from "../clipboard";
import { type Words, useWords } from "../locale";

export function StorageFolderLocation({
  scope = "downloads",
}: {
  readonly scope?: StorageFolderScope;
}) {
  const t = useWords();
  const [folder, setFolder] = useState<StorageFolder>();
  const [copied, setCopied] = useState<"yes" | "no">();
  const [showing, setShowing] = useState(false);
  const [failure, setFailure] = useState<{ readonly cause: unknown }>();
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
  const error = failure === undefined ? "" : showFolderError(failure.cause, scope, t);
  return (
    <div className="storage-folder">
      <span>{t("Kept in")}</span>
      <code className="storage-folder-path">{folder.path}</code>
      <button
        type="button"
        className="icon"
        aria-label={t(
          scope === "server" ? "Copy the server storage path" : "Copy the folder's path",
        )}
        title={t("Copy the folder's path")}
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
          aria-label={scope === "server" ? t("Show server storage in Finder") : undefined}
          disabled={showing}
          aria-busy={showing}
          onClick={() => {
            setShowing(true);
            setFailure(undefined);
            api.showStorageFolder(scope).then(
              () => {
                setShowing(false);
              },
              (failure: unknown) => {
                setShowing(false);
                setFailure({ cause: failure });
              },
            );
          }}
        >
          <FolderOpenIcon aria-hidden />
          {t("Show in Finder")}
        </button>
      )}
      <span className="listen-copied" role="status">
        {copied === "yes" ? t("Copied") : copied === "no" ? t("Couldn't copy") : ""}
      </span>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function showFolderError(failure: unknown, scope: StorageFolderScope, t: Words): string {
  const detail = failure instanceof Error ? failure.message : String(failure);
  const name = scope === "server" ? "server storage folder" : "Downloads folder";
  if (failure instanceof ApiError) {
    if (failure.status === 403 && detail === `Only an admin may show the ${name}.`) {
      return t("Only an admin may show the {{folder}}.", { folder: t(name) });
    }
    if (failure.status === 409) {
      if (detail === `Show the ${name} in Finder only on the Mac medleyplay runs on.`) {
        return t("Show the {{folder}} in Finder only on the Mac medleyplay runs on.", {
          folder: t(name),
        });
      }
      if (detail === `Finder could not show the ${name}.`) {
        return t("Finder could not show the {{folder}}.", { folder: t(name) });
      }
    }
  }
  return detail;
}
