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
import { useWords } from "../locale";
import { Cover } from "./Cover";
import { type CoverAlbum, PictureEditor } from "./PictureEditor";
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
  readonly onUse?:
    ((songs: readonly Track[], cover: string, subject: CoverAlbum) => Promise<void>) | undefined;
  readonly onUpload?:
    ((songs: readonly Track[], image: File, subject: CoverAlbum) => Promise<string>) | undefined;
  readonly onCloseRequestedEditor?: (() => void) | undefined;
  /** Shown beside the cover, as your rating of the album. */
  readonly children?: ReactNode;
}) {
  const t = useWords();
  const [replacing, setReplacing] = useState(false);
  const about = useRef<HTMLElement>(null);
  const editorOpen = replacing || onCloseRequestedEditor !== undefined;
  const art = <Cover size="medium" cover={cover} className="album-art" />;
  const framed = (
    <PictureFrame
      className="album-frame"
      replaceLabel={cover === null ? "Add album cover" : "Replace album cover"}
      save={cover === null ? undefined : { href: coverUrl(cover, "original"), name: album }}
      onReplace={() => {
        setReplacing(true);
      }}
    >
      {art}
    </PictureFrame>
  );
  const editable = onUse !== undefined && onUpload !== undefined && songs.length > 0;
  return (
    <section ref={about} tabIndex={-1} className="album-about" aria-label={t("About the album")}>
      {!editable ? (
        art
      ) : cover === null ? (
        <SuggestedCover
          album={album}
          artist={artist}
          fallback={framed}
          onUse={(chosen) => onUse(songs, chosen, { album, artist })}
          onChange={() => {
            setReplacing(true);
          }}
        />
      ) : (
        framed
      )}
      {children}
      {editable && editorOpen && (
        <PictureEditor
          sources={{
            kind: "cover",
            of: album,
            shown: cover,
            album: { album, artist },
            pictured: { kind: "album", album, artist },
            upload: async (image) => {
              await onUpload(songs, image, { album, artist });
            },
            use: (chosen) => onUse(songs, chosen, { album, artist }),
          }}
          onClose={() => {
            setReplacing(false);
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
