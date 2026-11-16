/**
 * @file Splitting artist names written as several artists, a section of Clean up.
 *
 * Each name written as several, such as *GUMI/MAYU* or *スズム feat. GUMI*: how many songs
 * show it, and the artists it lists, featured ones marked. *Split* makes each song count
 * under each artist; *Keep* keeps the name as written, as one artist. *Split all* splits
 * every name not linked to one artist. The names decided are listed, folded away, each
 * to undo, which offers it again.
 */

import { UsersThreeIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { type ArtistSplitOffer, type ArtistSplits, api } from "../api";

/** Say the artists a name lists, as *GUMI and MAYU* or *スズム, GUMI and MAYU*. */
function listed(offer: ArtistSplitOffer): string {
  const names = offer.artists.map((artist) => artist.written);
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** The names to split into their artists, each to split or keep, and the names decided. */
export function SplitArtistNames({
  splits,
  onChanged,
}: {
  readonly splits: ArtistSplits;
  /** Called after a change, so the names are read again. */
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { offers, decided } = splits;
  const unlinked = offers.filter((offer) => !offer.linked);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <section className="clean-up-section" aria-labelledby="split-artist-names-title">
      <header className="clean-up-head">
        <h3 id="split-artist-names-title">
          <UsersThreeIcon className="clean-up-icon" weight="bold" aria-hidden />
          Split artist names
          <span className="clean-up-count">{offers.length}</span>
        </h3>
        {unlinked.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={busy}
            onClick={() =>
              void run(() => api.splitArtistNames(unlinked.map((offer) => offer.written)))
            }
          >
            Split all
          </button>
        )}
      </header>
      <p className="tidy-lead">
        These names list several artists. Splitting one counts each song under each artist, and lets
        each be linked on its own; the songs keep the name as written.
      </p>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {offers.length === 0 ? (
        <p className="empty">Every name listing several artists is split, or kept as written.</p>
      ) : (
        <ul className="tidy-list" aria-label="Names to split">
          {offers.map((offer) => (
            <li key={offer.written} className="tidy-row split-name-row">
              <strong className="tidy-name">{offer.written}</strong>
              <span className="tidy-meta">
                {offer.songs === 1 ? "1 song" : `${String(offer.songs)} songs`}
              </span>
              <span className="split-name-artists">
                {offer.artists.map((artist) => (
                  <span
                    key={artist.written}
                    className={
                      artist.role === "featured"
                        ? "split-name-artist split-name-featured"
                        : "split-name-artist"
                    }
                  >
                    {artist.role === "featured" && (
                      <span className="split-name-feat" title="Featured">
                        feat.
                      </span>
                    )}
                    {artist.written}
                  </span>
                ))}
              </span>
              {offer.linked && (
                <p className="split-name-linked">
                  Linked to one artist on MusicBrainz, so it may name one artist.
                </p>
              )}
              <div className="tidy-actions">
                <button
                  type="button"
                  className="secondary outline dialog-button"
                  aria-label={`Keep ${offer.written} as written`}
                  disabled={busy}
                  onClick={() => void run(() => api.keepArtistNames([offer.written]))}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="dialog-button"
                  aria-label={`Split ${offer.written} into ${listed(offer)}`}
                  disabled={busy}
                  onClick={() => void run(() => api.splitArtistNames([offer.written]))}
                >
                  Split
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <details className="split-names-decided">
          <summary className="split-names-decided-summary">
            {decided.length === 1 ? "1 name decided" : `${String(decided.length)} names decided`}
          </summary>
          <ul className="tidy-list" aria-label="Names decided">
            {decided.map((each) => (
              <li key={each.written} className="tidy-row">
                <strong className="tidy-name">{each.written}</strong>
                <span className="tidy-meta">{each.split ? "Split" : "Kept as written"}</span>
                <div className="tidy-actions">
                  <button
                    type="button"
                    className="secondary outline dialog-button"
                    aria-label={`Undo ${each.split ? "splitting" : "keeping"} ${each.written}`}
                    disabled={busy}
                    onClick={() => void run(() => api.forgetArtistNames([each.written]))}
                  >
                    Undo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
