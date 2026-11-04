/**
 * @file The Bilibili section of Settings, for an admin: the household's proxy for Bilibili.
 *
 * The proxy is the household's own path to the site; it is used for every request
 * to Bilibili and nothing is tried around a refusal. Its URL may hold a password, so
 * it is typed into a password field, kept in the Keychain, and never shown again:
 * the section shows only its address and whether it has a login.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { type ProxySetting, api } from "../api";

const SITE = "bilibili";

/** The proxy for Bilibili now, a field to set another, and a button to remove it. */
export function BilibiliSettings() {
  const [loaded, setLoaded] = useState(false);
  const [proxy, setProxy] = useState<ProxySetting | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const reload = (then = "") => {
    api.proxy(SITE).then((read) => {
      setProxy(read);
      setLoaded(true);
      setNote(then);
    }, failed);
  };
  const loadOnOpen = useEffectEvent(() => {
    reload();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const save = () => {
    setError("");
    api.saveProxy(SITE, url.trim()).then(() => {
      setUrl("");
      reload("Saved.");
    }, failed);
  };
  const remove = () => {
    setError("");
    api.removeProxy(SITE).then(() => {
      reload("Removed.");
    }, failed);
  };

  return (
    <>
      <h4>Proxy</h4>
      {error !== "" && <p role="alert">{error}</p>}
      {!loaded ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            Reading the proxy…
          </p>
        )
      ) : (
        <>
          <p>
            {proxy === null ? (
              "No proxy is set, so Bilibili is reached directly."
            ) : (
              <>
                <code>{proxy.display}</code>
                {proxy.has_login && " with a login"}
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
              {proxy === null ? "Proxy URL" : "New proxy URL"}
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
              Save proxy
            </button>
            {proxy !== null && (
              <button type="button" className="secondary outline" onClick={remove}>
                Remove proxy
              </button>
            )}
            <p className="hint">
              The URL is kept in the Keychain and never shown again. Use http, https, or socks5h.
              Every request to Bilibili goes through it.
            </p>
          </form>
          <p className="hint" role="status">
            {note}
          </p>
        </>
      )}
    </>
  );
}
