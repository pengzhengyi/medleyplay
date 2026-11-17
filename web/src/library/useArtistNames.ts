/**
 * @file The Library's artist names, what MusicBrainz knows of them, and their links.
 *
 * Nothing is read while `version` is `undefined`, as before the Tracks are in. They
 * are read again whenever `version` changes, as it does with the Tracks, after
 * a change made here, and every 2 seconds while MusicBrainz is being asked about any,
 * Wikidata about a linked artist's other names, or an AI model which artists they name.
 */

import { useEffect, useRef, useState } from "react";

import { type ArtistNames, api } from "../api";
import { whenIdle } from "./stages";

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
  const finding = names.recommending === true || names.names.some((each) => each.finding);
  const readBefore = useRef(false);
  useEffect(() => {
    if (version === undefined) {
      return;
    }
    let current = true;
    const readNow = () => {
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
    };
    // The first read waits until the page is drawn and the browser idle.
    let cancel: (() => void) | undefined;
    if (readBefore.current) {
      readNow();
    } else {
      cancel = whenIdle(readNow);
    }
    readBefore.current = true;
    return () => {
      current = false;
      cancel?.();
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
