/**
 * @file The screen of a device the household hasn't let in: waiting for an
 * admin's answer, with its code, or refused.
 */

import { WaveformIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent } from "react";

import { type DeviceInfo, api } from "../api";

/** How often a waiting device asks again whether it was answered. */
export const ASK_AGAIN_MS = 3000;

/**
 * Say this device waits, showing its code so the admin can tell it apart, and
 * ask again every few seconds; a refused one can ask again by hand. Tell
 * `onAnswered` each answer.
 */
export function DeviceWaiting({
  device,
  onAnswered,
}: {
  readonly device: DeviceInfo;
  readonly onAnswered: (device: DeviceInfo) => void;
}) {
  const askNow = () => {
    api.device().then(onAnswered, () => undefined);
  };
  const ask = useEffectEvent(askNow);
  const waiting = device.presence === "waiting";
  useEffect(() => {
    if (!waiting) {
      return undefined;
    }
    const timer = setInterval(() => {
      ask();
    }, ASK_AGAIN_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting]);

  return (
    <main className="sign-in device-waiting" aria-live="polite">
      <h1>
        <WaveformIcon weight="bold" aria-hidden />
        medleyplay
      </h1>
      {waiting ? (
        <>
          <h2>Waiting for approval</h2>
          <p>
            An admin allows this device on the computer running medleyplay, or in Settings on a
            device already allowed.
          </p>
          <p className="device-code" aria-label={`Code ${device.code ?? ""}`}>
            {device.code}
          </p>
          <p className="hint">They will see this code next to {device.label}.</p>
        </>
      ) : (
        <>
          <h2>This device can't connect</h2>
          <p>The household hasn't let new devices in. Ask an admin to allow this one.</p>
          <button type="button" onClick={askNow}>
            Ask again
          </button>
        </>
      )}
    </main>
  );
}
