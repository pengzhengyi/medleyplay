/**
 * @file Finding photos of artists with none, a section of Clean up.
 *
 * Each artist linked to MusicBrainz with no photo for which Deezer has a picture that
 * fits shows it, ringed and tagged as a suggestion, to use or dismiss in one click, or to
 * choose another in the photo editor; *Use all* uses every one. The rest are counted: those Deezer has nothing for, and those not looked up
 * yet, which are looked up as their songs come up next, or all at once on opening Clean
 * up, as Settings → Deezer says. While Deezer is asked, it reads again every few seconds.
 */

import { CircleNotchIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useState } from "react";

import { type MissingPhoto, api } from "../api";
import { photosToUseOf } from "../library/cleanUp";
import { hrefOf } from "../routes";
import { ArtistPhotoEditor } from "./ArtistPhotoEditor";
import { Cover } from "./Cover";
import { SuggestedFrame } from "./SuggestedFrame";
import { Trans } from "react-i18next";
import { useWords } from "../locale";

const READ_EVERY_MS = 3000;
const SETTINGS_HELP = "They are looked up as <settings>Settings → Deezer</settings> says.";
type Suggested = MissingPhoto & { readonly suggested: string };
const suggestionKey = (photo: Suggested) => JSON.stringify([photo.artist_id, photo.suggested]);

/** The artists with no photo, each with the one suggested, to use. */
export function FindPhotos({
  artists,
  answered,
  onChanged,
  admin = false,
}: {
  readonly artists: readonly MissingPhoto[];
  /** How many answers came while Deezer was asked, the same one too; each reads again. */
  readonly answered: number;
  /** Called after a change, or to read the artists again. */
  readonly onChanged: () => void;
  readonly admin?: boolean;
}) {
  const t = useWords();
  // The artists whose photo is being used or dismissed: each stays saving until it is gone.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [usingAll, setUsingAll] = useState<number>();
  const [error, setError] = useState("");
  // The artist whose photo is chosen in the photo editor, if any.
  const [changing, setChanging] = useState<MissingPhoto>();
  const readAgain = useEffectEvent(onChanged);
  // Opened, every artist with no photo is looked up, while the household has every one be.
  useEffect(() => {
    api.findPhotos(null).then(
      ({ asked }) => {
        if (asked > 0) {
          readAgain();
        }
      },
      () => {
        // Nothing waits on it: the artists are looked up as their songs come up next.
      },
    );
  }, []);
  const finding = artists.filter((each) => each.finding).length;
  useEffect(() => {
    if (finding === 0) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [answered, finding]);

  const suggested = artists.filter((each): each is Suggested => each.suggested !== null);
  const unfit = artists.filter(
    (each) => each.suggested === null && each.found && !each.finding,
  ).length;
  const unasked = artists.filter((each) => !each.found && !each.finding).length;
  const ready = suggested.filter((each) => !saving.has(suggestionKey(each)));
  const [previousArtists, setPreviousArtists] = useState(artists);
  if (previousArtists !== artists) {
    setPreviousArtists(artists);
    const current = new Set(suggested.map(suggestionKey));
    setSaving(new Set([...saving].filter((key) => current.has(key))));
  }
  // Saves `change` to the artists `ids`, saving until they are read again without them.
  const save = async (ids: readonly string[], change: () => Promise<unknown>) => {
    setSaving((was) => new Set([...was, ...ids]));
    setError("");
    try {
      await change();
    } catch (failure) {
      setSaving((was) => new Set([...was].filter((id) => !ids.includes(id))));
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      onChanged();
    }
  };
  const take = (chosen: readonly Suggested[]) =>
    save(chosen.map(suggestionKey), async () => {
      for (const each of chosen) {
        await api.useArtistPhotoCover(each.artist_id, each.suggested);
      }
    });
  const takeAll = async () => {
    setUsingAll(ready.length);
    await take(ready);
    setUsingAll(undefined);
  };
  const dismiss = (artist: Suggested) =>
    save([suggestionKey(artist)], () =>
      api.dismissArtistPicture(artist.artist_id, artist.suggested),
    );
  return (
    <section className="clean-up-section" aria-labelledby="find-photos-title">
      <header className="clean-up-head">
        <h3 id="find-photos-title">
          <UserCircleIcon className="clean-up-icon" weight="bold" aria-hidden />
          {t("Find artist photos")}
          <span className="clean-up-count">{photosToUseOf(artists)}</span>
        </h3>
        {suggested.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={usingAll !== undefined || ready.length === 0}
            aria-busy={usingAll !== undefined}
            onClick={() => void takeAll()}
          >
            {t("Use all {{count}}", { count: usingAll ?? ready.length })}
          </button>
        )}
      </header>
      <p className="tidy-lead">
        {t(
          "A photo found on Deezer for each artist with none. Using one makes it the artist's photo.",
        )}
      </p>
      {error !== "" && (
        <p className="error" role="alert">
          {t("Could not update the photo suggestions: {{detail}}", { detail: error })}
        </p>
      )}
      {finding > 0 && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {t("artist_photo_search", { count: finding })}
        </p>
      )}
      {suggested.length > 0 && (
        <ul className="photo-suggestions" aria-label={t("Photos suggested")}>
          {suggested.map((each) => (
            <li key={each.artist_id} className="photo-suggestion-item">
              <SuggestedFrame
                of={each.name}
                why={t(
                  each.picked ? "An AI model picked this" : "Going by this artist's name on Deezer",
                )}
                picked={each.picked}
                busy={saving.has(suggestionKey(each))}
                onUse={() => void take([each])}
                onDismiss={() => void dismiss(each)}
                onChange={() => {
                  setChanging(each);
                }}
              >
                <Cover size="medium" cover={each.suggested} className="photo-suggestion-picture" />
              </SuggestedFrame>
              <a
                className="photo-suggestion-name"
                href={hrefOf({ view: "artist", name: each.name })}
              >
                {each.name}
              </a>
              <span className="tidy-meta">{t("song_count", { count: each.songs })}</span>
            </li>
          ))}
        </ul>
      )}
      {unfit + unasked > 0 && (
        <p className="tidy-lead">
          {[
            unfit > 0 && t("artist_photo_no_match", { count: unfit }),
            unasked > 0 && t("artist_photo_not_searched", { count: unasked }),
          ]
            .filter(Boolean)
            .join(t("; "))}
          {t(". ")}
          {unasked > 0 &&
            (admin ? (
              <Trans
                t={t}
                i18nKey={SETTINGS_HELP}
                defaults={SETTINGS_HELP}
                components={{
                  settings: <a href={hrefOf({ view: "settings", section: "deezer" })} />,
                }}
              />
            ) : (
              t("An admin controls when Deezer searches for photos.")
            ))}
        </p>
      )}
      {changing !== undefined && (
        <ArtistPhotoEditor
          artistId={changing.artist_id}
          name={changing.name}
          shown={null}
          onChanged={onChanged}
          onClose={() => {
            setChanging(undefined);
          }}
        />
      )}
    </section>
  );
}
