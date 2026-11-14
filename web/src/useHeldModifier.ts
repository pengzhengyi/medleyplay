/**
 * @file Whether ⌘ (Ctrl off Apple devices) is being held on its own, to glance at the shortcuts.
 *
 * The key counts as held once it has been down alone for `HOLD_MS`, and until it
 * comes up. A quick press never counts, and neither does a shortcut made with it,
 * such as ⌘K: any other key while it is down cancels it until it comes up. It
 * doesn't count while typing in a text box, and lets go when the window loses focus
 * or the page is hidden, so it can't stay held after switching apps with the key.
 */

import { useEffect, useState } from "react";

/** How long the key stays down alone before it counts as held. */
export const HOLD_MS = 1000;

const APPLE = /Mac|iPhone|iPad/.test(navigator.platform);

/** The key to hold: `Meta` (⌘) on Apple devices, `Control` elsewhere. */
export const HOLD_KEY = APPLE ? "Meta" : "Control";

/** The key's label: ⌘, or Ctrl. */
export const HOLD_LABEL = APPLE ? "⌘" : "Ctrl";

/** Whether the key is held on its own now; never while `enabled` is false. */
export function useHeldModifier(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Set from a press of another key with ours down, until ours comes up.
    let chord = false;
    const letGo = () => {
      clearTimeout(timer);
      timer = undefined;
      setHeld(false);
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.key !== HOLD_KEY) {
        if (timer !== undefined || event.getModifierState(HOLD_KEY)) {
          chord = true;
          letGo();
        }
        return;
      }
      if (event.repeat || timer !== undefined || chord || typing()) {
        return;
      }
      timer = setTimeout(() => {
        setHeld(true);
      }, HOLD_MS);
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === HOLD_KEY) {
        chord = false;
        letGo();
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        chord = false;
        letGo();
      }
    };
    const onBlur = () => {
      chord = false;
      letGo();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
      setHeld(false);
    };
  }, [enabled]);
  return held;
}

/** Whether focus is in something typed into, where the key belongs to the typing. */
function typing(): boolean {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) {
    return false;
  }
  if (focused.isContentEditable || focused instanceof HTMLTextAreaElement) {
    return true;
  }
  return (
    focused instanceof HTMLInputElement &&
    !["button", "checkbox", "radio", "range", "reset", "submit", "color", "file"].includes(
      focused.type,
    )
  );
}
