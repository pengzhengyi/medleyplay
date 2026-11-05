/**
 * @file The video details part of the Bilibili section of Settings, for an admin: queue the
 * lookup for every Track that can have one, and reset the lookup after Bilibili refused it.
 *
 * Nothing contacts Bilibili unless someone asks, so this section only asks on a click. The
 * first time Bilibili refuses a request, the lookup stops for good until it is reset here.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { DETAILS_ENRICHER, type Enricher, api } from "../api";

/** The lookup's state, a button to queue every Track, and a button to reset it once stopped. */
export function VideoDetailsSettings() {
  const [enricher, setEnricher] = useState<Enricher | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const reload = (then = "") => {
    api.enricher(DETAILS_ENRICHER).then((read) => {
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
    api.findDetailsForAll(DETAILS_ENRICHER).then(({ queued }) => {
      reload(queued === 1 ? "Queued 1 Track." : `Queued ${String(queued)} Tracks.`);
    }, failed);
  };
  const reset = () => {
    setError("");
    api.resetEnricher(DETAILS_ENRICHER).then(() => {
      reload("Reset.");
    }, failed);
  };

  return (
    <>
      <h4>Video details</h4>
      <p className="hint">
        Find details online asks Bilibili for a video&apos;s title, description, and cover. It asks
        only when someone chooses it, one Track at a time, and never the same video twice in a day.
      </p>
      {error !== "" && <p role="alert">{error}</p>}
      {enricher === null ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            Reading the video details…
          </p>
        )
      ) : (
        <>
          {!enricher.available ? (
            <p>Finding video details is turned off.</p>
          ) : enricher.stopped !== null ? (
            <p role="alert">
              Stopped after Bilibili refused a request: {enricher.stopped.reason} Nothing more is
              asked until it is reset.
            </p>
          ) : (
            <p>
              {enricher.eligible.length === 1
                ? "1 Track can have its details found."
                : `${String(enricher.eligible.length)} Tracks can have their details found.`}
            </p>
          )}
          {enricher.available && (
            <p>
              <button
                type="button"
                disabled={enricher.stopped !== null || enricher.eligible.length === 0}
                onClick={findForAll}
              >
                Find details for all
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
