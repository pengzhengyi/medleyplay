/** @file The device list and admission policy shared by Settings and the device window. */

import { createContext, useCallback, useEffect, useRef, useState } from "react";

import { type Devices, api } from "../api";

export function useDeviceManagement(
  surface: "settings" | "dialog" | "both" | null,
  waitingIds: string,
  connected = true,
) {
  const [devices, setDevices] = useState<Devices>();
  const [failure, setFailure] = useState<{ readonly cause: unknown }>();
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const read = ++latest.current;
    void api.devices().then(
      (loaded) => {
        if (read !== latest.current) return;
        setFailure(undefined);
        setDevices(loaded);
      },
      (cause: unknown) => {
        if (read === latest.current) setFailure({ cause });
      },
    );
  }, []);
  const keep = (saved: Devices) => {
    ++latest.current;
    setDevices((current) =>
      current === undefined || saved.revision >= current.revision ? saved : current,
    );
  };
  useEffect(() => {
    if (surface !== null) refresh();
  }, [surface, waitingIds, connected, refresh]);
  return { devices, failure, refresh, keep };
}

export const DeviceManagement = createContext<ReturnType<typeof useDeviceManagement> | null>(null);
