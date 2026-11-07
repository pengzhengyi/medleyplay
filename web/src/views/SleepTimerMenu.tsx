/**
 * @file The sleep timer's button in Up next: choose when to pause, see the time left.
 */

import { MoonIcon } from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";

import { formatMinutes, formatTimeLeft } from "../format";
import { SLEEP_MINUTES, type SleepTimer } from "../player/useSleepTimer";
import { useNow } from "../useNow";

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/**
 * A moon that offers times to pause after; while set, it shows the time left and
 * offers to turn the timer off. `container` holds the menu, as inside a modal dialog.
 */
export function SleepTimerMenu({
  timer,
  container,
}: {
  readonly timer: SleepTimer;
  readonly container?: HTMLElement | null | undefined;
}) {
  const now = useNow();
  const { endsAt, setAt } = timer;
  // The clock is read every few seconds, so it may be behind the moment the timer was set.
  const left = endsAt === null ? undefined : formatTimeLeft(endsAt - Math.max(now, setAt ?? now));
  const label =
    endsAt === null
      ? "Sleep timer"
      : `Sleep timer, ${left ?? ""} left: pauses at ${clock.format(endsAt)}`;
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className={endsAt === null ? "text sleep-timer" : "text sleep-timer on"}
          aria-label={label}
          title={label}
        >
          <MoonIcon weight={endsAt === null ? "regular" : "fill"} aria-hidden />
          {left !== undefined && <span>{left}</span>}
        </button>
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Content className="track-menu" align="end" sideOffset={4} collisionPadding={8}>
          <Menu.Label className="track-menu-label">Pause after</Menu.Label>
          {SLEEP_MINUTES.map((minutes) => (
            <Menu.Item
              key={minutes}
              className="track-menu-item"
              onSelect={() => {
                timer.start(minutes);
              }}
            >
              {formatMinutes(minutes)}
            </Menu.Item>
          ))}
          {endsAt !== null && (
            <>
              <Menu.Separator className="track-menu-separator" />
              <Menu.Item className="track-menu-item" onSelect={timer.stop}>
                Turn off the timer
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
