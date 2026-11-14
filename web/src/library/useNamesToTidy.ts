/**
 * @file The artist and album names written with more than the name in them, to tidy.
 *
 * They are read again whenever `version` changes, as it does with the Tracks, and after
 * a change made here.
 */

import { useEffect, useState } from "react";

import { type NameToTidy, api } from "../api";

/** The names to tidy, and a way to read them again after tidying or keeping one. */
export function useNamesToTidy(version: unknown): {
  readonly names: readonly NameToTidy[];
  readonly reload: () => void;
} {
  const [names, setNames] = useState<readonly NameToTidy[]>([]);
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let current = true;
    api.namesToTidy().then(
      (answer) => {
        if (current) {
          setNames(answer.names);
        }
      },
      () => {
        // Without the list there is nothing to offer; the Library works on.
      },
    );
    return () => {
      current = false;
    };
  }, [version, reads]);
  return {
    names,
    reload: () => {
      setReads((count) => count + 1);
    },
  };
}
