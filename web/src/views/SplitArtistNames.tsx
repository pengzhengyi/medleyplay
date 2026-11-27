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
import { type Words, useWords } from "../locale";
const MAX_SPLIT_BATCH = 500;

/** Say the artists a name lists, as *GUMI and MAYU* or *スズム, GUMI and MAYU*. */
function listed(offer: ArtistSplitOffer, t: Words): string {
  const names = offer.artists.map((artist) => artist.written);
  return names.length <= 1
    ? names.join("")
    : t("{{others}} and {{last}}", {
        others: names.slice(0, -1).join(t(", ")),
        last: names.at(-1),
      });
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
  const t = useWords();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { offers, decided } = splits;
  const unlinked = offers.filter((offer) => !offer.linked);
  const batch = unlinked.slice(0, MAX_SPLIT_BATCH);

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
          {t("Split artist names")}
          <span className="clean-up-count">{offers.length}</span>
        </h3>
        {unlinked.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={busy}
            onClick={() =>
              void run(() => api.splitArtistNames(batch.map((offer) => offer.written)))
            }
          >
            {unlinked.length > batch.length
              ? t("Split next {{count}} unlinked artist names", { count: batch.length })
              : unlinked.length < offers.length
                ? t("Split {{count}} unlinked artist names", { count: batch.length })
                : t("Split all")}
          </button>
        )}
      </header>
      <p className="tidy-lead">
        {t(
          "These names list several artists. Splitting one counts each song under each artist, and lets each be linked on its own; the songs keep the name as written.",
        )}
      </p>
      {error !== "" && (
        <p className="error" role="alert">
          {t("Could not change the artist names: {{detail}}", { detail: error })}
        </p>
      )}
      {offers.length === 0 ? (
        <p className="empty">
          {t("Every name listing several artists is split, or kept as written.")}
        </p>
      ) : (
        <ul className="tidy-list" aria-label={t("Names to split")}>
          {offers.map((offer) => (
            <li key={offer.written} className="tidy-row split-name-row">
              <strong className="tidy-name">{offer.written}</strong>
              <span className="tidy-meta">{t("song_count", { count: offer.songs })}</span>
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
                      <span className="split-name-feat" title={t("Featured")}>
                        {t("feat.")}
                      </span>
                    )}
                    {artist.written}
                  </span>
                ))}
              </span>
              {offer.linked && (
                <p className="split-name-linked">
                  {t("Linked to one artist on MusicBrainz, so it may name one artist.")}
                </p>
              )}
              <div className="tidy-actions">
                <button
                  type="button"
                  className="secondary outline dialog-button"
                  aria-label={t("Keep {{name}} as written", { name: offer.written })}
                  disabled={busy}
                  onClick={() => void run(() => api.keepArtistNames([offer.written]))}
                >
                  {t("Keep")}
                </button>
                <button
                  type="button"
                  className="dialog-button"
                  aria-label={t("Split {{name}} into {{artists}}", {
                    name: offer.written,
                    artists: listed(offer, t),
                  })}
                  disabled={busy}
                  onClick={() => void run(() => api.splitArtistNames([offer.written]))}
                >
                  {t("Split")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <details className="split-names-decided">
          <summary className="split-names-decided-summary">
            {t("split_names_decided", { count: decided.length })}
          </summary>
          <ul className="tidy-list" aria-label={t("Names decided")}>
            {decided.map((each) => (
              <li key={each.written} className="tidy-row">
                <strong className="tidy-name">{each.written}</strong>
                <span className="tidy-meta">{t(each.split ? "Split" : "Kept as written")}</span>
                <div className="tidy-actions">
                  <button
                    type="button"
                    className="secondary outline dialog-button"
                    aria-label={t(
                      each.split ? "Undo splitting {{name}}" : "Undo keeping {{name}}",
                      { name: each.written },
                    )}
                    disabled={busy}
                    onClick={() => void run(() => api.forgetArtistNames([each.written]))}
                  >
                    {t("Undo")}
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
