/**
 * @file An album page's heading: its cover large, beside its name, who it is by, and its
 * year, laid out as {@link PictureHeading} lays out every page of an album or artist.
 */

import type { ReactNode, Ref } from "react";

import { type Route, hrefOf } from "../routes";
import { PictureHeading } from "./PictureHeading";

/** The heading of the album `title` by `artist`, `artistTo` its artist's page if it has one. */
export function AlbumHeading({
  title,
  artist,
  artistTo,
  year,
  back,
  backLabel,
  cover,
  note,
  heart,
  edit,
  playPlace,
}: {
  readonly title: string;
  readonly artist: string;
  readonly artistTo?: Route | undefined;
  /** The year it came out, if known. */
  readonly year: number | null;
  readonly back: Route;
  readonly backLabel: string;
  /** The album's cover, shown large. */
  readonly cover: ReactNode;
  /** What you said of the album, under its year. */
  readonly note?: ReactNode;
  readonly heart?: ReactNode;
  readonly edit?: ReactNode;
  /** The element Play and Shuffle are drawn in, first on the line of buttons. */
  readonly playPlace: Ref<HTMLDivElement>;
}) {
  return (
    <PictureHeading
      title={title}
      back={back}
      backLabel={backLabel}
      picture={cover}
      heart={heart}
      edit={edit}
      playPlace={playPlace}
      className="album-heading"
    >
      <p className="subtitle">
        {artistTo === undefined ? artist : <a href={hrefOf(artistTo)}>{artist}</a>}
      </p>
      {year !== null && <p className="album-year">{String(year)}</p>}
      {note}
    </PictureHeading>
  );
}
