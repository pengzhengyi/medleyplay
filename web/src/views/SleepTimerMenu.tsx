/**
 * @file The sleep timer's button in Up next: choose when to pause, see the time left.
 */

import { MoonIcon } from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";

import { formatMinutes, formatTimeLeft } from "../format";
import { SLEEP_MINUTES, type SleepTimer } from "../player/useSleepTimer";
import { useNow } from "../useNow";
import { Hint } from "./Hint";
import { type Words, useWords } from "../locale";

/**
 * A moon that opens the timer menu and shows the remaining duration on hover or focus.
 * `container` holds the menu, as inside a modal dialog.
 */
export function SleepTimerMenu({
  timer,
  container,
}: {
  readonly timer: SleepTimer;
  readonly container?: HTMLElement | null | undefined;
}) {
  const t = useWords();
  const now = useNow();
  const { endsAt, setAt } = timer;
  const status = endsAt === null ? null : timeLeft(endsAt, setAt, now, t);
  return (
    <Menu.Root modal={false}>
      <Hint name={status ?? t("Sleep timer")} keys={[]}>
        <Menu.Trigger asChild>
          <button
            type="button"
            className={status === null ? "icon sleep-timer" : "icon sleep-timer on"}
            aria-label={t(status === null ? "Sleep timer" : "Sleep timer, on")}
          >
            <MoonIcon weight={status === null ? "regular" : "fill"} aria-hidden />
          </button>
        </Menu.Trigger>
      </Hint>
      <Menu.Portal container={container}>
        <Menu.Content
          className="track-menu"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onPointerDown={(event) => {
            // The menu is outside Up next in the DOM, but clicks in it are not outside clicks.
            event.stopPropagation();
          }}
        >
          {status !== null && <Menu.Label className="track-menu-label">{status}</Menu.Label>}
          <Menu.Label className="track-menu-label">{t("Pause after")}</Menu.Label>
          {SLEEP_MINUTES.map((minutes) => (
            <Menu.Item
              key={minutes}
              className="track-menu-item"
              onSelect={() => {
                timer.start(minutes);
              }}
            >
              {formatMinutes(minutes, t)}
            </Menu.Item>
          ))}
          {endsAt !== null && (
            <>
              <Menu.Separator className="track-menu-separator" />
              <Menu.Item className="track-menu-item" onSelect={timer.stop}>
                {t("Turn off the timer")}
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function timeLeft(endsAt: number, setAt: number | null, now: number, t: Words): string {
  const left = formatTimeLeft(endsAt - Math.max(now, setAt ?? now), t);
  return setAt === null
    ? t("{{left}} left", { left })
    : t("{{left}} left of {{total}}", { left, total: formatTimeLeft(endsAt - setAt, t) });
}
