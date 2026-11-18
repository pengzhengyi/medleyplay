/**
 * @file Asking the AI again about a Track it was asked about in the last 24 hours.
 *
 * The server refuses that unless someone chooses it, since another request costs the
 * household's AI provider and likely brings the same answer; this modal says so, and
 * asks only once someone agrees.
 */

import { useId, useRef } from "react";

import { Modal } from "./Modal";

/** Ask whether to ask the AI again about `title`, calling `onAsk` once someone agrees. */
export function AskAiAgain({
  title,
  onAsk,
  onClose,
}: {
  readonly title: string;
  readonly onAsk: () => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const close = () => {
    ref.current?.close();
  };
  return (
    <Modal
      ref={ref}
      className="ask-ai-again"
      labelledBy={`${id}-title`}
      describedBy={`${id}-why`}
      onClose={onClose}
    >
      <div className="card">
        <h2 id={`${id}-title`}>Ask the AI again?</h2>
        <p id={`${id}-why`}>
          The AI was asked about “{title}” in the last 24 hours. Asking again sends your AI provider
          another request, which may cost money, and it will likely answer the same.
        </p>
        <footer className="dialog-buttons">
          <button
            type="button"
            className="dialog-button"
            onClick={() => {
              onAsk();
              close();
            }}
          >
            Ask again
          </button>
        </footer>
      </div>
    </Modal>
  );
}
