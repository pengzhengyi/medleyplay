/** @file The host's share guide or the connected browser's playback modes, with device management. */

import { useId, useRef } from "react";

import type { LiveUpdates } from "../library/useLibrary";
import type { DeviceConnection } from "../listen";
import { useWords } from "../locale";
import { ConnectionInfo } from "./ConnectionInfo";
import { DeviceSettings } from "./DeviceSettings";
import { type ShareAddresses, ListenOnDevice } from "./ListenOnDevice";
import { Modal } from "./Modal";
import type { ModePicker } from "./PlayOn";

export function DeviceWindow({
  connection,
  live,
  admin,
  username,
  load,
  here = location,
  playback,
  onClose,
}: {
  readonly connection: DeviceConnection;
  readonly live: LiveUpdates;
  readonly admin: boolean;
  readonly username: string;
  readonly load: () => Promise<ShareAddresses>;
  readonly here?: Pick<Location, "hostname" | "protocol" | "port" | "origin">;
  readonly playback: ModePicker;
  readonly onClose: () => void;
}) {
  const t = useWords();
  const dialog = useRef<HTMLDialogElement>(null);
  const modes = useId();
  return (
    <Modal ref={dialog} className="listen" labelledBy="listen-title" onClose={onClose}>
      <div className="card">
        <h2 id="listen-title">{t("Devices")}</h2>
        {connection === "host" ? (
          <ListenOnDevice username={username} load={load} here={here} />
        ) : (
          <>
            <fieldset className="listen-modes" disabled={playback.busy}>
              <legend>{t("Playback mode")}</legend>
              <label className="listen-mode">
                <input
                  className="listen-mode-option"
                  type="radio"
                  name={modes}
                  checked={playback.on === "here"}
                  onChange={() => {
                    playback.onChoose("here");
                  }}
                />
                <span>
                  {t("Client")}
                  <small className="hint listen-mode-about">
                    {t("Play on this device with its own queue.")}
                  </small>
                </span>
              </label>
              <label className="listen-mode">
                <input
                  className="listen-mode-option"
                  type="radio"
                  name={modes}
                  checked={playback.on === "computer"}
                  disabled={!playback.available}
                  onChange={() => {
                    playback.onChoose("computer");
                  }}
                />
                <span>
                  {t("Remote")}
                  <small className="hint listen-mode-about">
                    {t("Control playback on the computer.")}
                  </small>
                </span>
              </label>
              {playback.unavailable !== undefined && (
                <p className="hint" role="status">
                  {t(playback.unavailable)}
                </p>
              )}
            </fieldset>
            <ConnectionInfo address={here.origin} live={live} />
          </>
        )}
        {admin && (
          <section className="listen-management" aria-labelledby="listen-management-title">
            <h3 id="listen-management-title">{t("Manage devices")}</h3>
            <DeviceSettings compact />
          </section>
        )}
      </div>
    </Modal>
  );
}
