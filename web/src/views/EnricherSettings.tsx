/**
 * @file The part of Settings that runs one enricher for an admin: when it is asked, and a
 * reset after its site refused it.
 *
 * It is asked manually by default: only when someone chooses it. It can be asked
 * instead about the songs coming up to play, or about every Track it may be asked
 * about. Whichever is chosen, the first time a site refuses a request, the lookup
 * stops for good until it is reset here.
 */

import { type ReactNode, useEffect, useEffectEvent, useId, useState } from "react";

import { type Enricher, type EnricherMode, api } from "../api";

/** How one enricher's part of Settings reads. */
export interface EnricherWords {
  /** The enricher's name. */
  readonly enricher: string;
  /** The site it asks, as the refusal names it. */
  readonly site: string;
  readonly heading: string;
  readonly description: ReactNode;
  /** Says how many Tracks can be looked up. */
  readonly count: (tracks: number) => string;
  /** Says the lookup is turned off. */
  readonly off: string;
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
  const [enricher, setEnricher] = useState<Enricher | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const modeHint = useId();

  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const reload = (then = "") => {
    api.enricher(words.enricher).then((read) => {
      setEnricher(read);
      setNote(then);
    }, failed);
  };
  const loadOnOpen = useEffectEvent(() => {
    reload();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const choose = (mode: EnricherMode) => {
    setError("");
    setNote("");
    setSaving(true);
    api.setEnricherMode(words.enricher, mode).then(
      (read) => {
        setSaving(false);
        setEnricher(read);
        setNote("Saved.");
        onChanged();
      },
      (failure: unknown) => {
        setSaving(false);
        failed(failure);
      },
    );
  };
  const reset = () => {
    setError("");
    api.resetEnricher(words.enricher).then(() => {
      reload("Reset.");
    }, failed);
  };

  const chosen = MODES.find((each) => each.mode === enricher?.mode) ?? MODES[0];
  return (
    <>
      <h4>{words.heading}</h4>
      <p className="hint">{words.description}</p>
      {error !== "" && <p role="alert">{error}</p>}
      {enricher === null ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            Reading {words.heading.toLowerCase()}…
          </p>
        )
      ) : !enricher.available ? (
        <p>{words.off}</p>
      ) : (
        <>
          <fieldset className="enricher-mode" aria-describedby={modeHint} disabled={saving}>
            <legend>Ask {words.site}</legend>
            {MODES.map(({ mode, label }) => (
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
                {label}
              </label>
            ))}
            <small id={modeHint} className="hint enricher-mode-does">
              {chosen?.does}
            </small>
          </fieldset>
          {enricher.stopped !== null ? (
            <p role="alert">
              Stopped after {words.site} refused a request: {enricher.stopped.reason} Nothing more
              is asked until it is reset.{" "}
              <button type="button" className="secondary outline enricher-reset" onClick={reset}>
                Reset
              </button>
            </p>
          ) : (
            <p>{words.count(enricher.eligible.length)}</p>
          )}
        </>
      )}
      <p className="hint" role="status">
        {note}
      </p>
    </>
  );
}
