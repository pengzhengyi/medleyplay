/**
 * @file Clean up: the Library's names that could read better, to tidy or to link, in one place.
 *
 * Each kind of change is a section with how many names wait and a way to do them all
 * at once. A bar above them goes to each; the sections with names waiting come first,
 * and those done last. The rail's *Clean up* says how many names wait in all, so the
 * views these names show in need no row of their own for them.
 */

import { CheckIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type {
  ArtistNames,
  ArtistSplits,
  MissingPhoto,
  NameToTidy,
  SharedName,
  SplitOffers,
  Track,
} from "../api";
import {
  inOrderOfWaiting,
  photosToUseOf,
  toSplitOf,
  toTellApartOf,
  unlinkedOf,
} from "../library/cleanUp";
import { FindPhotos } from "./FindPhotos";
import { LinkArtists } from "./LinkArtists";
import { SharedNames } from "./SharedNames";
import { SplitArtistNames } from "./SplitArtistNames";
import { SplitFiles } from "./SplitFiles";
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
  splits,
  artistSplits,
  sharedNames,
  missingPhotos,
  onEditSongs,
}: {
  readonly tidy: Read<readonly NameToTidy[]>;
  readonly artistNames: Read<ArtistNames> | undefined;
  /** The Library's Tracks, split files too, to show and rename the songs of each name to link. */
  readonly tracks?: readonly Track[];
  /** The long files to split, and a way to open one's songs. */
  readonly splits?: Read<SplitOffers>;
  /** The artist names written as several artists, to split or keep. */
  readonly artistSplits?: Read<ArtistSplits>;
  /** The names that may name several artists, to tell apart by album or keep as one. */
  readonly sharedNames?: Read<readonly SharedName[]>;
  /** The artists linked to MusicBrainz with no photo, each with any photo suggested. */
  readonly missingPhotos?: {
    readonly artists: readonly MissingPhoto[];
    readonly reload: () => void;
  };
  readonly onEditSongs?: (trackId: number) => void;
}) {
  const toSplitNames = artistSplits?.names.offers.length ?? 0;
  const splittingNames =
    artistSplits !== undefined && (toSplitNames > 0 || artistSplits.names.decided.length > 0);
  const toTidy = tidy.names.length;
  const toSplit = toSplitOf(splits?.names);
  const splitting =
    splits !== undefined && splits.names.setting !== "off" && splits.names.files.length > 0;
  const toLink = artistNames === undefined ? 0 : unlinkedOf(artistNames.names);
  const linkable = artistNames?.names.names.some((each) => each.look_up !== "never") ?? false;
  const toTellApart = toTellApartOf(sharedNames?.names);
  const sharing = (sharedNames?.names.length ?? 0) > 0;
  const toUse = photosToUseOf(missingPhotos?.artists);
  const photoless = (missingPhotos?.artists.length ?? 0) > 0;
  const sections = inOrderOfWaiting<Section>([
    ...(toTidy > 0
      ? [
          {
            id: "clean-up-tidy",
            title: "Tidy names",
            waiting: toTidy,
            body: <TidyNames names={tidy.names} onChanged={tidy.reload} />,
          },
        ]
      : []),
    ...(splits !== undefined && splitting
      ? [
          {
            id: "clean-up-split",
            title: "Split albums",
            waiting: toSplit,
            body: (
              <SplitFiles
                files={splits.names.files}
                onChanged={splits.reload}
                {...(onEditSongs === undefined ? {} : { onEditSongs })}
              />
            ),
          },
        ]
      : []),
    ...(artistSplits !== undefined && splittingNames
      ? [
          {
            id: "clean-up-split-names",
            title: "Split artist names",
            waiting: toSplitNames,
            body: <SplitArtistNames splits={artistSplits.names} onChanged={artistSplits.reload} />,
          },
        ]
      : []),
    ...(sharedNames !== undefined && sharing
      ? [
          {
            id: "clean-up-shared-names",
            title: "Artists sharing a name",
            waiting: toTellApart,
            body: (
              <SharedNames
                names={sharedNames.names}
                known={artistNames?.names.artists ?? []}
                tracks={tracks}
                onChanged={sharedNames.reload}
              />
            ),
          },
        ]
      : []),
    ...(missingPhotos !== undefined && photoless
      ? [
          {
            id: "clean-up-photos",
            title: "Find artist photos",
            waiting: toUse,
            body: <FindPhotos artists={missingPhotos.artists} onChanged={missingPhotos.reload} />,
          },
        ]
      : []),
    ...(artistNames !== undefined && linkable
      ? [
          {
            id: "clean-up-link",
            title: "Link artist names",
            waiting: toLink,
            body: (
              <LinkArtists
                names={artistNames.names}
                tracks={tracks}
                onChanged={artistNames.reload}
              />
            ),
          },
        ]
      : []),
  ]);
  return (
    <>
      <header className="view-heading">
        <h2 className="section" data-rail-named>
          Clean up
        </h2>
        <p className="meta">
          {summaryOf(toTidy, toLink, toSplit, toSplitNames, toTellApart, toUse)}
        </p>
      </header>
      {toTidy === 0 && !linkable && !splitting && !splittingNames && !sharing && !photoless ? (
        <p className="empty">
          Nothing to clean up. Names that could be tidied or linked to one artist, and long files to
          split into songs, show here.
        </p>
      ) : (
        <>
          <SectionBar sections={sections} />
          <div className="clean-up">
            {sections.map(({ id, body }) => (
              <div key={id} id={id} className="clean-up-anchor">
                {body}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** One kind of change: where it is, its name, how many names wait, and the section itself. */
interface Section {
  readonly id: string;
  readonly title: string;
  readonly waiting: number;
  readonly body: ReactNode;
}

/** A pill for each section, in the order they show, saying how many wait or that it is done. */
function SectionBar({ sections }: { readonly sections: readonly Section[] }) {
  return (
    <nav className="settings-toc clean-up-toc" aria-label="Clean up sections">
      <ul>
        {sections.map(({ id, title, waiting }) => (
          <li key={id}>
            <button
              type="button"
              className="secondary outline"
              aria-label={`Go to ${title}, ${waiting > 0 ? `${String(waiting)} waiting` : "done"}`}
              onClick={() => {
                document.getElementById(id)?.scrollIntoView({ block: "start" });
              }}
            >
              {title}
              {waiting > 0 ? (
                <span className="clean-up-toc-count" aria-hidden>
                  {waiting}
                </span>
              ) : (
                <CheckIcon className="clean-up-toc-done" weight="bold" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function summaryOf(
  toTidy: number,
  toLink: number,
  toSplit: number,
  toSplitNames: number,
  toTellApart: number,
  toUse: number,
): string {
  const waiting = [
    toTidy > 0 && `${String(toTidy)} ${toTidy === 1 ? "name" : "names"} to tidy`,
    toSplitNames > 0 &&
      `${String(toSplitNames)} artist ${toSplitNames === 1 ? "name" : "names"} to split`,
    toLink > 0 && `${String(toLink)} to link`,
    toTellApart > 0 &&
      `${String(toTellApart)} shared ${toTellApart === 1 ? "name" : "names"} to tell apart`,
    toUse > 0 && `${String(toUse)} artist ${toUse === 1 ? "photo" : "photos"} to use`,
    toSplit > 0 && `${String(toSplit)} ${toSplit === 1 ? "file" : "files"} to split`,
  ].filter(Boolean);
  return waiting.length === 0 ? "Every name is tidy and linked." : waiting.join(", ");
}
