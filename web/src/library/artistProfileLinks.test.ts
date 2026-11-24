import { describe, expect, it } from "vitest";

import { artistNameOf, trackOf } from "../testing/server";
import { linksOf } from "./artistLinks";
import { artistProfiles, songArtistCredits, trackAlbumArtistCredits } from "./artistProfileLinks";

describe("artist credit destinations", () => {
  it("uses the first route match instead of creating a chooser from a later folded name", () => {
    const albumSong = trackOf(1, "Guest song", { artist: "Guest", album_artist: "じぇい" });
    const shown = [
      albumSong,
      trackOf(2, "Split file", { artist: "じぇい", split: true }),
      trackOf(3, "Solo A", { artist: "Singer A", artist_ids: ["singer-a"] }),
      trackOf(4, "Solo B", { artist: "Singer B", artist_ids: ["singer-b"] }),
    ];
    const names = {
      names: [
        artistNameOf("じぇい"),
        { ...artistNameOf("ジェイ"), artist_ids: ["singer-a", "singer-b"] },
      ],
      artists: [],
    };

    const credits = trackAlbumArtistCredits(
      albumSong,
      artistProfiles(shown, linksOf(names, shown), names),
    );

    expect(credits).toEqual([{ name: "じぇい", to: undefined }]);
  });

  it("does not confuse a real hiragana credit with a katakana compilation placeholder", () => {
    const song = trackOf(1, "Solo", { artist: "おむにばす", artist_ids: ["solo-artist"] });
    const compilation = trackOf(2, "Collection", { artist: "オムニバス" });
    const names = {
      names: [
        { ...artistNameOf(compilation.artist), look_up: "never" as const },
        artistNameOf(song.artist),
      ],
      artists: [],
    };

    const profiles = artistProfiles([song, compilation], undefined, names);

    expect(songArtistCredits(song, profiles)).toEqual([
      { name: song.artist, to: { view: "artist", name: song.artist, id: "solo-artist" } },
    ]);
    expect(songArtistCredits(song, undefined)).toEqual(songArtistCredits(song, profiles));
    expect(songArtistCredits(compilation, undefined)).toEqual([
      { name: compilation.artist, to: undefined },
    ]);
  });
});
