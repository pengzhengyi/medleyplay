/**
 * @file A control's tooltip: what it does, and its keyboard shortcut as key caps.
 *
 * ```text
 * ┌──────────────────────┐
 * │ Next album  ⌥ ⇧ →    │
 * └──────────┬───────────┘
 *            ▾
 *        [ ⏭ ]
 * ```
 *
 * It shows after a short hover or when the control is reached with the keyboard, and
 * Escape hides it; a text box's shows on hover alone, so it never covers what is typed. The control keeps `aria-keyshortcuts`, and the tooltip says its keys in
 * words to assistive technology, such as *Next album (Alt + Shift + →)*.
 */

import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  createContext,
  use,
  useRef,
  useState,
} from "react";

import { hintTextOf, keyCapsOf, keyshortcutsOf } from "../shortcuts";

/** How long the pointer rests on a control before its hint shows, in milliseconds. */
const DELAY_MS = 400;

/** Whether the hints share one provider, so moving from one control to the next shows at once. */
const Shared = createContext(false);

/** The hints inside `children` share their timing: once one shows, the next shows at once. */
export function Hints({ children }: { readonly children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={DELAY_MS} skipDelayDuration={300}>
      <Shared value>{children}</Shared>
    </Tooltip.Provider>
  );
}

/** The key caps of a command's `keys`, such as `⇧ →`, several bindings joined by *or*. */
export function Keys({ keys }: { readonly keys: readonly string[] }) {
  return (
    <span className="keys" aria-hidden>
      {keys.map((binding, at) => (
        <Fragment key={binding}>
          {at > 0 && <span className="keys-or">or</span>}
          {keyCapsOf(binding).map((cap, place) => (
            // A binding names each key once, so its place tells the caps apart.
            <kbd key={place}>{cap}</kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * `children`, one control, with a hint naming it `name` and showing its command's `keys`.
 * Inside a modal dialog the hint is drawn in the dialog, which sits above the page.
 */
export function Hint({
  name,
  keys,
  showOnFocus = true,
  children,
}: {
  readonly name: string;
  readonly keys: readonly string[];
  /** Whether it shows when the control is reached with the keyboard, not only on hover. */
  readonly showOnFocus?: boolean;
  readonly children: ReactElement;
}) {
  // Typed as Radix types its trigger; the search box's is an input, which `closest` reads alike.
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const hint = (
    <Tooltip.Root
      onOpenChange={(open) => {
        if (open) {
          setContainer(trigger.current?.closest("dialog") ?? null);
        }
      }}
    >
      <Tooltip.Trigger
        ref={trigger}
        asChild
        aria-keyshortcuts={keyshortcutsOf(keys)}
        // Handled, a focus doesn't open the hint.
        onFocus={
          showOnFocus
            ? undefined
            : (event) => {
                event.preventDefault();
              }
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal container={container ?? undefined}>
        <Tooltip.Content
          className="control-hint"
          side="top"
          sideOffset={6}
          collisionPadding={8}
          aria-label={hintTextOf(name, keys)}
        >
          {name}
          {keys.length > 0 && <Keys keys={keys} />}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
  // A control drawn on its own, as in a test, keeps the hint's timing to itself.
  return use(Shared) ? hint : <Tooltip.Provider delayDuration={DELAY_MS}>{hint}</Tooltip.Provider>;
}
