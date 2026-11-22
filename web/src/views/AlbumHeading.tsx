/**
 * @file An album page's heading, laid out as music apps lay out an album: its cover large on
 * the left; beside it, its name, who it is by, and its year, centered against the cover; and
 * on a line with the cover's bottom edge, Play and Shuffle, the heart, and Edit details.
 */

import { CaretLeftIcon } from "@phosphor-icons/react";
import type { ReactNode, Ref } from "react";

import { type Route, hrefOf } from "../routes";

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
    <header className="view-heading album-heading">
      <a className="back" href={hrefOf(back)}>
        <CaretLeftIcon weight="bold" aria-hidden />
        {backLabel}
      </a>
      <div className="album-hero">
        {cover}
        <div className="album-side">
          <div className="album-names">
            <h2 className="section">{title}</h2>
            <p className="subtitle">
              {artistTo === undefined ? artist : <a href={hrefOf(artistTo)}>{artist}</a>}
            </p>
            {year !== null && <p className="album-year">{String(year)}</p>}
            {note}
          </div>
          <div className="album-actions">
            <div className="album-play" ref={playPlace} />
            {heart}
            {edit}
          </div>
        </div>
      </div>
    </header>
  );
}
