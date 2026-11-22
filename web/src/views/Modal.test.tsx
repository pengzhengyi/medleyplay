import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";

function Open({
  locked = false,
  onClose,
}: {
  readonly locked?: boolean;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <Modal ref={ref} className="test" labelledBy="test-title" locked={locked} onClose={onClose}>
      <div className="card">
        <h2 id="test-title">Pick one</h2>
        <input aria-label="Name" />
      </div>
    </Modal>
  );
}

function renderModal(locked = false) {
  const onClose = vi.fn();
  render(<Open locked={locked} onClose={onClose} />);
  return { dialog: screen.getByRole("dialog", { name: "Pick one" }), onClose };
}

/**
 * Ask `dialog` to close as a browser does for a close request that isn't the Escape
 * key, such as Android's Back button: a `cancel` event, then closing unless it was cancelled.
 */
function requestClose(dialog: HTMLElement) {
  if (fireEvent(dialog, new Event("cancel", { cancelable: true }))) {
    (dialog as HTMLDialogElement).close();
  }
}

describe("a modal", () => {
  it("closes from the ✕ at its top right", async () => {
    const { dialog, onClose } = renderModal();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(dialog).not.toHaveAttribute("open");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers no ✕ to press while locked", () => {
    renderModal(true);

    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("focuses itself on opening while it has no field yet, not the ✕", () => {
    const onClose = vi.fn();
    function Empty() {
      const ref = useRef<HTMLDialogElement>(null);
      return (
        <Modal ref={ref} className="test" labelledBy="empty-title" onClose={onClose}>
          <div className="card">
            <h2 id="empty-title">Loading</h2>
          </div>
        </Modal>
      );
    }
    render(<Empty />);

    expect(screen.getByRole("dialog", { name: "Loading" })).toHaveFocus();
  });

  it("focuses its own first field on opening, not the ✕", () => {
    renderModal();

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("closes on a close request such as the Back button", () => {
    const { dialog, onClose } = renderModal();

    requestClose(dialog);

    expect(dialog).not.toHaveAttribute("open");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open on a close request while locked", () => {
    const { dialog, onClose } = renderModal(true);

    requestClose(dialog);

    expect(dialog).toHaveAttribute("open");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a click outside its card", async () => {
    const { dialog, onClose } = renderModal();

    await userEvent.click(dialog);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open when a press in its card is released outside it", async () => {
    const { dialog, onClose } = renderModal();

    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: screen.getByRole("textbox", { name: "Name" }) },
      { target: dialog },
      { keys: "[/MouseLeft]", target: dialog },
    ]);

    expect(dialog).toHaveAttribute("open");
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * A modal with a second one open inside it, as Edit details opens the cover editor:
 * "Edit details" holds "Change the cover". The outer one is `locked` when asked.
 */
function renderNested(outerLocked = false) {
  const onOuterClose = vi.fn();
  const onInnerClose = vi.fn();
  function Nested() {
    const outer = useRef<HTMLDialogElement>(null);
    const inner = useRef<HTMLDialogElement>(null);
    return (
      <Modal
        ref={outer}
        className="outer"
        labelledBy="outer-title"
        locked={outerLocked}
        onClose={onOuterClose}
      >
        <div className="card">
          <h2 id="outer-title">Edit details</h2>
          <Modal ref={inner} className="inner" labelledBy="inner-title" onClose={onInnerClose}>
            <div className="card">
              <h2 id="inner-title">Change the cover</h2>
              <input aria-label="Link" />
            </div>
          </Modal>
        </div>
      </Modal>
    );
  }
  render(<Nested />);
  return {
    outer: screen.getByRole("dialog", { name: "Edit details" }),
    inner: screen.getByRole("dialog", { name: "Change the cover" }),
    onOuterClose,
    onInnerClose,
  };
}

describe("a modal opened inside another", () => {
  it("closing it leaves the one it was opened from open", async () => {
    const { outer, inner, onOuterClose, onInnerClose } = renderNested();

    await userEvent.click(within(inner).getByRole("button", { name: "Close" }));

    expect(inner).not.toHaveAttribute("open");
    expect(onInnerClose).toHaveBeenCalledOnce();
    expect(outer).toHaveAttribute("open");
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it("Escape closes only it", async () => {
    const { outer, inner, onOuterClose, onInnerClose } = renderNested();

    await userEvent.type(within(inner).getByRole("textbox", { name: "Link" }), "{Escape}");

    expect(onInnerClose).toHaveBeenCalledOnce();
    expect(outer).toHaveAttribute("open");
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it("closes on a close request while the one it was opened from is locked", () => {
    const { outer, inner, onOuterClose, onInnerClose } = renderNested(true);

    requestClose(inner);

    expect(inner).not.toHaveAttribute("open");
    expect(onInnerClose).toHaveBeenCalledOnce();
    expect(outer).toHaveAttribute("open");
    expect(onOuterClose).not.toHaveBeenCalled();
  });
});
