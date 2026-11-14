/**
 * @file The Library's artist names, what MusicBrainz knows of them, and their links.
 *
 * They are read again whenever `version` changes, as it does with the Tracks, after
 * a change made here, and every 2 seconds while MusicBrainz is being asked about any.
 */

import { useEffect, useState } from "react";

import { type ArtistNames, api } from "../api";

/** How often the names are read again while a name is being looked up. */
const FINDING_EVERY_MS = 2000;
const NONE: ArtistNames = { names: [], artists: [] };

/** The artist names, and a way to read them again after changing one. */
export function useArtistNames(version: unknown): {
  readonly names: ArtistNames;
  readonly reload: () => void;
} {
  const [names, setNames] = useState<ArtistNames>(NONE);
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const finding = names.names.some((each) => each.finding);
  useEffect(() => {
    let current = true;
    api.artistNames().then(
      (found) => {
        if (current) {
          setNames(found);
        }
      },
      () => {
        // Without them every name is an artist of its own; the Library works on.
      },
    );
    return () => {
      current = false;
    };
  }, [version, reads]);
  useEffect(() => {
    if (!finding) {
      return;
    }
    const timer = setTimeout(() => {
      setReads((count) => count + 1);
    }, FINDING_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [finding, names]);
  return {
    names,
    reload: () => {
      setReads((count) => count + 1);
    },
  };
}
