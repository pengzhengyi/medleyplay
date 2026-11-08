/**
 * @file Your imported rating of the album shown, and your review of it, from Rate Your Music.
 */

import { useEffect, useState } from "react";

import { type AlbumRating, api } from "../api";

/** Your stars and review of the album `album` by `artist`, if you imported any; else nothing. */
export function AlbumRatingNote({
  artist,
  album,
}: {
  readonly artist: string;
  readonly album: string;
}) {
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
    <aside className="album-rating" role="note" aria-label="Your rating of this album">
      <p>
        {rating.stars === null
          ? "Your review on Rate Your Music"
          : `You rated it ${rating.stars === 1 ? "1 star" : `${String(rating.stars)} stars`} on Rate Your Music`}
      </p>
      {rating.note !== "" && <p className="album-review">{rating.note}</p>}
    </aside>
  );
}
