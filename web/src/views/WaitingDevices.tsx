/**
 * @file The header's pill for an admin: the devices waiting to be let in, each
 * to allow or turn away.
 */

import { DeviceMobileIcon } from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";

import { type WaitingDevice, api } from "../api";
import { useWords } from "../locale";
import { deviceError } from "./deviceError";

/**
 * A pill naming how many devices wait, opening a menu with each one's label,
 * address and code, and Allow and Turn away. The event stream says when the
 * list changes, so an answer needs nothing more; a failed one says why beside
 * the pill.
 */
export function WaitingDevices({ waiting }: { readonly waiting: readonly WaitingDevice[] }) {
  const t = useWords();
  const [failure, setFailure] = useState<{ readonly cause: unknown }>();
  if (waiting.length === 0) {
    return null;
  }
  const answer = (request: Promise<unknown>) => {
    setFailure(undefined);
    request.catch((failure: unknown) => {
      setFailure({ cause: failure });
    });
  };
  const said = t("devices_waiting", { count: waiting.length });
  const failed = failure === undefined ? "" : deviceError(failure.cause, t);
  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <button
            type="button"
            className="devices-waiting"
            title={t("{{waiting}}: allow or turn away", { waiting: said })}
          >
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
                aria-label={t("{{device}}, code {{code}}", {
                  device: device.label,
                  code: device.code,
                })}
              >
                {index > 0 && <Menu.Separator className="track-menu-separator" />}
                <Menu.Label className="device-asking">
                  <span>{device.label}</span>
                  <span className="hint">
                    {t("{{address}} · code", { address: device.address })}{" "}
                    <strong>{device.code}</strong>
                  </span>
                </Menu.Label>
                <Menu.Item
                  className="track-menu-item"
                  onSelect={() => {
                    answer(api.allowDevice(device.id));
                  }}
                >
                  {t("Allow")}
                </Menu.Item>
                <Menu.Item
                  className="track-menu-item"
                  onSelect={() => {
                    answer(api.turnAwayDevice(device.id));
                  }}
                >
                  {t("Turn away")}
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
