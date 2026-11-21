/**
 * @file A picture suggested as an artist's photo or an album's cover, ringed and tagged as
 * a suggestion, that is its own controls.
 *
 * Its lower half uses it; of its upper half, the right dismisses it and the left opens the
 * picture editor to choose another. Each shows its icon on hover or focus, always on a
 * touch screen, and turns the ring green, red, or solid. A photo is round, a cover square.
 */

import { CheckIcon, PencilSimpleIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

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
  readonly busy?: boolean;
  readonly onUse: () => void;
  readonly onDismiss: () => void;
  readonly onChange: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={
        noun === "cover" ? "photo-suggestion-frame cover-suggestion" : "photo-suggestion-frame"
      }
    >
      <div
        className={
          className === undefined ? "photo-suggestion-art" : `photo-suggestion-art ${className}`
        }
        role="img"
        aria-label={`Suggested ${noun} of ${of}: ${why}`}
        title={why}
      >
        {children}
      </div>
      <div
        className="photo-suggestion-controls"
        role="group"
        aria-label={`Suggested ${noun} of ${of}`}
        aria-busy={busy}
      >
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-change"
          disabled={busy}
          aria-label={`Choose another ${noun} of ${of}…`}
          title={`Choose another ${noun}`}
          onClick={onChange}
        >
          <PencilSimpleIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-dismiss"
          disabled={busy}
          aria-label={`Dismiss the suggested ${noun} of ${of}`}
          title="Dismiss"
          onClick={onDismiss}
        >
          <XIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-use"
          disabled={busy}
          aria-label={`Use the suggested ${noun} of ${of}`}
          title={`Use this ${noun}`}
          onClick={onUse}
        >
          <CheckIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
      </div>
      <span className="photo-suggestion-tag" aria-hidden>
        {picked ? (
          <>
            <SparkleIcon weight="fill" /> AI pick
          </>
        ) : (
          "Suggested"
        )}
      </span>
    </div>
  );
}
