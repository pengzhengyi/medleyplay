/**
 * @file A dialog's frame shown the moment it is asked for, while its own code loads, so
 * the household sees at once that its press was heard.
 */

import { useId, useLayoutEffect, useRef } from "react";

import { Modal } from "./Modal";

/** The dialog `title`, of the look `className`, saying what it does first: `doing`. */
export function DialogOpening({
  className,
  title,
  doing,
  onClose,
}: {
  readonly className: string;
  readonly title: string;
  readonly doing: string;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Replaced by the dialog itself, the frame closes as it goes; only a person's close counts.
  const shown = useRef(true);
  useLayoutEffect(
    () => () => {
      shown.current = false;
    },
    [],
  );
  return (
    <Modal
      ref={dialog}
      className={className}
      labelledBy={titleId}
      onClose={() => {
        if (shown.current) {
          onClose();
        }
      }}
    >
      <div className="card">
        <h2 id={titleId}>{title}</h2>
        <p className="empty" aria-busy="true">
          {doing}
        </p>
      </div>
    </Modal>
  );
}
