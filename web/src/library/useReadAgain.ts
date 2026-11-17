/**
 * @file Something read from the server, read again whenever the Tracks change.
 */

import { useEffect, useRef, useState } from "react";

import { whenIdle } from "./stages";

/**
 * Return what `read` answers, `none` until it does, read again when `version` changes,
 * and a way to read it again. Nothing is read while `version` is `undefined`, as before
 * the Tracks are in; the first read waits until the browser is idle, so the page is
 * drawn first.
 */
export function useReadAgain<T>(
  read: () => Promise<T>,
  none: T,
  version: unknown,
): { readonly value: T; readonly reload: () => void } {
  const [value, setValue] = useState<T>(none);
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const readBefore = useRef(false);
  useEffect(() => {
    if (version === undefined) {
      return;
    }
    let current = true;
    const readNow = () => {
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
    };
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
  }, [read, version, reads]);
  return {
    value,
    reload: () => {
      setReads((count) => count + 1);
    },
  };
}
