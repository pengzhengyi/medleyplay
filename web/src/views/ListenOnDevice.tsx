/**
 * @file How to listen on a phone or another device: the address to open, as a code to
 * scan and as text to copy, and the few steps around it.
 *
 * The addresses are the server's on the network, on this page's port; with several,
 * each can be chosen, the surest first.
 */

import {
  CheckIcon,
  CopyIcon,
  DeviceMobileIcon,
  DotsThreeVerticalIcon,
  ExportIcon,
  QrCodeIcon,
  SignInIcon,
  WifiHighIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { copyText } from "../clipboard";
import { type Here, listenAddressesOf } from "../listen";
import { qrCodeOf } from "../qr";
import { Modal } from "./Modal";

export function ListenOnDevice({
  username,
  load,
  here = location,
  onClose,
}: {
  /** The Account's username, which signs in there too. */
  readonly username: string;
  /** The server's addresses on the network. */
  readonly load: () => Promise<{ readonly addresses: readonly string[] }>;
  /** Where this page was opened; the page's own location by default. */
  readonly here?: Here;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [hosts, setHosts] = useState<readonly string[] | undefined>(undefined);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState(0);
  const [copied, setCopied] = useState<"yes" | "no" | undefined>(undefined);

  useEffect(() => {
    let open = true;
    load().then(
      (read) => {
        if (open) {
          setHosts(read.addresses);
        }
      },
      (failure: unknown) => {
        if (open) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      open = false;
    };
  }, [load]);

  const addresses = useMemo(
    () => (hosts === undefined ? [] : listenAddressesOf(hosts, here)),
    [hosts, here],
  );
  const address = addresses[chosen] ?? addresses[0];
  const code = useMemo(() => (address === undefined ? undefined : qrCodeOf(address)), [address]);

  return (
    <Modal ref={dialog} className="listen" labelledBy="listen-title" onClose={onClose}>
      <div className="card">
        <h2 id="listen-title">Listen on your device</h2>
        {error !== "" && <p role="alert">{error}</p>}
        {hosts === undefined && error === "" && (
          <p className="empty" role="status">
            Finding this computer's address…
          </p>
        )}
        {hosts !== undefined && address === undefined && (
          <p className="empty">
            Other devices can't reach this computer now. Connect it to the same Wi-Fi as your phone,
            then open this again.
          </p>
        )}
        {address !== undefined && code !== undefined && (
          <div className="listen-body">
            <figure className="listen-code">
              <svg
                className="listen-code-image"
                viewBox={`0 0 ${String(code.size)} ${String(code.size)}`}
                role="img"
                aria-label={`QR code of ${address}`}
                shapeRendering="crispEdges"
              >
                <rect width={code.size} height={code.size} className="listen-code-light" />
                <path d={code.path} className="listen-code-dark" />
              </svg>
              <figcaption>Scan with the camera</figcaption>
            </figure>
            <ol className="listen-steps">
              <li className="listen-step">
                <WifiHighIcon className="listen-step-icon" aria-hidden />
                <span>Join the same Wi-Fi as this computer.</span>
              </li>
              <li className="listen-step">
                <QrCodeIcon className="listen-step-icon" aria-hidden />
                <span>
                  Scan the code, or open
                  <span className="listen-address">
                    <code>{address}</code>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`Copy ${address}`}
                      title="Copy"
                      onClick={() => {
                        void copyText(address).then((worked) => {
                          setCopied(worked ? "yes" : "no");
                        });
                      }}
                    >
                      {copied === "yes" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                    </button>
                  </span>
                  <span className="listen-copied" role="status">
                    {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't copy" : ""}
                  </span>
                </span>
              </li>
              <li className="listen-step">
                <SignInIcon className="listen-step-icon" aria-hidden />
                <span>
                  Sign in as <strong>{username}</strong>.
                </span>
              </li>
              <li className="listen-step">
                <DeviceMobileIcon className="listen-step-icon" aria-hidden />
                <span>
                  Add it to the Home Screen: on an iPhone, <ExportIcon aria-label="Share" /> then{" "}
                  <em>Add to Home Screen</em>; on Android,{" "}
                  <DotsThreeVerticalIcon aria-label="the menu" /> then <em>Add to Home screen</em>.
                </span>
              </li>
            </ol>
          </div>
        )}
        {addresses.length > 1 && (
          <ul className="listen-others" aria-label="Addresses">
            {addresses.map((each, index) => (
              <li key={each} className="listen-other">
                <button
                  type="button"
                  className={index === chosen ? "listen-choice on" : "listen-choice"}
                  aria-pressed={index === chosen}
                  onClick={() => {
                    setChosen(index);
                    setCopied(undefined);
                  }}
                >
                  {each.replace(/^https?:\/\//u, "")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Music plays from this computer while it is on and on the network.</p>
        <footer className="dialog-buttons">
          <button
            type="button"
            className="dialog-button"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </Modal>
  );
}
