/**
 * @file Finding covers of albums with none, a section of Clean up.
 *
 * Each album with no cover for which MusicBrainz has a cover that fits shows it, tagged as
 * a suggestion, to use or dismiss in one click, or to choose another in the cover editor;
 * *Use all* uses every one in one request. The rest are counted: those MusicBrainz has
 * nothing that fits for, and those not searched yet, which are searched as Settings →
 * MusicBrainz says. While MusicBrainz is searched, it reads again every few seconds.
 */

import { CircleNotchIcon, VinylRecordIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type MissingCover, type Track, api } from "../api";
import { coversToUseOf } from "../library/cleanUp";
import { albumFileOf, songsOf, tracksOfAlbum } from "../library/views";
import { hrefOf } from "../routes";
import { Cover } from "./Cover";
import { PictureEditor } from "./PictureEditor";
import { SuggestedFrame } from "./SuggestedFrame";

const READ_EVERY_MS = 3000;

type Suggested = MissingCover & { readonly suggested: string };

/** The key of `album` among those shown. */
const keyOf = (album: MissingCover) => `${album.artist}\n${album.album}`;

/** The ways to set an album's cover, as its page sets it: on its songs, or on its one file. */
export interface AlbumCoverActions {
  readonly onUse: (songs: readonly Track[], cover: string) => Promise<void>;
  readonly onUpload: (songs: readonly Track[], image: File) => Promise<string>;
}

/** Return what an album's cover is set on: its one file, else its songs. */
function targetOf(tracks: readonly Track[], album: MissingCover): readonly Track[] {
  const songs = tracksOfAlbum(songsOf(tracks), album.artist, album.album);
  const file = albumFileOf(songs, new Map(tracks.map((track) => [track.id, track])));
  return file === undefined ? songs : [file];
}

/** The albums with no cover, each with the one suggested, to use. */
export function FindAlbumCovers({
  albums,
  answered,
  tracks,
  actions,
  onChanged,
  onUsed,
}: {
  readonly albums: readonly MissingCover[];
  /** How many answers came while MusicBrainz was searched, the same one too; each reads again. */
  readonly answered: number;
  /** The Library's Tracks, split files too, to set a cover chosen in the editor on. */
  readonly tracks: readonly Track[];
  /** How a cover chosen in the editor is set; without them, *Change* opens the album's page. */
  readonly actions?: AlbumCoverActions | undefined;
  /** Called after a change, or to read the albums again. */
  readonly onChanged: () => void;
  /** Called once covers found were used, to read the songs again. */
  readonly onUsed?: (() => void) | undefined;
}) {
  // The albums whose cover is being used or dismissed: each stays saving until it is gone.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [usingAll, setUsingAll] = useState(false);
  const [error, setError] = useState("");
  // The album whose cover is chosen in the cover editor, if any.
  const [changing, setChanging] = useState<MissingCover>();
  // Where a tile was used or dismissed, and the albums then shown, so focus moves to the
  // tile taking its place once the albums are read again.
  const refocus = useRef<{ readonly place: number; readonly from: readonly MissingCover[] }>(
    undefined,
  );
  const list = useRef<HTMLUListElement>(null);
  const readAgain = useEffectEvent(onChanged);
  const finding = albums.filter((each) => each.finding).length;
  useEffect(() => {
    if (finding === 0) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [answered, finding]);

  const suggested = albums.filter((each): each is Suggested => each.suggested !== null);
  useEffect(() => {
    const moved = refocus.current;
    if (moved === undefined || moved.from === albums) {
      return;
    }
    refocus.current = undefined;
    const tiles = list.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [];
    tiles[Math.min(moved.place, tiles.length - 1)]?.querySelector<HTMLElement>("button")?.focus();
  }, [albums]);
  const unfit = albums.filter((each) => each.suggested === null && each.found).length;
  const unasked = albums.filter((each) => !each.found).length;
  const ready = suggested.filter((each) => !saving.has(keyOf(each)));
  // Saves `change` to the albums `chosen`, saving until they are read again without them.
  const act = async (
    chosen: readonly Suggested[],
    place: number | undefined,
    change: () => Promise<unknown>,
  ) => {
    const keys = chosen.map(keyOf);
    setSaving((was) => new Set([...was, ...keys]));
    setError("");
    try {
      await change();
      if (place !== undefined) {
        refocus.current = { place, from: albums };
      }
    } catch (failure) {
      setSaving((was) => new Set([...was].filter((key) => !keys.includes(key))));
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      onChanged();
    }
  };
  const take = (chosen: readonly Suggested[], place?: number) =>
    act(chosen, place, async () => {
      await api.useAlbumCovers(
        chosen.map(({ album, artist, suggested: cover }) => ({ album, artist, cover })),
      );
      onUsed?.();
    });
  const dismiss = (album: Suggested, place: number) =>
    act([album], place, () => api.dismissAlbumCover(album.album, album.artist, album.suggested));
  const takeAll = async () => {
    setUsingAll(true);
    await take(ready);
    setUsingAll(false);
  };
  const changingTarget = changing === undefined ? [] : targetOf(tracks, changing);
  return (
    <section className="clean-up-section" aria-labelledby="find-covers-title">
      <header className="clean-up-head">
        <h3 id="find-covers-title">
          <VinylRecordIcon className="clean-up-icon" weight="bold" aria-hidden />
          Find album covers
          <span className="clean-up-count">{coversToUseOf(albums)}</span>
        </h3>
        {suggested.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={usingAll || ready.length === 0}
            aria-busy={usingAll}
            onClick={() => void takeAll()}
          >
            {`Use all ${String(suggested.length)}`}
          </button>
        )}
      </header>
      <p className="tidy-lead">
        A cover found on MusicBrainz for each album with none. Using one puts it on the album's
        songs.
      </p>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {finding > 0 && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {`Looking on MusicBrainz for ${String(finding)} ${finding === 1 ? "album" : "albums"}…`}
        </p>
      )}
      {suggested.length > 0 && (
        <ul ref={list} className="photo-suggestions" aria-label="Covers suggested">
          {suggested.map((each, place) => (
            <li key={keyOf(each)} className="photo-suggestion-item">
              <SuggestedFrame
                of={each.album}
                noun="cover"
                why={
                  each.picked
                    ? "An AI model picked this"
                    : "A MusicBrainz release with this album's title and artist"
                }
                picked={each.picked}
                busy={saving.has(keyOf(each))}
                onUse={() => void take([each], place)}
                onDismiss={() => void dismiss(each, place)}
                onChange={() => {
                  if (actions === undefined) {
                    window.location.hash = hrefOf({
                      view: "album",
                      artist: each.artist,
                      name: each.album,
                    });
                  } else {
                    setChanging(each);
                  }
                }}
              >
                <Cover size="medium" cover={each.suggested} className="cover-suggestion-picture" />
              </SuggestedFrame>
              <a
                className="photo-suggestion-name"
                href={hrefOf({ view: "album", artist: each.artist, name: each.album })}
              >
                {each.album}
              </a>
              <span className="tidy-meta">
                {[each.artist, each.songs === 1 ? "1 song" : `${String(each.songs)} songs`]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {unfit + unasked > 0 && (
        <p className="tidy-lead">
          {[
            unfit > 0 &&
              `${String(unfit)} ${unfit === 1 ? "album has" : "albums have"} no cover on MusicBrainz that fits`,
            unasked > 0 &&
              `${String(unasked)} ${unasked === 1 ? "album isn't" : "albums aren't"} searched yet`,
          ]
            .filter(Boolean)
            .join("; ")}
          .{" "}
          {unasked > 0 && (
            <>
              They are searched as{" "}
              <a href={hrefOf({ view: "settings", section: "musicbrainz" })}>
                Settings → MusicBrainz
              </a>{" "}
              says.
            </>
          )}
        </p>
      )}
      {changing !== undefined && actions !== undefined && changingTarget.length > 0 && (
        <PictureEditor
          startOn="musicbrainz"
          sources={{
            kind: "cover",
            of: changing.album,
            shown: null,
            album: { album: changing.album, artist: changing.artist },
            pictured: { kind: "album", album: changing.album, artist: changing.artist },
            upload: async (image) => {
              await actions.onUpload(changingTarget, image);
              onChanged();
            },
            use: async (cover) => {
              await actions.onUse(changingTarget, cover);
              onChanged();
            },
          }}
          onClose={() => {
            setChanging(undefined);
          }}
        />
      )}
    </section>
  );
}
