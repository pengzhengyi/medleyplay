/**
 * @file The part of Settings that runs one enricher for an admin: queue the lookup for every
 * Track that can have one, and reset the lookup after its site refused it.
 *
 * Nothing contacts a site unless someone asks, so this part only asks on a click. The first
 * time a site refuses a request, the lookup stops for good until it is reset here.
 */

import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { type Enricher, api } from "../api";

/** How one enricher's part of Settings reads. */
export interface EnricherWords {
  /** The enricher's name. */
  readonly enricher: string;
  /** The site it asks, as the refusal names it. */
  readonly site: string;
  readonly heading: string;
  readonly description: ReactNode;
  /** The words of the button that queues every Track. */
  readonly findAll: string;
  /** Says how many Tracks can be looked up. */
  readonly count: (tracks: number) => string;
  /** Says the lookup is turned off. */
  readonly off: string;
}

/** The lookup's state, a button to queue every Track, and a button to reset it once stopped. */
export function EnricherSettings({ words }: { readonly words: EnricherWords }) {
  const [enricher, setEnricher] = useState<Enricher | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

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

  const findForAll = () => {
    setError("");
    api.findDetailsForAll(words.enricher).then(({ queued }) => {
      reload(queued === 1 ? "Queued 1 Track." : `Queued ${String(queued)} Tracks.`);
    }, failed);
  };
  const reset = () => {
    setError("");
    api.resetEnricher(words.enricher).then(() => {
      reload("Reset.");
    }, failed);
  };

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
      ) : (
        <>
          {!enricher.available ? (
            <p>{words.off}</p>
          ) : enricher.stopped !== null ? (
            <p role="alert">
              Stopped after {words.site} refused a request: {enricher.stopped.reason} Nothing more
              is asked until it is reset.
            </p>
          ) : (
            <p>{words.count(enricher.eligible.length)}</p>
          )}
          {enricher.available && (
            <p>
              <button
                type="button"
                disabled={enricher.stopped !== null || enricher.eligible.length === 0}
                onClick={findForAll}
              >
                {words.findAll}
              </button>{" "}
              {enricher.stopped !== null && (
                <button type="button" className="secondary outline" onClick={reset}>
                  Reset
                </button>
              )}
            </p>
          )}
          <p className="hint" role="status">
            {note}
          </p>
        </>
      )}
    </>
  );
}
