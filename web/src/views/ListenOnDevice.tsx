/**
 * @file How to listen on a phone or another device: the address to open, as a code to
 * scan and as text to copy, and the few steps around it.
 *
 * Managed sharing publishes its own URL. Otherwise the addresses use this page's port.
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
import { useEffect, useMemo, useState } from "react";
import { Trans } from "react-i18next";

import { copyText } from "../clipboard";
import { type Here, listenAddressesOf } from "../listen";
import { useWords } from "../locale";
import { qrCodeOf } from "../qr";
import { ConnectionInfo } from "./ConnectionInfo";
import { COMPUTER_READY } from "./unplayable";

const SIGN_IN = "Sign in as <account/>.";
const HOME_SCREEN =
  "Add it to the Home Screen: on an iPhone, <share/> then <item>Add to Home Screen</item>; on Android, <menu/> then <item>Add to Home screen</item>.";
const PLAY_ON =
  "On your phone, open <control>Devices</control> to play on the phone or control this computer. Keep this computer on and on the network.";

export interface ShareAddresses {
  readonly addresses: readonly string[];
  readonly share_url?: string | null;
}

export function ListenOnDevice({
  username,
  load,
  here = location,
}: {
  /** The Account's username, which signs in there too. */
  readonly username: string;
  /** The server's addresses on the network. */
  readonly load: () => Promise<ShareAddresses>;
  /** Where this page was opened; the page's own location by default. */
  readonly here?: Here;
}) {
  const t = useWords();
  const [published, setPublished] = useState<ShareAddresses | undefined>(undefined);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState(0);
  const [copied, setCopied] = useState<"yes" | "no" | undefined>(undefined);

  useEffect(() => {
    let open = true;
    let managed = false;
    let retry: number | undefined;
    const refresh = () => {
      void load().then(
        (read) => {
          if (!open) return;
          managed = read.share_url !== undefined;
          setPublished(read);
          setError("");
          if (managed) retry = window.setTimeout(refresh, 3000);
        },
        (failure: unknown) => {
          if (!open) return;
          setError(failure instanceof Error ? failure.message : String(failure));
          if (managed) {
            setPublished({ addresses: [], share_url: null });
            retry = window.setTimeout(refresh, 3000);
          }
        },
      );
    };
    refresh();
    return () => {
      open = false;
      window.clearTimeout(retry);
    };
  }, [load]);

  const addresses = useMemo(() => {
    if (published === undefined || published.share_url === null) return [];
    if (published.share_url !== undefined) return [published.share_url];
    return listenAddressesOf(published.addresses, here);
  }, [published, here]);
  const address = addresses[chosen] ?? addresses[0];
  const code = useMemo(() => (address === undefined ? undefined : qrCodeOf(address)), [address]);
  return (
    <section className="listen-share" aria-labelledby="listen-share-title">
      <h3 id="listen-share-title">{t("Listen on another device")}</h3>
      {error !== "" && <p role="alert">{error}</p>}
      {published === undefined && error === "" && (
        <p className="empty" role="status">
          {t("Finding this computer's address…")}
        </p>
      )}
      {published?.share_url === null && error === "" && (
        <p className="empty" role="status">
          {t("LAN sharing is off. Start it from Terminal.")}
        </p>
      )}
      {published !== undefined && published.share_url === undefined && address === undefined && (
        <p className="empty">
          {t(
            "No local network address was found. Connect both devices to the same network. If medleyplay started before the connection was available, restart it.",
          )}
        </p>
      )}
      {address !== undefined && (
        <ConnectionInfo
          address={address}
          copy={
            <>
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
            </>
          }
        >
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
        </ConnectionInfo>
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
            {t("If the device is waiting for approval, ask an admin to match its code here.")}
          </li>
        </ul>
      </details>
      <p className="hint">
        <Trans t={t} i18nKey={PLAY_ON} defaults={PLAY_ON} components={{ control: <strong /> }} />
      </p>
      {address !== undefined && <p className="hint">{t(COMPUTER_READY)}</p>}
    </section>
  );
}
