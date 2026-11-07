/**
 * @file The Other devices section of Settings: the choice for new devices, and
 * the devices waiting and allowed.
 *
 * Only an admin sees it. Answering a waiting device and removing an allowed one
 * act at once; Remove all asks once more first.
 */

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  type Admission,
  type AllowedDevice,
  ApiError,
  type Devices,
  type WaitingDevice,
  api,
} from "../api";
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
              <DeviceName device={device} onRenamed={reload} />
              <span className="hint">
                {device.name !== null && `${device.label} · `}
                {device.address} · {formatSeen(Date.parse(device.last_seen_at), now)}
              </span>
              {!device.this_device && (
                <span className="device-actions">
                  <button
                    type="button"
                    className="secondary outline"
                    aria-label={`Remove ${device.name ?? device.label} at ${device.address}`}
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

/**
 * An allowed device's name, or its label while it has none, with a pencil that turns
 * it into a field: Enter or Save names it, Escape or Cancel leaves it, and a blank
 * name leaves the label. Why a name was refused shows beside it.
 */
function DeviceName({
  device,
  onRenamed,
}: {
  readonly device: AllowedDevice;
  readonly onRenamed: () => void;
}) {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pencil = useRef<HTMLButtonElement>(null);
  // Closing the field gives focus back to the pencil that opened it.
  const refocus = useRef(false);
  useEffect(() => {
    if (typed === undefined && refocus.current) {
      refocus.current = false;
      pencil.current?.focus();
    }
  }, [typed]);
  const shown = device.name ?? device.label;

  const stop = () => {
    refocus.current = true;
    setTyped(undefined);
    setError("");
  };

  if (typed === undefined) {
    return (
      <span className="device-name">
        {shown}
        {device.this_device && <span className="device-tag">This device</span>}
        <button
          ref={pencil}
          type="button"
          className="icon device-rename"
          aria-label={`Rename ${shown}`}
          title="Rename"
          onClick={() => {
            setTyped(device.name ?? "");
          }}
        >
          <PencilSimpleIcon aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <form
      className="device-name device-rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        api.renameDevice(device.id, typed.trim() === "" ? null : typed).then(
          () => {
            setSaving(false);
            stop();
            onRenamed();
          },
          (failure: unknown) => {
            setSaving(false);
            setError(failure instanceof Error ? failure.message : String(failure));
          },
        );
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          stop();
        }
      }}
    >
      <input
        ref={(input) => {
          input?.focus();
        }}
        aria-label={`Name of ${device.label}`}
        value={typed}
        placeholder={device.label}
        maxLength={40}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <button type="submit" aria-busy={saving} disabled={saving}>
        Save
      </button>
      <button type="button" className="secondary outline" onClick={stop}>
        Cancel
      </button>
      {error !== "" && (
        <span role="alert" className="note failed">
          {error}
        </span>
      )}
    </form>
  );
}
