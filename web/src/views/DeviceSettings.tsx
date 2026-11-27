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
import { useFormattingLocale, useWords } from "../locale";
import { useNow } from "../useNow";
import { classOf, useNote } from "../useNote";
import { deviceError } from "./deviceError";

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
  const t = useWords();
  const [devices, setDevices] = useState<Devices | undefined>(undefined);
  const [removingAll, setRemovingAll] = useState(false);
  const [failure, setFailure] = useState<{ readonly cause: unknown }>();
  const error = failure === undefined ? "" : deviceError(failure.cause, t);
  const notes = useNote();
  const now = useNow();
  const locale = useFormattingLocale();

  const failed = (failure: unknown) => {
    setFailure({ cause: failure });
  };
  const reload = () => {
    api.devices().then(setDevices, failed);
  };
  const act = (request: Promise<unknown>, done = "") => {
    setFailure(undefined);
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
    setFailure(undefined);
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
        {t("Reading the devices…")}
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
        <legend>{t("New devices")}</legend>
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
            {t(said)}
          </label>
        ))}
      </fieldset>
      <p className="hint">{t("The computer running medleyplay is always let in.")}</p>
      {devices.waiting.length > 0 && (
        <>
          <h4 className="device-heading">{t("Waiting")}</h4>
          <ul className="device-list" aria-label={t("Waiting devices")}>
            {devices.waiting.map((device) => (
              <li key={device.id}>
                <span className="device-name">{device.label}</span>
                <span className="hint">
                  {t("{{address}} · code", { address: device.address })}{" "}
                  <strong>{device.code}</strong>
                </span>
                <span className="device-actions">
                  <button
                    type="button"
                    onClick={() => {
                      act(api.allowDevice(device.id));
                    }}
                  >
                    {t("Allow")}
                  </button>
                  <button
                    type="button"
                    className="secondary outline"
                    onClick={() => {
                      act(api.turnAwayDevice(device.id));
                    }}
                  >
                    {t("Turn away")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="device-heading">{t("Allowed")}</h4>
      {devices.allowed.length === 0 ? (
        <p className="hint">{t("No devices yet.")}</p>
      ) : (
        <ul className="device-list" aria-label={t("Allowed devices")}>
          {devices.allowed.map((device) => (
            <li key={device.id}>
              <DeviceName device={device} onRenamed={reload} />
              <span className="hint">
                {device.name !== null && `${device.label} · `}
                {device.address} · {formatSeen(Date.parse(device.last_seen_at), now, { locale, t })}
              </span>
              {!device.this_device && (
                <span className="device-actions">
                  <button
                    type="button"
                    className="secondary outline"
                    aria-label={t("Remove {{device}} at {{address}}", {
                      device: device.name ?? device.label,
                      address: device.address,
                    })}
                    onClick={() => {
                      act(api.removeDevice(device.id), "Removed.");
                    }}
                  >
                    {t("Remove")}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 1 &&
        (removingAll ? (
          <p className="device-remove-all" role="group" aria-label={t("Remove all devices")}>
            <span>
              {t(
                "Remove {{count}} devices? This signs them out. The New devices setting determines whether they can reconnect.",
                { count: others.length },
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setRemovingAll(false);
                act(api.removeOtherDevices(), "Removed.");
              }}
            >
              {t("Remove all")}
            </button>
            <button
              type="button"
              className="secondary outline"
              onClick={() => {
                setRemovingAll(false);
              }}
            >
              {t("Keep them")}
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
            {t("Remove all")}
          </button>
        ))}
      <p className={classOf(notes.note)} role="status">
        {t(notes.note.text)}
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
  const t = useWords();
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ readonly cause: unknown }>();
  const error = failure === undefined ? "" : deviceError(failure.cause, t);
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
    setFailure(undefined);
  };

  if (typed === undefined) {
    return (
      <span className="device-name">
        {shown}
        {device.this_device && <span className="device-tag">{t("This device")}</span>}
        <button
          ref={pencil}
          type="button"
          className="icon device-rename"
          aria-label={t("Rename {{device}}", { device: shown })}
          title={t("Rename")}
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
        setFailure(undefined);
        api.renameDevice(device.id, typed.trim() === "" ? null : typed).then(
          () => {
            setSaving(false);
            stop();
            onRenamed();
          },
          (failure: unknown) => {
            setSaving(false);
            setFailure({ cause: failure });
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
        aria-label={t("Name of {{device}}", { device: device.label })}
        value={typed}
        placeholder={device.label}
        maxLength={40}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <button type="submit" aria-busy={saving} disabled={saving}>
        {t("Save")}
      </button>
      <button type="button" className="secondary outline" onClick={stop}>
        {t("Cancel")}
      </button>
      {error !== "" && (
        <span role="alert" className="note failed">
          {error}
        </span>
      )}
    </form>
  );
}
