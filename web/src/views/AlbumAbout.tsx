/**
 * @file What is shown of an album under its page's heading: its cover, and your rating of
 * it beside the cover.
 *
 * The cover shows *Save* and *Replace* on hover, as the album's editor does; *Replace*
 * opens the picture editor, which looks the album up on MusicBrainz or asks an AI model.
 * An album with no cover shows the one suggested for it, if any, to use in one click.
 */

import { type ReactNode, useRef, useState } from "react";

import { type Track, coverUrl } from "../api";
import { Cover } from "./Cover";
import { PictureEditor } from "./PictureEditor";
import { PictureFrame } from "./PictureFrame";
import { SuggestedCover } from "./SuggestedCover";

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
  onCloseRequestedEditor,
  children,
}: {
  readonly album: string;
  readonly artist: string;
  readonly songs: readonly Track[];
  readonly cover: string | null;
  readonly onUse?: ((songs: readonly Track[], cover: string) => Promise<void>) | undefined;
  readonly onUpload?: ((songs: readonly Track[], image: File) => Promise<string>) | undefined;
  readonly onCloseRequestedEditor?: (() => void) | undefined;
  /** Shown beside the cover, as your rating of the album. */
  readonly children?: ReactNode;
}) {
  const [replacing, setReplacing] = useState<"upload" | "musicbrainz">();
  const about = useRef<HTMLElement>(null);
  const editor = onCloseRequestedEditor === undefined ? replacing : "upload";
  const art = (
    <Cover size="medium" cover={cover} className="album-art" lyrics={{ artist, album }} />
  );
  const framed = (
    <PictureFrame
      className="album-frame"
      replaceLabel={cover === null ? "Add a cover" : "Replace the cover"}
      save={cover === null ? undefined : { href: coverUrl(cover, "original"), name: album }}
      onReplace={() => {
        setReplacing("upload");
      }}
    >
      {art}
    </PictureFrame>
  );
  const editable = onUse !== undefined && onUpload !== undefined && songs.length > 0;
  return (
    <section ref={about} tabIndex={-1} className="album-about" aria-label="About the album">
      {!editable ? (
        art
      ) : cover === null ? (
        <SuggestedCover
          album={album}
          artist={artist}
          fallback={framed}
          onUse={(chosen) => onUse(songs, chosen)}
          onChange={() => {
            setReplacing("musicbrainz");
          }}
        />
      ) : (
        framed
      )}
      {children}
      {editable && editor !== undefined && (
        <PictureEditor
          startOn={editor}
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
            setReplacing(undefined);
            if (onCloseRequestedEditor !== undefined) {
              onCloseRequestedEditor();
              about.current?.focus();
            }
          }}
        />
      )}
    </section>
  );
}
