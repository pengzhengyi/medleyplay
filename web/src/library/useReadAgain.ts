/**
 * @file Something read from the server, read again whenever the Tracks change.
 */

import { useEffect, useState } from "react";

/**
 * Return what `read` answers, `none` until it does, read again when `version` changes,
 * and a way to read it again.
 */
export function useReadAgain<T>(
  read: () => Promise<T>,
  none: T,
  version: unknown,
): { readonly value: T; readonly reload: () => void } {
  const [value, setValue] = useState<T>(none);
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let current = true;
    read().then(
      (answer) => {
        if (current) {
          setValue(answer);
        }
      },
      () => {
        // Without an answer there is nothing more to offer; the Library works on.
      },
    );
    return () => {
      current = false;
    };
  }, [read, version, reads]);
  return {
    value,
    reload: () => {
      setReads((count) => count + 1);
    },
  };
}
