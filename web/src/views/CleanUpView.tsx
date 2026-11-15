/**
 * @file Clean up: the Library's names that could read better, to tidy or to link, in one place.
 *
 * Each kind of change is a section with how many names wait and a way to do them all
 * at once. The rail's *Clean up* says how many names wait in all, so the views these
 * names show in need no row of their own for them.
 */

import type { ArtistNames, NameToTidy, Track } from "../api";
import { unlinkedOf } from "../library/cleanUp";
import { LinkArtists } from "./LinkArtists";
import { TidyNames } from "./TidyNames";

/** Names read from the server, and a way to read them again after a change. */
interface Read<T> {
  readonly names: T;
  readonly reload: () => void;
}

/** The names to tidy and to link. */
export function CleanUpView({
  tidy,
  artistNames,
  tracks = [],
}: {
  readonly tidy: Read<readonly NameToTidy[]>;
  readonly artistNames: Read<ArtistNames> | undefined;
  /** The Library's songs, to show the songs of each name to link. */
  readonly tracks?: readonly Track[];
}) {
  const toTidy = tidy.names.length;
  const toLink = artistNames === undefined ? 0 : unlinkedOf(artistNames.names);
  const linkable = artistNames?.names.names.some((each) => each.look_up !== "never") ?? false;
  return (
    <>
      <header className="view-heading">
        <h2 className="section">Clean up</h2>
        <p className="meta">{summaryOf(toTidy, toLink)}</p>
      </header>
      {toTidy === 0 && !linkable ? (
        <p className="empty">
          Nothing to clean up. Names that could be tidied, or linked to one artist, show here.
        </p>
      ) : (
        <div className="clean-up">
          {toTidy > 0 && <TidyNames names={tidy.names} onChanged={tidy.reload} />}
          {artistNames !== undefined && linkable && (
            <LinkArtists names={artistNames.names} tracks={tracks} onChanged={artistNames.reload} />
          )}
        </div>
      )}
    </>
  );
}

function summaryOf(toTidy: number, toLink: number): string {
  const waiting = [
    toTidy > 0 && `${String(toTidy)} ${toTidy === 1 ? "name" : "names"} to tidy`,
    toLink > 0 && `${String(toLink)} to link`,
  ].filter(Boolean);
  return waiting.length === 0 ? "Every name is tidy and linked." : waiting.join(", ");
}
