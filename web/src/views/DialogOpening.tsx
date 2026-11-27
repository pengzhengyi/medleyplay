/**
 * @file A dialog's frame shown the moment it is asked for, while its own code loads, so
 * the household sees at once that its press was heard; if the code fails to load, the
 * frame says so.
 */

import { type ReactNode, useId, useLayoutEffect, useRef } from "react";

import { useWords } from "../locale";
import { Modal } from "./Modal";

/** The dialog `title`, of the look `className`, showing `children`: what it does first. */
export function DialogOpening({
  className,
  title,
  children,
  onClose,
}: {
  readonly className: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const t = useWords();
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
        <h2 id={titleId}>{t(title)}</h2>
        {children}
      </div>
    </Modal>
  );
}
