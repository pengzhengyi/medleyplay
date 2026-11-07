/**
 * @file The root component: the waiting screen, the sign-in form, or the signed-in page.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { type Account, type DeviceInfo, api, letIn, onDeviceRefused } from "./api";
import { DeviceWaiting } from "./views/DeviceWaiting";
import { Library } from "./views/Library";
import { SignIn } from "./views/SignIn";

/**
 * Asks what this device is, then who is signed in, and shows the waiting
 * screen, the sign-in form, or the Library; a request refused for the device,
 * as when an admin removes it, asks again.
 */
export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [keptOut, setKeptOut] = useState<DeviceInfo | null>(null);

  const askWhoIsSignedIn = () => {
    api.me().then(setAccount, () => {
      setAccount(null);
    });
  };
  const answered = (device: DeviceInfo) => {
    if (letIn(device)) {
      setKeptOut(null);
      askWhoIsSignedIn();
    } else {
      setKeptOut(device);
    }
  };
  const ask = useEffectEvent(() => {
    // A server that can't say what the device is answers as before devices were asked about.
    api.device().then(answered, askWhoIsSignedIn);
  });
  useEffect(() => {
    ask();
    return onDeviceRefused(() => {
      ask();
    });
  }, []);

  if (keptOut !== null) {
    return <DeviceWaiting device={keptOut} onAnswered={answered} />;
  }
  if (account === undefined) {
    return null;
  }
  if (account === null) {
    return <SignIn onSignedIn={setAccount} />;
  }
  return (
    <Library
      account={account}
      onSignedOut={() => {
        setAccount(null);
      }}
    />
  );
}
