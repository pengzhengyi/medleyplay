/**
 * @file The part of Settings that runs one enricher for an admin: when it is asked, and a
 * reset after its site refused it.
 *
 * Most are asked manually by default: only when someone chooses it. One can be asked
 * instead about the songs coming up to play, or about every Track it may be asked
 * about, among the ways the enricher allows. Whichever is chosen, the first time a site
 * refuses a request, the lookup stops for good until it is reset here.
 */

import { useEffect, useEffectEvent, useId, useState } from "react";

import { AI_ENRICHER, ApiError, type Enricher, type EnricherMode, api } from "../api";
import { type Words, useWords } from "../locale";
import { classOf, useNote } from "../useNote";

/** How one enricher's part of Settings reads. */
export interface EnricherWords {
  /** The enricher's name. */
  readonly enricher: string;
  /** The site it asks, as the refusal names it. */
  readonly site: string;
  readonly heading: string;
  readonly description: string;
  /** Says how many Tracks can be looked up. */
  readonly count: (tracks: number, t: Words) => string;
  /** Says the lookup is turned off. */
  readonly off: string;
  /** The ways it may be asked, when not every way. */
  readonly modes?: readonly EnricherMode[];
  readonly manualHelp?: string;
}

/** Each mode, a word or two for it, and what it does. */
const MODES: readonly {
  readonly mode: EnricherMode;
  readonly label: string;
  readonly does: string;
}[] = [
  { mode: "manual", label: "Manually", does: "Only when someone chooses it, one Track at a time." },
  {
    mode: "next",
    label: "Next to play",
    does: "For the song playing and the one after it, as each comes up.",
  },
  {
    mode: "all",
    label: "All missing",
    does: "For every Track that can be, a few at a time, and for each one added later.",
  },
];

/**
 * When the lookup is asked, the Tracks it can be asked about, and a reset once stopped.
 * `onChanged` is called once the mode is saved, since the page asks by it.
 */
export function EnricherSettings({
  words,
  onChanged = () => undefined,
}: {
  readonly words: EnricherWords;
  readonly onChanged?: (() => void) | undefined;
}) {
  const t = useWords();
  const [enricher, setEnricher] = useState<Enricher | null>(null);
  const [saving, setSaving] = useState(false);
  const notes = useNote();
  const [failure, setFailure] = useState<{ readonly cause: unknown }>();
  const cause = failure?.cause;
  const detail =
    failure === undefined ? "" : cause instanceof Error ? cause.message : String(cause);
  const error =
    cause instanceof ApiError &&
    cause.status === 403 &&
    detail === "Only an admin manages what the enrichers do for every Track."
      ? t(detail)
      : detail;
  const modeHint = useId();

  const failed = (failure: unknown) => {
    setFailure({ cause: failure });
  };
  const reload = (
    then = () => {
      notes.tell("");
    },
  ) => {
    api.enricher(words.enricher).then((read) => {
      setEnricher(read);
      then();
    }, failed);
  };
  const loadOnOpen = useEffectEvent(() => {
    reload();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const choose = (mode: EnricherMode) => {
    setFailure(undefined);
    notes.tell("");
    setSaving(true);
    api.setEnricherMode(words.enricher, mode).then(
      (read) => {
        setSaving(false);
        setEnricher(read);
        notes.confirm("Saved.");
        onChanged();
      },
      (failure: unknown) => {
        setSaving(false);
        failed(failure);
      },
    );
  };
  const reset = () => {
    setFailure(undefined);
    api.resetEnricher(words.enricher).then(() => {
      reload(() => {
        notes.confirm("Reset.");
      });
    }, failed);
  };

  const offered = MODES.filter(({ mode }) => words.modes?.includes(mode) ?? true);
  const chosen = offered.find((each) => each.mode === enricher?.mode) ?? offered[0];
  const site = words.enricher === AI_ENRICHER ? t(words.site) : words.site;
  return (
    <>
      <h4>{t(words.heading, { context: "enricher" })}</h4>
      <p className="hint">{t(words.description)}</p>
      {error !== "" && <p role="alert">{error}</p>}
      {enricher === null ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            {t("Reading {{heading}}…", {
              heading: t(words.heading, { context: "enricher" }).toLocaleLowerCase(),
            })}
          </p>
        )
      ) : !enricher.available ? (
        <p>{t(words.off)}</p>
      ) : (
        <>
          <fieldset className="enricher-mode" aria-describedby={modeHint} disabled={saving}>
            <legend>{t("Ask {{site}}", { site })}</legend>
            {offered.map(({ mode, label }) => (
              <label key={mode} className="enricher-mode-choice">
                <input
                  className="enricher-mode-radio"
                  type="radio"
                  name={`${words.enricher}-mode`}
                  value={mode}
                  checked={enricher.mode === mode}
                  onChange={() => {
                    choose(mode);
                  }}
                />
                {t(label)}
              </label>
            ))}
            <small id={modeHint} className="hint enricher-mode-does">
              {t((chosen?.mode === "manual" ? words.manualHelp : undefined) ?? chosen?.does ?? "")}
            </small>
          </fieldset>
          {enricher.stopped !== null ? (
            <p role="alert">
              {t(
                "Stopped after {{site}} refused a request: {{reason}} Nothing more is asked until it is reset.",
                {
                  site,
                  reason: enricher.stopped.reason,
                },
              )}{" "}
              <button type="button" className="secondary outline enricher-reset" onClick={reset}>
                {t("Reset")}
              </button>
            </p>
          ) : (
            <p>{words.count(enricher.eligible.length, t)}</p>
          )}
        </>
      )}
      <p className={classOf(notes.note)} role="status">
        {t(notes.note.text)}
      </p>
    </>
  );
}
