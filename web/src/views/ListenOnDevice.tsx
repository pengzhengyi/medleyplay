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
  SignInIcon,
  WifiHighIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "react-i18next";

import { copyText } from "../clipboard";
import { type Here, listenAddressesOf } from "../listen";
import { useWords } from "../locale";
import { qrCodeOf } from "../qr";
import { hrefOf } from "../routes";
import { Modal } from "./Modal";
import { COMPUTER_READY } from "./unplayable";

const SIGN_IN = "Sign in as <account/>.";
const HOME_SCREEN =
  "Add it to the Home Screen: on an iPhone, <share/> then <item>Add to Home Screen</item>; on Android, <menu/> then <item>Add to Home screen</item>.";
const PLAY_ON =
  "The phone plays the music itself, or on this computer: choose <control>Play on</control> in its player. Either way, keep this computer on and on the network.";

export function ListenOnDevice({
  username,
  load,
  here = location,
  waitingCount,
  onClose,
}: {
  /** The Account's username, which signs in there too. */
  readonly username: string;
  /** The server's addresses on the network. */
  readonly load: () => Promise<{ readonly addresses: readonly string[] }>;
  /** Where this page was opened; the page's own location by default. */
  readonly here?: Here;
  readonly waitingCount?: number | undefined;
  readonly onClose: () => void;
}) {
  const t = useWords();
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
  const secure = here.protocol === "https:";
  const port = here.port || (secure ? "443" : "80");

  return (
    <Modal ref={dialog} className="listen" labelledBy="listen-title" onClose={onClose}>
      <div className="card">
        <h2 id="listen-title">{t("Listen on your device")}</h2>
        {error !== "" && <p role="alert">{error}</p>}
        {hosts === undefined && error === "" && (
          <p className="empty" role="status">
            {t("Finding this computer's address…")}
          </p>
        )}
        {hosts !== undefined && address === undefined && (
          <p className="empty">
            {t(
              "No local network address was found. Connect both devices to the same network. If medleyplay started before the connection was available, restart it.",
            )}
          </p>
        )}
        {address !== undefined && (
          <section className="listen-connection" aria-labelledby="listen-connection-title">
            <h3 id="listen-connection-title">{t("Connection info")}</h3>
            <div className="listen-address">
              <code>{address}</code>
              <button
                type="button"
                className="icon"
                aria-label={t("Copy {{address}}", { address })}
                title={t("Copy")}
                onClick={() => {
                  void copyText(address).then((worked) => {
                    setCopied(worked ? "yes" : "no");
                  });
                }}
              >
                {copied === "yes" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              </button>
              <span className="listen-copied" role="status">
                {copied === "yes" ? t("Copied") : copied === "no" ? t("Couldn't copy") : ""}
              </span>
            </div>
            <dl className="listen-connection-facts">
              <div>
                <dt>{t("Protocol")}</dt>
                <dd>{secure ? "HTTPS" : "HTTP"}</dd>
              </div>
              <div>
                <dt>{t("TCP port")}</dt>
                <dd>{port}</dd>
              </div>
            </dl>
            {addresses.length > 1 && (
              <ul className="listen-others" aria-label={t("Addresses")}>
                {addresses.map((each, index) => (
                  <li key={each} className="listen-other">
                    <button
                      type="button"
                      className={each === address ? "listen-choice on" : "listen-choice"}
                      aria-pressed={each === address}
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
            <p className="hint">{t("This link does not verify access from another device.")}</p>
            {waitingCount !== undefined && waitingCount > 0 && (
              <p className="hint" role="status">
                {t("devices_waiting", { count: waitingCount })}
              </p>
            )}
            {waitingCount !== undefined && (
              <a href={hrefOf({ view: "settings", section: "devices" })} onClick={onClose}>
                {t("Open Devices settings")}
              </a>
            )}
          </section>
        )}
        {address !== undefined && code !== undefined && (
          <div className="listen-body">
            <figure className="listen-code">
              <svg
                className="listen-code-image"
                viewBox={`0 0 ${String(code.size)} ${String(code.size)}`}
                role="img"
                aria-label={t("QR code of {{address}}", { address })}
                shapeRendering="crispEdges"
              >
                <rect width={code.size} height={code.size} className="listen-code-light" />
                <path d={code.path} className="listen-code-dark" />
              </svg>
              <figcaption>{t("Scan with the camera")}</figcaption>
            </figure>
            <ol className="listen-steps">
              <li className="listen-step">
                <WifiHighIcon className="listen-step-icon" aria-hidden />
                <span>{t("Join the same Wi-Fi as this computer.")}</span>
              </li>
              <li className="listen-step">
                <SignInIcon className="listen-step-icon" aria-hidden />
                <span>
                  <Trans
                    t={t}
                    i18nKey={SIGN_IN}
                    defaults={SIGN_IN}
                    components={{ account: <strong>{username}</strong> }}
                  />
                </span>
              </li>
              <li className="listen-step">
                <DeviceMobileIcon className="listen-step-icon" aria-hidden />
                <span>
                  <Trans
                    t={t}
                    i18nKey={HOME_SCREEN}
                    defaults={HOME_SCREEN}
                    components={{
                      share: <ExportIcon aria-label={t("Share")} />,
                      menu: <DotsThreeVerticalIcon aria-label={t("the menu")} />,
                      item: <em />,
                    }}
                  />
                </span>
              </li>
            </ol>
          </div>
        )}
        <details className="listen-help">
          <summary>{t("Can't connect?")}</summary>
          <ul className="listen-help-steps">
            <li>
              {t(
                "If the page does not load, try the numeric address on the same non-guest Wi-Fi. Check whether a firewall, VPN, or Wi-Fi isolation blocks local connections.",
              )}
            </li>
            <li>
              {t(
                "If the device is waiting for approval, ask an admin to match its code in Settings → Devices.",
              )}
            </li>
          </ul>
        </details>
        <p className="hint">
          <Trans t={t} i18nKey={PLAY_ON} defaults={PLAY_ON} components={{ control: <strong /> }} />
        </p>
        {address !== undefined && <p className="hint">{t(COMPUTER_READY)}</p>}
      </div>
    </Modal>
  );
}
