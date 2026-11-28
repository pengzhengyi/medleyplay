/**
 * @file *Play on*: where a page that isn't on the computer plays, on itself or on the
 * computer medleyplay runs on.
 */

import { CheckIcon, DesktopIcon, DeviceMobileIcon, SpeakerHifiIcon } from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useWords } from "../locale";
import { playbackMessage } from "./unplayable";

/** Where the music plays: on this device, or on the computer. */
export type PlaysOn = "here" | "computer";

export interface ModePicker {
  readonly on: PlaysOn;
  readonly available: boolean;
  readonly unavailable: string | undefined;
  readonly busy: boolean;
  readonly onChoose: (where: PlaysOn) => void;
}

/**
 * A button opening a menu of *This device* and *The computer*; the computer can be
 * chosen only while medleyplay is open there. Playing on the computer, the button
 * says so. A choice that failed says why beside it.
 */
export function PlayOn({
  on,
  available,
  unavailable,
  busy,
  failed,
  onChoose,
  onMove,
}: ModePicker & {
  readonly failed: string;
  readonly onMove: (() => void) | undefined;
}) {
  const t = useWords();
  const label = t(on === "computer" ? "Play on: the computer" : "Play on: this device");
  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <button
            type="button"
            className={on === "computer" ? "icon play-on on" : "icon play-on"}
            aria-label={label}
            aria-busy={busy}
            title={label}
          >
            <SpeakerHifiIcon weight={on === "computer" ? "fill" : "regular"} aria-hidden />
            {on === "computer" && <span className="play-on-where">{t("Computer")}</span>}
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="track-menu" align="end" sideOffset={4} collisionPadding={8}>
            <Menu.Label className="device-asking">{t("Playback mode")}</Menu.Label>
            <Menu.RadioGroup
              className="play-on-group"
              value={on}
              onValueChange={(value) => {
                onChoose(value === "computer" ? "computer" : "here");
              }}
            >
              <Menu.RadioItem className="track-menu-item play-on-item" value="here" disabled={busy}>
                <DeviceMobileIcon aria-hidden />
                <span className="play-on-choice">
                  {t("Client")}
                  <span className="hint">{t("This device")}</span>
                </span>
                <Menu.ItemIndicator className="play-on-mark">
                  <CheckIcon weight="bold" aria-hidden />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
              <Menu.RadioItem
                className="track-menu-item play-on-item"
                value="computer"
                disabled={!available || busy}
              >
                <DesktopIcon aria-hidden />
                <span className="play-on-choice">
                  {t("Remote")}
                  <span className="hint">{t("The computer")}</span>
                  {unavailable !== undefined && <span className="hint">{t(unavailable)}</span>}
                </span>
                <Menu.ItemIndicator className="play-on-mark">
                  <CheckIcon weight="bold" aria-hidden />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            </Menu.RadioGroup>
            {onMove !== undefined && (
              <>
                <Menu.Separator className="track-menu-separator" />
                <Menu.Item className="track-menu-item" disabled={busy} onSelect={onMove}>
                  <span className="play-on-choice">
                    {t("Move playback")}
                    <span className="hint">
                      {t(
                        on === "computer"
                          ? "Replace this device’s queue. Only part of a long queue may move."
                          : "Replace the computer’s queue.",
                      )}
                    </span>
                  </span>
                </Menu.Item>
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {failed !== "" && (
        <span role="alert" className="note failed">
          {playbackMessage(failed, t)}
        </span>
      )}
    </>
  );
}
