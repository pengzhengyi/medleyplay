/**
 * @file The Network section of Settings: the Mode now, its setting, and the metered networks.
 *
 * Anyone sees why medleyplay is Online or Offline and the network the server is
 * on; an admin changes the setting, marks the network the server is on metered,
 * and removes a mark.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { ApiError, type Mode, type ModeSetting, type ModeSettings, api } from "../api";
import { useFormattingLocale, useWords } from "../locale";
import { SETTINGS, checkable, networkSaid, offlineBecause } from "../mode";
import { classOf, useNote } from "../useNote";
import { CheckNetwork } from "./CheckNetwork";

const UNIDENTIFIED_NETWORK =
  "The server can't tell which network it is on now, so it can't mark it.";

/** The Mode now, and, for an admin, its setting and the metered networks to change. */
export function NetworkSettings({
  admin,
  mode,
  onModeChecked,
}: {
  readonly admin: boolean;
  readonly mode: Mode | null;
  readonly onModeChecked: (mode: Mode) => void;
}) {
  const t = useWords();
  const [settings, setSettings] = useState<ModeSettings | undefined>(undefined);
  const [name, setName] = useState("");
  const notes = useNote();
  const [failure, setFailure] = useState<
    { readonly key: typeof UNIDENTIFIED_NETWORK } | { readonly detail: string }
  >();
  const error = failure === undefined ? "" : "key" in failure ? t(failure.key) : failure.detail;

  const failed = (failure: unknown) => {
    setFailure({ detail: failure instanceof Error ? failure.message : String(failure) });
  };
  const reload = (
    then = () => {
      notes.tell("");
    },
  ) => {
    api.modeSettings().then((read) => {
      setSettings(read);
      then();
    }, failed);
  };
  const loadOnOpen = useEffectEvent(() => {
    reload();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const choose = (setting: ModeSetting) => {
    if (settings === undefined) {
      return;
    }
    setFailure(undefined);
    setSettings({ ...settings, setting });
    api.saveModeSetting(setting, settings.revision).then(setSettings, (failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 409) {
        reload(() => {
          notes.tell(
            "The setting changed elsewhere, so here it is now. Choose again to change it.",
          );
        });
        return;
      }
      failed(failure);
      reload();
    });
  };
  const mark = () => {
    setFailure(undefined);
    api.markMetered(name.trim()).then(
      () => {
        setName("");
        reload(() => {
          notes.confirm("Marked.");
        });
      },
      (failure: unknown) => {
        if (
          failure instanceof ApiError &&
          failure.status === 409 &&
          failure.message === UNIDENTIFIED_NETWORK
        ) {
          setFailure({ key: UNIDENTIFIED_NETWORK });
        } else {
          failed(failure);
        }
      },
    );
  };
  const unmark = (id: number) => {
    setFailure(undefined);
    api.unmarkMetered(id).then(() => {
      reload();
    }, failed);
  };

  const network = mode?.network ?? null;
  return (
    <>
      {error !== "" && <p role="alert">{error}</p>}
      <ModeNow mode={mode} onChecked={onModeChecked} />
      {settings === undefined ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            {t("Reading the network settings…")}
          </p>
        )
      ) : (
        <>
          {admin ? (
            <fieldset className="mode-setting">
              <legend>{t("When medleyplay may contact music sites")}</legend>
              {SETTINGS.map(({ setting, said }) => (
                <label key={setting} className="mode-choice">
                  <input
                    type="radio"
                    name="mode-setting"
                    checked={settings.setting === setting}
                    onChange={() => {
                      choose(setting);
                    }}
                  />
                  {t(said)}
                </label>
              ))}
            </fieldset>
          ) : (
            <p>
              {t("{{setting}}. An admin changes this.", {
                setting: t(
                  SETTINGS.find(({ setting }) => setting === settings.setting)?.said ?? "",
                ),
              })}
            </p>
          )}
          {admin && network !== null && network.metered_as === null && (
            <form
              className="mark-metered"
              onSubmit={(event) => {
                event.preventDefault();
                mark();
              }}
            >
              <label className="mark-name">
                {t("Mark this network metered, as")}
                <input
                  type="text"
                  value={name}
                  maxLength={64}
                  required
                  placeholder={t(network.hotspot_like ? "Phone hotspot" : "A name, such as Office")}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              </label>
              <button type="submit" disabled={name.trim() === ""}>
                {t("Mark metered")}
              </button>
              {network.hotspot_like && (
                <p className="hint">{t("This network looks like a phone's hotspot.")}</p>
              )}
            </form>
          )}
          {settings.metered.length > 0 && (
            <>
              <h4>{t("Metered networks")}</h4>
              <ul className="metered">
                {settings.metered.map((each) => (
                  <li key={each.id}>
                    <span>
                      {each.name} <span className="hint">{each.subnet}</span>
                    </span>
                    {admin && (
                      <button
                        type="button"
                        className="secondary outline"
                        aria-label={t("Remove the mark on {{name}}", { name: each.name })}
                        onClick={() => {
                          unmark(each.id);
                        }}
                      >
                        {t("Remove")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="hint">
                {t(
                  "A phone that changes its hotspot's address is a new network until it is marked again.",
                )}
              </p>
            </>
          )}
          <p className={classOf(notes.note)} role="status">
            {t(notes.note.text)}
          </p>
        </>
      )}
    </>
  );
}

/** Whether medleyplay is Online or Offline and why, the network, when it was checked, and what waits. */
function ModeNow({
  mode,
  onChecked,
}: {
  readonly mode: Mode | null;
  readonly onChecked: (mode: Mode) => void;
}) {
  const t = useWords();
  const locale = useFormattingLocale();
  if (mode === null) {
    return (
      <p className="hint" aria-busy="true">
        {t("Reading the network…")}
      </p>
    );
  }
  const because = offlineBecause(mode);
  const count = mode.held_jobs;
  return (
    <div className="mode-now">
      <p>
        <strong>
          {because === null ? t("Online.") : t("Offline: {{reason}}.", { reason: t(because) })}
        </strong>{" "}
        {mode.online_at !== null &&
          t("Goes Online at {{time}} if nothing changes.", {
            time: timeOf(mode.online_at, locale),
          })}
      </p>
      <p>{networkSaid(mode, t)}</p>
      {(mode.checked_at !== null || checkable(mode)) && (
        <p className="mode-checked">
          {mode.checked_at !== null && (
            <span className="hint">
              {t("Internet last checked at {{time}}.", { time: timeOf(mode.checked_at, locale) })}
            </span>
          )}
          {checkable(mode) && <CheckNetwork said={t("Check now")} onChecked={onChecked} />}
        </p>
      )}
      {count > 0 && (
        <p className="hint">
          {t(
            count === 1 ? "1 download waits for Online." : "{{count}} downloads wait for Online.",
            { count },
          )}
        </p>
      )}
    </div>
  );
}

function timeOf(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
