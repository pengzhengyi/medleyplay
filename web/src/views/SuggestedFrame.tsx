/**
 * @file A picture suggested as an artist's photo or an album's cover, ringed and tagged as
 * a suggestion, that is its own controls.
 *
 * Its lower half uses it; of its upper half, the right dismisses it and the left opens the
 * picture editor to choose another. Each shows its icon on hover or focus, always on a
 * touch screen, and turns the ring green, red, or solid. A photo is round, a cover square.
 * While a choice made on it is saved, it is faded, tagged *Saving…*, and takes no input.
 */

import {
  CheckIcon,
  CircleNotchIcon,
  PencilSimpleIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useWords } from "../locale";

/**
 * The picture `children`, suggested as the photo or cover, `noun`, of `of`, with its three
 * controls; `why` says why it was suggested.
 */
export function SuggestedFrame({
  of,
  noun = "photo",
  why,
  picked,
  className,
  busy = false,
  onUse,
  onDismiss,
  onChange,
  children,
}: {
  /** The artist's or album's name. */
  readonly of: string;
  readonly noun?: "photo" | "cover";
  readonly why: string;
  /** Whether an AI model picked it, tagged *AI pick* rather than *Suggested*. */
  readonly picked: boolean;
  /** The class of the ring around the picture, which sets its size. */
  readonly className?: string;
  /** Whether a choice made on it, to use or dismiss it, is being saved. */
  readonly busy?: boolean;
  readonly onUse: () => void;
  readonly onDismiss: () => void;
  readonly onChange: () => void;
  readonly children: ReactNode;
}) {
  const t = useWords();
  const cover = noun === "cover";
  const reason = t(why);
  return (
    <div
      className={[
        "photo-suggestion-frame",
        noun === "cover" && "cover-suggestion",
        busy && "photo-suggestion-saving",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={
          className === undefined ? "photo-suggestion-art" : `photo-suggestion-art ${className}`
        }
        role="img"
        aria-label={t(
          cover
            ? "Suggested cover of {{name}}: {{reason}}"
            : "Suggested photo of {{name}}: {{reason}}",
          { name: of, reason },
        )}
        title={reason}
      >
        {children}
      </div>
      <div
        className="photo-suggestion-controls"
        role="group"
        aria-label={t(cover ? "Suggested cover of {{name}}" : "Suggested photo of {{name}}", {
          name: of,
        })}
        aria-busy={busy}
      >
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-change"
          disabled={busy}
          aria-label={t(
            cover ? "Choose another cover of {{name}}…" : "Choose another photo of {{name}}…",
            { name: of },
          )}
          title={t(cover ? "Choose another cover" : "Choose another photo")}
          onClick={onChange}
        >
          <PencilSimpleIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-dismiss"
          disabled={busy}
          aria-label={t(
            cover
              ? "Dismiss the suggested cover of {{name}}"
              : "Dismiss the suggested photo of {{name}}",
            { name: of },
          )}
          title={t("Dismiss")}
          onClick={onDismiss}
        >
          <XIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-use"
          disabled={busy}
          aria-label={t(
            cover ? "Use the suggested cover of {{name}}" : "Use the suggested photo of {{name}}",
            { name: of },
          )}
          title={t(cover ? "Use this cover" : "Use this photo")}
          onClick={onUse}
        >
          <CheckIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
      </div>
      <span className="photo-suggestion-tag" aria-hidden={!busy}>
        {busy ? (
          <>
            <CircleNotchIcon weight="bold" className="spin" aria-hidden /> {t("Saving…")}
          </>
        ) : picked ? (
          <>
            <SparkleIcon weight="fill" aria-hidden /> {t("AI pick")}
          </>
        ) : (
          t("Suggested")
        )}
      </span>
    </div>
  );
}
