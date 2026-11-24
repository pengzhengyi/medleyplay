/** @file The local profile destinations of written artist credits. */

import type { ArtistNames, Track } from "../api";
import type { Route } from "../routes";
import type { ArtistLinks } from "./artistLinks";
import { artistNamesOf, artistProfileGroup, artistRouteOf, fold, wholeArtistCredit } from "./views";

type ArtistRoute = Extract<Route, { readonly view: "artist" }>;

export interface ArtistCredit {
  readonly name: string;
  readonly to?: ArtistRoute | undefined;
}

// Keep in step with the names the server marks as representing no one artist.
const NO_PERSON = new Set(
  [
    "",
    "Various Artists",
    "Various",
    "V.A.",
    "VA",
    "Unknown",
    "Unknown Artist",
    "群星",
    "佚名",
    "未知",
    "未知艺术家",
    "未知歌手",
    "オムニバス",
  ].map(fold),
);

function profileMembership(tracks: readonly Track[], links: ArtistLinks | undefined) {
  const groups = new Set<string>();
  const groupOfId = new Map<string, string>();
  for (const track of tracks) {
    if (track.split) continue;
    const names = artistNamesOf(track);
    names.forEach((name, place) => {
      const id = track.artist_ids[place];
      const group = artistProfileGroup(name, id, links);
      groups.add(group);
      if (id !== undefined) groupOfId.set(id, group);
    });
    const whole = wholeArtistCredit(track, names);
    if (whole !== undefined) groups.add(artistProfileGroup(whole, undefined, links));
  }
  return { groups, groupOfId };
}

export function artistProfiles(
  tracks: readonly Track[],
  links: ArtistLinks | undefined,
  metadata: ArtistNames | undefined,
) {
  let names: Map<string, ArtistNames["names"][number]> | undefined;
  let membership: ReturnType<typeof profileMembership> | undefined;

  function named(name: string) {
    names ??= new Map(metadata?.names.map((entry) => [fold(entry.name.trim()), entry]));
    return names.get(fold(name.trim()));
  }

  return {
    namesNobody(name: string) {
      return NO_PERSON.has(fold(name.trim())) || named(name)?.look_up === "never";
    },
    has({ name, id }: ArtistRoute) {
      membership ??= profileMembership(tracks, links);
      const { groups, groupOfId } = membership;
      if (id !== undefined && groupOfId.has(id)) return true;
      if (groups.has(artistProfileGroup(name, id, links))) return true;
      const called = id === undefined && links !== undefined ? named(name)?.artist_ids : undefined;
      if (called === undefined) return false;
      const choices = new Set(
        called.map((each) => groupOfId.get(each)).filter((group) => group !== undefined),
      );
      return choices.size > 1;
    },
  };
}

export type ArtistProfiles = ReturnType<typeof artistProfiles>;

function nameCredit(name: string, profiles: ArtistProfiles | undefined): ArtistCredit {
  const to = { view: "artist", name } as const;
  return { name, to: profiles?.namesNobody(name) === false && profiles.has(to) ? to : undefined };
}

export function songArtistCredits(
  track: Track,
  profiles: ArtistProfiles | undefined,
): readonly ArtistCredit[] {
  return artistNamesOf(track).map((name, place) => {
    const to = artistRouteOf(track, place);
    const noArtist = profiles?.namesNobody(name) ?? NO_PERSON.has(fold(name.trim()));
    return {
      name,
      to: noArtist || (track.split && !profiles?.has(to)) ? undefined : to,
    };
  });
}

export function trackAlbumArtistCredits(
  track: Track,
  profiles: ArtistProfiles | undefined,
): readonly ArtistCredit[] {
  return track.album_artist === ""
    ? songArtistCredits(track, profiles)
    : [nameCredit(track.album_artist, profiles)];
}

export function albumArtistCredits(
  name: string,
  songs: readonly Track[],
  profiles: ArtistProfiles | undefined,
): readonly ArtistCredit[] {
  const first = songs[0];
  if (first?.album_artist !== "") return [nameCredit(name, profiles)];
  const credits = songArtistCredits(first, profiles);
  const destination = ({ name: written, to }: ArtistCredit) =>
    to === undefined ? ["text", fold(written.trim())] : [to.id ?? null, to.id ? "" : fold(to.name)];
  const key = JSON.stringify(credits.map(destination));
  return songs.every(
    (song) =>
      song.album_artist === "" &&
      JSON.stringify(songArtistCredits(song, profiles).map(destination)) === key,
  )
    ? credits
    : [nameCredit(name, profiles)];
}
