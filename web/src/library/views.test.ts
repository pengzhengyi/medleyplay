// cspell:ignore supercell ｍｅｌｔ beatls jsie
import { describe, expect, it } from "vitest";

import {
  OTHER_JAY,
  artistIdOf,
  artistNameOf,
  knownArtistOf,
  trackOf,
  twoJaysNames,
  twoJaysSongs,
} from "../testing/server";
import { linksOf } from "./artistLinks";
import {
  albumFileOf,
  albumYearOf,
  albumsOf,
  artistRouteOf,
  coverPlaceOf,
  artistsOf,
  artistWrittenOf,
  downloadedOf,
  favoritesOf,
  fold,
  search,
  songsOf,
  tracksOfAlbum,
  tracksOfArtist,
} from "./views";

/**
 * A small Library:
 *
 * | Title     | Artist      | Album      | Album artist | Length |
 * | --------- | ----------- | ---------- | ------------ | ------ |
 * | Melt      | ryo         | Supercell  |              | 4:00   |
 * | 君の知らない物語 | supercell | Supercell |              | 5:00   |
 * | Untitled  |             |            |              | 1:00   |
 * | しるべのクジラ | ルワン     | くじらと空想  | ルワン         | 4:24   |
 * | Ｍｅｌｔ (live) | RYO     | Live       | Various      | 6:00   |
 */
const LIBRARY = [
  trackOf(1, "Melt", { artist: "ryo", album: "Supercell", duration_ms: 240_000 }),
  trackOf(2, "君の知らない物語", { artist: "supercell", album: "Supercell", duration_ms: 300_000 }),
  trackOf(3, "Untitled", { artist: "", album: "", duration_ms: 60_000 }),
  trackOf(4, "しるべのクジラ", {
    artist: "ルワン",
    album: "くじらと空想",
    album_artist: "ルワン",
    duration_ms: 264_000,
  }),
  trackOf(5, "Ｍｅｌｔ (live)", {
    artist: "RYO",
    album: "Live",
    album_artist: "Various",
    duration_ms: 360_000,
  }),
];

const titles = (tracks: readonly { readonly title: string }[]) => tracks.map((t) => t.title);

describe("folding text for search", () => {
  it("ignores case, width, and hiragana or katakana", () => {
    expect(fold("Ｍｅｌｔ")).toBe("melt");
    expect(fold("ｸｼﾞﾗ")).toBe(fold("くじら"));
    expect(fold("クジラ")).toBe("くじら");
  });

  it("keeps marks that change a kana, so が stays が", () => {
    expect(fold("が")).not.toBe(fold("か"));
  });
});

describe("artists", () => {
  it("lists each artist once, with how many Tracks and how long, names as people read them", () => {
    const artists = artistsOf(LIBRARY);

    expect(artists.map((artist) => [artist.name, artist.count, artist.durationMs])).toEqual([
      ["", 1, 60_000],
      ["ryo", 2, 600_000],
      ["supercell", 1, 300_000],
      ["ルワン", 1, 264_000],
    ]);
  });

  it("names each artist by the id of the Library's artist its songs are bound to", () => {
    const artists = artistsOf(LIBRARY);

    expect(artists.map((artist) => [artist.link, artist.id])).toEqual([
      ["", undefined],
      ["ryo", artistIdOf("ryo")],
      ["supercell", artistIdOf("supercell")],
      ["ルワン", artistIdOf("ルワン")],
    ]);
  });

  it("finds the name an artist is written as most, by its id", () => {
    expect(artistWrittenOf(LIBRARY, artistIdOf("ryo"))).toBe("ryo");
    expect(artistWrittenOf(LIBRARY, "artist-nobody")).toBeUndefined();
  });

  it("goes to the page of each of a song's artists by its id", () => {
    const melt = trackOf(1, "Melt", { artist: "GUMI/MAYU", artists: ["GUMI", "MAYU"] });

    expect(artistRouteOf(melt, 1)).toEqual({
      view: "artist",
      name: "MAYU",
      id: artistIdOf("MAYU"),
    });
    expect(artistRouteOf(trackOf(2, "Untitled", { artist: "" }), 0)).toEqual({
      view: "artist",
      name: "",
    });
  });

  it("opens an artist's Tracks by the name as written, in any case or width", () => {
    expect(titles(tracksOfArtist(LIBRARY, "RYO"))).toEqual(["Melt", "Ｍｅｌｔ (live)"]);
    expect(titles(tracksOfArtist(LIBRARY, ""))).toEqual(["Untitled"]);
  });
});

describe("songs by several artists", () => {
  /** *Melt* by GUMI/MAYU, split into GUMI and MAYU, and *Smile* by GUMI. */
  const SONGS = [
    trackOf(1, "Melt", { artist: "GUMI/MAYU", artists: ["GUMI", "MAYU"], duration_ms: 100_000 }),
    trackOf(2, "Smile", { artist: "GUMI", duration_ms: 200_000 }),
  ];

  it("count under each artist they list", () => {
    const artists = artistsOf(SONGS);

    expect(artists.map((artist) => [artist.name, artist.count, artist.durationMs])).toEqual([
      ["GUMI", 2, 300_000],
      ["MAYU", 1, 100_000],
    ]);
  });

  it("open from each artist, or from the name as written", () => {
    expect(titles(tracksOfArtist(SONGS, "mayu"))).toEqual(["Melt"]);
    expect(titles(tracksOfArtist(SONGS, "GUMI/MAYU"))).toEqual(["Melt"]);
  });

  it("are found under each artist they list", () => {
    const found = search(SONGS, "mayu");
    const tagged = search(SONGS, "artist:MAYU");

    expect(found.artists.map((artist) => artist.name)).toEqual(["MAYU"]);
    expect(titles(found.tracks)).toEqual(["Melt"]);
    expect(titles(tagged.tracks)).toEqual(["Melt"]);
  });
});

describe("artists linked as one", () => {
  /** *Help!* by The Beatles, two songs by 披头士, and *Melt* by ryo. */
  const SONGS = [
    trackOf(1, "Help!", { artist: "The Beatles", duration_ms: 100_000 }),
    trackOf(2, "Yesterday", { artist: "披头士", duration_ms: 200_000 }),
    trackOf(3, "Let It Be", { artist: "披头士", duration_ms: 300_000 }),
    trackOf(4, "Melt", { artist: "ryo", duration_ms: 400_000 }),
  ];
  /** The Beatles and 披头士 linked to one artist, who also goes by 甲壳虫. */
  const LINKS = linksOf({
    names: [artistNameOf("The Beatles", "b1"), artistNameOf("披头士", "b1")],
    artists: [
      knownArtistOf("b1", "The Beatles", {
        sort_name: "Beatles, The",
        disambiguation: "",
        country: "GB",
        aliases: [{ name: "甲壳虫", locale: "zh", primary: false }],
      }),
    ],
  });

  it("are listed once, named as most of their songs write the name", () => {
    const artists = artistsOf(SONGS, LINKS);

    expect(artists.map((artist) => [artist.name, artist.count, artist.durationMs])).toEqual([
      ["ryo", 1, 400_000],
      ["披头士", 3, 600_000],
    ]);
  });

  it("open every song of the artist from any of its names", () => {
    expect(titles(tracksOfArtist(SONGS, "The Beatles", LINKS))).toEqual([
      "Help!",
      "Yesterday",
      "Let It Be",
    ]);
  });

  it("are found by any name the artist goes by", () => {
    expect(search(SONGS, "甲壳虫", LINKS).artists.map((artist) => artist.name)).toEqual(["披头士"]);
  });

  describe("shown as the household chose", () => {
    /** The links above, with The Beatles shown as *甲壳虫乐队*. */
    const CHOSEN = linksOf({
      names: [artistNameOf("The Beatles", "b1"), artistNameOf("披头士", "b1")],
      artists: [knownArtistOf("b1", "The Beatles", { shown_as: "甲壳虫乐队" })],
    });

    it("are listed by the name chosen, and open by the name most of their songs write", () => {
      const artists = artistsOf(SONGS, CHOSEN);

      expect(artists.map((artist) => [artist.name, artist.link])).toEqual([
        ["ryo", "ryo"],
        ["甲壳虫乐队", "披头士"],
      ]);
    });

    it("leave the songs of another artist who goes by the name chosen to that artist", () => {
      const links = linksOf({
        names: [artistNameOf("The Beatles", "b1")],
        artists: [knownArtistOf("b1", "The Beatles", { shown_as: "ryo" })],
      });

      expect(artistsOf(SONGS, links).map((artist) => [artist.name, artist.link])).toEqual([
        ["ryo", "ryo"],
        ["ryo", "The Beatles"],
        ["披头士", "披头士"],
      ]);
      expect(titles(tracksOfArtist(SONGS, "ryo", links))).toEqual(["Melt"]);
    });

    it("are found by the name chosen", () => {
      expect(search(SONGS, "甲壳虫乐队", CHOSEN).artists.map((artist) => artist.name)).toEqual([
        "甲壳虫乐队",
      ]);
    });
  });
});

describe("two artists of one name", () => {
  /** A song by each Jay, and a second by the name's first, on *范特西*. */
  const SONGS = [...twoJaysSongs(), trackOf(3, "简单爱", { artist: "Jay", album: "范特西" })];
  const LINKS = linksOf(twoJaysNames(), SONGS);

  it("are listed apart, by the album most of their songs are on, each by its id", () => {
    const artists = artistsOf(SONGS, LINKS);

    expect(artists.map((artist) => [artist.name, artist.id, artist.count, artist.onAlbum])).toEqual(
      [
        ["Jay", OTHER_JAY, 1, "Blue Night"],
        ["Jay", artistIdOf("Jay"), 2, "Jay"],
      ],
    );
  });

  it("each open only their own songs", () => {
    expect(titles(tracksOfArtist(SONGS, "Jay", LINKS, OTHER_JAY))).toEqual(["Blue Night"]);
    expect(titles(tracksOfArtist(SONGS, "Jay", LINKS, artistIdOf("Jay")))).toEqual([
      "星晴",
      "简单爱",
    ]);
    expect(titles(tracksOfArtist(SONGS, "Jay", LINKS))).toEqual(["星晴", "简单爱"]);
  });

  it("name no album for an artist no other one listed shares its name with", () => {
    expect(artistsOf(SONGS.slice(0, 1), LINKS)[0]?.onAlbum).toBeUndefined();
  });
});

describe("albums", () => {
  it("lists each album under its album artist, or its artist when that is blank", () => {
    const albums = albumsOf(LIBRARY);

    expect(albums.map((album) => [album.artist, album.name, album.count])).toEqual([
      ["", "", 1],
      ["ryo", "Supercell", 1],
      ["supercell", "Supercell", 1],
      ["Various", "Live", 1],
      ["ルワン", "くじらと空想", 1],
    ]);
  });

  it("shows an album by the first cover among its songs", () => {
    const tracks = [
      trackOf(1, "Intro", { album: "Bremen", cover: "" }),
      trackOf(2, "Bremen", { album: "Bremen", cover: "b".repeat(64) }),
      trackOf(3, "Outro", { album: "Bremen", cover: "c".repeat(64) }),
      trackOf(4, "Untitled", { album: "" }),
    ];

    expect(albumsOf(tracks).map((album) => [album.name, album.cover])).toEqual([
      ["", null],
      ["Bremen", "b".repeat(64)],
    ]);
  });

  it("opens an album's Tracks by its artist and name", () => {
    expect(titles(tracksOfAlbum(LIBRARY, "ルワン", "くじらと空想"))).toEqual(["しるべのクジラ"]);
    expect(titles(tracksOfAlbum(LIBRARY, "various", "LIVE"))).toEqual(["Ｍｅｌｔ (live)"]);
  });
});

describe("lists made from the Tracks", () => {
  it("lists the favorites newest added first, as the server's Favorites does", () => {
    const tracks = [
      trackOf(1, "A", { favorite: true, added_at: "2026-10-03T00:00:00Z" }),
      trackOf(2, "B", { added_at: "2026-10-04T00:00:00Z" }),
      trackOf(3, "C", { favorite: true, added_at: "2026-10-01T00:00:00Z" }),
      trackOf(4, "D", { favorite: true, added_at: "2026-10-03T00:00:00Z" }),
    ];

    expect(titles(favoritesOf(tracks))).toEqual(["D", "A", "C"]);
  });

  it("lists the Tracks downloaded", () => {
    const tracks = [trackOf(1, "A"), trackOf(2, "B", { downloaded: true })];

    expect(titles(downloadedOf(tracks))).toEqual(["B"]);
  });
});

describe("search", () => {
  it("finds Tracks with every word typed in the title, artist, or album", () => {
    expect(titles(search(LIBRARY, "melt").tracks)).toEqual(["Melt", "Ｍｅｌｔ (live)"]);
    expect(titles(search(LIBRARY, "melt live").tracks)).toEqual(["Ｍｅｌｔ (live)"]);
    expect(titles(search(LIBRARY, "クジラ").tracks)).toEqual(["しるべのクジラ"]);
    expect(titles(search(LIBRARY, "べのくじら").tracks)).toEqual(["しるべのクジラ"]);
  });

  it("finds the artists and albums whose names match", () => {
    const found = search(LIBRARY, "supercell");

    expect(found.artists.map((artist) => artist.name)).toEqual(["supercell"]);
    expect(found.albums.map((album) => [album.artist, album.name])).toEqual([
      ["ryo", "Supercell"],
      ["supercell", "Supercell"],
    ]);
  });

  it("finds nothing for a blank search, or tags with no value yet", () => {
    expect(search(LIBRARY, "   ")).toEqual({ tracks: [], artists: [], albums: [] });
    expect(search(LIBRARY, "artist: album:")).toEqual({ tracks: [], artists: [], albums: [] });
  });

  describe("loosely", () => {
    /**
     * | Title      | Artist      | Album  |
     * | ---------- | ----------- | ------ |
     * | Jealousy   | Queen       | Jazz   |
     * | Yesterday  | The Beatles | Help!  |
     * | 晴天        | Jay Chou    | 叶惠美  |
     */
    const SONGS = [
      trackOf(1, "Jealousy", { artist: "Queen", album: "Jazz" }),
      trackOf(2, "Yesterday", { artist: "The Beatles", album: "Help!" }),
      trackOf(3, "晴天", { artist: "Jay Chou", album: "叶惠美" }),
    ];

    it("finds names with the letters typed in order, when some are left out", () => {
      expect(titles(search(SONGS, "beatls").tracks)).toEqual(["Yesterday"]);
      expect(search(SONGS, "jch").artists.map((artist) => artist.name)).toEqual(["Jay Chou"]);
    });

    it("lists names holding the words side by side first, however close a loose one is", () => {
      const songs = [trackOf(9, "Beat Less", { artist: "", album: "" }), ...SONGS];

      expect(titles(search(songs, "beatles").tracks)).toEqual(["Yesterday", "Beat Less"]);
    });

    it("leaves out a poor match, and matches fewer than three letters only side by side", () => {
      expect(titles(search(SONGS, "jay").tracks)).toEqual(["晴天"]);
      expect(titles(search(SONGS, "jy").tracks)).toEqual([]);
    });
  });

  describe("with tags", () => {
    /**
     * | Title     | Artist      | Album      | Album artist | Rating | Heart |
     * | --------- | ----------- | ---------- | ------------ | ------ | ----- |
     * | 晴天       | Jay Chou    | 叶惠美      |              | 5      | ♥     |
     * | 稻香       | Jay Chou    | 魔杰座      |              | 3      |       |
     * | Love Song | Jessie Ware | Love       | Various      |        | ♥     |
     * | Jay's Day | Nobody      | Jay Chou?  | Jay Chou     | 4      |       |
     */
    const SONGS = [
      trackOf(1, "晴天", { artist: "Jay Chou", album: "叶惠美", rating: 5, favorite: true }),
      trackOf(2, "稻香", { artist: "Jay Chou", album: "魔杰座", rating: 3 }),
      trackOf(3, "Love Song", {
        artist: "Jessie Ware",
        album: "Love",
        album_artist: "Various",
        favorite: true,
      }),
      trackOf(4, "Jay's Day", {
        artist: "Nobody",
        album: "Jay Chou?",
        album_artist: "Jay Chou",
        rating: 4,
      }),
    ];

    it("keeps the songs of an artist, by artist or album artist, listing only that artist", () => {
      const found = search(SONGS, "artist:jay");

      expect(titles(found.tracks)).toEqual(["晴天", "稻香", "Jay's Day"]);
      expect(found.artists.map((artist) => artist.name)).toEqual(["Jay Chou"]);
      expect(found.albums.map((album) => album.name)).toEqual(["Jay Chou?", "叶惠美", "魔杰座"]);
    });

    it("keeps names close to the tag, and loose ones only when none is", () => {
      expect(titles(search(SONGS, "song:love").tracks)).toEqual(["Love Song"]);
      expect(titles(search(SONGS, 'artist:"jsie wre"').tracks)).toEqual(["Love Song"]);
    });

    it("finds the words among the songs a tag keeps", () => {
      expect(titles(search(SONGS, "artist:jay 稻").tracks)).toEqual(["稻香"]);
      expect(titles(search(SONGS, "album:love song").tracks)).toEqual(["Love Song"]);
    });

    it("keeps songs rated at least so many stars, or with a heart or without", () => {
      expect(titles(search(SONGS, "rating:4").tracks)).toEqual(["晴天", "Jay's Day"]);
      expect(titles(search(SONGS, "favorite:yes").tracks)).toEqual(["晴天", "Love Song"]);
      expect(titles(search(SONGS, "favorite:no").tracks)).toEqual(["稻香", "Jay's Day"]);
    });

    it("lists an album or artist whole when a song the tags keep is its", () => {
      const found = search(SONGS, "rating:4");

      expect(found.albums.map((album) => [album.name, album.count])).toEqual([
        ["Jay Chou?", 1],
        ["叶惠美", 1],
      ]);
      expect(found.artists.map((artist) => [artist.name, artist.count])).toEqual([
        ["Jay Chou", 2],
        ["Nobody", 1],
      ]);
    });

    it("ignores a kind it doesn't know, as one still being typed", () => {
      expect(titles(search(SONGS, "kind:so artist:jay").tracks)).toEqual([
        "晴天",
        "稻香",
        "Jay's Day",
      ]);
    });

    it("shows only the kind asked for", () => {
      const found = search(SONGS, "kind:albums artist:jay");

      expect(found.tracks).toEqual([]);
      expect(found.artists).toEqual([]);
      expect(found.albums.map((album) => album.name)).toEqual(["Jay Chou?", "叶惠美", "魔杰座"]);
    });
  });
});

describe("the songs of the Library", () => {
  it("are its songs in place of a file split into them", () => {
    const album = trackOf(104, "BV1dm4y1s7ak", { split: true });
    const first = trackOf(154, "アイネクライネ", { segment_of: 104 });
    const melt = trackOf(1, "Melt");

    expect(songsOf([album, first, melt])).toEqual([first, melt]);
  });
});

describe("albumFileOf", () => {
  const file = trackOf(9, "Jay", {
    album: "Jay",
    kind: "album",
    kind_reason: "split",
    split: true,
  });
  const songs = [
    trackOf(11, "可爱女人", { album: "Jay", segment_of: 9 }),
    trackOf(12, "完美主义", { album: "Jay", segment_of: 9 }),
  ];
  const byId = new Map([file, ...songs].map((track) => [track.id, track]));

  it("is the file an album's songs were split from, with or without the file listed", () => {
    expect(albumFileOf(songs, byId)).toBe(file);
    expect(albumFileOf([file, ...songs], byId)).toBe(file);
  });

  it("is the album itself when it is one file not yet split", () => {
    const whole = trackOf(5, "Bremen", { album: "Bremen", kind: "album" });

    expect(albumFileOf([whole], new Map([[5, whole]]))).toBe(whole);
  });

  it("is none for an album of songs of their own", () => {
    const loose = [
      trackOf(1, "Melt", { album: "Supercell" }),
      trackOf(2, "Shiver", { album: "Supercell" }),
    ];

    expect(albumFileOf(loose, new Map(loose.map((track) => [track.id, track])))).toBeUndefined();
  });

  it("is none when the songs come from two files", () => {
    const other = trackOf(13, "龙卷风", { album: "Jay", segment_of: 10 });

    expect(albumFileOf([...songs, other], byId)).toBeUndefined();
  });
});

describe("albumYearOf", () => {
  it("is the year most of the album's songs give", () => {
    const songs = [
      trackOf(1, "Melt", { year: 2010 }),
      trackOf(2, "Shiver", { year: 2011 }),
      trackOf(3, "Bless", { year: 2011 }),
    ];

    expect(albumYearOf(songs)).toBe(2011);
  });

  it("is the earlier year when as many songs give each", () => {
    const songs = [trackOf(1, "Melt", { year: 2011 }), trackOf(2, "Shiver", { year: 2009 })];

    expect(albumYearOf(songs)).toBe(2009);
  });

  it("leaves out the songs that give no year, and is none when no song gives one", () => {
    expect(albumYearOf([trackOf(1, "Melt", { year: 2010 }), trackOf(2, "Shiver")])).toBe(2010);
    expect(albumYearOf([trackOf(1, "Melt"), trackOf(2, "Shiver")])).toBeNull();
  });
});

describe("coverPlaceOf", () => {
  it("is the file a split file's song comes from, so the file's other songs show it too", () => {
    const song = trackOf(11, "可爱女人", { album: "Jay", segment_of: 9 });

    expect(coverPlaceOf(song, [song])).toEqual({ kind: "file", id: 9 });
  });

  it("is every song of the album a song is on, its artist and name compared folded", () => {
    const melt = trackOf(1, "Melt", { artist: "ryo", album: "Supercell" });
    const songs = [
      melt,
      trackOf(2, "君の知らない物語", { artist: "RYO", album: "supercell" }),
      trackOf(3, "Shiver", { artist: "ryo", album: "Other" }),
    ];

    expect(coverPlaceOf(melt, songs)).toEqual({ kind: "songs", ids: [1, 2] });
  });

  it("is the song alone when it is on no album", () => {
    const untitled = trackOf(3, "Untitled", { album: "" });

    expect(coverPlaceOf(untitled, [untitled, trackOf(4, "Draft", { album: "" })])).toEqual({
      kind: "songs",
      ids: [3],
    });
  });

  it("is a split file itself, whose songs take its cover", () => {
    const file = trackOf(9, "Jay", { album: "Jay", kind: "album", split: true });
    const song = trackOf(11, "可爱女人", { album: "Jay", segment_of: 9 });

    expect(coverPlaceOf(file, [song])).toEqual({ kind: "songs", ids: [9] });
  });
});
