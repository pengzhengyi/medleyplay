/**
 * @file The root component: the waiting screen, the sign-in form, or the signed-in page.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { type Account, type DeviceInfo, api, forgetHeldReads, letIn, onDeviceRefused } from "./api";
import { DeviceWaiting } from "./views/DeviceWaiting";
import { Hints } from "./views/Hint";
import { Library } from "./views/Library";
import { SignIn } from "./views/SignIn";
import { Starting } from "./views/Starting";

/**
 * Asks what this device is, then who is signed in, and shows the waiting
 * screen, the sign-in form, or the Library; a request refused for the device,
 * as when an admin removes it, asks again.
 */
export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [keptOut, setKeptOut] = useState<DeviceInfo | null>(null);
  // Whether this page is on the computer medleyplay runs on, so it plays for the Account.
  const [onHost, setOnHost] = useState(false);

  const askWhoIsSignedIn = () => {
    api.me().then(setAccount, () => {
      setAccount(null);
    });
  };
  const answered = (device: DeviceInfo) => {
    setOnHost(device.presence === "host");
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
  const accountId = account?.id;
  useEffect(
    () => () => {
      // Signing out, or in as another, forgets the answers held for this Account.
      forgetHeldReads();
    },
    [accountId],
  );
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
    return <Starting />;
  }
  if (account === null) {
    return <SignIn onSignedIn={setAccount} />;
  }
  return (
    <Hints>
      <Library
        account={account}
        onHost={onHost}
        onSignedOut={() => {
          setAccount(null);
        }}
      />
    </Hints>
  );
}
