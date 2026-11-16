/**
 * @file The long files a song list was found for, read again whenever the Tracks change.
 */

import { useEffect, useState } from "react";

import { type SplitOffers, api } from "../api";

const NONE: SplitOffers = { setting: "off", files: [] };

/** The split offers, read when `version` changes, and a way to read them again. */
export function useSplitOffers(version: unknown): {
  readonly offers: SplitOffers;
  readonly reload: () => void;
} {
  const [offers, setOffers] = useState<SplitOffers>(NONE);
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let current = true;
    api.splitOffers().then(
      (answer) => {
        if (current) {
          setOffers(answer);
        }
      },
      () => {
        // Without the offers there is nothing to split; the Library works on.
      },
    );
    return () => {
      current = false;
    };
  }, [version, reads]);
  return {
    offers,
    reload: () => {
      setReads((count) => count + 1);
    },
  };
}
