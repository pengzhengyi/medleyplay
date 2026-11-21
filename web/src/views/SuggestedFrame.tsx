/**
 * @file A picture suggested as an artist's photo, ringed and tagged as a suggestion, that
 * is its own controls.
 *
 * Its lower two thirds use it; of its top third, the right half dismisses it and the
 * left half opens the photo editor to choose another. Each shows its icon on hover or
 * focus, always on a touch screen, and turns the ring green, red, or solid.
 */

import { CheckIcon, PencilSimpleIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/**
 * The picture `children`, suggested as the photo of `of`, with its three controls; `why`
 * says why it was suggested.
 */
export function SuggestedFrame({
  of,
  why,
  picked,
  className,
  busy = false,
  onUse,
  onDismiss,
  onChange,
  children,
}: {
  /** The artist's name. */
  readonly of: string;
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
    <div className="photo-suggestion-frame">
      <div
        className={
          className === undefined ? "photo-suggestion-art" : `photo-suggestion-art ${className}`
        }
        role="img"
        aria-label={`Suggested photo of ${of}: ${why}`}
        title={why}
      >
        {children}
      </div>
      <div
        className="photo-suggestion-controls"
        role="group"
        aria-label={`Suggested photo of ${of}`}
        aria-busy={busy}
      >
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-change"
          disabled={busy}
          aria-label={`Choose another photo of ${of}…`}
          title="Choose another photo"
          onClick={onChange}
        >
          <PencilSimpleIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-dismiss"
          disabled={busy}
          aria-label={`Dismiss the suggested photo of ${of}`}
          title="Dismiss"
          onClick={onDismiss}
        >
          <XIcon className="photo-suggestion-icon" weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className="photo-suggestion-control photo-suggestion-use"
          disabled={busy}
          aria-label={`Use the suggested photo of ${of}`}
          title="Use this photo"
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
