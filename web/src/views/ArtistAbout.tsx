/**
 * @file What is known of an artist, under its page's heading: its photo, or covers of
 * its albums, who MusicBrainz says it is, the other names it goes by, and where to
 * read more. An artist linked to MusicBrainz with no photo shows one suggested from
 * Deezer instead of its covers, to use in one click, while Deezer is on; and its photo,
 * or its covers while it has none, open the photo editor from their tools.
 *
 * The links only open the sites in a new tab; nothing here asks them anything.
 */

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { type KnownArtist, type Track, coverUrl } from "../api";
import { initialOf } from "../format";
import { albumsOf, fold } from "../library/views";
import { hrefOf } from "../routes";
import { ArtistPhotoEditor } from "./ArtistPhotoEditor";
import { Cover } from "./Cover";
import { PictureFrame } from "./PictureFrame";
import { SuggestedPhoto } from "./SuggestedPhoto";

/** How many album covers the mosaic shows. */
const MOSAIC = 4;
/** How many other names show before *and N more*. */
const NAMES_SHOWN = 6;

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
 * About the artist `name`: `songs` are its songs, `artist` the one it is linked to,
 * if any, and `toLink` says whether it could be linked to one on Clean up.
 * `onPhotoUsed`, given, offers a photo suggested for an artist with none and a way to
 * replace its photo, and is called once a photo is used.
 */
export function ArtistAbout({
  name,
  songs,
  artist,
  toLink,
  onPhotoUsed,
}: {
  readonly name: string;
  readonly songs: readonly Track[];
  readonly artist: KnownArtist | undefined;
  readonly toLink: boolean;
  readonly onPhotoUsed?: () => void;
}) {
  const covers = albumsOf(songs)
    .flatMap((album) => (album.cover === null ? [] : [album.cover]))
    .slice(0, MOSAIC);
  const others = artist === undefined ? [] : otherNames(artist, name);
  const [allNames, setAllNames] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const hidden = allNames ? 0 : Math.max(0, others.length - NAMES_SHOWN);
  const photo = artist?.photo ?? null;
  const credit = overHttps(artist?.photo_page ?? null);
  const mosaic = (
    <div
      className={`artist-art tiles-${String(covers.length)}`}
      role="img"
      aria-label={`Album covers of ${name}`}
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
      <div className="artist-art tiles-1" role="img" aria-label={`Photo of ${name}`}>
        <Cover size="medium" cover={photo} className="artist-tile">
          <span className="artist-initial">{initialOf(name)}</span>
        </Cover>
      </div>
    );
  // A linked artist's photo, or its covers while it has none, opens the photo editor.
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
    <section className="artist-about" aria-label="About the artist">
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
      <div className="artist-facts">
        {artist !== undefined && <p className="artist-who">{describe(artist)}</p>}
        {artist?.about != null && <p className="artist-note">{artist.about}</p>}
        {others.length > 0 && (
          <p className="artist-names">
            Goes by {others.slice(0, others.length - hidden).join(", ")}
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
                  and {hidden} more
                </button>
              </>
            )}
          </p>
        )}
        <ul className="artist-places" aria-label="The artist elsewhere">
          {placesOf(name, artist).map(({ site, href }) => (
            <li key={site}>
              <a
                className="artist-place"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${site} in a new tab`}
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
              title="Who took the photo, and its license, in a new tab"
            >
              Photo: Wikimedia Commons
            </a>
          </p>
        )}
        {toLink && (
          <p className="hint">
            Not linked to an artist yet.{" "}
            <a href={hrefOf({ view: "clean-up" })}>Link it to an artist</a>
          </p>
        )}
      </div>
    </section>
  );
}
