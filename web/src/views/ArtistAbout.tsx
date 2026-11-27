/**
 * @file What is known of an artist, in its page's heading: its photo, or covers of
 * its albums, beside who MusicBrainz says it is, the other names it goes by, and where
 * to read more. An artist linked to MusicBrainz with no photo shows one suggested from
 * Deezer instead of its covers, to use in one click, while Deezer is on; and its photo,
 * or its covers while it has none, open the photo editor from their tools.
 *
 * The links only open the sites in a new tab; nothing here asks them anything.
 */

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Trans } from "react-i18next";

import { type KnownArtist, type Track, coverUrl } from "../api";
import { initialOf } from "../format";
import { artistMosaic, fold } from "../library/views";
import { hrefOf } from "../routes";
import { useWords } from "../locale";
import { ArtistPhotoEditor } from "./ArtistPhotoEditor";
import { Cover } from "./Cover";
import { PictureFrame } from "./PictureFrame";
import { SuggestedPhoto } from "./SuggestedPhoto";

/** How many other names show before *and N more*. */
const NAMES_SHOWN = 6;
const LINK_HELP = "Not linked to an artist yet. <associate>Link it to an artist</associate>";

/** Say who MusicBrainz says the artist is: `The Beatles (Liverpool rock band, GB)`. */
function describe(artist: KnownArtist): string {
  const about = [artist.disambiguation, artist.country].filter(Boolean).join(", ");
  return about === "" ? artist.name : `${artist.name} (${about})`;
}

/** The names the artist goes by, but the one shown and its own, each once. */
function otherNames(artist: KnownArtist, shown: string): string[] {
  const seen = new Set([fold(shown.trim()), fold(artist.name.trim())]);
  const names: string[] = [];
  for (const { name } of artist.aliases) {
    const key = fold(name.trim());
    if (key !== "" && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/** Return `url` when it is a web page over HTTPS, else `null`: a link opens nothing else. */
function overHttps(url: string | null): string | null {
  return url?.startsWith("https://") === true ? url : null;
}

/** Where to read more of the artist, each a page of its own. */
function placesOf(name: string, artist: KnownArtist | undefined) {
  const search = encodeURIComponent(artist?.name ?? name);
  return [
    ...(artist === undefined
      ? []
      : [
          { site: "MusicBrainz", href: `https://musicbrainz.org/artist/${artist.id}` },
          {
            site: "Wikidata",
            // Until Wikidata answers, the item holding the MusicBrainz id, found by its search.
            href:
              overHttps(artist.page) ??
              `https://www.wikidata.org/w/index.php?search=${encodeURIComponent(`haswbstatement:P434=${artist.id}`)}`,
          },
        ]),
    {
      site: "Rate Your Music",
      href: `https://rateyourmusic.com/search?searchterm=${search}&searchtype=a`,
    },
  ];
}

/**
 * The picture of the artist `name`, large: its photo, or covers of its albums, `songs`.
 * `artist` is the one it is linked to, if any. `onPhotoUsed`, given, offers a photo
 * suggested for an artist with none and a way to replace its photo, and is called once a
 * photo is used.
 */
export function ArtistPicture({
  name,
  songs,
  artist,
  onPhotoUsed,
}: {
  readonly name: string;
  readonly songs: readonly Track[];
  readonly artist: KnownArtist | undefined;
  readonly onPhotoUsed?: (() => void) | undefined;
}) {
  const t = useWords();
  const covers = artistMosaic(songs);
  const [replacing, setReplacing] = useState(false);
  const photo = artist?.photo ?? null;
  const mosaic = (
    <div
      className={`artist-art tiles-${String(covers.length)}`}
      role="img"
      aria-label={t("Album covers of {{name}}", { name })}
    >
      {covers.length === 0 ? (
        <span className="artist-initial">{initialOf(name)}</span>
      ) : (
        covers.map((cover) => (
          <Cover size="medium" key={cover} cover={cover} className="artist-tile" />
        ))
      )}
    </div>
  );
  const shown =
    photo === null ? (
      mosaic
    ) : (
      <div className="artist-art tiles-1" role="img" aria-label={t("Photo of {{name}}", { name })}>
        <Cover size="medium" cover={photo} className="artist-tile">
          <span className="artist-initial">{initialOf(name)}</span>
        </Cover>
      </div>
    );
  const framed =
    artist === undefined || onPhotoUsed === undefined ? (
      shown
    ) : (
      <PictureFrame
        className="artist-frame"
        replaceLabel={photo === null ? "Add a photo" : "Replace the photo"}
        save={photo === null ? undefined : { href: coverUrl(photo, "original"), name }}
        onReplace={() => {
          setReplacing(true);
        }}
      >
        {shown}
      </PictureFrame>
    );
  return (
    <div className="artist-picture">
      {photo === null && artist !== undefined && onPhotoUsed !== undefined ? (
        <SuggestedPhoto artistId={artist.id} name={name} fallback={framed} onUsed={onPhotoUsed} />
      ) : (
        framed
      )}
      {replacing && artist !== undefined && onPhotoUsed !== undefined && (
        <ArtistPhotoEditor
          artistId={artist.id}
          name={name}
          shown={photo}
          onChanged={onPhotoUsed}
          onClose={() => {
            setReplacing(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * What is known of the artist `name`: `artist` is the one it is linked to, if any, and
 * `toLink` says whether it could be linked to one on Clean up.
 */
export function ArtistFacts({
  name,
  artist,
  toLink,
}: {
  readonly name: string;
  readonly artist: KnownArtist | undefined;
  readonly toLink: boolean;
}) {
  const t = useWords();
  const others = artist === undefined ? [] : otherNames(artist, name);
  const [allNames, setAllNames] = useState(false);
  const hidden = allNames ? 0 : Math.max(0, others.length - NAMES_SHOWN);
  const photo = artist?.photo ?? null;
  const credit = overHttps(artist?.photo_page ?? null);
  return (
    <section className="artist-facts" aria-label={t("About the artist")}>
      {artist !== undefined && <p className="artist-who">{describe(artist)}</p>}
      {artist?.about != null && <p className="artist-note">{artist.about}</p>}
      {others.length > 0 && (
        <p className="artist-names">
          {t("Goes by {{names}}", {
            names: others.slice(0, others.length - hidden).join(t(", ")),
          })}
          {hidden > 0 && (
            <>
              {" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setAllNames(true);
                }}
              >
                {t("and {{count}} more names", {
                  count: hidden,
                  defaultValue: "and {{count}} more",
                })}
              </button>
            </>
          )}
        </p>
      )}
      <ul className="artist-places" aria-label={t("The artist elsewhere")}>
        {placesOf(name, artist).map(({ site, href }) => (
          <li key={site}>
            <a
              className="artist-place"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={t("Open {{site}} in a new tab", { site })}
            >
              {site}
              <ArrowSquareOutIcon aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      {photo !== null && credit !== null && (
        <p className="artist-credit">
          <a
            href={credit}
            target="_blank"
            rel="noopener noreferrer"
            title={t("Who took the photo, and its license, in a new tab")}
          >
            {t("Photo: Wikimedia Commons")}
          </a>
        </p>
      )}
      {toLink && (
        <p className="hint">
          <Trans
            t={t}
            i18nKey={LINK_HELP}
            defaults={LINK_HELP}
            components={{ associate: <a href={hrefOf({ view: "clean-up" })} /> }}
          />
        </p>
      )}
    </section>
  );
}
