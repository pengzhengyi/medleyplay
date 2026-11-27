/**
 * @file A cover or a photo, with its tools shown at its foot on hover or focus.
 *
 * As a profile picture's are: save the image, replace it in the picture editor, and
 * remove the household's own. A touch screen always shows them.
 */

import {
  CircleNotchIcon,
  DownloadSimpleIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useWords } from "../locale";

/**
 * The picture `children` in a frame: `save` downloads it, `onReplace` opens the editor,
 * and `onRemove`, when given, drops the household's own; `saving` names what is being
 * saved while it is.
 */
export function PictureFrame({
  className,
  replaceLabel,
  save,
  removeLabel = "",
  busy = false,
  saving,
  onReplace,
  onRemove,
  children,
}: {
  readonly className?: string;
  /** What replacing does, as *Replace the cover*. */
  readonly replaceLabel: string;
  /** The image to save and the name it is saved as, when there is one. */
  readonly save?: { readonly href: string; readonly name: string } | undefined;
  readonly removeLabel?: string;
  readonly busy?: boolean;
  readonly saving?: string | undefined;
  readonly onReplace: () => void;
  readonly onRemove?: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const t = useWords();
  return (
    <div className={className === undefined ? "cover-frame" : `cover-frame ${className}`}>
      {children}
      <div className="cover-tools">
        {save !== undefined && (
          <a
            className="cover-tool"
            href={save.href}
            download={save.name}
            aria-label={t("Save the image")}
            title={t("Save image")}
          >
            <DownloadSimpleIcon weight="bold" aria-hidden />
          </a>
        )}
        <button
          type="button"
          className="cover-tool"
          disabled={busy}
          aria-label={t("{{action}}…", { action: t(replaceLabel) })}
          title={t(replaceLabel)}
          onClick={onReplace}
        >
          <UploadSimpleIcon weight="bold" aria-hidden />
        </button>
        {onRemove !== undefined && (
          <button
            type="button"
            className="cover-tool"
            disabled={busy}
            aria-label={t(removeLabel)}
            title={t(removeLabel)}
            onClick={onRemove}
          >
            <TrashIcon weight="bold" aria-hidden />
          </button>
        )}
      </div>
      {saving !== undefined && (
        <span className="cover-saving" role="status" aria-label={t(saving)}>
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
        </span>
      )}
    </div>
  );
}
