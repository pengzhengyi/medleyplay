/**
 * @file The Other devices section of Settings: the choice for new devices, and
 * the devices waiting and allowed.
 *
 * Only an admin sees it. Answering a waiting device and removing an allowed one
 * act at once; Remove all asks once more first.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { type Admission, ApiError, type Devices, type WaitingDevice, api } from "../api";
import { formatSeen } from "../format";
import { useNow } from "../useNow";
import { classOf, useNote } from "../useNote";

/** The choices for new devices, in the order the section shows them. */
const ADMISSIONS: readonly { readonly admission: Admission; readonly said: string }[] = [
  { admission: "ask", said: "Ask first: a new device waits until an admin allows it" },
  { admission: "everyone", said: "Allow all: any device on the network can sign in" },
  { admission: "known", said: "Block new devices: only allowed devices connect" },
];

/**
 * The choice, the waiting devices to allow or turn away, and the allowed ones to
 * remove; `waiting` is what the event stream last said waits, so the lists
 * follow it.
 */
export function DeviceSettings({ waiting }: { readonly waiting: readonly WaitingDevice[] }) {
  const [devices, setDevices] = useState<Devices | undefined>(undefined);
  const [removingAll, setRemovingAll] = useState(false);
  const [error, setError] = useState("");
  const notes = useNote();
  const now = useNow();

  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const reload = () => {
    api.devices().then(setDevices, failed);
  };
  const act = (request: Promise<unknown>, done = "") => {
    setError("");
    request.then(() => {
      reload();
      if (done !== "") {
        notes.confirm(done);
      }
    }, failed);
  };
  const reloadWhenWaitingChanges = useEffectEvent(() => {
    reload();
  });
  const waitingIds = waiting.map(({ id }) => id).join(" ");
  useEffect(() => {
    reloadWhenWaitingChanges();
  }, [waitingIds]);

  const choose = (admission: Admission) => {
    if (devices === undefined) {
      return;
    }
    setError("");
    setDevices({ ...devices, admission });
    api.saveAdmission(admission, devices.revision).then(setDevices, (failure: unknown) => {
      reload();
      if (failure instanceof ApiError && failure.status === 409) {
        notes.tell("The choice changed elsewhere, so here it is now. Choose again to change it.");
        return;
      }
      failed(failure);
    });
  };

  if (devices === undefined) {
    return error === "" ? (
      <p className="hint" aria-busy="true">
        Reading the devices…
      </p>
    ) : (
      <p role="alert">{error}</p>
    );
  }
  const others = devices.allowed.filter((device) => !device.this_device);
  return (
    <>
      {error !== "" && <p role="alert">{error}</p>}
      <fieldset className="mode-setting">
        <legend>New devices</legend>
        {ADMISSIONS.map(({ admission, said }) => (
          <label key={admission} className="mode-choice">
            <input
              type="radio"
              name="admission"
              checked={devices.admission === admission}
              onChange={() => {
                choose(admission);
              }}
            />
            {said}
          </label>
        ))}
      </fieldset>
      <p className="hint">The computer running medleyplay is always let in.</p>
      {devices.waiting.length > 0 && (
        <>
          <h4 className="device-heading">Waiting</h4>
          <ul className="device-list" aria-label="Waiting devices">
            {devices.waiting.map((device) => (
              <li key={device.id}>
                <span className="device-name">{device.label}</span>
                <span className="hint">
                  {device.address} · code <strong>{device.code}</strong>
                </span>
                <span className="device-actions">
                  <button
                    type="button"
                    onClick={() => {
                      act(api.allowDevice(device.id));
                    }}
                  >
                    Allow
                  </button>
                  <button
                    type="button"
                    className="secondary outline"
                    onClick={() => {
                      act(api.turnAwayDevice(device.id));
                    }}
                  >
                    Turn away
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="device-heading">Allowed</h4>
      {devices.allowed.length === 0 ? (
        <p className="hint">No devices yet. A new device asks when it opens medleyplay.</p>
      ) : (
        <ul className="device-list" aria-label="Allowed devices">
          {devices.allowed.map((device) => (
            <li key={device.id}>
              <span className="device-name">
                {device.label}
                {device.this_device && <span className="device-tag">This device</span>}
              </span>
              <span className="hint">
                {device.address} · {formatSeen(Date.parse(device.last_seen_at), now)}
              </span>
              {!device.this_device && (
                <span className="device-actions">
                  <button
                    type="button"
                    className="secondary outline"
                    aria-label={`Remove ${device.label} at ${device.address}`}
                    onClick={() => {
                      act(api.removeDevice(device.id), "Removed.");
                    }}
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 1 &&
        (removingAll ? (
          <p className="device-remove-all" role="group" aria-label="Remove all devices">
            <span>
              Remove {String(others.length)} devices? They sign in again only once allowed.
            </span>
            <button
              type="button"
              onClick={() => {
                setRemovingAll(false);
                act(api.removeOtherDevices(), "Removed.");
              }}
            >
              Remove all
            </button>
            <button
              type="button"
              className="secondary outline"
              onClick={() => {
                setRemovingAll(false);
              }}
            >
              Keep them
            </button>
          </p>
        ) : (
          <button
            type="button"
            className="secondary outline"
            onClick={() => {
              setRemovingAll(true);
            }}
          >
            Remove all
          </button>
        ))}
      <p className={classOf(notes.note)} role="status">
        {notes.note.text}
      </p>
    </>
  );
}
