/** @file The protocol and port of either the current browser or a shared URL. */

import type { ReactNode } from "react";

import type { LiveUpdates } from "../library/useLibrary";
import { useWords } from "../locale";

export function ConnectionInfo({
  address,
  live,
  copy,
  children,
}: {
  readonly address: string;
  readonly live?: LiveUpdates;
  readonly copy?: ReactNode;
  readonly children?: ReactNode;
}) {
  const t = useWords();
  const endpoint = new URL(address);
  const secure = endpoint.protocol === "https:";
  const state =
    live === "connected"
      ? t("Connected")
      : live === "reconnecting"
        ? t("Reconnecting")
        : t("Connecting");
  return (
    <section className="listen-connection" aria-labelledby="listen-connection-title">
      <h3 id="listen-connection-title">{t("Connection info")}</h3>
      <div className="listen-address">
        <code>{address}</code>
        {copy}
      </div>
      <dl className="listen-connection-facts">
        <div>
          <dt>{t("Protocol")}</dt>
          <dd>{secure ? "HTTPS" : "HTTP"}</dd>
        </div>
        <div>
          <dt>{t("TCP port")}</dt>
          <dd>{endpoint.port || (secure ? "443" : "80")}</dd>
        </div>
        {live !== undefined && (
          <div>
            <dt>{t("Live updates")}</dt>
            <dd role="status">{state}</dd>
          </div>
        )}
      </dl>
      {children}
    </section>
  );
}
