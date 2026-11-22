/**
 * @file The heading of an album's or an artist's page, laid out as music apps lay one out:
 * its picture large on the left; beside it, its name and what is said of it, centered
 * against the picture; and on a line with the picture's bottom edge, Play and Shuffle, the
 * heart, and Edit details. On a phone, the picture is on top and the rest centered under it.
 */

import { CaretLeftIcon } from "@phosphor-icons/react";
import type { ReactNode, Ref } from "react";

import { type Route, hrefOf } from "../routes";

/** The heading `title` of a page, beside its `picture`, with `children` under the title. */
export function PictureHeading({
  title,
  back,
  backLabel,
  picture,
  heart,
  edit,
  playPlace,
  className,
  children,
}: {
  readonly title: string;
  readonly back: Route;
  readonly backLabel: string;
  /** The album's cover or the artist's photo, shown large. */
  readonly picture: ReactNode;
  readonly heart?: ReactNode;
  readonly edit?: ReactNode;
  /** The element Play and Shuffle are drawn in, first on the line of buttons. */
  readonly playPlace: Ref<HTMLDivElement>;
  /** The class of what the page is of, beside `picture-heading`. */
  readonly className?: string;
  /** What shows under the title: who an album is by and its year, or what is known of an artist. */
  readonly children?: ReactNode;
}) {
  return (
    <header
      className={
        className === undefined
          ? "view-heading picture-heading"
          : `view-heading picture-heading ${className}`
      }
    >
      <a className="back" href={hrefOf(back)}>
        <CaretLeftIcon weight="bold" aria-hidden />
        {backLabel}
      </a>
      <div className="picture-hero">
        {picture}
        <div className="picture-side">
          <div className="picture-names">
            <h2 className="section">{title}</h2>
            {children}
          </div>
          <div className="picture-actions">
            <div className="picture-play" ref={playPlace} />
            {heart}
            {edit}
          </div>
        </div>
      </div>
    </header>
  );
}
