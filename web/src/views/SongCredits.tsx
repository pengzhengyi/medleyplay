/**
 * @file Who sings a song and the album it is on, each a link to its own page.
 *
 * ```text
 * 周杰伦, 费玉清 — 叶惠美
 * ```
 *
 * A song by several artists names each, each with its own page, as Now Playing does.
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
  return (
    <span className="song-credits">
      {artists.map(({ name, place }, at) => (
        <Fragment key={`${name}-${String(place)}`}>
          {at > 0 && ", "}
          <a href={hrefOf(artistRouteOf(track, place))}>{name}</a>
        </Fragment>
      ))}
      {artists.length > 0 && album !== "" && " — "}
      {album !== "" && (
        <a href={hrefOf({ view: "album", artist: albumArtistOf(track), name: album })}>{album}</a>
      )}
    </span>
  );
}
