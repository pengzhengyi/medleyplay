/**
 * @file Who sings a song and the album it is on, each a link to its own page.
 *
 * ```text
 * 周杰伦, 费玉清 — 叶惠美
 * ```
 *
 * A song by several artists names each, each with its own page, as Now Playing does.
 * The artists and the album are two pieces, each shortened on its own when the line is
 * short of room, so a long name never hides the other; hovering a piece shows it whole.
 */

import { Fragment } from "react";

import type { Track } from "../api";
import { albumArtistOf, artistNamesOf, artistRouteOf } from "../library/views";
import { hrefOf } from "../routes";

/**
 * The artists of `track`, then its album unless the album is the Track itself, each
 * linking to its page.
 */
export function SongCredits({ track }: { readonly track: Track }) {
  const artists = artistNamesOf(track)
    .map((name, place) => ({ name, place }))
    .filter(({ name }) => name !== "");
  const album = track.album !== "" && track.album !== track.title ? track.album : "";
  const written = artists.map(({ name }) => name).join(", ");
  return (
    <span className="song-credits">
      {artists.length > 0 && (
        <span className="credit" title={written}>
          {artists.map(({ name, place }, at) => (
            <Fragment key={`${name}-${String(place)}`}>
              {at > 0 && ", "}
              <a href={hrefOf(artistRouteOf(track, place))}>{name}</a>
            </Fragment>
          ))}
        </span>
      )}
      {artists.length > 0 && album !== "" && <span className="credit-gap"> — </span>}
      {album !== "" && (
        <a
          className="credit"
          title={album}
          href={hrefOf({ view: "album", artist: albumArtistOf(track), name: album })}
        >
          {album}
        </a>
      )}
    </span>
  );
}
