/**
 * @file A modal: a card over a dimmed page, open while it is on the page.
 *
 * A native modal `<dialog>`, so focus stays in it and the page behind is inert.
 * The ✕ at its top right, Escape, or a click outside the card closes it, unless it is
 * `locked`; so does `ref.current.close()`. Its own buttons are only what it does.
 */

import { XIcon } from "@phosphor-icons/react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";

/**
 * A modal named by the element `labelledBy`, and described by `describedBy`; the
 * caller keeps `ref` to close it. While `locked`, as during a save, only the caller closes it.
 */
export function Modal({
  ref,
  className,
  labelledBy,
  describedBy,
  locked = false,
  onClose,
  children,
}: {
  readonly ref: RefObject<HTMLDialogElement | null>;
  readonly className: string;
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly locked?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  // Whether the press began on the backdrop, so a drag out of a box doesn't close it.
  const pressedOutside = useRef(false);
  const closer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    // Opening focuses the first control, which is the ✕ while the content has none yet.
    if (document.activeElement === closer.current) {
      element?.focus();
    }
    return () => {
      element?.close();
    };
  }, [ref]);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Focusable itself, so opening can focus it rather than the ✕.
      tabIndex={-1}
      onClose={onClose}
      onCancel={(event) => {
        // A close request that isn't a key, such as Android's Back button.
        if (locked) {
          event.preventDefault();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!locked) {
            event.currentTarget.close();
          }
        }
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself, outside its card.
        if (event.target === event.currentTarget && pressedOutside.current && !locked) {
          event.currentTarget.close();
        }
      }}
    >
      {/* The card's frame, so the ✕ sits at the card's corner, not the page's. */}
      <div className="modal-frame">
        {children}
        {/* Last, so opening focuses the dialog's own first field rather than this. */}
        <button
          ref={closer}
          type="button"
          className="modal-close"
          aria-label="Close"
          title="Close (Esc)"
          disabled={locked}
          onClick={() => ref.current?.close()}
        >
          <XIcon weight="bold" aria-hidden />
        </button>
      </div>
    </dialog>
  );
}
