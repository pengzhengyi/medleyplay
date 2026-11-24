/** @file Renders written artist credits as links when they name Library profiles. */

import { Fragment, use } from "react";

import type { Track } from "../api";
import {
  type ArtistCredit,
  albumArtistCredits,
  songArtistCredits,
  trackAlbumArtistCredits,
} from "../library/artistProfileLinks";
import { hrefOf } from "../routes";
import { LocalArtistProfiles } from "./artistProfilesContext";

function Credits({ credits }: { readonly credits: readonly ArtistCredit[] }) {
  return credits.map(({ name, to }, place) => (
    <Fragment key={`${String(place)}:${name}`}>
      {place > 0 && ", "}
      {to === undefined ? (
        name
      ) : (
        <a className="artist-link" href={hrefOf(to)}>
          {name}
        </a>
      )}
    </Fragment>
  ));
}

export function TrackArtistCredit({
  track,
  album = false,
}: {
  readonly track: Track;
  readonly album?: boolean;
}) {
  const profiles = use(LocalArtistProfiles);
  return (
    <Credits
      credits={
        album ? trackAlbumArtistCredits(track, profiles) : songArtistCredits(track, profiles)
      }
    />
  );
}

export function AlbumArtistCredit({
  name,
  songs,
}: {
  readonly name: string;
  readonly songs: readonly Track[];
}) {
  const profiles = use(LocalArtistProfiles);
  return <Credits credits={albumArtistCredits(name, songs, profiles)} />;
}
