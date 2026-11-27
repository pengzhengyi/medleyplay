/**
 * @file The Bilibili section of Settings, for an admin: the household's proxy for Bilibili.
 *
 * The proxy is the household's own path to the site; it is used for every request
 * to Bilibili and nothing is tried around a refusal. Its URL may hold a password, so
 * it is typed into a password field, kept in the Keychain, and never shown again:
 * the section shows only its address and whether it has a login.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { ApiError, type ProxySetting, api } from "../api";
import { classOf, useNote } from "../useNote";
import { type Words, useWords } from "../locale";

const SITE = "bilibili";
const PROXY_SHAPE =
  "A proxy is written like socks5h://127.0.0.1:7890, or http://user:password@host:3128.";
const INVALID_PROXY: ReadonlySet<string> = new Set([
  PROXY_SHAPE,
  `A proxy is http, https, or socks5h. ${PROXY_SHAPE}`,
  `A proxy needs a host. ${PROXY_SHAPE}`,
  "A proxy has no path.",
  "A proxy is at most 512 characters long.",
  "A proxy is at most 512 characters, its login written as %XX for each byte outside ASCII.",
  "A proxy has no spaces or control characters.",
  "A proxy has no query or fragment; write ? and # in a password as %3F and %23.",
  "Use socks5h, which looks names up through the proxy.",
  "A proxy's port is a number from 1 to 65535.",
  "A proxy needs a port from 1 to 65535.",
  "A proxy's login needs a user name.",
  "A proxy's login has no control characters.",
]);

function proxyError(failure: unknown, saving: boolean, t: Words): string {
  const detail = failure instanceof Error ? failure.message : String(failure);
  if (
    failure instanceof ApiError &&
    ((failure.status === 403 && detail === "Only an admin can manage proxies.") ||
      (saving && failure.status === 422 && INVALID_PROXY.has(detail)))
  )
    return t(detail);
  return detail;
}

/** The proxy for Bilibili now, a field to set another, and a button to remove it. */
export function BilibiliSettings() {
  const t = useWords();
  const [loaded, setLoaded] = useState(false);
  const [proxy, setProxy] = useState<ProxySetting | null>(null);
  const [url, setUrl] = useState("");
  const notes = useNote();
  const [failure, setFailure] = useState<{ readonly cause: unknown; readonly saving: boolean }>();
  const error = failure === undefined ? "" : proxyError(failure.cause, failure.saving, t);

  const failed = (cause: unknown) => {
    setFailure({ cause, saving: false });
  };
  const reload = (
    then = () => {
      notes.tell("");
    },
  ) => {
    api.proxy(SITE).then((read) => {
      setProxy(read);
      setLoaded(true);
      then();
    }, failed);
  };
  const loadOnOpen = useEffectEvent(() => {
    reload();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const save = () => {
    setFailure(undefined);
    api.saveProxy(SITE, url.trim()).then(
      () => {
        setUrl("");
        reload(() => {
          notes.confirm("Saved.");
        });
      },
      (cause: unknown) => {
        setFailure({ cause, saving: true });
      },
    );
  };
  const remove = () => {
    setFailure(undefined);
    api.removeProxy(SITE).then(() => {
      reload(() => {
        notes.confirm("Removed.");
      });
    }, failed);
  };

  return (
    <>
      <h4>{t("Proxy")}</h4>
      {error !== "" && <p role="alert">{error}</p>}
      {!loaded ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            {t("Reading the proxy…")}
          </p>
        )
      ) : (
        <>
          <p>
            {proxy === null ? (
              t("No proxy is set, so Bilibili is reached directly.")
            ) : (
              <>
                <code>{proxy.display}</code>
                {proxy.has_login && t(" with a login")}
              </>
            )}
          </p>
          <form
            className="proxy-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="mark-name">
              {t(proxy === null ? "Proxy URL" : "New proxy URL")}
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={url}
                maxLength={512}
                placeholder="socks5h://user:password@127.0.0.1:7890"
                onChange={(event) => {
                  setUrl(event.target.value);
                }}
              />
            </label>
            <button type="submit" disabled={url.trim() === ""}>
              {t("Save proxy")}
            </button>
            {proxy !== null && (
              <button type="button" className="secondary outline" onClick={remove}>
                {t("Remove proxy")}
              </button>
            )}
            <p className="hint">
              {t(
                "The URL is kept in the Keychain and never shown again. Use http, https, or socks5h. Every request to Bilibili goes through it.",
              )}
            </p>
          </form>
          <p className={classOf(notes.note)} role="status">
            {t(notes.note.text)}
          </p>
        </>
      )}
    </>
  );
}
