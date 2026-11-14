/**
 * @file The list of keyboard shortcuts: each command and its keys, and where to change them.
 *
 * Holding ⌘ (Ctrl off Apple devices) on its own shows the same list for a glance,
 * without taking focus, until the key comes up.
 */

import { useRef } from "react";

import { hrefOf } from "../routes";
import { useHoldForShortcuts } from "../holdForShortcuts";
import { COMMANDS, labelOf, useBindings } from "../shortcuts";
import { HOLD_LABEL, useHeldModifier } from "../useHeldModifier";
import { Modal } from "./Modal";

/** Every command and its keys, in a modal. */
export function ShortcutList({ onClose }: { readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => {
    dialog.current?.close();
  };
  return (
    <Modal
      ref={dialog}
      className="shortcut-list"
      labelledBy="shortcut-list-title"
      onClose={onClose}
    >
      <div className="card">
        <h2 id="shortcut-list-title">Keyboard shortcuts</h2>
        <ShortcutTable />
        <footer className="dialog-buttons">
          <a className="change-keys" href={hrefOf({ view: "settings" })} onClick={close}>
            Change them in Settings
          </a>
          <button type="button" className="dialog-button" onClick={close}>
            Close
          </button>
        </footer>
      </div>
    </Modal>
  );
}

/** The shortcuts while the key is held on its own, unless `blocked`, as by the list's dialog. */
export function HoldForShortcuts({ blocked }: { readonly blocked: boolean }) {
  const on = useHoldForShortcuts();
  const held = useHeldModifier(on && !blocked);
  return held ? <HeldShortcuts /> : null;
}

/** The list for a glance: nothing to press, and focus stays where it was. */
export function HeldShortcuts() {
  return (
    <section
      className="held-shortcuts"
      role="dialog"
      aria-modal="false"
      aria-labelledby="held-shortcuts-title"
    >
      <div className="card">
        <h2 id="held-shortcuts-title">Keyboard shortcuts</h2>
        <ShortcutTable />
        <p className="held-hint">Let go of {HOLD_LABEL} to close.</p>
      </div>
    </section>
  );
}

function ShortcutTable() {
  const bindings = useBindings();
  return (
    <dl className="shortcuts">
      {COMMANDS.map(({ command, name }) => (
        <div key={command} className="shortcut">
          <dt>{name}</dt>
          <dd>
            {bindings[command].length === 0 ? (
              <span className="no-keys">None</span>
            ) : (
              bindings[command].map((keys, index) => (
                <span key={keys}>
                  {index > 0 && <span className="or"> or </span>}
                  <kbd>{labelOf(keys)}</kbd>
                </span>
              ))
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
