/**
 * @file The header's pill for an admin: the devices waiting to be let in, each
 * to allow or turn away.
 */

import { DeviceMobileIcon } from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";

import { type WaitingDevice, api } from "../api";

/** Return how the pill names the waiting devices, as "2 devices waiting". */
function waitingSaid(count: number): string {
  return count === 1 ? "1 device waiting" : `${String(count)} devices waiting`;
}

/**
 * A pill naming how many devices wait, opening a menu with each one's label,
 * address and code, and Allow and Turn away. The event stream says when the
 * list changes, so an answer needs nothing more; a failed one says why beside
 * the pill.
 */
export function WaitingDevices({ waiting }: { readonly waiting: readonly WaitingDevice[] }) {
  const [failed, setFailed] = useState("");
  if (waiting.length === 0) {
    return null;
  }
  const answer = (request: Promise<unknown>) => {
    setFailed("");
    request.catch((failure: unknown) => {
      setFailed(failure instanceof Error ? failure.message : String(failure));
    });
  };
  const said = waitingSaid(waiting.length);
  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <button type="button" className="devices-waiting" title={`${said}: allow or turn away`}>
            <DeviceMobileIcon weight="bold" aria-hidden />
            {said}
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="track-menu" align="end" sideOffset={4} collisionPadding={8}>
            {waiting.map((device, index) => (
              <Menu.Group
                key={device.id}
                className="devices-menu-group"
                aria-label={`${device.label}, code ${device.code}`}
              >
                {index > 0 && <Menu.Separator className="track-menu-separator" />}
                <Menu.Label className="device-asking">
                  <span>{device.label}</span>
                  <span className="hint">
                    {device.address} · code <strong>{device.code}</strong>
                  </span>
                </Menu.Label>
                <Menu.Item
                  className="track-menu-item"
                  onSelect={() => {
                    answer(api.allowDevice(device.id));
                  }}
                >
                  Allow
                </Menu.Item>
                <Menu.Item
                  className="track-menu-item"
                  onSelect={() => {
                    answer(api.turnAwayDevice(device.id));
                  }}
                >
                  Turn away
                </Menu.Item>
              </Menu.Group>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {failed !== "" && (
        <span role="alert" className="hint">
          {failed}
        </span>
      )}
    </>
  );
}
