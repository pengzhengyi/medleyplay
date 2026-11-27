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
  MissingCover,
  MissingDetailReview,
  MissingPhoto,
  NameToTidy,
  SharedName,
  SplitOffers,
  Track,
} from "../api";
import {
  inOrderOfWaiting,
  coversToUseOf,
  photosToUseOf,
  toSplitOf,
  toTellApartOf,
  unlinkedOf,
} from "../library/cleanUp";
import { type AlbumCoverActions, FindAlbumCovers } from "./FindAlbumCovers";
import { FindPhotos } from "./FindPhotos";
import { MissingDetails } from "./MissingDetails";
import { type Words, useFormattingLocale, useWords } from "../locale";
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
  missingCovers,
  albumCovers,
  missingDetails,
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
    readonly answered: number;
  };
  /** The albums with no cover, each with any cover suggested. */
  readonly missingCovers?: {
    readonly albums: readonly MissingCover[];
    readonly reload: () => void;
    readonly answered: number;
    /** Read the songs again once covers found were used, so their albums show them. */
    readonly onUsed?: () => void;
  };
  /** How a cover chosen in the cover editor is set on an album. */
  readonly albumCovers?: AlbumCoverActions | undefined;
  readonly missingDetails?: {
    readonly revision: string;
    readonly onEdit: (track: number, review?: MissingDetailReview) => void;
  };
  readonly onEditSongs?: (trackId: number) => void;
}) {
  const t = useWords();
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
  const missingAnyPhoto = (missingPhotos?.artists.length ?? 0) > 0;
  const coversToUse = coversToUseOf(missingCovers?.albums);
  const missingAnyCover = (missingCovers?.albums.length ?? 0) > 0;
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
    ...(missingPhotos !== undefined && missingAnyPhoto
      ? [
          {
            id: "clean-up-photos",
            title: "Find artist photos",
            waiting: toUse,
            artwork: true,
            body: (
              <FindPhotos
                artists={missingPhotos.artists}
                answered={missingPhotos.answered}
                onChanged={missingPhotos.reload}
              />
            ),
          },
        ]
      : []),
    ...(missingCovers !== undefined && missingAnyCover
      ? [
          {
            id: "clean-up-covers",
            title: "Find album covers",
            waiting: coversToUse,
            artwork: true,
            body: (
              <FindAlbumCovers
                albums={missingCovers.albums}
                answered={missingCovers.answered}
                tracks={tracks}
                actions={albumCovers}
                onChanged={missingCovers.reload}
                onUsed={missingCovers.onUsed}
              />
            ),
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
  const allSections =
    missingDetails === undefined
      ? sections
      : [
          {
            id: "clean-up-missing-details",
            title: "Missing artist or album",
            waiting: null,
            body: <MissingDetails {...missingDetails} />,
          },
          ...sections,
        ];
  return (
    <>
      <header className="view-heading">
        <h2 className="section" data-rail-named>
          {t("Clean up")}
        </h2>
        <p className="meta">
          {summaryOf(t, toTidy, toLink, toSplit, toSplitNames, toTellApart, toUse, coversToUse)}
        </p>
      </header>
      {toTidy === 0 &&
      !linkable &&
      !splitting &&
      !splittingNames &&
      !sharing &&
      !missingAnyPhoto &&
      !missingAnyCover &&
      missingDetails === undefined ? (
        <p className="empty">
          {t(
            "Nothing to clean up. Names that could be tidied or linked to one artist, and long files to split into songs, show here.",
          )}
        </p>
      ) : (
        <>
          <SectionBar sections={allSections} />
          <div className="clean-up">
            {allSections.map(({ id, body }) => (
              <div key={id} id={id} className="clean-up-anchor" tabIndex={-1}>
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
  readonly artwork?: boolean;
  readonly body: ReactNode;
}

/** A pill for each section, in the order they show, saying how many wait or that it is done. */
function SectionBar({
  sections,
}: {
  readonly sections: readonly (Omit<Section, "waiting"> & { readonly waiting: number | null })[];
}) {
  const t = useWords();
  const number = new Intl.NumberFormat(useFormattingLocale());
  return (
    <nav className="settings-toc clean-up-toc" aria-label={t("Clean up sections")}>
      <ul>
        {sections.map(({ id, title, waiting, artwork = false }) => (
          <li key={id}>
            <button
              type="button"
              className="secondary outline"
              aria-label={
                waiting === null
                  ? t("Go to {{section}}", { section: t(title) })
                  : waiting > 0
                    ? t("Go to {{section}}, {{pending}} waiting", {
                        section: t(title),
                        pending: number.format(waiting),
                      })
                    : t(
                        artwork
                          ? "Go to {{section}}, no suggestions to review"
                          : "Go to {{section}}, done",
                        { section: t(title) },
                      )
              }
              onClick={() => {
                const target = document.getElementById(id);
                target?.focus({ preventScroll: true });
                target?.scrollIntoView({ block: "start" });
              }}
            >
              {t(title)}
              {waiting === null ? null : waiting > 0 ? (
                <span className="clean-up-toc-count" aria-hidden>
                  {number.format(waiting)}
                </span>
              ) : !artwork ? (
                <CheckIcon className="clean-up-toc-done" weight="bold" aria-hidden />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function summaryOf(
  t: Words,
  toTidy: number,
  toLink: number,
  toSplit: number,
  toSplitNames: number,
  toTellApart: number,
  toUse: number,
  coversToUse: number,
): string {
  const waiting = [
    toTidy > 0 && t("cleanup_tidy", { count: toTidy }),
    toSplitNames > 0 && t("cleanup_split_artist", { count: toSplitNames }),
    toLink > 0 && t("{{count}} to link", { count: toLink }),
    toTellApart > 0 && t("cleanup_shared", { count: toTellApart }),
    toUse > 0 && t("cleanup_photos", { count: toUse }),
    coversToUse > 0 && t("cleanup_covers", { count: coversToUse }),
    toSplit > 0 && t("cleanup_files", { count: toSplit }),
  ].filter(Boolean);
  return waiting.length === 0 ? t("Every name is tidy and linked.") : waiting.join(t(", "));
}
