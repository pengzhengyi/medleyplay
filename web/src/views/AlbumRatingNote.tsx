/**
 * @file Your imported rating of the album shown, and your review of it, from Rate Your Music.
 */

import { useEffect, useState } from "react";

import { type AlbumRating, api } from "../api";
import { useWords } from "../locale";

/** Your stars and review of the album `album` by `artist`, if you imported any; else nothing. */
export function AlbumRatingNote({
  artist,
  album,
}: {
  readonly artist: string;
  readonly album: string;
}) {
  const t = useWords();
  const [rating, setRating] = useState<AlbumRating | null>(null);
  useEffect(() => {
    let current = true;
    api.albumRating(artist, album).then(
      (found) => {
        if (current) {
          setRating(found);
        }
      },
      // A rating that can't be read leaves the album page as it is without one.
      () => undefined,
    );
    return () => {
      current = false;
      setRating(null);
    };
  }, [artist, album]);
  if (rating === null) {
    return null;
  }
  return (
    <aside className="album-rating" role="note" aria-label={t("Your rating of this album")}>
      <p>
        {rating.stars === null
          ? t("Your review on Rate Your Music")
          : t("You rated it {{rating}} on Rate Your Music", {
              rating: t("star_count", { count: rating.stars }),
            })}
      </p>
      {rating.note !== "" && <p className="album-review">{rating.note}</p>}
    </aside>
  );
}
