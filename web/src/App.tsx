/**
 * @file The root component: the waiting screen, the sign-in form, or the signed-in page.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  type Account,
  type DeviceInfo,
  type FirstReads,
  api,
  forgetHeldReads,
  letIn,
  onDeviceRefused,
} from "./api";
import type { DeviceConnection } from "./listen";
import { DeviceWaiting } from "./views/DeviceWaiting";
import { Hints } from "./views/Hint";
import { Library } from "./views/Library";
import { SignIn } from "./views/SignIn";
import { Starting } from "./views/Starting";

declare global {
  interface Window {
    medleyplayFirstReads?: FirstReads;
  }
}

/**
 * Asks what this device is, then who is signed in, and shows the waiting
 * screen, the sign-in form, or the Library; a request refused for the device,
 * as when an admin removes it, asks again.
 */
export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [keptOut, setKeptOut] = useState<DeviceInfo | null>(null);
  // Whether this page is on the computer medleyplay runs on, so it plays for the Account.
  const [connection, setConnection] = useState<DeviceConnection>("unknown");
  const reads = useRef({ lastRequest: 0, current: 0, admitted: false });
  const initialReads = useRef<FirstReads | null | undefined>(undefined);

  const askWhoIsSignedIn = (read: number, first?: FirstReads["account"]) => {
    const order = reads.current;
    order.admitted = true;
    api.me(first).then(
      (who) => {
        if (read === order.current) setAccount(who);
      },
      () => {
        if (read === order.current) setAccount(null);
      },
    );
  };
  const answered = (device: DeviceInfo, read: number, first?: FirstReads["account"]) => {
    setConnection(device.presence === "host" ? "host" : "lan");
    if (letIn(device)) {
      setKeptOut(null);
      askWhoIsSignedIn(read, first);
    } else {
      reads.current.admitted = false;
      setAccount(undefined);
      setKeptOut(device);
    }
  };
  const checkDevice = (first?: FirstReads, retry = false) => {
    const order = reads.current;
    const read = ++order.lastRequest;
    if (!retry) {
      order.current = read;
      order.admitted = false;
    }
    api.device(first?.device).then(
      (device) => {
        if (read < order.current) return;
        order.current = read;
        initialReads.current = null;
        answered(device, read, first?.account);
      },
      () => {
        if (retry || read !== order.current) return;
        initialReads.current = null;
        setConnection("unknown");
        askWhoIsSignedIn(read);
      },
    );
  };
  const ask = useEffectEvent(checkDevice);
  const setSession = (who: Account | null) => {
    const order = reads.current;
    order.current = ++order.lastRequest;
    setAccount(who);
  };
  const accountId = account?.id;
  useEffect(
    () => () => {
      // Signing out, or in as another, forgets the answers held for this Account.
      forgetHeldReads();
    },
    [accountId],
  );
  useEffect(() => {
    const order = reads.current;
    if (initialReads.current === undefined) {
      initialReads.current = window.medleyplayFirstReads ?? null;
      delete window.medleyplayFirstReads;
    }
    const stop = onDeviceRefused(() => {
      setAccount(undefined);
      ask();
    });
    ask(initialReads.current ?? undefined);
    return () => {
      order.current = ++order.lastRequest;
      order.admitted = false;
      stop();
    };
  }, []);

  if (keptOut !== null) {
    return (
      <DeviceWaiting
        device={keptOut}
        onCheck={() => {
          checkDevice(undefined, true);
        }}
      />
    );
  }
  if (account === undefined) {
    return <Starting />;
  }
  if (account === null) {
    return <SignIn onSignedIn={setSession} />;
  }
  return (
    <Hints>
      <Library
        account={account}
        connection={connection}
        onSignedOut={() => {
          if (reads.current.admitted) setSession(null);
        }}
      />
    </Hints>
  );
}
