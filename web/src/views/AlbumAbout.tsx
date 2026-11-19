/**
 * @file What is shown of an album under its page's heading: its cover, and your rating of
 * it beside the cover.
 *
 * The cover shows *Save* and *Replace* on hover, as the album's editor does; *Replace*
 * opens the picture editor, which looks the album up on MusicBrainz or asks an AI model.
 */

import { type ReactNode, useState } from "react";

import { type Track, coverUrl } from "../api";
import { Cover } from "./Cover";
import { PictureEditor } from "./PictureEditor";
import { PictureFrame } from "./PictureFrame";

/**
 * The album `album` by `artist`: `songs` are what its cover is set on, its songs or its one
 * file, and `cover` the one shown. Without `onUse` and `onUpload` the cover is only shown.
 */
export function AlbumAbout({
  album,
  artist,
  songs,
  cover,
  onUse,
  onUpload,
  children,
}: {
  readonly album: string;
  readonly artist: string;
  readonly songs: readonly Track[];
  readonly cover: string | null;
  readonly onUse?: ((songs: readonly Track[], cover: string) => Promise<void>) | undefined;
  readonly onUpload?: ((songs: readonly Track[], image: File) => Promise<string>) | undefined;
  /** Shown beside the cover, as your rating of the album. */
  readonly children?: ReactNode;
}) {
  const [replacing, setReplacing] = useState(false);
  const art = <Cover cover={cover} className="album-art" />;
  return (
    <section className="album-about" aria-label="About the album">
      {onUse === undefined || onUpload === undefined || songs.length === 0 ? (
        art
      ) : (
        <PictureFrame
          className="album-frame"
          replaceLabel={cover === null ? "Add a cover" : "Replace the cover"}
          save={cover === null ? undefined : { href: coverUrl(cover), name: album }}
          onReplace={() => {
            setReplacing(true);
          }}
        >
          {art}
        </PictureFrame>
      )}
      {children}
      {replacing && onUse !== undefined && onUpload !== undefined && (
        <PictureEditor
          sources={{
            kind: "cover",
            of: album,
            shown: cover,
            album: { album, artist },
            pictured: { kind: "album", album, artist },
            upload: async (image) => {
              await onUpload(songs, image);
            },
            use: (chosen) => onUse(songs, chosen),
          }}
          onClose={() => {
            setReplacing(false);
          }}
        />
      )}
    </section>
  );
}
