/**
 * @file *Play on*: where a page that isn't on the computer plays, on itself or on the
 * computer medleyplay runs on.
 */

import { CheckIcon, DesktopIcon, DeviceMobileIcon, SpeakerHifiIcon } from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";

/** Where the music plays: on this device, or on the computer. */
export type PlaysOn = "here" | "computer";

/**
 * A button opening a menu of *This device* and *The computer*; the computer can be
 * chosen only while medleyplay is open there. Playing on the computer, the button
 * says so. A choice that failed says why beside it.
 */
export function PlayOn({
  on,
  available,
  failed,
  onChoose,
}: {
  readonly on: PlaysOn;
  /** Whether medleyplay is open on the computer, so it can play there. */
  readonly available: boolean;
  readonly failed: string;
  readonly onChoose: (where: PlaysOn) => void;
}) {
  const label = on === "computer" ? "Play on: the computer" : "Play on: this device";
  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <button
            type="button"
            className={on === "computer" ? "icon play-on on" : "icon play-on"}
            aria-label={label}
            title={label}
          >
            <SpeakerHifiIcon weight={on === "computer" ? "fill" : "regular"} aria-hidden />
            {on === "computer" && <span className="play-on-where">Computer</span>}
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="track-menu" align="end" sideOffset={4} collisionPadding={8}>
            <Menu.Label className="device-asking">Play on</Menu.Label>
            <Menu.RadioGroup
              className="play-on-group"
              value={on}
              onValueChange={(value) => {
                onChoose(value === "computer" ? "computer" : "here");
              }}
            >
              <Menu.RadioItem className="track-menu-item play-on-item" value="here">
                <DeviceMobileIcon aria-hidden />
                This device
                <Menu.ItemIndicator className="play-on-mark">
                  <CheckIcon weight="bold" aria-hidden />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
              <Menu.RadioItem
                className="track-menu-item play-on-item"
                value="computer"
                disabled={!available}
              >
                <DesktopIcon aria-hidden />
                <span className="play-on-choice">
                  The computer
                  {!available && <span className="hint">Open medleyplay on the computer</span>}
                </span>
                <Menu.ItemIndicator className="play-on-mark">
                  <CheckIcon weight="bold" aria-hidden />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {failed !== "" && (
        <span role="alert" className="note failed">
          {failed}
        </span>
      )}
    </>
  );
}
