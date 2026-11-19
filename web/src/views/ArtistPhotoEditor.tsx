/**
 * @file The photo editor of an artist: the picture editor, with each way an artist's
 * photo is replaced, its Deezer tab looking up the artist's pictures.
 */

import { api } from "../api";
import { PictureEditor } from "./PictureEditor";

/**
 * The editor of the photo of the artist `artistId`, called `name`, showing `shown`;
 * `onChanged` is called once a photo is used, and `onClose` once it closes.
 */
export function ArtistPhotoEditor({
  artistId,
  name,
  shown,
  onChanged,
  onClose,
}: {
  readonly artistId: string;
  readonly name: string;
  readonly shown: string | null;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  return (
    <PictureEditor
      sources={{
        kind: "photo",
        of: name,
        shown,
        artistId,
        pictured: { kind: "artist", artistId },
        upload: async (image) => {
          await api.setArtistPhoto(artistId, image);
          onChanged();
        },
        use: async (cover) => {
          await api.useArtistPhotoCover(artistId, cover);
          onChanged();
        },
      }}
      onClose={onClose}
    />
  );
}
